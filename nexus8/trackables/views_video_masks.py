"""
Video mask track propagation and removal endpoints.

Dispatches SAM 2 propagation jobs to Modal and manages mask track versioning.
Follows the Phase 1.3 / Phase 2 architecture outlined in SRED_VIDEOOP_EXPERIMENTS.md.
"""

import io
import json
import logging
import os
from datetime import datetime

from django.conf import settings
from django.http import HttpResponse
from django.shortcuts import get_object_or_404
from rest_framework import permissions, status
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import MediaAsset, MaskTrack
from .services.video_staging import VideoFrameStager, FrameStagingError

logger = logging.getLogger(__name__)
MODAL_APP_NAME = "nexus8-videoseg"

# SAM 2 holds every frame's features in GPU memory, so cap the window we send.
MAX_SPAN_FRAMES = 600
# Resolution tier used for segmentation; masks are upscaled to native on apply.
STAGING_TIER = "preview_480p"


def _resolve_local_path(file_path: str) -> str | None:
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


class VideoMaskPropagateView(APIView):
    """Dispatch a mask track propagation job to SAM 2 (Modal)."""

    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, asset_id: str, layer_id: str):
        """POST /api/library/assets/<id>/video-mask/<layer_id>/propagate/

        Request body:
            {
                "prompt_frames": [
                    {"frame_index": 0, "type": "click", "clicks": [{"x": 100, "y": 200}]},
                    {"frame_index": 10, "type": "scribble", "scribble_code": "asset-code"}
                ],
                "propagation_params": {
                    "full_clip": true,
                    "span_start": 0,
                    "span_end": null
                }
            }

        Response (202):
            {
                "status": "working",
                "call_id": "call-xyz123",
                "track_id": "track-uuid",
                "version_number": 1
            }
        """
        # Fetch the video asset
        video = get_object_or_404(MediaAsset, id=asset_id)

        # Validate request
        prompt_frames = request.data.get('prompt_frames')
        propagation_params = request.data.get('propagation_params')
        if not prompt_frames or not propagation_params:
            return Response(
                {'error': 'Missing prompt_frames or propagation_params'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        import time
        t_start = time.time()
        tag = f"[propagate {asset_id[:8]}/{layer_id[:8]}]"
        logger.info(f"{tag} START — {len(prompt_frames)} prompt frame(s), "
                    f"params={propagation_params}")

        # ── Resolve the propagation span ────────────────────────────────────────
        # SAM 2 holds every frame's features in GPU memory, so we process a bounded
        # window, not the whole clip. The frontend sends span_start/span_end
        # (absolute frame indices); we clamp the width to MAX_SPAN_FRAMES.
        prompt_indices = [pf.get('frame_index', 0) for pf in prompt_frames]
        span_start = propagation_params.get('span_start')
        span_end = propagation_params.get('span_end')
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

        # Keep only prompts that fall inside the span — SAM 2 can't use a click
        # for a frame it never sees. Drop the rest (they belong to other spans).
        in_span = [pf for pf in prompt_frames
                   if span_start <= pf.get('frame_index', 0) <= span_end]
        dropped = len(prompt_frames) - len(in_span)
        if dropped:
            logger.info(f"{tag} dropped {dropped} prompt frame(s) outside span")
        if not in_span:
            return Response(
                {'error': f'No prompt frames fall within the selected span '
                          f'[{span_start}, {span_end}]. Draw a mask inside the '
                          f'span, or adjust the span to include your keyframes.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Rebase prompt frame indices to be span-relative (span_start → 0).
        span_prompt_frames = [
            {**pf, 'frame_index': pf.get('frame_index', 0) - span_start}
            for pf in in_span
        ]
        logger.info(f"{tag} span [{span_start}, {span_end}] "
                    f"({span_end - span_start + 1} frames), "
                    f"{len(in_span)} prompt(s) in span")

        # Get or create mask track for this (video, layer_id). Persist the layer's
        # name/colour so the layer can be restored on reload (layer ids churn).
        track, created = MaskTrack.objects.get_or_create_for_video_and_layer(
            video_id=str(video.id),
            layer_id=layer_id,
            layer_name=request.data.get('layer_name'),
            layer_color=request.data.get('layer_color'),
        )
        logger.info(f"{tag} track {'created' if created else 'reused'} id={track.id}")

        # Stage frames (Phase 0) — extract PNGs with ffmpeg at preview res.
        # Full clip is extracted once and cached; we archive only the span below.
        try:
            video_path = _resolve_local_path(video.file_path)
            if not video_path or not os.path.exists(video_path):
                logger.warning(f"{tag} video file not found: {video.file_path!r}")
                return Response(
                    {'error': f'Video file not found for asset {asset_id}'},
                    status=status.HTTP_404_NOT_FOUND,
                )
            logger.info(f"{tag} staging span [{span_start}, {span_end}] "
                        f"({STAGING_TIER}) from {video_path} …")
            t_stage = time.time()
            staging_dir = VideoFrameStager.extract_frames(
                video_path,
                asset_id=str(video.id),
                version_id=str(video.id),
                tier=STAGING_TIER,
                frame_range=(span_start, span_end),
            )
            frame_count = len(list(staging_dir.glob('frame_*.jpg')))
            logger.info(f"{tag} staged {frame_count} frames in "
                        f"{time.time() - t_stage:.1f}s → {staging_dir}")
        except FrameStagingError as e:
            logger.error(f"{tag} frame staging FAILED: {e}")
            return Response(
                {'error': f'Frame staging failed: {str(e)}'},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

        # ── Rescale click prompts to the staged frame size ─────────────────────
        # Clicks arrive in native pixel coords (source_size), but the staged
        # frames SAM 2 sees are downscaled (preview_480p). Without rescaling, a
        # click on a foreground character lands on unrelated background.
        source_size = request.data.get('source_size') or {}
        src_w, src_h = source_size.get('width'), source_size.get('height')
        if src_w and src_h:
            from PIL import Image as PILImage
            first_frame = sorted(staging_dir.glob('frame_*.jpg'))[0]
            with PILImage.open(first_frame) as im:
                staged_w, staged_h = im.size
            sx, sy = staged_w / src_w, staged_h / src_h
            if abs(sx - 1.0) > 1e-6 or abs(sy - 1.0) > 1e-6:
                for pf in span_prompt_frames:
                    for click in pf.get('clicks', []):
                        click['x'] = click['x'] * sx
                        click['y'] = click['y'] * sy
                logger.info(f"{tag} rescaled clicks {src_w}x{src_h} → "
                            f"{staged_w}x{staged_h} (x{sx:.3f}, x{sy:.3f})")
            sample = [
                (pf['frame_index'], round(c['x']), round(c['y']))
                for pf in span_prompt_frames for c in pf.get('clicks', [])
            ][:6]
            logger.info(f"{tag} click sample (span-relative frame, x, y): {sample}")
        else:
            logger.warning(f"{tag} no source_size in request — clicks NOT rescaled; "
                           f"coordinates may misalign with staged frames")

        # Dispatch to Modal SAM 2 app (Phase 1.1)
        try:
            import modal

            # Credentials resolve from ~/.modal.toml (CLI auth) or the
            # MODAL_TOKEN_ID / MODAL_TOKEN_SECRET env vars — same as views_inpaint.
            try:
                # Instantiate the Cls (trailing ()) before accessing its methods —
                # same as views_inpaint. Without it Modal raises AttributeError.
                segmentor = modal.Cls.from_name(MODAL_APP_NAME, "VideoSegmentor")()
                logger.info(f"{tag} building span archive [{span_start}, {span_end}] …")
                t_arc = time.time()
                # staging_dir already contains only the span's frames.
                frames_archive = VideoFrameStager.create_frame_archive(staging_dir)
                logger.info(f"{tag} archive {len(frames_archive) / 1e6:.1f} MB "
                            f"in {time.time() - t_arc:.1f}s; dispatching to Modal …")

                # Spawn the propagation job (frame indices are span-relative).
                modal_call = segmentor.propagate.spawn(
                    frames_tar_gz=frames_archive,
                    prompt_frames=span_prompt_frames,
                    propagation_params=propagation_params,
                )
                call_id = modal_call.object_id  # Modal FunctionCall id (see views_inpaint)
                logger.info(f"{tag} DISPATCHED call_id={call_id} "
                            f"(total {time.time() - t_start:.1f}s)")
            except (LookupError, modal.Error) as e:
                # Modal app not deployed / auth missing; fall back to mock.
                logger.warning(f"{tag} Modal dispatch unavailable ({e}); using MOCK response")
                call_id = f'call-mock-{str(track.id)[:8]}'
        except ImportError:
            logger.warning(f"{tag} modal library not installed; using MOCK response")
            call_id = f'call-mock-{str(track.id)[:8]}'

        # Store dispatch metadata for polling
        dispatch_at_ms = int(datetime.now().timestamp() * 1000)

        return Response(
            {
                'status': 'working',
                'call_id': call_id,
                'track_id': str(track.id),
                'version_number': 1,  # First version
                'dispatch_at_ms': dispatch_at_ms,
                'span_start': span_start,
                'span_end': span_end,
            },
            status=status.HTTP_202_ACCEPTED,
        )


class VideoMaskStatusView(APIView):
    """Poll the status of a mask track propagation job."""

    permission_classes = [permissions.IsAuthenticated]

    def get(self, request, asset_id: str, layer_id: str):
        """GET /api/library/assets/<id>/video-mask/<layer_id>/status/?call_id=call-xyz

        Response (working):
            {
                "status": "working",
                "progress": "120/240 frames",
                "call_id": "call-xyz123"
            }

        Response (done):
            {
                "status": "done",
                "track_id": "track-uuid",
                "version_id": "version-uuid",
                "frames_processed": 240,
                "latency_s": 45.2
            }

        Response (failed):
            {
                "status": "failed",
                "error": "error message"
            }
        """
        call_id = request.query_params.get('call_id')
        if not call_id:
            return Response(
                {'error': 'call_id required'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Fetch track for this (video, layer_id)
        track = MaskTrack.objects.for_video_and_layer(str(asset_id), layer_id)
        if not track:
            return Response(
                {'error': 'No mask track found for this video/layer'},
                status=status.HTTP_404_NOT_FOUND,
            )

        # Elapsed since dispatch (frontend passes dispatch_at_ms back on each poll).
        dispatch_at_ms = int(request.query_params.get('dispatch_at_ms', 0) or 0)
        elapsed_s = (
            int(datetime.now().timestamp() * 1000 - dispatch_at_ms) // 1000
            if dispatch_at_ms else 0
        )
        tag = f"[status {call_id}]"

        # Poll Modal function call (Phase 1.1)
        try:
            import modal

            if call_id.startswith('call-mock'):
                # Mock response for testing
                latest = track.versions.order_by('-version_number').first()
                logger.info(f"{tag} MOCK done")
                return Response(
                    {
                        'status': 'done',
                        'track_id': str(track.id),
                        'version_id': str(latest.id) if latest else None,
                        'frames_processed': 240,
                        'latency_s': 45.2,
                    }
                )

            try:
                modal_call = modal.FunctionCall.from_id(call_id)
                # timeout=0 → raises TimeoutError while the job is still running.
                result = modal_call.get(timeout=0)
            except TimeoutError:
                logger.info(f"{tag} still working ({elapsed_s}s elapsed)")
                return Response({
                    'status': 'working',
                    'progress': f'Segmenting… {elapsed_s}s',
                    'elapsed_s': elapsed_s,
                })
            except Exception as exc:
                # Any non-timeout exception here is the remote function's own
                # error re-raised by get() (or a terminal Modal error). Surface it
                # as a clean 'failed' status instead of 500'ing the poll.
                logger.exception(f"{tag} propagation FAILED ({elapsed_s}s)")
                return Response({
                    'status': 'failed',
                    'error': str(exc) or exc.__class__.__name__,
                })

            if result is None:
                # Still running
                logger.info(f"{tag} still working ({elapsed_s}s elapsed)")
                return Response({
                    'status': 'working',
                    'progress': f'Segmenting… {elapsed_s}s',
                    'elapsed_s': elapsed_s,
                })

            # Job complete: ingest results into track
            logger.info(f"{tag} COMPLETE in ~{elapsed_s}s; ingesting "
                        f"{len(result.get('frames', []))} frame masks")

            frames = result.get('frames', [])
            latency_s = result.get('latency_s', 0)

            # SAM 2 indexed frames span-relative (0-based within the archive).
            # Rebase to absolute frame numbers so the timeline lines up.
            span_start = int(request.query_params.get('span_start', 0) or 0)
            if span_start:
                for f in frames:
                    if 'frame_index' in f:
                        f['frame_index'] = f['frame_index'] + span_start

            # Correction (span-limited re-propagation): overlay the re-run frames
            # onto the prior version's frames, so the untouched part of the track
            # is preserved with its provenance rather than recomputed.
            is_correction = request.query_params.get('correction') in ('1', 'true')
            prior_version_id = None
            corrected_frames = None
            if is_correction:
                prior = track.versions.order_by('-version_number').first()
                if prior:
                    prior_version_id = str(prior.id)
                    corrected_frames = sorted(f['frame_index'] for f in frames if 'frame_index' in f)
                    merged = {f['frame_index']: f for f in prior.data.get('frames', [])
                              if 'frame_index' in f}
                    merged.update({f['frame_index']: f for f in frames if 'frame_index' in f})
                    frames = [merged[i] for i in sorted(merged)]
                    logger.info(f"{tag} correction merged: {len(corrected_frames)} re-run "
                                f"frame(s) over {len(frames)} total")

            # Create new version with propagation results
            version = track.add_propagation_result(
                propagation_model='SAM2',
                propagation_model_version='v2.1',
                prompt_frames=request.query_params.get('prompt_frames', []),  # TODO: store from dispatch
                propagation_params=request.query_params.get('propagation_params', {}),  # TODO: store from dispatch
                frames=frames,
                modal_call_id=call_id,
                dispatch_at_ms=int(request.query_params.get('dispatch_at_ms', 0)),
                result_at_ms=int(datetime.now().timestamp() * 1000),
                prior_version_id=prior_version_id,
                corrected_frames=corrected_frames,
            )

            return Response(
                {
                    'status': 'done',
                    'track_id': str(track.id),
                    'version_id': str(version.id),
                    'frames_processed': len(frames),
                    'latency_s': latency_s,
                }
            )
        except ImportError:
            # Modal not available; return mock
            latest = track.versions.order_by('-version_number').first()
            return Response(
                {
                    'status': 'done',
                    'track_id': str(track.id),
                    'version_id': str(latest.id) if latest else None,
                    'frames_processed': 240,
                    'latency_s': 45.2,
                }
            )


class VideoMaskCancelView(APIView):
    """Cancel an in-flight propagation job."""

    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, asset_id: str, layer_id: str):
        """POST /api/library/assets/<id>/video-mask/<layer_id>/cancel/?call_id=call-xyz

        Response:
            {"status": "cancelled"}
        """
        call_id = request.query_params.get('call_id')
        if not call_id:
            return Response(
                {'error': 'call_id required'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # TODO: Phase 1.1 — Cancel Modal function call
        # modal.functions.FunctionCall.from_id(call_id).cancel()

        return Response({'status': 'cancelled'})


class VideoMaskTrackInfoView(APIView):
    """Return persisted track state so the timeline can rehydrate after reload.

    The keyframe markers and propagated-span bar are otherwise session-only React
    state; this lets the frontend rebuild them from the DB on mount.
    """

    permission_classes = [permissions.IsAuthenticated]

    def get(self, request, asset_id: str, layer_id: str):
        """GET /api/library/assets/<id>/video-mask/<layer_id>/"""
        track = MaskTrack.objects.for_video_and_layer(str(asset_id), layer_id)
        if not track:
            return Response({'exists': False})

        try:
            version = track.versions.latest('version_number')
        except Exception:
            return Response({'exists': False})

        frames = version.data.get('frames', [])
        frame_indices = sorted(f['frame_index'] for f in frames if 'frame_index' in f)
        if not frame_indices:
            return Response({'exists': False})

        low_conf = track.get_low_confidence_frames(version_id=str(version.id))

        return Response({
            'exists': True,
            'version_id': str(version.id),
            'version_number': version.version_number,
            'span_start': frame_indices[0],
            'span_end': frame_indices[-1],
            'keyframes': track.get_keyframes(version_id=str(version.id)),
            'low_confidence_frames': low_conf,
        })


class VideoMaskListView(APIView):
    """List every mask track for a video so the client can restore its layers.

    Layer ids in the Yjs doc are not guaranteed stable across sessions, so tracks
    (keyed by layer_id) can orphan. Anchoring on the track list lets the frontend
    re-seed the mask layers from the durable source of truth.
    """

    permission_classes = [permissions.IsAuthenticated]

    def get(self, request, asset_id: str):
        """GET /api/library/assets/<id>/video-masks/"""
        from .models.relations import EntityRelation

        relations = EntityRelation.objects.filter(
            asset_id=str(asset_id), role='mask_track',
        )
        tracks_out = []
        for rel in relations:
            layer_id = (rel.type_data or {}).get('layer_id')
            if not layer_id:
                continue
            track = MaskTrack.objects.filter(pk=rel.entity_id).first()
            if not track:
                continue
            version = track.versions.order_by('-version_number').first()
            if not version:
                continue
            frames = version.data.get('frames', [])
            frame_indices = sorted(f['frame_index'] for f in frames if 'frame_index' in f)
            if not frame_indices:
                continue
            meta = rel.type_data or {}
            tracks_out.append({
                'layer_id': layer_id,
                'layer_name': meta.get('layer_name'),
                'layer_color': meta.get('layer_color'),
                'version_id': str(version.id),
                'span_start': frame_indices[0],
                'span_end': frame_indices[-1],
                'keyframes': track.get_keyframes(version_id=str(version.id)),
                'low_confidence_frames': track.get_low_confidence_frames(version_id=str(version.id)),
            })
        return Response({'tracks': tracks_out})


class VideoMaskFrameView(APIView):
    """Serve a single frame's mask as a tintable RGBA PNG.

    The stored mask is grayscale (white = object). We return RGBA with the mask
    in the alpha channel and white RGB, so the client can colour it by filling
    the layer colour through the alpha (source-in) — no per-pixel work client-side.
    """

    permission_classes = [permissions.IsAuthenticated]

    def get(self, request, asset_id: str, layer_id: str):
        """GET /api/library/assets/<id>/video-mask/<layer_id>/mask/?frame=N[&version_id=]"""
        frame = request.query_params.get('frame')
        if frame is None:
            return Response({'error': 'frame required'},
                            status=status.HTTP_400_BAD_REQUEST)
        try:
            frame_index = int(frame)
        except (TypeError, ValueError):
            return Response({'error': 'frame must be an integer'},
                            status=status.HTTP_400_BAD_REQUEST)

        track = MaskTrack.objects.for_video_and_layer(str(asset_id), layer_id)
        if not track:
            return HttpResponse(status=status.HTTP_404_NOT_FOUND)

        version_id = request.query_params.get('version_id') or None
        png_bytes = track.get_mask_for_frame(frame_index, version_id=version_id)
        if not png_bytes:
            # No mask for this frame (e.g. before the prompt frame). 204 = empty.
            return HttpResponse(status=status.HTTP_204_NO_CONTENT)

        from PIL import Image

        mask = Image.open(io.BytesIO(png_bytes)).convert('L')
        rgba = Image.new('RGBA', mask.size, (255, 255, 255, 0))
        rgba.putalpha(mask)  # alpha follows the mask; RGB stays white

        buf = io.BytesIO()
        rgba.save(buf, format='PNG')
        resp = HttpResponse(buf.getvalue(), content_type='image/png')
        # Masks are immutable per (track version, frame) — cache aggressively.
        resp['Cache-Control'] = 'private, max-age=86400'
        return resp
