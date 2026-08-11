"""
Video mask endpoints: legacy segment-op aliases + the interactive loop.

The propagate/status/cancel views are thin delegates onto the generic
operation-job service (services/video_ops.py, op='segment') so existing
clients keep their contract; new clients should use /video-ops/ instead
(views_video_ops.py). The interactive preview/session-click loop and the
mask-serving views are segment-specific and live here permanently.
"""

import io
import logging

from django.http import HttpResponse
from django.shortcuts import get_object_or_404
from rest_framework import permissions, status
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import MediaAsset, MaskTrack, OperationJob
from .services import video_ops
from .services.video_staging import VideoFrameStager, FrameStagingError

logger = logging.getLogger(__name__)
MODAL_APP_NAME = video_ops.SEGMENT_MODAL_APP

# Resolution tier used for segmentation; masks are upscaled to native on apply.
STAGING_TIER = video_ops.DEFAULT_STAGING_TIER


def _job_for_call(asset_id: str, layer_id: str, call_id: str) -> OperationJob | None:
    return (
        OperationJob.objects
        .filter(asset_id=asset_id, layer_id=layer_id, modal_call_id=call_id)
        .order_by("-created_at")
        .first()
    )


class VideoMaskPropagateView(APIView):
    """Dispatch a segment (SAM 2 propagation) job. Legacy alias for /video-ops/."""

    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, asset_id: str, layer_id: str):
        """POST /api/library/assets/<id>/video-mask/<layer_id>/propagate/

        Body: {prompt_frames, propagation_params, layer_name?, layer_color?,
               source_size?, staging_tier?}
        Response (202): {status, call_id, track_id, version_number,
                         dispatch_at_ms, span_start, span_end}
        """
        video = get_object_or_404(MediaAsset, id=asset_id)
        try:
            job = video_ops.dispatch_job(
                asset=video,
                op_name='segment',
                layer_id=layer_id,
                inputs={
                    'prompt_frames': request.data.get('prompt_frames'),
                    'propagation_params': request.data.get('propagation_params'),
                    'layer_name': request.data.get('layer_name'),
                    'layer_color': request.data.get('layer_color'),
                    'source_size': request.data.get('source_size'),
                    'staging_tier': request.data.get('staging_tier'),
                    'chain_source': request.data.get('chain_source'),
                    'layer_source_layer_id': request.data.get('layer_source_layer_id'),
                },
                user=request.user,
            )
        except video_ops.OpError as exc:
            return Response({'error': str(exc)}, status=exc.http_status)

        return Response(
            {
                'status': 'working',
                'call_id': job.modal_call_id,
                'job_id': str(job.id),
                'track_id': job.inputs.get('track_id'),
                'version_number': 1,  # First version
                'dispatch_at_ms': int(job.dispatched_at.timestamp() * 1000),
                'span_start': job.inputs.get('span_start'),
                'span_end': job.inputs.get('span_end'),
            },
            status=status.HTTP_202_ACCEPTED,
        )


class VideoMaskStatusView(APIView):
    """Poll a segment job. Legacy alias for /video-ops/<job_id>/.

    Keyed by call_id (the legacy client contract); dispatch state (span,
    prompts, params) comes from the job record, not query params.
    """

    permission_classes = [permissions.IsAuthenticated]

    def get(self, request, asset_id: str, layer_id: str):
        """GET /api/library/assets/<id>/video-mask/<layer_id>/status/?call_id=call-xyz[&correction=1]

        Response: {status: 'working'|'done'|'failed', …} — working carries
        progress/elapsed_s; done carries track_id/version_id/frames_processed/
        latency_s; failed carries error.
        """
        call_id = request.query_params.get('call_id')
        if not call_id:
            return Response(
                {'error': 'call_id required'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        job = _job_for_call(asset_id, layer_id, call_id)
        if not job:
            return Response(
                {'error': 'No job found for this call_id'},
                status=status.HTTP_404_NOT_FOUND,
            )

        is_correction = request.query_params.get('correction') in ('1', 'true')
        try:
            payload = video_ops.poll_job(job, correction=is_correction or None)
        except video_ops.OpError as exc:
            return Response({'error': str(exc)}, status=exc.http_status)
        return Response(payload)


class VideoMaskCancelView(APIView):
    """Cancel an in-flight segment job. Legacy alias for /video-ops/<job_id>/cancel/."""

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
        job = _job_for_call(asset_id, layer_id, call_id)
        if job:
            video_ops.cancel_job(job)
        return Response({'status': 'cancelled'})


class VideoMaskPreviewView(APIView):
    """Interactive prompt-frame preview: clicks on one frame → that frame's mask.

    Powers the demo-style tight loop: the artist refines clicks with sub-second
    feedback BEFORE committing to a full propagation. The approved preview mask
    is then sent as the propagation's mask prompt ("compile" step, client-side).
    """

    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, asset_id: str, layer_id: str):
        """POST /api/library/assets/<id>/video-mask/<layer_id>/preview/

        Body: {"frame_index": N, "clicks": [{x, y, positive}] (native px),
               "source_size": {width, height}, "staging_tier": "preview_480p"}
        """
        import time as _time
        t0 = _time.time()

        try:
            frame_index = int(request.data.get('frame_index'))
        except (TypeError, ValueError):
            return Response({'error': 'frame_index required'},
                            status=status.HTTP_400_BAD_REQUEST)
        clicks = request.data.get('clicks') or []
        if not clicks:
            return Response({'error': 'clicks required'},
                            status=status.HTTP_400_BAD_REQUEST)

        video = get_object_or_404(MediaAsset, id=asset_id)
        tier = request.data.get('staging_tier') or STAGING_TIER
        if tier not in VideoFrameStager.TIERS:
            tier = STAGING_TIER

        # Chaining (Phase 3): previews on a chained layer read the derived
        # clip's pixels — a preview against the source would segment the very
        # object the removal already erased. Frame index stays source-based;
        # the offset applies only at extraction (rebase contract).
        try:
            chain_path, chain_offset, chain_count, chain_key = \
                video_ops.resolve_chain_source(
                    video, {'chain_source': request.data.get('chain_source')})
        except video_ops.OpError as exc:
            return Response({'error': str(exc)}, status=exc.http_status)
        if chain_count is not None and not (
            chain_offset <= frame_index <= chain_offset + chain_count - 1
        ):
            # Outside the chained clip's covered range — nothing to preview.
            return Response({'mask_b64': None, 'conditioned': False})

        # Stage just this frame (cached per (clip, tier, frame)).
        try:
            staging_dir = VideoFrameStager.extract_frames(
                chain_path,
                asset_id=str(video.id),
                version_id=chain_key,
                tier=tier,
                frame_range=(frame_index - chain_offset,
                             frame_index - chain_offset),
            )
            frame_path = sorted(staging_dir.glob('frame_*.jpg'))[0]
        except (FrameStagingError, IndexError) as e:
            return Response({'error': f'Frame staging failed: {e}'},
                            status=status.HTTP_500_INTERNAL_SERVER_ERROR)

        # Rescale clicks native → staged px (same contract as propagate, F9).
        from PIL import Image as PILImage
        with PILImage.open(frame_path) as im:
            staged_w, staged_h = im.size
        source_size = request.data.get('source_size') or {}
        src_w, src_h = source_size.get('width'), source_size.get('height')
        if src_w and src_h:
            sx, sy = staged_w / src_w, staged_h / src_h
            clicks = [{**c, 'x': c['x'] * sx, 'y': c['y'] * sy} for c in clicks]

        conditioned = False
        try:
            import modal
            segmentor = modal.Cls.from_name(MODAL_APP_NAME, "VideoSegmentor")()

            # Demo-style correction path: when the client reports a live
            # propagation session, click against the retained video state so
            # the frame's PROPAGATED mask conditions the result (the click
            # refines the existing mask instead of re-solving from scratch).
            result = None
            session_span_start = request.data.get('session_span_start')
            if session_span_start is not None:
                sess = segmentor.session_click.remote(
                    session_key=f"{asset_id}:{layer_id}",
                    session_meta={'tier': tier,
                                  'span_start': int(session_span_start)},
                    frame_index=frame_index - int(session_span_start),
                    clicks=clicks,
                )
                if not sess.get('no_session'):
                    result = sess
                    conditioned = True
                else:
                    logger.info(f"[preview {asset_id}/{layer_id[:8]}] session "
                                f"gone — stateless fallback")

            if result is None:
                # The stateless preview needs a positive click to establish
                # the object; a negative-only correction only means something
                # against an existing mask, which we no longer have.
                if not any(c.get('positive', True) for c in clicks):
                    return Response({'mask_b64': None, 'conditioned': False})
                result = segmentor.preview.remote(
                    frame_jpeg=frame_path.read_bytes(),
                    clicks=clicks,
                )
        except Exception as exc:
            logger.exception(f"[preview {asset_id}/{layer_id[:8]}] Modal preview failed")
            return Response({'error': f'Preview failed: {exc}'},
                            status=status.HTTP_502_BAD_GATEWAY)

        # Convert the binary mask to RGBA (alpha = object) — the same tintable
        # format as VideoMaskFrameView, and directly usable as a mask prompt.
        import base64 as _b64
        mask = PILImage.open(io.BytesIO(_b64.b64decode(result['mask_png_b64']))).convert('L')
        rgba = PILImage.new('RGBA', mask.size, (255, 255, 255, 0))
        rgba.putalpha(mask)
        buf = io.BytesIO()
        rgba.save(buf, format='PNG')

        logger.info(f"[preview {asset_id}/{layer_id[:8]}] frame {frame_index}, "
                    f"{len(clicks)} click(s), "
                    f"{'conditioned' if conditioned else 'stateless'}, "
                    f"score={result.get('score', 0):.3f}, "
                    f"total {_time.time() - t0:.2f}s "
                    f"(gpu {result.get('latency_s', 0):.2f}s)")
        return Response({
            'mask_b64': _b64.b64encode(buf.getvalue()).decode(),
            'score': result.get('score'),
            'latency_s': result.get('latency_s'),
            'conditioned': conditioned,
        })


def _normalize_mask_png_b64(b64s: str) -> str:
    """White-on-black grayscale PNG from either an alpha-carried (RGBA) raster
    or an already-grayscale mask. Client rasterizers emit alpha-channel masks
    (the F13 convention); stored track frames are L PNGs (white = object)."""
    import base64 as _b64

    from PIL import Image as PILImage

    img = PILImage.open(io.BytesIO(_b64.b64decode(b64s)))
    mask = img.getchannel('A') if img.mode == 'RGBA' else img.convert('L')
    buf = io.BytesIO()
    mask.save(buf, format='PNG')
    return _b64.b64encode(buf.getvalue()).decode()


class VideoMaskManualView(APIView):
    """Bake hand-painted masks into a track version — no GPU job anywhere.

    From-scratch (no base_version_id): painted frames become a 'manual'
    version with hold-until-next-keyframe fill (garbage-matte semantics —
    one painted frame on a locked-off shot is a usable removal matte).
    With base_version_id: painted frames overlay that version's frames as
    deterministic corrections (the escape hatch when SAM won't converge).
    """

    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, asset_id: str, layer_id: str):
        """POST /api/library/assets/<id>/video-mask/<layer_id>/manual/

        Body: {frames: [{frame_index, mask_png_b64}], fill_policy?,
               span?: {start, end}, base_version_id?, layer_name?, layer_color?}
        """
        from .models import Version

        frames = request.data.get('frames') or []
        if not frames:
            return Response({'error': 'frames required'},
                            status=status.HTTP_400_BAD_REQUEST)
        get_object_or_404(MediaAsset, id=asset_id)
        track, created = MaskTrack.objects.get_or_create_for_video_and_layer(
            str(asset_id), layer_id,
            layer_name=request.data.get('layer_name'),
            layer_color=request.data.get('layer_color'),
            source_layer_id=request.data.get('layer_source_layer_id'),
        )

        base_version = None
        base_id = request.data.get('base_version_id')
        if base_id:
            base_version = Version.objects.filter(pk=base_id, entity=track).first()
            if not base_version:
                return Response(
                    {'error': 'base_version_id does not belong to this track'},
                    status=status.HTTP_404_NOT_FOUND,
                )

        try:
            normalized = [
                {'frame_index': f.get('frame_index'),
                 'mask_png_b64': _normalize_mask_png_b64(f['mask_png_b64'])}
                for f in frames if f.get('mask_png_b64')
            ]
            span = request.data.get('span') or {}
            version = track.add_manual_version(
                normalized,
                fill_policy=request.data.get('fill_policy') or 'hold',
                span_start=span.get('start'),
                span_end=span.get('end'),
                base_version=base_version,
            )
        except (ValueError, KeyError, OSError) as exc:
            return Response({'error': f'Bake failed: {exc}'},
                            status=status.HTTP_400_BAD_REQUEST)

        logger.info(f"[manual {asset_id[:8]}/{layer_id[:8]}] baked "
                    f"{len(normalized)} frame(s) as v{version.version_number} "
                    f"({'correction over ' + base_id[:8] if base_id else 'from scratch'}"
                    f"{', track created' if created else ''})")
        return Response({
            'track_id': str(track.id),
            'version_id': str(version.id),
            'version_number': version.version_number,
            'frames_baked': len(normalized),
            'versions': track.version_summaries(),
        }, status=status.HTTP_201_CREATED)


class VideoMaskSelectView(APIView):
    """Pin a take: the version the overlay serves and removal consumes."""

    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, asset_id: str, layer_id: str):
        """POST /api/library/assets/<id>/video-mask/<layer_id>/select/
        Body: {version_id}"""
        from .models import Version
        from .models.versions import update_symlink

        track = MaskTrack.objects.for_video_and_layer(str(asset_id), layer_id)
        if not track:
            return Response({'error': 'No mask track for this layer'},
                            status=status.HTTP_404_NOT_FOUND)
        version = Version.objects.filter(
            pk=request.data.get('version_id'), entity=track
        ).first()
        if not version:
            return Response({'error': 'version_id does not belong to this track'},
                            status=status.HTTP_404_NOT_FOUND)
        update_symlink(track, 'selected', version, actor=request.user)
        return Response({
            'status': 'selected',
            'version_id': str(version.id),
            'version_number': version.version_number,
        })


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

        version = track.current_version()
        if not version:
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
            'versions': track.version_summaries(),
        })

    def delete(self, request, asset_id: str, layer_id: str):
        """DELETE /api/library/assets/<id>/video-mask/<layer_id>/[?purge=1]

        Removes the video↔track relation so the layer stops rehydrating on
        reload. With purge=1, also deletes the MaskTrack entity and all its
        versions — i.e. the stored per-frame mask PNGs. Without purge the
        track data is retained (orphaned) and recoverable by re-linking.
        """
        from .models.relations import EntityRelation

        purge = request.query_params.get('purge') in ('1', 'true')
        relations = EntityRelation.objects.filter(
            asset_id=str(asset_id), role='mask_track',
            type_data__layer_id=layer_id,
        )
        track_ids = list(relations.values_list('entity_id', flat=True))
        relations.delete()

        purged = 0
        if purge:
            for track in MaskTrack.objects.filter(pk__in=track_ids):
                # Symlinks RESTRICT their version FK — remove them before the
                # versions, then the entity itself.
                track.symlinks.all().delete()
                track.versions.all().delete()
                track.delete()
                purged += 1

        logger.info(f"[delete {asset_id[:8]}/{layer_id[:8]}] "
                    f"unlinked {len(track_ids)} track(s), purged {purged}")
        return Response({'deleted': bool(track_ids), 'purged': purged})


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
            version = track.current_version()
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
                'source_layer_id': meta.get('source_layer_id'),
                'version_id': str(version.id),
                'span_start': frame_indices[0],
                'span_end': frame_indices[-1],
                'keyframes': track.get_keyframes(version_id=str(version.id)),
                'low_confidence_frames': track.get_low_confidence_frames(version_id=str(version.id)),
                'versions': track.version_summaries(),
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
