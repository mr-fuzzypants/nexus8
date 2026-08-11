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
from datetime import timedelta

from django.conf import settings
from django.db.models import Q
from django.utils import timezone

from ..models import MaskTrack, OperationJob
from .video_staging import VideoFrameStager, FrameStagingError

logger = logging.getLogger(__name__)

SEGMENT_MODAL_APP = "nexus8-videoseg"
REMOVE_MODAL_APP = "nexus8-videoremove"
VOID_MODAL_APP = "nexus8-videovoid"
ERASER_MODAL_APP = "nexus8-videoeraser"

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
        "model": "VOID",
        "deploy_hint": "modal deploy modal_functions/video_void.py",
    },
    # BENCHMARK-ONLY (license quarantine, F23): DiffuEraser is Apache but its
    # stock prior is ProPainter (S-Lab non-commercial). Never a shipped path
    # until the prior is swapped for an MIT flow stage (FGT/FGVC).
    "eraser": {
        "app": ERASER_MODAL_APP,
        "cls": "DiffuEraserRemover",
        "max_frames": 250,
        "model": "DiffuEraser+ProPainter-prior",
        "deploy_hint": "modal deploy modal_functions/video_eraser.py",
    },
}
# VOID's temporal window: spans wider than this cross multiple windows and
# need pass-2 warped-noise refinement to clear moving-subject residue (F22a).
VOID_WINDOW_FRAMES = 85
# Resolution tier used for segmentation; masks are upscaled to native on apply.
DEFAULT_STAGING_TIER = "preview_480p"
# Eraser long-edge ceiling: the deployed L40S fits max_img_size 1280 (~26 GB,
# see modal_functions/video_eraser.py). Sources at or under this run natively
# end-to-end, so ingest's self-composite skip fires and no local composite runs.
ERASER_NATIVE_MAX_IMG = 1280
# An 'ingesting' claim older than this is considered abandoned (worker died
# mid-ingest) and may be taken over by the next poll.
INGEST_STALE_S = 30 * 60


class OpError(Exception):
    """Dispatch/ingest failure with an HTTP status for the view layer."""

    def __init__(self, message: str, http_status: int = 400):
        super().__init__(message)
        self.http_status = http_status


def resolve_chain_source(asset, inputs) -> tuple[str, int, int | None, str]:
    """Resolve the clip an op reads frames from — the Phase 3 chaining contract.

    Returns (local_path, frame_offset, frame_count, staging_cache_key).

    Default: the library asset's own file at offset 0. With
    ``inputs['chain_source'] = {layer_id, run}``: that layer's removal take —
    a layer-render version of this asset whose clip covers source frames
    ``[offset, offset+count-1]`` as file frames ``[0, count-1]``.

    All spans and frame indices stay SOURCE-based at every other boundary;
    callers apply the offset exactly once, at frame extraction, and log it
    (SRED_OPGRAPH Phase 3 contract; the F9 lesson).
    """
    chain = (inputs or {}).get("chain_source") or None
    if not chain:
        path = resolve_local_path(asset.file_path)
        if not path or not os.path.exists(path):
            raise OpError(f"Video file not found for asset {asset.id}", 404)
        return path, 0, None, str(asset.id)

    from ..models import Version
    from .layer_renders import find_layer_relation

    layer_id = chain.get("layer_id") or ""
    rel = find_layer_relation(asset, layer_id)
    if rel is None:
        raise OpError(
            f"chain_source layer {layer_id!r} has no renders for this asset", 404)
    try:
        version = Version.objects.get(
            entity_id=rel.entity_id,
            version_number=int(chain.get("run")),
            variation_number=0,
        )
    except (Version.DoesNotExist, TypeError, ValueError):
        raise OpError(
            f"chain_source run {chain.get('run')!r} not found for "
            f"layer {layer_id!r}", 404)
    gen = version.data.get("generation") or {}
    path = resolve_local_path(version.data.get("file_path") or "")
    if not path or not os.path.exists(path):
        raise OpError("chain_source clip file not found on disk", 404)
    offset = int(gen.get("span_start") or 0)
    count = gen.get("frames_processed")
    return path, offset, (int(count) if count else None), str(version.pk)


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

        # ── Chaining (Phase 3): ops may read a derived clip, not the asset ─
        # The chained clip covers only [offset, offset+count-1] of the source
        # timeline; clamp the span to it BEFORE prompt filtering so out-of-
        # range prompts get the standard "outside span" treatment.
        chain_path, chain_offset, chain_count, chain_key = \
            resolve_chain_source(video, inputs)
        if chain_count is not None:
            lo, hi = chain_offset, chain_offset + chain_count - 1
            new_lo, new_hi = max(span_start, lo), min(span_end, hi)
            if new_lo > new_hi:
                raise OpError(
                    f"Span [{span_start}, {span_end}] does not intersect the "
                    f"chained clip's range [{lo}, {hi}]")
            if (new_lo, new_hi) != (span_start, span_end):
                logger.info(f"{tag} span clamped to chained clip "
                            f"[{span_start},{span_end}] → [{new_lo},{new_hi}]")
            span_start, span_end = new_lo, new_hi

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
            source_layer_id=inputs.get("layer_source_layer_id"),
        )
        logger.info(f"{tag} track {'created' if created else 'reused'} id={track.id}")

        # Stage frames — extract JPEGs with ffmpeg at the requested tier.
        # The extraction range is the ONLY place the chain offset applies
        # (Phase 3 contract); everything else stays source-based.
        tier = inputs.get("staging_tier") or DEFAULT_STAGING_TIER
        if tier not in VideoFrameStager.TIERS:
            tier = DEFAULT_STAGING_TIER
        if inputs.get("chain_source"):
            logger.info(f"{tag} CHAIN src={inputs['chain_source']} "
                        f"offset={chain_offset} span src[{span_start},{span_end}]"
                        f" → file[{span_start - chain_offset},"
                        f"{span_end - chain_offset}]")
        logger.info(f"{tag} staging span [{span_start}, {span_end}] "
                    f"({tier}) from {chain_path} …")
        t_stage = time.time()
        try:
            staging_dir = VideoFrameStager.extract_frames(
                chain_path,
                asset_id=str(video.id),
                version_id=chain_key,
                tier=tier,
                frame_range=(span_start - chain_offset, span_end - chain_offset),
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
            # Fold the run's dispatch settings into the version so the take's
            # "parameters used" are answerable from the version alone (the
            # OperationJob has them too, but takes are the artist-facing unit).
            propagation_params={
                **(job.inputs.get("propagation_params") or {}),
                "staging_tier": job.inputs.get("staging_tier"),
                **({"chain_source": job.inputs["chain_source"]}
                   if job.inputs.get("chain_source") else {}),
            },
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
        # Default to the version's declared span (manual hold tracks extend
        # past their last painted keyframe), falling back to the masked
        # extent; an explicit sub-span narrows it. Cap at the tier window.
        mask_lo, mask_hi = min(mask_by_frame), max(mask_by_frame)
        declared = mask_version.data.get("propagation_params") or {}
        default_lo = declared.get("span_start")
        default_hi = declared.get("span_end")
        span_start = int(inputs.get("span_start") if inputs.get("span_start")
                         is not None else
                         default_lo if default_lo is not None else mask_lo)
        span_end = int(inputs.get("span_end") if inputs.get("span_end")
                       is not None else
                       default_hi if default_hi is not None else mask_hi)
        if span_end < span_start:
            span_start, span_end = span_end, span_start
        span_start = max(span_start, 0)
        if span_end - span_start + 1 > tier["max_frames"]:
            span_end = span_start + tier["max_frames"] - 1
            logger.warning(f"{tag} span capped to {tier['max_frames']} frames "
                           f"[{span_start}, {span_end}]")
        # Chaining (Phase 3): clamp to the chained clip's covered range.
        chain_path, chain_offset, chain_count, chain_key = \
            resolve_chain_source(video, inputs)
        if chain_count is not None:
            lo, hi = chain_offset, chain_offset + chain_count - 1
            new_lo, new_hi = max(span_start, lo), min(span_end, hi)
            if new_lo > new_hi:
                raise OpError(
                    f"Span [{span_start}, {span_end}] does not intersect the "
                    f"chained clip's range [{lo}, {hi}]")
            span_start, span_end = new_lo, new_hi
        # Manual hold tracks store only painted keyframes; expand each mask
        # forward to the next keyframe so the exported archive is dense.
        if mask_version.data.get("fill_policy") == "hold":
            keyed = sorted(mask_by_frame)
            for i in range(span_start, span_end + 1):
                if i in mask_by_frame:
                    continue
                prior = [k for k in keyed if k <= i]
                if prior:
                    mask_by_frame[i] = mask_by_frame[prior[-1]]
        if not any(span_start <= i <= span_end for i in mask_by_frame):
            raise OpError(f"No mask frames fall within the span "
                          f"[{span_start}, {span_end}]")
        logger.info(f"{tag} span [{span_start}, {span_end}], "
                    f"{sum(1 for i in mask_by_frame if span_start <= i <= span_end)}"
                    f" masked frame(s)")

        # ── Stage RGB frames ───────────────────────────────────────────────
        # Extraction range is the only place the chain offset applies.
        # Eraser defaults to native staging: DiffuEraser composites internally,
        # so native-res input (paired with the native max_img_size default
        # below) yields native-res output and skips the local composite.
        default_tier = ("native" if tier_name == "eraser"
                        else DEFAULT_STAGING_TIER)
        staging_tier = inputs.get("staging_tier") or default_tier
        if staging_tier not in VideoFrameStager.TIERS:
            staging_tier = default_tier
        if inputs.get("chain_source"):
            logger.info(f"{tag} CHAIN src={inputs['chain_source']} "
                        f"offset={chain_offset} span src[{span_start},{span_end}]"
                        f" → file[{span_start - chain_offset},"
                        f"{span_end - chain_offset}]")
        try:
            staging_dir = VideoFrameStager.extract_frames(
                chain_path,
                asset_id=str(video.id),
                version_id=chain_key,
                tier=staging_tier,
                frame_range=(span_start - chain_offset, span_end - chain_offset),
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
            #
            # Multi-window residue (F22a) is handled inside the Modal function
            # by independent ≤85-frame window chunking + concat — no pass-2
            # toolchain needed. The app auto-chunks when the span exceeds one
            # window; nothing to gate here.
            frame_count = span_end - span_start + 1
            modal_params = {
                "prompt": job.params.get("prompt") or "",
                "num_inference_steps": int(job.params.get("num_inference_steps", 50)),
                "guidance_scale": float(job.params.get("guidance_scale", 1.0)),
                "seed": job.params.get("seed"),
                "fps": float(fps),
                "mask_dilate_px": int(job.params.get("mask_dilate_px", 0)),
                "sample_size": job.params.get("sample_size"),
            }
            if frame_count > VOID_WINDOW_FRAMES:
                logger.info(f"{tag} {frame_count} frames > {VOID_WINDOW_FRAMES}-frame "
                            f"window — app will chunk into independent windows")
        elif tier_name == "eraser":
            # DiffuEraser is promptless (pure inpainting) and has no seed
            # control; prompt/negative/seed params are ignored by design.
            # max_img_size defaults to the source's long edge (capped at the
            # L40S ceiling): the extra GPU pixels cost far less wall-clock
            # than the local native composite they make unnecessary.
            tm = video.type_data.get("technical_metadata") or {}
            native_long = max(int(tm.get("width") or 0),
                              int(tm.get("height") or 0))
            default_img_size = (min(native_long, ERASER_NATIVE_MAX_IMG)
                                if native_long else 960)
            modal_params = {
                "fps": float(fps),
                "mask_dilation_iter": int(job.params.get("mask_dilation_iter", 8)),
                "max_img_size": int(job.params.get("max_img_size",
                                                   default_img_size)),
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

    def _composite_native(self, job: OperationJob, result: dict,
                          mp4_bytes: bytes) -> bytes | None:
        """Upscale the generated fill into the native-res source frames.

        Both tiers generate at reduced resolution (VACE at the staging tier,
        VOID at its trained ≤384×672), so the raw result plays soft against
        the native source. Re-composite server-side: native frames stay
        pixel-original outside the (dilated) mask; only the fill region is
        upscaled in. Trade-off: for the quality tier this crops VOID's
        outside-mask edits (shadow/reflection removal) to the dilated band —
        `composite_native_dilate_px` widens it, `composite_native: false`
        keeps the raw model output instead. Returns None on any failure
        (caller stores the raw result).

        Runs in the poll request thread, streaming raw RGB through ffmpeg
        pipes (~0.1-0.3s/frame). The poll holds an 'ingesting' claim while
        this runs, so concurrent polls report progress instead of piling on.
        Move to a worker if the quality tier becomes routine.
        """
        import base64 as _b64
        import io as _io
        import subprocess
        import tempfile
        from pathlib import Path

        import numpy as np
        from PIL import Image as PILImage
        from PIL import ImageFilter

        from ..models import Version

        try:
            n = int(result.get("frames_processed") or 0)
            span_start = int(job.inputs["span_start"])
            fps = float(job.inputs.get("fps") or 24.0)
            dilate = int(job.params.get("composite_native_dilate_px", 24))
            if n <= 0:
                return None

            # For a chained removal, "original" = the chained clip's frames,
            # not the library asset's (the removal edited the chained clip).
            chain_path, chain_offset, _count, chain_key = \
                resolve_chain_source(job.asset, job.inputs)
            native_dir = VideoFrameStager.extract_frames(
                chain_path,
                asset_id=str(job.asset_id),
                version_id=chain_key,
                tier="native",
                frame_range=(span_start - chain_offset,
                             span_start - chain_offset + n - 1),
            )
            native_frames = sorted(native_dir.glob("frame_*.jpg"))[:n]
            if len(native_frames) < n:
                return None

            mask_version = Version.objects.get(pk=job.inputs["mask_track_version_id"])
            mask_by_frame = {
                f["frame_index"]: f["mask_png_b64"]
                for f in mask_version.data.get("frames", [])
                if "frame_index" in f and f.get("mask_png_b64")
            }

            with tempfile.TemporaryDirectory() as td:
                tdp = Path(td)
                (tdp / "result.mp4").write_bytes(mp4_bytes)
                # Actual stored dims — the mp4 may pad odd model-output dims
                # to even, so probe rather than trusting result['width'].
                probe = subprocess.run(
                    ["ffprobe", "-v", "error", "-select_streams", "v:0",
                     "-show_entries", "stream=width,height", "-of", "csv=p=0",
                     str(tdp / "result.mp4")],
                    capture_output=True, text=True, check=True,
                )
                gen_w, gen_h = (int(x) for x in
                                probe.stdout.strip().split(",")[:2])
                base_w, base_h = PILImage.open(native_frames[0]).size

                # Stream both ends as raw RGB pipes — the old PNG
                # intermediates (zlib encode/decode per frame) dominated
                # composite time.
                decoder = subprocess.Popen(
                    ["ffmpeg", "-loglevel", "error",
                     "-i", str(tdp / "result.mp4"),
                     "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1"],
                    stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                )
                encoder = subprocess.Popen(
                    ["ffmpeg", "-y", "-loglevel", "error",
                     "-f", "rawvideo", "-pix_fmt", "rgb24",
                     "-s", f"{base_w}x{base_h}", "-framerate", str(fps),
                     "-i", "pipe:0",
                     "-c:v", "libx264", "-pix_fmt", "yuv420p",
                     "-crf", "16", "-movflags", "+faststart",
                     str(tdp / "composited.mp4")],
                    stdin=subprocess.PIPE, stderr=subprocess.DEVNULL,
                )
                frame_len = gen_w * gen_h * 3
                enc_rc = None
                try:
                    for i in range(n):
                        raw = decoder.stdout.read(frame_len)
                        if not raw or len(raw) < frame_len:
                            return None  # result clip shorter than expected
                        base = PILImage.open(native_frames[i]).convert("RGB")
                        out_arr = np.asarray(base, dtype=np.uint8)
                        mb64 = mask_by_frame.get(span_start + i)
                        if mb64:
                            m = PILImage.open(_io.BytesIO(_b64.b64decode(mb64)))
                            m = (m.getchannel("A") if m.mode == "RGBA"
                                 else m.convert("L"))
                            # Dilate + feather at the mask's own (small)
                            # resolution and resize the resulting ALPHA once —
                            # visually identical to native-res morphology at
                            # ~10x less CPU (a 49px MaxFilter at 1280x534 per
                            # frame dominated ingest time).
                            scale = m.size[0] / base_w
                            d_small = max(1, round(dilate * scale))
                            if dilate > 0:
                                m = m.filter(
                                    ImageFilter.MaxFilter(d_small * 2 + 1))
                            # Feathered alpha blend, not a binary paste: a
                            # hard fill/native edge re-quantizes per frame and
                            # shimmers in playback (invisible in stills).
                            feather = int(
                                job.params.get("composite_feather_px", 8))
                            if feather > 0:
                                m = m.filter(ImageFilter.GaussianBlur(
                                    max(1, round(feather * scale))))
                            m = m.resize((base_w, base_h), PILImage.BILINEAR)
                            alpha = (np.asarray(m, dtype=np.float32)
                                     / 255.0)[..., None]
                            gen = (PILImage.frombuffer(
                                       "RGB", (gen_w, gen_h), raw,
                                       "raw", "RGB", 0, 1)
                                   .resize((base_w, base_h), PILImage.LANCZOS))
                            out_arr = (np.asarray(gen, dtype=np.float32) * alpha
                                       + np.asarray(base, dtype=np.float32)
                                       * (1.0 - alpha)).astype("uint8")
                        encoder.stdin.write(
                            np.ascontiguousarray(out_arr).tobytes())
                finally:
                    decoder.stdout.close()
                    decoder.terminate()
                    decoder.wait()
                    encoder.stdin.close()
                    enc_rc = encoder.wait()
                if enc_rc != 0:
                    return None
                return (tdp / "composited.mp4").read_bytes()
        except Exception:
            logger.exception(f"[remove ingest {job.modal_call_id}] native "
                             f"composite failed — storing raw result")
            return None

    def _ensure_h264(self, mp4_bytes: bytes, tag: str,
                     size: tuple[int, int] | None = None) -> bytes:
        """Re-encode raw model output for the browser when needed.

        The stored take feeds the viewport's <video> overlay directly, so it
        must be a web-decodable codec — DiffuEraser writes OpenCV 'mp4v'
        (MPEG-4 Part 2), which no browser plays. With ``size``, also snap the
        clip to exact source dims (models round to /8 or /16) so the overlay
        aligns pixel-perfect. No-op when the clip is already h264 at size.
        Returns the original bytes on any failure.
        """
        import subprocess
        import tempfile
        from pathlib import Path

        with tempfile.TemporaryDirectory() as td:
            src = Path(td) / "in.mp4"
            src.write_bytes(mp4_bytes)
            try:
                probe = subprocess.run(
                    ["ffprobe", "-v", "error", "-select_streams", "v:0",
                     "-show_entries", "stream=codec_name,width,height",
                     "-of", "csv=p=0", str(src)],
                    capture_output=True, text=True, check=True, timeout=60,
                )
                codec, w, h = probe.stdout.strip().split(",")[:3]
                needs_scale = bool(size) and (int(w), int(h)) != tuple(size)
            except Exception:
                logger.exception(f"{tag} result probe failed — storing as-is")
                return mp4_bytes
            if codec == "h264" and not needs_scale:
                return mp4_bytes
            out = Path(td) / "out.mp4"
            cmd = ["ffmpeg", "-y", "-loglevel", "error", "-i", str(src)]
            if needs_scale:
                cmd += ["-vf", f"scale={size[0]}:{size[1]}:flags=lanczos"]
            cmd += ["-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "16",
                    "-movflags", "+faststart", str(out)]
            try:
                subprocess.run(cmd, check=True, capture_output=True,
                               timeout=600)
            except Exception:
                logger.exception(f"{tag} h264 re-encode failed — storing "
                                 f"as-is")
                return mp4_bytes
            logger.info(f"{tag} re-encoded {codec} {w}x{h} → h264"
                        f"{f' {size[0]}x{size[1]}' if needs_scale else ''}")
            return out.read_bytes()

    def ingest(self, job: OperationJob, result: dict) -> dict:
        import base64 as _b64

        from ..models import Version
        from .layer_renders import store_run_results

        tag = f"[remove ingest {job.modal_call_id}]"
        mp4_bytes = _b64.b64decode(result["video_mp4_b64"])
        composited = None
        # DiffuEraser composites internally (blurred-mask blend over the
        # original at its working resolution), so when it generated at ~native
        # size there is nothing for the post-comp to add — skip the whole
        # (minutes-long) step. VOID/VACE render reduced and need it.
        tm = job.asset.type_data.get("technical_metadata") or {}
        native_w, native_h = tm.get("width"), tm.get("height")
        out_w = result.get("width")
        self_composited = (
            job.params.get("tier") == "eraser"
            and out_w and native_w and abs(out_w - native_w) <= 16
        )
        if job.params.get("composite_native", True) and not self_composited:
            composited = self._composite_native(job, result, mp4_bytes)
            if composited:
                mp4_bytes = composited
        if not composited:
            # Raw model output is served straight to the viewport overlay.
            mp4_bytes = self._ensure_h264(
                mp4_bytes, tag,
                size=((int(native_w), int(native_h))
                      if self_composited and native_w and native_h else None),
            )
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
            "passes": result.get("passes"),
            "windows": result.get("windows"),
            "frames_processed": result.get("frames_processed"),
            "trimmed_frames": result.get("trimmed_frames"),
            "gen_latency_s": result.get("gen_latency_s"),
            "latency_s": result.get("latency_s"),
            # Raw model output dims; when composited_native, the stored file
            # is at the source's native resolution instead.
            "output_size": {"width": result.get("width"),
                            "height": result.get("height")},
            "composited_native": bool(composited),
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

    if job.status == OperationJob.STATUS_INGESTING:
        # Another poll request holds the ingest claim. Report progress instead
        # of fetching the completed result and ingesting it a second time —
        # unless the claim is stale (claimant died mid-ingest), in which case
        # fall through and let the claim query below take it over.
        age_s = (timezone.now() - job.updated_at).total_seconds()
        if age_s < INGEST_STALE_S:
            return {"status": "working", "job_id": str(job.id),
                    "progress": f"Finalizing… {elapsed_s}s",
                    "elapsed_s": elapsed_s}
        logger.warning(f"{tag} stale ingest claim ({int(age_s)}s old) — "
                       f"taking over")

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

    # Claim the ingest atomically. Ingest runs in this request thread and can
    # take a while; without the claim, every poll arriving meanwhile would
    # fetch the same completed Modal result and ingest it again (duplicate
    # CPU work, duplicate stored versions).
    now = timezone.now()
    claimed = OperationJob.objects.filter(
        Q(pk=job.pk),
        Q(status=OperationJob.STATUS_WORKING)
        | Q(status=OperationJob.STATUS_INGESTING,
            updated_at__lt=now - timedelta(seconds=INGEST_STALE_S)),
    ).update(status=OperationJob.STATUS_INGESTING, updated_at=now)
    if not claimed:
        job.refresh_from_db()
        if job.status == OperationJob.STATUS_DONE:
            return {"status": "done", "job_id": str(job.id), **job.result}
        if job.status in (OperationJob.STATUS_FAILED,
                          OperationJob.STATUS_CANCELLED):
            return {"status": job.status, "job_id": str(job.id),
                    "error": job.error}
        logger.info(f"{tag} complete; ingest already claimed elsewhere")
        return {"status": "working", "job_id": str(job.id),
                "progress": f"Finalizing… {elapsed_s}s", "elapsed_s": elapsed_s}

    logger.info(f"{tag} COMPLETE in ~{elapsed_s}s; ingesting")
    try:
        payload = op.ingest(job, result)
    except Exception as exc:
        # Release the claim: the Modal result is durable, so a later poll can
        # retry ingest instead of the job wedging in 'ingesting'.
        logger.exception(f"{tag} ingest failed — claim released for retry")
        OperationJob.objects.filter(
            pk=job.pk, status=OperationJob.STATUS_INGESTING
        ).update(status=OperationJob.STATUS_WORKING,
                 error=str(exc) or exc.__class__.__name__,
                 updated_at=timezone.now())
        if isinstance(exc, OpError):
            raise
        raise OpError(f"Ingest failed: {exc}", 500)
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
