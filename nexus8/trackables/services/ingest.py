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
import hashlib
import io
import os
import re

from django.conf import settings
from django.core.files.storage import default_storage

from ..models import MediaAsset, Version

THUMB_SIZES = (256, 1024)
TINY_SIZE = 24  # inline blur-up placeholder, embedded as a data URI

IMAGE_EXTENSIONS = {
    ".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp", ".tif", ".tiff", ".avif",
}
VIDEO_EXTENSIONS = {".mp4", ".mov", ".avi", ".webm", ".mkv"}


def _slugify(value):
    value = re.sub(r"[^a-zA-Z0-9]+", "_", value).strip("_").lower()
    return value or "asset"


def _media_type_for(extension):
    if extension in IMAGE_EXTENSIONS:
        return "image"
    if extension in VIDEO_EXTENSIONS:
        return "video"
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


def add_version(asset, uploaded_file, *, created_by=None):
    """
    Publish a new version of an existing asset from an uploaded file.

    Returns (version, created). If the bytes match an existing version of this
    asset, that version is returned with created=False. The asset's live
    type_data is repointed at the new file so grids show the latest rendition,
    and AI analysis is re-queued.
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
        },
        content_hash=content_hash,
        created_by=created_by,
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
