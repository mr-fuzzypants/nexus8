"""
Video frame staging for GPU processing.

On-demand frame extraction from video files, with resolution tiers and
efficient transport to Modal GPU workers.
"""

import os
import shutil
import subprocess
import tempfile
import tarfile
from pathlib import Path
from typing import Optional

from django.conf import settings
from django.core.exceptions import SuspiciousFileOperation
from django.core.files.storage import default_storage

import logging

logger = logging.getLogger(__name__)


class FrameStagingError(Exception):
    """Raised when frame extraction or staging fails."""
    pass


class VideoFrameStager:
    """Manages on-demand frame extraction and staging for video processing."""

    # Resolution tiers: (name, scale_filter). Higher tiers preserve fine mask
    # detail (thin trims, fingers) at higher upload/GPU cost.
    TIERS = {
        'native': None,  # No scaling
        'preview_720p': 'scale=w=1280:h=720:force_original_aspect_ratio=decrease',
        'preview_480p': 'scale=w=854:h=480:force_original_aspect_ratio=decrease',
    }

    # Frame storage directory (staging area, content-addressed by asset version)
    STAGING_ROOT = getattr(settings, 'VIDEO_FRAME_STAGING_ROOT', '/tmp/nexus8-frames')

    @classmethod
    def staging_dir(
        cls,
        asset_id: str,
        version_id: str,
        tier: str = 'native',
        frame_range: Optional[tuple[int, int]] = None,
    ) -> Path:
        """Get the staging directory path for (asset_id, version_id, tier[, range]).

        A frame_range gets its own subdirectory so spans cache independently and
        never collide with a full-clip extraction.
        """
        base = Path(cls.STAGING_ROOT) / asset_id / version_id / tier
        if frame_range is not None:
            return base / f"span_{frame_range[0]}-{frame_range[1]}"
        return base

    @classmethod
    def extract_frames(
        cls,
        video_path: str,
        asset_id: str,
        version_id: str,
        tier: str = 'native',
        frame_range: Optional[tuple[int, int]] = None,
    ) -> Path:
        """Extract frames from a video to a staging directory.

        Args:
            video_path: Path to the video file (local filesystem or storage path)
            asset_id: Asset UUID for directory organization
            version_id: Asset version UUID (enables cache invalidation)
            tier: Resolution tier ('native' or 'preview_480p')
            frame_range: Optional (start_frame, end_frame) to extract a span

        Returns:
            Path to the staging directory containing frame PNGs

        Raises:
            FrameStagingError: If extraction fails
        """
        if tier not in cls.TIERS:
            raise FrameStagingError(f"Unknown tier: {tier}")

        staging_dir = cls.staging_dir(asset_id, version_id, tier, frame_range)

        # Check if frames already extracted
        if staging_dir.exists() and list(staging_dir.glob('frame_*.jpg')):
            logger.info(f"Frames already staged at {staging_dir}")
            return staging_dir

        # Resolve local path
        is_temp = False
        if os.path.isabs(video_path) and os.path.exists(video_path):
            # Caller passed an already-resolved absolute filesystem path.
            local_path = video_path
        else:
            try:
                local_path = default_storage.path(video_path)
            except (NotImplementedError, ValueError, AttributeError, SuspiciousFileOperation):
                # Remote storage: extract to temp, then move
                local_path = None

        if not local_path:
            # Copy to temp file for processing
            with tempfile.NamedTemporaryFile(suffix='.mp4', delete=False) as tmp:
                with default_storage.open(video_path, 'rb') as src:
                    tmp.write(src.read())
                local_path = tmp.name
                is_temp = True

        try:
            staging_dir.mkdir(parents=True, exist_ok=True)
            cls._extract_with_ffmpeg(
                local_path,
                staging_dir,
                tier,
                frame_range,
            )
            logger.info(f"Extracted {len(list(staging_dir.glob('frame_*.jpg')))} frames to {staging_dir}")
            return staging_dir
        finally:
            # Only remove the temp copy we created; never the source video.
            if is_temp:
                try:
                    os.unlink(local_path)
                except OSError:
                    pass

    @classmethod
    def _extract_with_ffmpeg(
        cls,
        video_path: str,
        staging_dir: Path,
        tier: str,
        frame_range: Optional[tuple[int, int]],
    ) -> None:
        """Extract frames using ffmpeg."""
        ffmpeg = shutil.which('ffmpeg')
        if not ffmpeg:
            raise FrameStagingError("ffmpeg not found; install to extract frames")

        scale_filter = cls.TIERS[tier]
        vf_parts = []
        if scale_filter:
            vf_parts.append(scale_filter)

        # Frame selection. For a span, select by decoded-frame index (n) so the
        # extraction is frame-accurate — 'n' counts input frames from 0, i.e. the
        # absolute frame number. The scale filter is applied AFTER select so we
        # only scale the frames we keep.
        frames_limit_args = []
        if frame_range:
            start_frame, end_frame = frame_range
            select = f"select=between(n\\,{start_frame}\\,{end_frame})"
            vf_parts = [select] + vf_parts
            # -frames:v bounds output to the span size, so ffmpeg stops decoding
            # once the last span frame is written instead of walking the whole clip.
            frames_limit_args = ['-frames:v', str(end_frame - start_frame + 1)]

        # Emit JPEG, not PNG: SAM 2's video predictor wants JPEG frames, and
        # lossless PNG makes the Modal upload payload ~5-10x larger for no gain.
        cmd = [
            ffmpeg,
            '-i', video_path,
            *(['-vf', ','.join(vf_parts)] if vf_parts else []),
            '-vsync', '0',  # Emit every selected frame, no dup/drop
            *frames_limit_args,
            '-q:v', '4',  # MJPEG quality (2=best/large … 31=worst); 4 ≈ visually clean
            str(staging_dir / 'frame_%06d.jpg'),
        ]

        try:
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=600,  # 10 minute timeout for long videos
            )
        except subprocess.TimeoutExpired:
            raise FrameStagingError(f"Frame extraction timeout for {video_path}")

        if result.returncode != 0:
            raise FrameStagingError(
                f"ffmpeg failed: {result.stderr}"
            )

    # ffmpeg's image2 muxer numbers output starting at frame_000001, so the
    # file for absolute frame index i is frame_{i + 1:06d}.jpg.
    FRAME_FILE_OFFSET = 1

    @classmethod
    def _frame_abs_index(cls, frame_path: Path) -> int:
        """Absolute (0-based) frame index for a staged 'frame_NNNNNN' file."""
        return int(frame_path.stem.split('_')[1]) - cls.FRAME_FILE_OFFSET

    @classmethod
    def create_frame_archive(
        cls,
        staging_dir: Path,
        start_frame: Optional[int] = None,
        end_frame: Optional[int] = None,
        archive_format: str = 'tar',
    ) -> bytes:
        """Create a compressed archive of staged frames for transport to Modal.

        Args:
            staging_dir: Path to staging directory with frame PNGs
            start_frame: First absolute frame index to include (inclusive). None = 0.
            end_frame: Last absolute frame index to include (inclusive). None = last.
            archive_format: 'tar' (default) or 'zip'

        Returns:
            Compressed archive bytes. Frames are added in ascending order so the
            span's first frame becomes SAM 2's frame 0.
        """
        frames = sorted(staging_dir.glob('frame_*.jpg'))
        if not frames:
            raise FrameStagingError(f"No frames found in {staging_dir}")

        if start_frame is not None or end_frame is not None:
            lo = start_frame if start_frame is not None else 0
            hi = end_frame if end_frame is not None else 10**12
            frames = [f for f in frames if lo <= cls._frame_abs_index(f) <= hi]
            if not frames:
                raise FrameStagingError(
                    f"No frames in span [{start_frame}, {end_frame}] within {staging_dir}"
                )

        if archive_format == 'tar':
            import io
            buffer = io.BytesIO()
            with tarfile.open(fileobj=buffer, mode='w:gz') as tar:
                for frame_path in frames:
                    tar.add(frame_path, arcname=frame_path.name)
            return buffer.getvalue()
        else:
            raise FrameStagingError(f"Unsupported archive format: {archive_format}")

    @classmethod
    def cleanup(cls, asset_id: str, version_id: Optional[str] = None) -> None:
        """Remove staged frames for an asset (and optionally a specific version).

        Args:
            asset_id: Asset UUID
            version_id: Optional version UUID; if None, clean all versions for the asset
        """
        asset_staging = Path(cls.STAGING_ROOT) / asset_id
        if version_id:
            version_staging = asset_staging / version_id
            if version_staging.exists():
                shutil.rmtree(version_staging)
                logger.info(f"Cleaned up frames for {asset_id}/{version_id}")
        else:
            if asset_staging.exists():
                shutil.rmtree(asset_staging)
                logger.info(f"Cleaned up all frames for {asset_id}")
