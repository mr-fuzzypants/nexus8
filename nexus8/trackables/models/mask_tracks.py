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
    ) -> tuple['MaskTrack', bool]:
        """Get or create a MaskTrack for (video_id, layer_id).

        Creates both the MaskTrack entity and the EntityRelation that links it
        to the source video.  layer_name/layer_color are stored on the relation
        so the layer can be restored on reload. Returns (track, created).
        """
        existing = self.for_video_and_layer(video_id, layer_id)
        if existing:
            # Refresh stored layer metadata if provided (name/colour may change).
            if layer_name is not None or layer_color is not None:
                rel = EntityRelation.objects.filter(
                    asset_id=video_id, role='mask_track',
                    type_data__layer_id=layer_id,
                ).first()
                if rel:
                    if layer_name is not None:
                        rel.type_data['layer_name'] = layer_name
                    if layer_color is not None:
                        rel.type_data['layer_color'] = layer_color
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
        update_symlink(self, 'latest', version)

        return version

    def get_mask_for_frame(self, frame_index: int, version_id: Optional[str] = None) -> Optional[bytes]:
        """Fetch the mask PNG bytes for a specific frame.

        Args:
            frame_index: Frame number (0-indexed)
            version_id: Specific version; if None, uses the latest (current) version

        Returns:
            PNG bytes, or None if frame has no mask or version not found.
        """
        from .versions import Version  # Avoid circular import

        if version_id:
            try:
                version = Version.objects.get(id=version_id, entity=self)
            except Version.DoesNotExist:
                return None
        else:
            version = self.versions.latest('version_number')

        frames = version.data.get('frames', [])
        frame_record = next(
            (f for f in frames if f.get('frame_index') == frame_index),
            None,
        )

        if not frame_record or not frame_record.get('mask_png_b64'):
            return None

        return base64.b64decode(frame_record['mask_png_b64'])

    def get_confidence_for_frame(self, frame_index: int, version_id: Optional[str] = None) -> Optional[float]:
        """Fetch the SAM 2 confidence score for a frame."""
        from .versions import Version  # Avoid circular import

        if version_id:
            try:
                version = Version.objects.get(id=version_id, entity=self)
            except Version.DoesNotExist:
                return None
        else:
            version = self.versions.latest('version_number')

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
        from .versions import Version  # Avoid circular import

        if version_id:
            try:
                version = Version.objects.get(id=version_id, entity=self)
            except Version.DoesNotExist:
                return []
        else:
            version = self.versions.latest('version_number')

        frames = version.data.get('frames', [])
        return [
            f['frame_index'] for f in frames
            if f.get('confidence', 1.0) < threshold
        ]

    def get_keyframes(self, version_id: Optional[str] = None) -> list[int]:
        """Return frame indices authored by the user (keyframes or corrections)."""
        from .versions import Version  # Avoid circular import

        if version_id:
            try:
                version = Version.objects.get(id=version_id, entity=self)
            except Version.DoesNotExist:
                return []
        else:
            version = self.versions.latest('version_number')

        frames = version.data.get('frames', [])
        return [
            f['frame_index'] for f in frames
            if f.get('authorship') in ('keyframe', 'correction')
        ]
