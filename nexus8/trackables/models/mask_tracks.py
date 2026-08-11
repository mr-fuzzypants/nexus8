"""
Video mask track models and managers.

A mask track is a sequence of per-frame masks for a video clip, produced by SAM 2
propagation with interactive corrections. See [[MASK_TRACK_MODEL.md]] for the design.
"""

from uuid import uuid4
import base64
from datetime import datetime
from typing import Any, Optional

from django.db import models

from .entities import VersionedEntity
from .versions import VersionLink
from .relations import EntityRelation


class MaskTrackManager(models.Manager):
    """Manager for MaskTrack entities."""

    def for_video_and_layer(self, video_id: str, layer_id: str) -> Optional['MaskTrack']:
        """Fetch the MaskTrack for a given (video_id, layer_id) pair.

        EntityRelation.asset  = the video  (FK → VersionedEntity)
        EntityRelation.entity = the track  (FK → VersionedEntity)
        type_data['layer_id'] identifies which layer within the video.
        """
        try:
            relation = EntityRelation.objects.get(
                asset_id=video_id,
                role='mask_track',
                type_data__layer_id=layer_id,
            )
            return self.get_queryset().get(pk=relation.entity_id)
        except (EntityRelation.DoesNotExist, self.model.DoesNotExist):
            return None

    def get_or_create_for_video_and_layer(
        self,
        video_id: str,
        layer_id: str,
        defaults: Optional[dict] = None,
        layer_name: Optional[str] = None,
        layer_color: Optional[str] = None,
        source_layer_id: Optional[str] = None,
    ) -> tuple['MaskTrack', bool]:
        """Get or create a MaskTrack for (video_id, layer_id).

        Creates both the MaskTrack entity and the EntityRelation that links it
        to the source video. layer_name/layer_color — and, for chained layers,
        source_layer_id (the layer whose removal output this layer operates
        on) — are stored on the relation so the layer restores on reload.
        Returns (track, created).
        """
        existing = self.for_video_and_layer(video_id, layer_id)
        if existing:
            # Refresh stored layer metadata if provided (name/colour may change).
            if layer_name is not None or layer_color is not None or source_layer_id is not None:
                rel = EntityRelation.objects.filter(
                    asset_id=video_id, role='mask_track',
                    type_data__layer_id=layer_id,
                ).first()
                if rel:
                    if layer_name is not None:
                        rel.type_data['layer_name'] = layer_name
                    if layer_color is not None:
                        rel.type_data['layer_color'] = layer_color
                    if source_layer_id is not None:
                        rel.type_data['source_layer_id'] = source_layer_id
                    rel.save(update_fields=['type_data'])
            return existing, False

        defaults = defaults or {}
        track = self.create(
            entity_type='mask_track',
            code=f'track-{uuid4().hex[:8]}',
            name=f'Mask track (layer {layer_id[:8]})',
            **defaults,
        )
        type_data = {'layer_id': layer_id}
        if layer_name is not None:
            type_data['layer_name'] = layer_name
        if layer_color is not None:
            type_data['layer_color'] = layer_color
        if source_layer_id is not None:
            type_data['source_layer_id'] = source_layer_id
        EntityRelation.objects.create(
            asset_id=video_id,
            entity=track,
            role='mask_track',
            type_data=type_data,
        )
        return track, True


class MaskTrack(VersionedEntity):
    """Video mask track entity.

    One track per (source_video, layer_id); each track accumulates Versions
    as the artist propagates and corrects the mask.
    """

    objects = MaskTrackManager()

    class Meta:
        proxy = True

    def add_propagation_result(
        self,
        propagation_model: str,
        propagation_model_version: str,
        prompt_frames: list[dict[str, Any]],
        propagation_params: dict[str, Any],
        frames: list[dict[str, Any]],
        modal_call_id: str,
        dispatch_at_ms: int,
        result_at_ms: int,
        prior_version_id: Optional[str] = None,
        corrected_frames: Optional[list[int]] = None,
    ) -> 'Version':
        """Create a new Version with propagation results.

        Args:
            propagation_model: 'SAM2'
            propagation_model_version: e.g. 'v2.1'
            prompt_frames: List of {frame_index, type, clicks/scribble_bytes}
            propagation_params: {full_clip, span_start, span_end}
            frames: List of {frame_index, authorship, mask_png_b64, confidence, vector_geometry}
            modal_call_id: Modal function call ID for audit
            dispatch_at_ms: Unix timestamp in ms
            result_at_ms: Unix timestamp in ms
            prior_version_id: If this is a correction run, ID of the prior version
            corrected_frames: If this is a correction run, list of frame indices that were corrected

        Returns:
            The created Version.
        """
        from .versions import Version, update_symlink  # Avoid circular import

        next_version_number = (
            Version.objects.filter(entity=self)
            .aggregate(max=models.Max('version_number'))['max'] or 0
        ) + 1

        version = Version.objects.create(
            entity=self,
            version_number=next_version_number,
            variation_number=0,
            data={
                'propagation_model': propagation_model,
                'propagation_model_version': propagation_model_version,
                'prompt_frames': prompt_frames,
                'propagation_params': propagation_params,
                'frames': frames,
                'modal_call_id': modal_call_id,
                'dispatch_at_ms': dispatch_at_ms,
                'result_at_ms': result_at_ms,
                'latency_s': (result_at_ms - dispatch_at_ms) / 1000,
                'prior_version_id': prior_version_id,
                'corrected_frames': corrected_frames or [],
            },
        )

        # Point the track's 'latest' symlink at the new version. VersionedEntity
        # has no entity_version column — current version is tracked via symlinks.
        # 'selected' (the artist's take choice) auto-pins to the fresh run: the
        # artist is watching it land, and reload must restore what they saw.
        update_symlink(self, 'latest', version)
        update_symlink(self, 'selected', version)

        return version

    def add_manual_version(
        self,
        frames: list[dict[str, Any]],
        *,
        fill_policy: str = 'hold',
        span_start: Optional[int] = None,
        span_end: Optional[int] = None,
        base_version: Optional[Any] = None,
    ) -> 'Version':
        """Create a version from hand-painted masks — no GPU job anywhere.

        frames: [{frame_index, mask_png_b64}] — grayscale white-on-object PNGs
        at native resolution (callers normalize alpha-carried rasters first).

        Without ``base_version`` this is a from-scratch manual track: every
        painted frame is a 'keyframe', and ``fill_policy='hold'`` gives
        garbage-matte semantics (each mask persists until the next keyframe,
        expanded at read time so storage stays sparse).

        With ``base_version`` the painted frames overlay that version's frames
        as 'correction' authorship — the deterministic paint-over fix for
        frames where SAM refuses to converge (F16 escape hatch).
        """
        from .versions import Version, update_symlink  # Avoid circular import

        painted = sorted(
            (dict(f) for f in frames
             if f.get('frame_index') is not None and f.get('mask_png_b64')),
            key=lambda f: f['frame_index'],
        )
        if not painted:
            raise ValueError('No painted frames provided')

        if base_version is not None:
            merged = {f['frame_index']: f
                      for f in base_version.data.get('frames', [])
                      if 'frame_index' in f}
            for f in painted:
                merged[f['frame_index']] = {
                    'frame_index': f['frame_index'],
                    'authorship': 'correction',
                    'mask_png_b64': f['mask_png_b64'],
                    'confidence': 1.0,
                }
            out_frames = [merged[i] for i in sorted(merged)]
            model = base_version.data.get('propagation_model', 'SAM2')
            params = dict(base_version.data.get('propagation_params') or {})
            fill = base_version.data.get('fill_policy')
            corrected = [f['frame_index'] for f in painted]
        else:
            out_frames = [{
                'frame_index': f['frame_index'],
                'authorship': 'keyframe',
                'mask_png_b64': f['mask_png_b64'],
                'confidence': 1.0,
            } for f in painted]
            model = 'manual'
            lo = span_start if span_start is not None else painted[0]['frame_index']
            hi = span_end if span_end is not None else painted[-1]['frame_index']
            params = {'full_clip': False, 'span_start': lo, 'span_end': hi}
            fill = fill_policy
            corrected = []

        next_version_number = (
            Version.objects.filter(entity=self)
            .aggregate(max=models.Max('version_number'))['max'] or 0
        ) + 1
        now_ms = int(datetime.now().timestamp() * 1000)
        version = Version.objects.create(
            entity=self,
            version_number=next_version_number,
            variation_number=0,
            data={
                'propagation_model': model,
                'manual': base_version is None,
                'manual_correction': base_version is not None,
                'prompt_frames': [],
                'propagation_params': params,
                'frames': out_frames,
                'fill_policy': fill,
                'modal_call_id': None,
                'dispatch_at_ms': now_ms,
                'result_at_ms': now_ms,
                'latency_s': 0,
                'prior_version_id': str(base_version.id) if base_version is not None else None,
                'corrected_frames': corrected,
            },
        )
        update_symlink(self, 'latest', version)
        update_symlink(self, 'selected', version)
        return version

    def current_version(self) -> Optional[Any]:
        """The pinned take ('selected' symlink) if set, else the latest version.

        'latest' stays the append pointer; 'selected' is the artist's choice —
        the version the overlay serves and downstream ops consume by default.
        """
        from .versions import Symlink  # Avoid circular import

        link = (
            Symlink.objects.filter(entity=self, name='selected')
            .select_related('version')
            .first()
        )
        if link:
            return link.version
        try:
            return self.versions.latest('version_number')
        except Exception:
            return None

    def _resolve_version(self, version_id: Optional[str]) -> Optional[Any]:
        from .versions import Version  # Avoid circular import

        if version_id:
            try:
                return Version.objects.get(id=version_id, entity=self)
            except Version.DoesNotExist:
                return None
        return self.current_version()

    def version_summaries(self) -> list[dict[str, Any]]:
        """Take list for the UI: one summary per version, newest first."""
        current = self.current_version()
        out = []
        for v in self.versions.order_by('-version_number'):
            frames = v.data.get('frames', [])
            idx = sorted(f['frame_index'] for f in frames if 'frame_index' in f)
            if not idx:
                continue
            pp = v.data.get('propagation_params') or {}
            prompts = v.data.get('prompt_frames') or []
            out.append({
                'version_id': str(v.id),
                'version_number': v.version_number,
                'model': v.data.get('propagation_model'),
                'manual': bool(v.data.get('manual')),
                'manual_correction': bool(v.data.get('manual_correction')),
                'corrected': bool(v.data.get('corrected_frames')),
                'fill_policy': v.data.get('fill_policy'),
                'span_start': pp.get('span_start', idx[0]),
                'span_end': pp.get('span_end', idx[-1]),
                'frame_count': len(idx),
                'created_at': v.created_at.isoformat(),
                'selected': bool(current and v.pk == current.pk),
                # The values this run was made with — the artist-facing
                # provenance record for the take (UI + API).
                'params': {
                    'model': v.data.get('propagation_model'),
                    'model_version': v.data.get('propagation_model_version'),
                    'staging_tier': pp.get('staging_tier'),
                    'span': [pp.get('span_start', idx[0]), pp.get('span_end', idx[-1])],
                    'chain_source': pp.get('chain_source'),
                    'fill_policy': v.data.get('fill_policy'),
                    'prompt_frames': len(prompts),
                    'prompt_mask_frames': sum(1 for p in prompts if p.get('type') == 'mask'),
                    'corrected_frames': v.data.get('corrected_frames') or [],
                    'prior_version_id': v.data.get('prior_version_id'),
                    'latency_s': v.data.get('latency_s'),
                    'modal_call_id': v.data.get('modal_call_id'),
                },
            })
        return out

    def get_mask_for_frame(self, frame_index: int, version_id: Optional[str] = None) -> Optional[bytes]:
        """Fetch the mask PNG bytes for a specific frame.

        Args:
            frame_index: Frame number (0-indexed)
            version_id: Specific version; if None, uses the pinned/current version

        Returns:
            PNG bytes, or None if frame has no mask or version not found.
        """
        version = self._resolve_version(version_id)
        if not version:
            return None

        frames = version.data.get('frames', [])
        frame_record = next(
            (f for f in frames if f.get('frame_index') == frame_index),
            None,
        )

        # Manual hold tracks store only painted keyframes; each mask persists
        # until the next keyframe (garbage-matte semantics), expanded here at
        # read time so the stored version stays sparse.
        if not frame_record and version.data.get('fill_policy') == 'hold':
            pp = version.data.get('propagation_params') or {}
            lo, hi = pp.get('span_start'), pp.get('span_end')
            if (lo is None or frame_index >= lo) and (hi is None or frame_index <= hi):
                earlier = [f for f in frames
                           if f.get('frame_index') is not None
                           and f['frame_index'] <= frame_index
                           and f.get('mask_png_b64')]
                if earlier:
                    frame_record = max(earlier, key=lambda f: f['frame_index'])

        if not frame_record or not frame_record.get('mask_png_b64'):
            return None

        return base64.b64decode(frame_record['mask_png_b64'])

    def get_confidence_for_frame(self, frame_index: int, version_id: Optional[str] = None) -> Optional[float]:
        """Fetch the SAM 2 confidence score for a frame."""
        version = self._resolve_version(version_id)
        if not version:
            return None

        frames = version.data.get('frames', [])
        frame_record = next(
            (f for f in frames if f.get('frame_index') == frame_index),
            None,
        )

        return frame_record.get('confidence') if frame_record else None

    def get_low_confidence_frames(self, threshold: float = 0.7, version_id: Optional[str] = None) -> list[int]:
        """Return frame indices with confidence below threshold.

        Used by the timeline UI to display low-confidence spans.
        """
        version = self._resolve_version(version_id)
        if not version:
            return []

        frames = version.data.get('frames', [])
        return [
            f['frame_index'] for f in frames
            if f.get('confidence', 1.0) < threshold
        ]

    def get_keyframes(self, version_id: Optional[str] = None) -> list[int]:
        """Return frame indices authored by the user (keyframes or corrections)."""
        version = self._resolve_version(version_id)
        if not version:
            return []

        frames = version.data.get('frames', [])
        return [
            f['frame_index'] for f in frames
            if f.get('authorship') in ('keyframe', 'correction')
        ]
