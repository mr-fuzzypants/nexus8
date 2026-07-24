"""
Blob resolution and stat endpoints for external engines (e.g. the nodegraph
``nexus8://`` storage driver).

BlobResolveView — ``GET /api/blob/resolve/?code=<code>&ref=<ref>``
  Minimal contract: resolves code+ref → download URL + content hash.
  Deliberately small — kept stable for the nodegraph driver.

BlobStatView — ``GET /api/blob/stat/?uri=nexus8://<code>/<ref>``
  Rich descriptor: version metadata, thumbnails, entity relations (role → entity),
  and full type_data. For SPA and nodegraph dev-mode consumers that need context
  about a pinned URI beyond raw bytes.

``ref`` semantics (both endpoints)
-----------------------------------
- A symlink name (``approved``, ``latest``, …) → resolved against the entity's
  current symlink target.
- ``v<N>`` (e.g. ``v5``) → that exact version number. This is the reproducible,
  pinned form an orchestrator freezes into a graph's dependency set.
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


def _parse_nexus8_uri(uri: str) -> tuple[str, str] | None:
    """Split ``nexus8://code/ref`` → ``(code, ref)``. Returns None if malformed."""
    if not uri.startswith("nexus8://"):
        return None
    rest = uri[len("nexus8://"):]
    code, sep, ref = rest.partition("/")
    if not code:
        return None
    return code, ref or "latest"


def _resolve_version(entity, ref: str):
    """Resolve ref → Version, or raise DoesNotExist / ValueError."""
    m = _VERSION_REF.match(ref)
    if m:
        return entity.versions.get(version_number=int(m.group(1)))
    return entity.resolve_symlink(ref)


class BlobStatView(APIView):
    """``GET /trackables/api/blob/stat/?uri=nexus8://<code>/<ref>``

    Rich descriptor for a pinned URI. Returns version metadata, thumbnails,
    entity relations (role + entity), and the asset's type_data.

    Also accepts ``?code=<code>&ref=<ref>`` as an alternative to a full URI.
    """

    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        uri = request.query_params.get("uri", "")
        if uri:
            parsed = _parse_nexus8_uri(uri)
            if parsed is None:
                return Response(
                    {"error": f"malformed URI {uri!r} — expected nexus8://<code>/<ref>"},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            code, ref = parsed
        else:
            code = request.query_params.get("code", "")
            ref = request.query_params.get("ref") or "latest"
            uri = f"nexus8://{code}/{ref}" if code else ""

        if not code:
            return Response(
                {"error": "supply ?uri=nexus8://<code>/<ref> or ?code=<code>&ref=<ref>"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            entity = VersionedEntity.objects.get(code=code)
        except VersionedEntity.DoesNotExist:
            return Response(
                {"error": f"no entity with code {code!r}"},
                status=status.HTTP_404_NOT_FOUND,
            )

        try:
            version = _resolve_version(entity, ref)
        except Exception:
            return Response(
                {"error": f"{code} has no version or symlink {ref!r}"},
                status=status.HTTP_404_NOT_FOUND,
            )

        vdata = version.data or {}
        type_data = entity.type_data or {}
        technical = vdata.get("technical_metadata") or {}

        file_path = _file_ref(version)
        download_url = storage = None
        if file_path:
            download_url, storage = BlobResolveView._download_url_for(request, file_path)

        thumbnails = vdata.get("thumbnails") or type_data.get("thumbnails") or {}

        role_filter = request.query_params.get("role")
        _rv = request.query_params.get("relation_version_number")
        # When filtering by role, default relation version to the resolved asset
        # version so callers only need &ref=vN rather than both params.
        if _rv is not None:
            relation_version = int(_rv)
        elif role_filter:
            relation_version = version.version_number
        else:
            relation_version = None

        from .models.relations import EntityRelation

        def _rel_dict(direction, code, name, entity_type, entity_version_number, entity_version):
            ref = f"v{entity_version_number}" if entity_version_number is not None else "latest"
            file_path = (entity_version.data or {}).get("file_path") if entity_version else None
            dest_url, _ = BlobResolveView._download_url_for(request, file_path) if file_path else (None, None)
            return {
                "direction": direction,
                "role": None,  # overwritten by caller
                "entity_code": code,
                "entity_name": name,
                "entity_type": entity_type,
                "dest_version_number": entity_version_number,
                "uri": f"nexus8://{code}/{ref}",
                "download_url": dest_url,
                "source_version_number": relation_version,
            }

        outgoing_qs = (
            entity.entity_relations
            .select_related("entity", "entity_version")
            .order_by("role")
        )
        if role_filter:
            outgoing_qs = outgoing_qs.filter(role=role_filter)
        if relation_version is not None:
            outgoing_qs = outgoing_qs.filter(asset_version__version_number=relation_version)
        outgoing = [
            {
                **_rel_dict(
                    "outgoing", rel.entity.code, rel.entity.name,
                    rel.entity.entity_type, rel.entity_version_number, rel.entity_version,
                ),
                "role": rel.role,
                "type_data": rel.type_data or {},
            }
            for rel in outgoing_qs
        ]
        incoming_qs = (
            EntityRelation.objects
            .filter(entity=entity)
            .select_related("asset", "entity_version")
            .order_by("role")
        )
        if role_filter:
            incoming_qs = incoming_qs.filter(role=role_filter)
        incoming = [
            {
                **_rel_dict(
                    "incoming", rel.asset.code, rel.asset.name,
                    rel.asset.entity_type, rel.entity_version_number, rel.entity_version,
                ),
                "role": rel.role,
                "type_data": rel.type_data or {},
            }
            for rel in incoming_qs
        ]
        relations = outgoing + incoming

        return Response({
            "uri": uri,
            "code": code,
            "name": entity.name,
            "entity_type": entity.entity_type,
            "version_number": version.version_number,
            "version_ref": ref,
            "created_at": version.created_at.isoformat(),
            "content_hash": version.content_hash or "",
            "media_type": type_data.get("media_type") or vdata.get("media_type"),
            "size_bytes": technical.get("file_size"),
            "width": technical.get("width"),
            "height": technical.get("height"),
            "thumbnails": thumbnails,
            "file_path": file_path,
            "download_url": download_url,
            "storage": storage,
            "relations": relations,
            "type_data": type_data,
        })
