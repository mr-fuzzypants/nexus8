"""
Video operation registry and job lifecycle.

Operations come in two kinds (see SRED_VIDEOOP_EXPERIMENTS.md):

- ``selection`` ops produce a MaskTrack version (segment/track via SAM 2).
- ``generative`` ops consume the video + a mask track version and produce new
  pixels — a new video asset (remove, inpaint, outpaint, restyle…).

Both share one batch job envelope: dispatch (stage inputs, spawn Modal job)
→ poll → ingest, recorded on an :class:`~trackables.models.OperationJob`.
Interactive per-op loops (segment's preview / session clicks) are deliberately
NOT generalized — they stay as op-specific endpoints in views_video_masks.
"""

import logging
import os
import time

from django.conf import settings
from django.utils import timezone

from ..models import MaskTrack, OperationJob
from .video_staging import VideoFrameStager, FrameStagingError

logger = logging.getLogger(__name__)

SEGMENT_MODAL_APP = "nexus8-videoseg"
REMOVE_MODAL_APP = "nexus8-videoremove"
VOID_MODAL_APP = "nexus8-videovoid"

# SAM 2 holds every frame's features in GPU memory, so cap the window we send.
MAX_SPAN_FRAMES = 600

# Removal tiers (H4). fast = VACE-1.3B on L40S: one denoising window,
# num_frames ≡ 1 mod 4, 81 ≈ its native window. quality = VOID pass 1 on
# A100: windowed multidiffusion (85-frame windows) up to its 197-frame cap.
# F21a: fast hallucinates contextually-implied subjects back in — route
# person/subject removal to quality.
REMOVE_TIERS = {
    "fast": {
        "app": REMOVE_MODAL_APP,
        "cls": "VideoRemover",
        "max_frames": 81,
        "model": "Wan2.1-VACE-1.3B",
        "deploy_hint": "modal deploy modal_functions/video_remove.py",
    },
    "quality": {
        "app": VOID_MODAL_APP,
        "cls": "VoidRemover",
        "max_frames": 197,
        "model": "VOID-pass1",
        "deploy_hint": "modal deploy modal_functions/video_void.py",
    },
}
# Resolution tier used for segmentation; masks are upscaled to native on apply.
DEFAULT_STAGING_TIER = "preview_480p"


class OpError(Exception):
    """Dispatch/ingest failure with an HTTP status for the view layer."""

    def __init__(self, message: str, http_status: int = 400):
        super().__init__(message)
        self.http_status = http_status


def resolve_local_path(file_path: str) -> str | None:
    """Resolve a stored file reference to an absolute local filesystem path.

    ``file_path`` is stored as ``/media/assets/originals/<hash>.mov`` (i.e.
    prefixed with MEDIA_URL). Mirrors views_inpaint._media_bytes.
    """
    if not file_path:
        return None
    if file_path.startswith(settings.MEDIA_URL):
        return os.path.join(settings.MEDIA_ROOT, file_path[len(settings.MEDIA_URL):])
    if file_path.startswith("/") and "://" not in file_path:
        return file_path
    return None


class VideoOp:
    """Base class for registered video operations.

    Subclasses set the class attrs and implement ``dispatch``/``ingest``.
    ``dispatch`` stages inputs, spawns the remote job, and writes everything
    the poll side will need into ``job.inputs`` (the view never smuggles
    dispatch state back through query params). ``ingest`` turns the raw Modal
    result into persisted entities and returns the response payload.
    """

    name: str = ""
    label: str = ""
    # Verb shown in poll progress strings ("Segmenting… 12s").
    progress_label: str = "Working"
    kind: str = "generative"  # 'selection' | 'generative'
    requires_mask_track: bool = False
    available: bool = True

    def dispatch(self, job: OperationJob) -> None:
        raise NotImplementedError

    def ingest(self, job: OperationJob, result: dict) -> dict:
        raise NotImplementedError

    def describe(self) -> dict:
        return {
            "name": self.name,
            "label": self.label,
            "kind": self.kind,
            "requires_mask_track": self.requires_mask_track,
            "available": self.available,
        }


class SegmentOp(VideoOp):
    """SAM 2 mask propagation — the selection op. Produces a MaskTrack version."""

    name = "segment"
    label = "Select / Track"
    progress_label = "Segmenting"
    kind = "selection"
    requires_mask_track = False  # it *creates* the track

    def dispatch(self, job: OperationJob) -> None:
        video = job.asset
        inputs = job.inputs
        prompt_frames = inputs.get("prompt_frames") or []
        propagation_params = inputs.get("propagation_params") or {}
        if not prompt_frames or not propagation_params:
            raise OpError("Missing prompt_frames or propagation_params")

        t_start = time.time()
        tag = f"[{self.name} {str(job.asset_id)[:8]}/{job.layer_id[:8]}]"
        logger.info(f"{tag} START — {len(prompt_frames)} prompt frame(s), "
                    f"params={propagation_params}")

        # ── Resolve the propagation span ───────────────────────────────────
        # SAM 2 holds every frame's features in GPU memory, so we process a
        # bounded window, not the whole clip. The client sends span_start/
        # span_end (absolute frame indices); we clamp to MAX_SPAN_FRAMES.
        prompt_indices = [pf.get("frame_index", 0) for pf in prompt_frames]
        span_start = propagation_params.get("span_start")
        span_end = propagation_params.get("span_end")
        if span_start is None:
            span_start = min(prompt_indices) if prompt_indices else 0
        if span_end is None:
            span_end = span_start + MAX_SPAN_FRAMES - 1
        span_start = max(0, int(span_start))
        span_end = int(span_end)
        if span_end < span_start:
            span_start, span_end = span_end, span_start
        if span_end - span_start + 1 > MAX_SPAN_FRAMES:
            span_end = span_start + MAX_SPAN_FRAMES - 1
            logger.warning(f"{tag} span capped to {MAX_SPAN_FRAMES} frames "
                           f"[{span_start}, {span_end}]")

        # Keep only prompts inside the span — SAM 2 can't use a click for a
        # frame it never sees. Drop the rest (they belong to other spans).
        in_span = [pf for pf in prompt_frames
                   if span_start <= pf.get("frame_index", 0) <= span_end]
        dropped = len(prompt_frames) - len(in_span)
        if dropped:
            logger.info(f"{tag} dropped {dropped} prompt frame(s) outside span")
        if not in_span:
            raise OpError(
                f"No prompt frames fall within the selected span "
                f"[{span_start}, {span_end}] — your keyframes are at "
                f"{sorted(prompt_indices)}. Draw a mask inside the span, "
                f"or adjust the span to include your keyframes."
            )

        # Rebase prompt frame indices to be span-relative (span_start → 0).
        span_prompt_frames = [
            {**pf, "frame_index": pf.get("frame_index", 0) - span_start}
            for pf in in_span
        ]
        logger.info(f"{tag} span [{span_start}, {span_end}] "
                    f"({span_end - span_start + 1} frames), "
                    f"{len(in_span)} prompt(s) in span")

        # Get or create the mask track for this (video, layer). Persist the
        # layer's name/colour so it can be restored on reload (ids churn).
        track, created = MaskTrack.objects.get_or_create_for_video_and_layer(
            video_id=str(video.id),
            layer_id=job.layer_id,
            layer_name=inputs.get("layer_name"),
            layer_color=inputs.get("layer_color"),
        )
        logger.info(f"{tag} track {'created' if created else 'reused'} id={track.id}")

        # Stage frames — extract JPEGs with ffmpeg at the requested tier.
        video_path = resolve_local_path(video.file_path)
        if not video_path or not os.path.exists(video_path):
            logger.warning(f"{tag} video file not found: {video.file_path!r}")
            raise OpError(f"Video file not found for asset {video.id}", 404)
        tier = inputs.get("staging_tier") or DEFAULT_STAGING_TIER
        if tier not in VideoFrameStager.TIERS:
            tier = DEFAULT_STAGING_TIER
        logger.info(f"{tag} staging span [{span_start}, {span_end}] "
                    f"({tier}) from {video_path} …")
        t_stage = time.time()
        try:
            staging_dir = VideoFrameStager.extract_frames(
                video_path,
                asset_id=str(video.id),
                version_id=str(video.id),
                tier=tier,
                frame_range=(span_start, span_end),
            )
        except FrameStagingError as e:
            logger.error(f"{tag} frame staging FAILED: {e}")
            raise OpError(f"Frame staging failed: {e}", 500)
        frame_count = len(list(staging_dir.glob("frame_*.jpg")))
        logger.info(f"{tag} staged {frame_count} frames in "
                    f"{time.time() - t_stage:.1f}s → {staging_dir}")

        # ── Rescale click prompts to the staged frame size ─────────────────
        # Clicks arrive in native pixel coords (source_size), but the staged
        # frames SAM 2 sees are downscaled. Without rescaling, a click on a
        # foreground character lands on unrelated background.
        source_size = inputs.get("source_size") or {}
        src_w, src_h = source_size.get("width"), source_size.get("height")
        if src_w and src_h:
            from PIL import Image as PILImage
            first_frame = sorted(staging_dir.glob("frame_*.jpg"))[0]
            with PILImage.open(first_frame) as im:
                staged_w, staged_h = im.size
            sx, sy = staged_w / src_w, staged_h / src_h
            if abs(sx - 1.0) > 1e-6 or abs(sy - 1.0) > 1e-6:
                for pf in span_prompt_frames:
                    for click in pf.get("clicks", []):
                        click["x"] = click["x"] * sx
                        click["y"] = click["y"] * sy
                logger.info(f"{tag} rescaled clicks {src_w}x{src_h} → "
                            f"{staged_w}x{staged_h} (x{sx:.3f}, x{sy:.3f})")
        else:
            logger.warning(f"{tag} no source_size in inputs — clicks NOT rescaled; "
                           f"coordinates may misalign with staged frames")

        # Persist everything the poll/ingest side needs.
        job.inputs.update({
            "span_start": span_start,
            "span_end": span_end,
            "staging_tier": tier,
            "track_id": str(track.id),
            "span_prompt_frames": span_prompt_frames,
            "propagation_params": propagation_params,
        })

        # Dispatch to the Modal SAM 2 app.
        try:
            import modal

            # Credentials resolve from ~/.modal.toml (CLI auth) or the
            # MODAL_TOKEN_ID / MODAL_TOKEN_SECRET env vars.
            try:
                # Instantiate the Cls (trailing ()) before accessing its
                # methods — without it Modal raises AttributeError.
                segmentor = modal.Cls.from_name(SEGMENT_MODAL_APP, "VideoSegmentor")()
                logger.info(f"{tag} building span archive [{span_start}, {span_end}] …")
                t_arc = time.time()
                frames_archive = VideoFrameStager.create_frame_archive(staging_dir)
                logger.info(f"{tag} archive {len(frames_archive) / 1e6:.1f} MB "
                            f"in {time.time() - t_arc:.1f}s; dispatching to Modal …")

                # session_key/meta: the GPU container retains the inference
                # state after propagation so correction clicks on propagated
                # frames refine the existing mask (see session_click).
                modal_call = segmentor.propagate.spawn(
                    frames_tar_gz=frames_archive,
                    prompt_frames=span_prompt_frames,
                    propagation_params=propagation_params,
                    session_key=f"{job.asset_id}:{job.layer_id}",
                    session_meta={"tier": tier, "span_start": span_start},
                )
                job.modal_call_id = modal_call.object_id
                logger.info(f"{tag} DISPATCHED call_id={job.modal_call_id} "
                            f"(total {time.time() - t_start:.1f}s)")
            except (LookupError, modal.Error) as e:
                # Modal app not deployed / auth missing; fall back to mock.
                logger.warning(f"{tag} Modal dispatch unavailable ({e}); using MOCK response")
                job.modal_call_id = f"call-mock-{str(track.id)[:8]}"
        except ImportError:
            logger.warning(f"{tag} modal library not installed; using MOCK response")
            job.modal_call_id = f"call-mock-{str(track.id)[:8]}"

    def ingest(self, job: OperationJob, result: dict) -> dict:
        track = MaskTrack.objects.get(pk=job.inputs["track_id"])
        frames = result.get("frames", [])
        latency_s = result.get("latency_s", 0)
        tag = f"[{self.name} ingest {job.modal_call_id}]"

        # SAM 2 indexed frames span-relative (0-based within the archive).
        # Rebase to absolute frame numbers so the timeline lines up.
        span_start = int(job.inputs.get("span_start") or 0)
        if span_start:
            for f in frames:
                if "frame_index" in f:
                    f["frame_index"] = f["frame_index"] + span_start

        # Correction (span-limited re-propagation): overlay the re-run frames
        # onto the prior version's frames, so the untouched part of the track
        # is preserved with its provenance rather than recomputed.
        prior_version_id = None
        corrected_frames = None
        if job.inputs.get("correction"):
            prior = track.versions.order_by("-version_number").first()
            if prior:
                prior_version_id = str(prior.id)
                corrected_frames = sorted(f["frame_index"] for f in frames
                                          if "frame_index" in f)
                merged = {f["frame_index"]: f for f in prior.data.get("frames", [])
                          if "frame_index" in f}
                merged.update({f["frame_index"]: f for f in frames
                               if "frame_index" in f})
                frames = [merged[i] for i in sorted(merged)]
                logger.info(f"{tag} correction merged: {len(corrected_frames)} re-run "
                            f"frame(s) over {len(frames)} total")

        dispatch_at_ms = (int(job.dispatched_at.timestamp() * 1000)
                          if job.dispatched_at else 0)
        version = track.add_propagation_result(
            propagation_model="SAM2",
            propagation_model_version="v2.1",
            prompt_frames=job.inputs.get("span_prompt_frames", []),
            propagation_params=job.inputs.get("propagation_params", {}),
            frames=frames,
            modal_call_id=job.modal_call_id,
            dispatch_at_ms=dispatch_at_ms,
            result_at_ms=int(timezone.now().timestamp() * 1000),
            prior_version_id=prior_version_id,
            corrected_frames=corrected_frames,
        )

        return {
            "track_id": str(track.id),
            "version_id": str(version.id),
            "frames_processed": len(frames),
            "latency_s": latency_s,
        }


class RemoveOp(VideoOp):
    """Object removal — mask track version + video → derived video asset.

    Phase 2.1 of SRED_VIDEOOP_EXPERIMENTS.md: Wan2.1-VACE-1.3B preview tier,
    steered by background-description prompting (H5). The result is stored as
    a layer render of the source video (op='remove') with VersionLink lineage
    to the exact source-video version and mask-track version (2.5).
    """

    name = "remove"
    label = "Remove"
    progress_label = "Removing"
    kind = "generative"
    requires_mask_track = True

    def dispatch(self, job: OperationJob) -> None:
        import tarfile

        from ..models import Version

        video = job.asset
        inputs = job.inputs
        if not job.layer_id:
            raise OpError("remove requires layer_id (the mask layer to remove)")
        tier_name = job.params.get("tier") or "fast"
        tier = REMOVE_TIERS.get(tier_name)
        if not tier:
            raise OpError(f"Unknown removal tier {tier_name!r}. "
                          f"Known tiers: {sorted(REMOVE_TIERS)}")

        tag = f"[{self.name}:{tier_name} {str(job.asset_id)[:8]}/{job.layer_id[:8]}]"
        t_start = time.time()

        # ── Resolve the mask track version ─────────────────────────────────
        track = MaskTrack.objects.for_video_and_layer(str(video.id), job.layer_id)
        if not track:
            raise OpError("No mask track exists for this layer — propagate first", 404)
        try:
            mask_version = Version.objects.get(
                pk=inputs["mask_track_version_id"], entity=track
            )
        except Version.DoesNotExist:
            raise OpError("mask_track_version_id does not belong to this "
                          "layer's mask track", 404)

        mask_by_frame = {
            f["frame_index"]: f["mask_png_b64"]
            for f in mask_version.data.get("frames", [])
            if "frame_index" in f and f.get("mask_png_b64")
        }
        if not mask_by_frame:
            raise OpError("Mask track version has no frame masks")

        # ── Resolve the removal span ───────────────────────────────────────
        # Default to the masked extent; an explicit sub-span narrows it.
        # Cap at the VACE single-window limit (see REMOVE_MAX_FRAMES).
        mask_lo, mask_hi = min(mask_by_frame), max(mask_by_frame)
        span_start = int(inputs.get("span_start") if inputs.get("span_start")
                         is not None else mask_lo)
        span_end = int(inputs.get("span_end") if inputs.get("span_end")
                       is not None else mask_hi)
        if span_end < span_start:
            span_start, span_end = span_end, span_start
        span_start = max(span_start, 0)
        if span_end - span_start + 1 > tier["max_frames"]:
            span_end = span_start + tier["max_frames"] - 1
            logger.warning(f"{tag} span capped to {tier['max_frames']} frames "
                           f"[{span_start}, {span_end}]")
        if not any(span_start <= i <= span_end for i in mask_by_frame):
            raise OpError(f"No mask frames fall within the span "
                          f"[{span_start}, {span_end}]")
        logger.info(f"{tag} span [{span_start}, {span_end}], "
                    f"{sum(1 for i in mask_by_frame if span_start <= i <= span_end)}"
                    f" masked frame(s)")

        # ── Stage RGB frames ───────────────────────────────────────────────
        video_path = resolve_local_path(video.file_path)
        if not video_path or not os.path.exists(video_path):
            raise OpError(f"Video file not found for asset {video.id}", 404)
        staging_tier = inputs.get("staging_tier") or DEFAULT_STAGING_TIER
        if staging_tier not in VideoFrameStager.TIERS:
            staging_tier = DEFAULT_STAGING_TIER
        try:
            staging_dir = VideoFrameStager.extract_frames(
                video_path,
                asset_id=str(video.id),
                version_id=str(video.id),
                tier=staging_tier,
                frame_range=(span_start, span_end),
            )
        except FrameStagingError as e:
            raise OpError(f"Frame staging failed: {e}", 500)

        # ── Build the mask archive (span-relative naming, sparse) ──────────
        import base64 as _b64
        import io as _io

        buf = _io.BytesIO()
        with tarfile.open(fileobj=buf, mode="w:gz") as tar:
            for frame_index, mask_b64 in mask_by_frame.items():
                if not span_start <= frame_index <= span_end:
                    continue
                raw = _b64.b64decode(mask_b64)
                info = tarfile.TarInfo(
                    name=f"frame_{frame_index - span_start:06d}.png"
                )
                info.size = len(raw)
                tar.addfile(info, _io.BytesIO(raw))
        masks_archive = buf.getvalue()

        fps = (video.type_data.get("technical_metadata") or {}).get("fps") or 24.0

        if tier_name == "quality":
            # VOID pass 1: guidance 1.0 / 50 steps are the upstream defaults;
            # VOID dilates the mask itself (dilate_width 11), so no extra
            # dilation by default. No paste-back composite — VOID legitimately
            # changes pixels outside the mask (shadow/reflection removal).
            modal_params = {
                "prompt": job.params.get("prompt") or "",
                "num_inference_steps": int(job.params.get("num_inference_steps", 50)),
                "guidance_scale": float(job.params.get("guidance_scale", 1.0)),
                "seed": job.params.get("seed"),
                "fps": float(fps),
                "mask_dilate_px": int(job.params.get("mask_dilate_px", 0)),
                "sample_size": job.params.get("sample_size"),
            }
        else:
            modal_params = {
                "prompt": job.params.get("prompt") or "",
                "negative_prompt": job.params.get("negative_prompt") or "",
                "num_inference_steps": int(job.params.get("num_inference_steps", 30)),
                "guidance_scale": float(job.params.get("guidance_scale", 5.0)),
                "seed": job.params.get("seed"),
                "fps": float(fps),
                "mask_dilate_px": int(job.params.get("mask_dilate_px", 8)),
                "mask_shape": job.params.get("mask_shape"),
                "composite_original": bool(job.params.get("composite_original", True)),
            }

        job.inputs.update({
            "span_start": span_start,
            "span_end": span_end,
            "staging_tier": staging_tier,
            "track_id": str(track.id),
            "fps": float(fps),
        })
        job.params = {**job.params, "tier": tier_name, **modal_params}

        # ── Dispatch (no mock tier — a mock removal result is meaningless) ─
        try:
            import modal
        except ImportError:
            raise OpError("modal library not installed", 502)
        try:
            remover = modal.Cls.from_name(tier["app"], tier["cls"])()
            frames_archive = VideoFrameStager.create_frame_archive(staging_dir)
            logger.info(f"{tag} frames {len(frames_archive) / 1e6:.1f} MB, "
                        f"masks {len(masks_archive) / 1e6:.1f} MB; dispatching …")
            modal_call = remover.remove.spawn(
                frames_tar_gz=frames_archive,
                masks_tar_gz=masks_archive,
                params=modal_params,
            )
            job.modal_call_id = modal_call.object_id
            logger.info(f"{tag} DISPATCHED call_id={job.modal_call_id} "
                        f"(total {time.time() - t_start:.1f}s)")
        except (LookupError, modal.Error) as e:
            raise OpError(
                f"Removal app ({tier_name} tier) unavailable — deploy it with "
                f"`{tier['deploy_hint']}` ({e})",
                502,
            )

    def ingest(self, job: OperationJob, result: dict) -> dict:
        import base64 as _b64

        from ..models import Version
        from .layer_renders import store_run_results

        mp4_bytes = _b64.b64decode(result["video_mp4_b64"])
        source_version = (job.asset.versions.order_by("-version_number").first())
        mask_version = Version.objects.filter(
            pk=job.inputs.get("mask_track_version_id")
        ).first()

        params = {
            **{k: v for k, v in job.params.items() if v is not None},
            "modal_call_id": job.modal_call_id,
            "span_start": job.inputs.get("span_start"),
            "span_end": job.inputs.get("span_end"),
            "staging_tier": job.inputs.get("staging_tier"),
            "mask_track_version_id": job.inputs.get("mask_track_version_id"),
            "removal_model": REMOVE_TIERS.get(
                job.params.get("tier") or "fast", REMOVE_TIERS["fast"])["model"],
            "frames_processed": result.get("frames_processed"),
            "trimmed_frames": result.get("trimmed_frames"),
            "gen_latency_s": result.get("gen_latency_s"),
            "latency_s": result.get("latency_s"),
            "output_size": {"width": result.get("width"),
                            "height": result.get("height")},
        }

        render_asset, run, versions = store_run_results(
            job.asset,
            job.layer_id,
            [mp4_bytes],
            op="remove",
            params=params,
            source_version=source_version,
            guide_version=mask_version,
            guide_role="removal_mask",
            created_by=job.created_by,
            file_ext="mp4",
            content_type="video/mp4",
        )

        version = versions[0]
        return {
            "render_asset_id": render_asset.pk,
            "run": run,
            "version_id": str(version.pk),
            "file_path": version.data.get("file_path"),
            "frames_processed": result.get("frames_processed"),
            "latency_s": result.get("latency_s"),
            "span_start": job.inputs.get("span_start"),
            "span_end": job.inputs.get("span_end"),
        }


_REGISTRY: dict[str, VideoOp] = {
    op.name: op for op in (SegmentOp(), RemoveOp())
}


def get_op(name: str) -> VideoOp:
    op = _REGISTRY.get(name)
    if not op:
        raise OpError(f"Unknown operation {name!r}. "
                      f"Known ops: {sorted(_REGISTRY)}", 400)
    return op


def describe_registry() -> list[dict]:
    return [op.describe() for op in _REGISTRY.values()]


# ── Job lifecycle ──────────────────────────────────────────────────────────


def dispatch_job(*, asset, op_name: str, layer_id: str = "",
                 inputs: dict | None = None, params: dict | None = None,
                 user=None) -> OperationJob:
    """Create an OperationJob and dispatch it. Raises OpError on failure.

    The job row is only persisted once dispatch succeeds — a failed dispatch
    is a request error, not a job in a failed state.
    """
    op = get_op(op_name)
    if op.requires_mask_track and not (inputs or {}).get("mask_track_version_id"):
        raise OpError(f"Operation {op.name!r} requires inputs.mask_track_version_id")

    job = OperationJob(
        asset=asset,
        op=op.name,
        layer_id=layer_id or "",
        inputs=dict(inputs or {}),
        params=dict(params or {}),
        created_by=user if getattr(user, "is_authenticated", False) else None,
    )
    op.dispatch(job)
    job.status = OperationJob.STATUS_WORKING
    job.dispatched_at = timezone.now()
    job.save()
    return job


def poll_job(job: OperationJob, *, correction: bool | None = None) -> dict:
    """Poll the job's Modal call; ingest on completion.

    Returns a status payload: {'status': 'working'|'done'|'failed', ...} with
    the op's ingest result merged in when done. Terminal states are persisted
    on the job, and repeated polls of a finished job return the stored result
    without re-ingesting.
    """
    if correction is not None:
        job.inputs["correction"] = correction

    if job.status == OperationJob.STATUS_DONE:
        return {"status": "done", "job_id": str(job.id), **job.result}
    if job.status in (OperationJob.STATUS_FAILED, OperationJob.STATUS_CANCELLED):
        return {"status": job.status, "job_id": str(job.id), "error": job.error}

    elapsed_s = (int((timezone.now() - job.dispatched_at).total_seconds())
                 if job.dispatched_at else 0)
    tag = f"[status {job.modal_call_id}]"
    op = get_op(job.op)

    result = None
    if job.modal_call_id.startswith("call-mock"):
        # Modal unavailable at dispatch: resolve to the latest existing state
        # so the UI flow can be exercised end-to-end without a GPU.
        logger.info(f"{tag} MOCK done")
        track_id = job.inputs.get("track_id")
        track = MaskTrack.objects.filter(pk=track_id).first() if track_id else None
        latest = track.versions.order_by("-version_number").first() if track else None
        payload = {
            "track_id": track_id,
            "version_id": str(latest.id) if latest else None,
            "frames_processed": 240,
            "latency_s": 45.2,
        }
        job.status = OperationJob.STATUS_DONE
        job.result = payload
        job.result_at = timezone.now()
        job.save()
        return {"status": "done", "job_id": str(job.id), **payload}

    try:
        import modal
    except ImportError:
        job.status = OperationJob.STATUS_FAILED
        job.error = "modal library not installed"
        job.save()
        return {"status": "failed", "job_id": str(job.id), "error": job.error}

    try:
        modal_call = modal.FunctionCall.from_id(job.modal_call_id)
        # timeout=0 → raises TimeoutError while the job is still running.
        result = modal_call.get(timeout=0)
    except TimeoutError:
        logger.info(f"{tag} still working ({elapsed_s}s elapsed)")
        return {"status": "working", "job_id": str(job.id),
                "progress": f"{op.progress_label}… {elapsed_s}s", "elapsed_s": elapsed_s}
    except Exception as exc:
        # Any non-timeout exception here is the remote function's own error
        # re-raised by get() (or a terminal Modal error). Surface it as a
        # clean 'failed' status instead of 500'ing the poll.
        logger.exception(f"{tag} {job.op} FAILED ({elapsed_s}s)")
        job.status = OperationJob.STATUS_FAILED
        job.error = str(exc) or exc.__class__.__name__
        job.result_at = timezone.now()
        job.save()
        return {"status": "failed", "job_id": str(job.id), "error": job.error}

    if result is None:
        logger.info(f"{tag} still working ({elapsed_s}s elapsed)")
        return {"status": "working", "job_id": str(job.id),
                "progress": f"{op.progress_label}… {elapsed_s}s", "elapsed_s": elapsed_s}

    logger.info(f"{tag} COMPLETE in ~{elapsed_s}s; ingesting")
    payload = op.ingest(job, result)
    job.status = OperationJob.STATUS_DONE
    job.result = payload
    job.result_at = timezone.now()
    job.save()
    return {"status": "done", "job_id": str(job.id), **payload}


def cancel_job(job: OperationJob) -> None:
    """Best-effort cancel of the in-flight Modal call."""
    if job.status in (OperationJob.STATUS_DONE, OperationJob.STATUS_FAILED,
                      OperationJob.STATUS_CANCELLED):
        return
    if job.modal_call_id and not job.modal_call_id.startswith("call-mock"):
        try:
            import modal
            modal.FunctionCall.from_id(job.modal_call_id).cancel()
        except Exception:
            logger.warning(f"[cancel {job.modal_call_id}] Modal cancel failed",
                           exc_info=True)
    job.status = OperationJob.STATUS_CANCELLED
    job.result_at = timezone.now()
    job.save()
