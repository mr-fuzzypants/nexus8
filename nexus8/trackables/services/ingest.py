"""
Media ingest: uploaded file -> MediaAsset + first published Version.

Stores the original under MEDIA_ROOT/assets/originals/, builds a thumbnail
pyramid (tiny inline placeholder, 256px and 1024px WEBP renditions) under
MEDIA_ROOT/assets/thumbs/, and records everything in the asset's type_data so
the grid can paint progressively without extra round trips.

Files are content-addressed by sha256: re-uploading identical bytes returns
the existing asset instead of creating a duplicate.
"""

import base64
import contextlib
import hashlib
import io
import json
import math
import os
import re
import shutil
import subprocess
import tempfile

from django.conf import settings
from django.core.files.storage import default_storage

from ..models import MediaAsset, Version

THUMB_SIZES = (256, 1024)
TINY_SIZE = 24  # inline blur-up placeholder, embedded as a data URI

# Filmstrip sprite sheet: one poster frame every SPRITE_MIN_INTERVAL seconds
# (stretched for long clips so the sheet never exceeds SPRITE_MAX_TILES), packed
# into a SPRITE_COLUMNS-wide grid. The annotator draws slices of this single
# decoded image for the base timeline instead of seeking the video per thumbnail.
SPRITE_TILE_HEIGHT = 90
SPRITE_COLUMNS = 12
SPRITE_MAX_TILES = 240
SPRITE_MIN_INTERVAL = 1.0

IMAGE_EXTENSIONS = {
    ".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp", ".tif", ".tiff", ".avif",
}
VIDEO_EXTENSIONS = {".mp4", ".mov", ".avi", ".webm", ".mkv"}
# .glb/.gltf are unambiguous meshes; .ply is left as generic (often a mesh, but our
# generated splats set media_type explicitly) so extension inference stays safe.
MODEL_EXTENSIONS = {".glb", ".gltf", ".fbx", ".obj", ".blend"}


def _slugify(value):
    value = re.sub(r"[^a-zA-Z0-9]+", "_", value).strip("_").lower()
    return value or "asset"


def _media_type_for(extension):
    if extension in IMAGE_EXTENSIONS:
        return "image"
    if extension in VIDEO_EXTENSIONS:
        return "video"
    if extension in MODEL_EXTENSIONS:
        return "3d_model"
    return "file"


def _build_pyramid(original_bytes, content_hash):
    """Return (thumbnails dict, technical dict, tiny placeholder data URI)."""
    from PIL import Image

    image = Image.open(io.BytesIO(original_bytes))
    image.load()
    width, height = image.size

    if image.mode not in ("RGB", "RGBA"):
        image = image.convert("RGB")

    thumbnails = {}
    for size in THUMB_SIZES:
        if max(width, height) <= size:
            continue
        thumb = image.copy()
        thumb.thumbnail((size, size), Image.LANCZOS)
        buffer = io.BytesIO()
        thumb.save(buffer, "WEBP", quality=80)
        rel_path = f"assets/thumbs/{content_hash}_{size}.webp"
        default_storage.save(rel_path, io.BytesIO(buffer.getvalue()))
        thumbnails[str(size)] = settings.MEDIA_URL + rel_path

    tiny = image.copy()
    tiny.thumbnail((TINY_SIZE, TINY_SIZE), Image.LANCZOS)
    buffer = io.BytesIO()
    tiny.convert("RGB").save(buffer, "WEBP", quality=40)
    placeholder = "data:image/webp;base64," + base64.b64encode(buffer.getvalue()).decode()

    technical = {
        "width": width,
        "height": height,
        "format": (image.format or "").lower(),
    }
    return thumbnails, technical, placeholder


def _to_float(value):
    try:
        result = float(value)
    except (TypeError, ValueError):
        return None
    return result if result > 0 else None


def _to_int(value):
    try:
        result = int(value)
    except (TypeError, ValueError):
        return None
    return result if result > 0 else None


def _parse_frame_rate(value):
    """ffprobe reports frame rates as a 'num/den' rational (e.g. '24000/1001')."""
    if not isinstance(value, str):
        return None
    if "/" in value:
        num, _, den = value.partition("/")
        numerator = _to_float(num)
        denominator = _to_float(den)
        if numerator is None or denominator is None:
            return None
        return numerator / denominator
    return _to_float(value)


def _probe_video_file(path):
    """Run ffprobe on a local file; return a video technical_metadata dict (or {})."""
    ffprobe = shutil.which("ffprobe")
    if not ffprobe:
        return {}

    try:
        proc = subprocess.run(
            [
                ffprobe,
                "-v", "error",
                "-select_streams", "v:0",
                "-show_entries",
                "stream=width,height,r_frame_rate,avg_frame_rate,nb_frames,codec_name,duration"
                ":format=duration",
                "-of", "json",
                path,
            ],
            capture_output=True,
            text=True,
            timeout=30,
        )
    except (OSError, subprocess.SubprocessError):
        return {}

    if proc.returncode != 0:
        return {}

    try:
        payload = json.loads(proc.stdout or "{}")
    except ValueError:
        return {}

    streams = payload.get("streams") or []
    if not streams:
        return {}
    stream = streams[0]
    fmt = payload.get("format") or {}

    # r_frame_rate is the nominal (constant) rate; prefer it for frame-accurate
    # seeking and fall back to the average rate for variable-frame-rate sources.
    fps = _parse_frame_rate(stream.get("r_frame_rate")) or _parse_frame_rate(
        stream.get("avg_frame_rate")
    )
    duration = _to_float(stream.get("duration")) or _to_float(fmt.get("duration"))
    nb_frames = _to_int(stream.get("nb_frames"))
    if nb_frames is None and fps and duration:
        nb_frames = int(round(fps * duration))

    technical = {}
    width = _to_int(stream.get("width"))
    height = _to_int(stream.get("height"))
    if width:
        technical["width"] = width
    if height:
        technical["height"] = height
    if duration:
        technical["duration"] = duration
    if fps:
        technical["fps"] = fps
    if nb_frames:
        technical["nb_frames"] = nb_frames
    if stream.get("codec_name"):
        technical["codec"] = stream["codec_name"]
    return technical


@contextlib.contextmanager
def _local_video_path(rel_path, original_bytes):
    """Yield a filesystem path to the stored video for ffprobe/ffmpeg.

    Local storages expose a path directly; remote storages (which raise
    NotImplementedError) get a short-lived temp copy that is cleaned up on exit.
    """
    try:
        local_path = default_storage.path(rel_path)
    except (NotImplementedError, ValueError, AttributeError):
        local_path = None

    if local_path and os.path.exists(local_path):
        yield local_path
        return

    suffix = os.path.splitext(rel_path)[1]
    tmp_path = None
    try:
        with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
            tmp.write(original_bytes)
            tmp_path = tmp.name
        yield tmp_path
    finally:
        if tmp_path:
            try:
                os.unlink(tmp_path)
            except OSError:
                pass


def _build_video_sprite(local_path, content_hash, technical):
    """Render a tiled sprite sheet of poster frames and return its manifest.

    The annotator's filmstrip draws slices of this one image for the base
    timeline — no per-thumbnail video seeking. Returns None (and the strip falls
    back to client-side extraction) when ffmpeg is missing, the geometry is
    unknown, or encoding fails.
    """
    ffmpeg = shutil.which("ffmpeg")
    duration = _to_float(technical.get("duration"))
    width = _to_int(technical.get("width"))
    height = _to_int(technical.get("height"))
    if not ffmpeg or not duration or not width or not height:
        return None

    interval = max(SPRITE_MIN_INTERVAL, duration / SPRITE_MAX_TILES)
    count = min(SPRITE_MAX_TILES, max(1, int(duration // interval) + 1))
    columns = min(count, SPRITE_COLUMNS)
    rows = int(math.ceil(count / columns))
    tile_height = SPRITE_TILE_HEIGHT
    tile_width = int(round(tile_height * width / height))
    if tile_width % 2:
        tile_width += 1  # keep even so the scaler never rounds a column away
    rate = 1.0 / interval

    # JPEG (mjpeg) rather than WebP: mjpeg ships in every ffmpeg build, whereas
    # libwebp is often absent; sprite sheets are photographic so JPEG suits them.
    rel_sprite = f"assets/thumbs/{content_hash}_sprite.jpg"
    with tempfile.NamedTemporaryFile(suffix=".jpg", delete=False) as out:
        out_path = out.name
    try:
        proc = subprocess.run(
            [
                ffmpeg,
                "-y",
                "-i", local_path,
                "-frames:v", "1",
                "-an",
                "-vf",
                f"fps={rate:.6f},scale={tile_width}:{tile_height},"
                f"tile={columns}x{rows}:padding=0",
                "-q:v", "4",
                out_path,
            ],
            capture_output=True,
            timeout=120,
        )
        if proc.returncode != 0 or not os.path.getsize(out_path):
            return None
        with open(out_path, "rb") as handle:
            sprite_bytes = handle.read()
    except (OSError, subprocess.SubprocessError):
        return None
    finally:
        try:
            os.unlink(out_path)
        except OSError:
            pass

    default_storage.save(rel_sprite, io.BytesIO(sprite_bytes))
    return {
        "url": settings.MEDIA_URL + rel_sprite,
        "interval": interval,
        "tile_width": tile_width,
        "tile_height": tile_height,
        "columns": columns,
        "rows": rows,
        "count": count,
    }


def _probe_video(rel_path, original_bytes, content_hash):
    """Probe a stored video and build its filmstrip sprite in one temp copy.

    Returns the technical_metadata dict (with a ``sprite`` manifest when the
    sheet was generated). ffprobe/ffmpeg failures degrade gracefully to {}.
    """
    with _local_video_path(rel_path, original_bytes) as local_path:
        technical = _probe_video_file(local_path)
        if technical:
            sprite = _build_video_sprite(local_path, content_hash, technical)
            if sprite:
                technical["sprite"] = sprite
        return technical


def store_media_bytes(original_bytes, filename):
    """
    Persist bytes + thumbnail pyramid. Returns a dict with content_hash,
    file_path (URL), media_type, thumbnails, technical_metadata, placeholder.
    """
    content_hash = hashlib.sha256(original_bytes).hexdigest()
    _, extension = os.path.splitext(filename or "upload")
    extension = extension.lower()
    media_type = _media_type_for(extension)

    rel_original = f"assets/originals/{content_hash}{extension}"
    if not default_storage.exists(rel_original):
        default_storage.save(rel_original, io.BytesIO(original_bytes))
    original_url = settings.MEDIA_URL + rel_original

    thumbnails, technical, placeholder = {}, {}, ""
    if media_type == "image":
        try:
            thumbnails, technical, placeholder = _build_pyramid(
                original_bytes, content_hash
            )
        except Exception:
            # Unreadable/corrupt image: keep the original, skip renditions.
            media_type = "file"
    elif media_type == "video":
        # Extract width/height/duration/fps/nb_frames/codec so the annotator can
        # seek frame-accurately, plus a filmstrip sprite sheet for the timeline.
        # ffprobe/ffmpeg failures degrade gracefully to {}.
        technical = _probe_video(rel_original, original_bytes, content_hash)

    technical["file_size"] = len(original_bytes)
    return {
        "content_hash": content_hash,
        "file_path": original_url,
        "media_type": media_type,
        "thumbnails": thumbnails,
        "technical_metadata": technical,
        "placeholder": placeholder,
    }


def ingest_file(uploaded_file, *, name=None, created_by=None):
    """
    Ingest one uploaded file. Returns (asset, created: bool).

    Idempotent on content: if a version with the same sha256 already exists,
    its asset is returned with created=False.
    """
    original_bytes = uploaded_file.read()
    content_hash = hashlib.sha256(original_bytes).hexdigest()

    existing = (
        Version.objects.filter(content_hash=content_hash)
        .select_related("entity")
        .first()
    )
    if existing is not None:
        return existing.entity, False

    base_name, _ = os.path.splitext(uploaded_file.name or "upload")
    stored = store_media_bytes(original_bytes, uploaded_file.name or "upload")
    media_type = stored["media_type"]
    original_url = stored["file_path"]
    thumbnails = stored["thumbnails"]
    technical = stored["technical_metadata"]
    placeholder = stored["placeholder"]

    display_name = name or base_name
    asset = MediaAsset.objects.create(
        code=f"{_slugify(display_name)}_{content_hash[:10]}",
        name=display_name,
        type_data={
            "file_path": original_url,
            "media_type": media_type,
            "original_filename": uploaded_file.name,
            "thumbnails": thumbnails,
            "placeholder": placeholder,
            "technical_metadata": technical,
            "tags": [],
        },
    )
    asset.publish(
        data={
            "file_path": original_url,
            "thumbnails": thumbnails,
            "technical_metadata": technical,
        },
        content_hash=content_hash,
        created_by=created_by,
    )
    return asset, True


def add_version(asset, uploaded_file, *, created_by=None, version_number=None,
                variation=0, extra_data=None, upstream=None):
    """
    Publish a new version of an existing asset from an uploaded file.

    Returns (version, created). If the bytes match an existing version of this
    asset, that version is returned with created=False. The asset's live
    type_data is repointed at the new file so grids show the latest rendition,
    and AI analysis is re-queued.

    version_number/variation place the version on the two-axis grid (a
    generation run's parallel candidates); extra_data is merged into the
    version payload (e.g. a ``generation`` provenance record); upstream is
    passed through to publish() as {role: Version} lineage edges.
    """
    original_bytes = uploaded_file.read()
    content_hash = hashlib.sha256(original_bytes).hexdigest()

    existing = asset.versions.filter(content_hash=content_hash).first()
    if existing is not None:
        return existing, False

    stored = store_media_bytes(original_bytes, uploaded_file.name or "upload")
    version = asset.publish(
        data={
            "file_path": stored["file_path"],
            "thumbnails": stored["thumbnails"],
            "technical_metadata": stored["technical_metadata"],
            **(extra_data or {}),
        },
        content_hash=content_hash,
        created_by=created_by,
        version_number=version_number,
        variation=variation,
        upstream=upstream,
    )

    asset.type_data.update(
        {
            "file_path": stored["file_path"],
            "media_type": stored["media_type"],
            "thumbnails": stored["thumbnails"],
            "placeholder": stored["placeholder"],
            "technical_metadata": stored["technical_metadata"],
            "original_filename": uploaded_file.name,
        }
    )
    asset.ai_analysis_status = "pending"
    asset.save(update_fields=["type_data", "ai_analysis_status", "updated_at"])
    return version, True


def _thumbs_from_image_bytes(image_bytes, content_hash):
    """Build the thumbnail pyramid + placeholder from a pre-rendered preview image
    (e.g. a Modal-rendered turntable of a 3D asset). Returns (thumbnails, placeholder)."""
    thumbnails, _technical, placeholder = _build_pyramid(image_bytes, content_hash)
    return thumbnails, placeholder


def ingest_generated_asset(asset_bytes, *, filename, thumbnail_bytes=None, media_type=None,
                           name=None, created_by=None, upstream=None, generation=None,
                           project_id=None):
    """Ingest a machine-generated binary asset (e.g. a GLB / splat from image-to-3D) as a
    first-class MediaAsset with an optional pre-rendered thumbnail and lineage edges.

    Unlike ``ingest_file`` this (a) takes raw bytes, (b) lets the caller set ``media_type``
    (extension inference maps .glb/.gltf → 3d_model; splats pass 'gaussian_splat' explicitly),
    (c) attaches a supplied preview image as the thumbnail (3D binaries aren't self-thumbnailing),
    and (d) records ``upstream`` lineage (e.g. {'init_image': source_version}) + a ``generation``
    provenance record. Returns (asset, version, created).
    """
    content_hash = hashlib.sha256(asset_bytes).hexdigest()
    existing = (
        Version.objects.filter(content_hash=content_hash).select_related("entity").first()
    )
    if existing is not None:
        return existing.entity, existing, False

    _, extension = os.path.splitext(filename or "asset.glb")
    extension = extension.lower()
    media_type = media_type or _media_type_for(extension)

    rel_original = f"assets/originals/{content_hash}{extension}"
    if not default_storage.exists(rel_original):
        default_storage.save(rel_original, io.BytesIO(asset_bytes))
    original_url = settings.MEDIA_URL + rel_original

    thumbnails, placeholder = {}, ""
    if thumbnail_bytes:
        try:
            thumbnails, placeholder = _thumbs_from_image_bytes(thumbnail_bytes, content_hash)
        except Exception:
            thumbnails, placeholder = {}, ""
    technical = {"file_size": len(asset_bytes)}

    display_name = name or os.path.splitext(filename)[0]
    asset = MediaAsset.objects.create(
        code=f"{_slugify(display_name)}_{content_hash[:10]}",
        name=display_name,
        project_id=project_id or None,  # scope to the source's project so it shows in the grid
        type_data={
            "file_path": original_url,
            "media_type": media_type,
            "original_filename": filename,
            "thumbnails": thumbnails,
            "placeholder": placeholder,
            "technical_metadata": technical,
            "tags": [],
        },
    )
    data = {
        "file_path": original_url,
        "thumbnails": thumbnails,
        "technical_metadata": technical,
    }
    if generation:
        data["generation"] = generation
    version = asset.publish(
        data=data,
        content_hash=content_hash,
        created_by=created_by,
        upstream=upstream or None,
    )
    return asset, version, True
