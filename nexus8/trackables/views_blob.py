"""
Blob resolution endpoint for external engines (e.g. the nodegraph ``nexus8://``
storage driver).

Resolves an entity ``code`` + ``ref`` to a concrete published Version and hands
back the metadata an external blob-store driver needs to fetch the bytes:
content hash, media type, size, and an absolute, directly-fetchable URL.

``ref`` semantics
-----------------
- A symlink name (``approved``, ``latest``, …) → resolved against the entity's
  current symlink target.
- ``v<N>`` (e.g. ``v5``) → that exact version number. This is the reproducible,
  pinned form an orchestrator freezes into a graph's dependency set.

This is read-only and deliberately small: it is the single contract the
``nexus8://`` driver depends on.
"""

import re

from django.conf import settings
from rest_framework import permissions, status
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import VersionedEntity

_VERSION_REF = re.compile(r"^v(\d+)$")

# Candidate keys, in priority order, that hold the primary file reference in a
# version payload across the different entity types (media_asset uses
# ``file_path``; model_checkpoint uses ``weights_file``; lora_adapter uses
# ``file``).
_FILE_KEYS = ("file_path", "weights_file", "file")


def _file_ref(version):
    for key in _FILE_KEYS:
        value = (version.data or {}).get(key)
        if value:
            return value
    return None


class BlobResolveView(APIView):
    """``GET /trackables/api/blob/resolve/?code=<code>&ref=<ref>``"""

    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        code = request.query_params.get("code")
        # ``latest`` always exists post-publish; governed pipelines pass an
        # explicit ``approved`` (or a pinned ``v<N>``) instead.
        ref = request.query_params.get("ref") or "latest"
        if not code:
            return Response(
                {"error": "missing required query param 'code'"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            entity = VersionedEntity.objects.get(code=code)
        except VersionedEntity.DoesNotExist:
            return Response(
                {"error": f"no entity with code '{code}'"},
                status=status.HTTP_404_NOT_FOUND,
            )

        version_match = _VERSION_REF.match(ref)
        if version_match:
            try:
                version = entity.versions.get(version_number=int(version_match.group(1)))
            except entity.versions.model.DoesNotExist:
                return Response(
                    {"error": f"{code} has no version {ref}"},
                    status=status.HTTP_404_NOT_FOUND,
                )
        else:
            try:
                version = entity.resolve_symlink(ref)
            except Exception:
                return Response(
                    {"error": f"{code} has no symlink '{ref}'"},
                    status=status.HTTP_404_NOT_FOUND,
                )

        file_path = _file_ref(version)
        if not file_path:
            return Response(
                {"error": f"{code} v{version.version_number} has no file reference"},
                status=status.HTTP_409_CONFLICT,
            )

        # Two governance modes:
        #  - managed:    bytes live in nexus8's media store (served over HTTP)
        #  - referenced: nexus8 governs *which* local path/URI is approved; the
        #                weights (e.g. a multi-GB diffusers directory) stay put
        download_url, storage = self._download_url_for(request, file_path)
        technical = (version.data or {}).get("technical_metadata") or {}

        return Response(
            {
                "code": code,
                "entity_type": entity.entity_type,
                "ref": ref,
                "version_number": version.version_number,
                "content_hash": version.content_hash or "",
                "media_type": (entity.type_data or {}).get("media_type"),
                "size_bytes": technical.get("file_size"),
                "file_path": file_path,
                "download_url": download_url,
                "storage": storage,
            }
        )

    @staticmethod
    def _download_url_for(request, file_path):
        """Map a stored file reference to a fetchable URL + its storage mode."""
        if "://" in file_path:
            # Already a qualified URI (file://, http(s)://, s3://, …).
            return file_path, "referenced"
        if file_path.startswith(settings.MEDIA_URL):
            # Managed: served by Django out of the media store.
            return request.build_absolute_uri(file_path), "managed"
        if file_path.startswith("/"):
            # Referenced: a governed pointer to a local filesystem path.
            return f"file://{file_path}", "referenced"
        return request.build_absolute_uri(file_path), "managed"
