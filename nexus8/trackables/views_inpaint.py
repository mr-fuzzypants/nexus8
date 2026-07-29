"""
Live inpainting dispatch/poll endpoints (SRED_INPAINT_EXPERIMENT.md Phase 3).

  POST /api/library/assets/<id>/mask/inpaint/          dispatch a generation for a layer's saved mask
  GET  /api/library/assets/<id>/mask/inpaint/status/   poll; on completion store result as linked asset

The GPU work runs on Modal (modal_functions/inpaint.py, deployed separately as
app "nexus8-inpaint"). Django only spawns the call and tracks its id — no task
queue needed. Modal credentials come from ~/.modal.toml (CLI auth) or the
MODAL_TOKEN_ID / MODAL_TOKEN_SECRET environment variables.

The result is stored as a SEPARATE asset linked to the source with
role="inpaint_preview": it is an ephemeral preview, so it must not pollute the
source asset's version history, and versioning the mask asset would conflate
the binary mask with generated RGB output.
"""

import logging
import os

from django.conf import settings
from django.core.files.uploadedfile import SimpleUploadedFile
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import permissions, status
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import EntityRelation, MediaAsset, VersionedEntity
from .services.ingest import add_version, ingest_file
from .views_annotations import MASK_ROLE
from .views_blob import _file_ref, _parse_nexus8_uri, _resolve_version
from .views_library import asset_summary

logger = logging.getLogger(__name__)

INPAINT_ROLE = "inpaint_preview"
MODAL_APP_NAME = "nexus8-inpaint"


def _media_bytes(file_path: str) -> bytes | None:
    """Read the bytes behind a stored file reference (managed media or local path)."""
    if not file_path:
        return None
    if file_path.startswith(settings.MEDIA_URL):
        local = os.path.join(settings.MEDIA_ROOT, file_path[len(settings.MEDIA_URL):])
    elif file_path.startswith("/") and "://" not in file_path:
        local = file_path
    else:
        return None
    try:
        with open(local, "rb") as f:
            return f.read()
    except OSError:
        return None


def _version_file_bytes(entity, version_number: int | None = None) -> bytes | None:
    """Bytes of a specific (or latest) version's primary file."""
    version = None
    if version_number is not None:
        version = entity.versions.filter(version_number=version_number).first()
    if version is None:
        version = entity.versions.order_by("-version_number").first()
    if version is None:
        return None
    file_path = _file_ref(version)
    return _media_bytes(file_path) if file_path else None


def _reference_bytes(uri: str | None) -> bytes | None:
    """Resolve a nexus8:// reference URI to image bytes; non-fatal on any failure.

    Tolerates both ``nexus8://{code}/{ref}`` (canonical) and the legacy
    ``nexus8://asset/{code}`` form documented in older frontend code.
    """
    if not uri:
        return None
    parsed = _parse_nexus8_uri(uri)
    if parsed is None:
        return None
    code, ref = parsed
    if code == "asset" and ref != "latest":
        code, _, rest = ref.partition("/")
        ref = rest or "latest"
    try:
        entity = VersionedEntity.objects.get(code=code)
        version = _resolve_version(entity, ref)
        file_path = _file_ref(version)
        return _media_bytes(file_path) if file_path else None
    except Exception:
        logger.warning("inpaint: could not resolve reference %r", uri, exc_info=True)
        return None


def _mask_lookup(source, layer_id):
    """The layer's mask asset + its relation to the source, as MaskSaveView stores them."""
    mask_asset = MediaAsset.objects.filter(
        type_data__mask_of_asset_id=source.id,
        type_data__mask_layer_id=layer_id,
    ).first()
    if mask_asset is None:
        return None, None
    relation = EntityRelation.objects.filter(
        asset=source, entity=mask_asset, role=MASK_ROLE
    ).first()
    return mask_asset, relation


class MaskInpaintTriggerView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, pk):
        source = get_object_or_404(MediaAsset.objects, pk=pk)
        layer_id = request.data.get("layer_id")
        if not layer_id:
            return Response(
                {"detail": "layer_id is required"}, status=status.HTTP_400_BAD_REQUEST
            )
        mask_asset, relation = _mask_lookup(source, layer_id)
        if mask_asset is None or relation is None:
            return Response(
                {"detail": "No saved mask for this layer — save the mask first."},
                status=status.HTTP_404_NOT_FOUND,
            )

        # Body prompt wins: the layer's prompt lives in the collaborative doc and
        # the relation copy may be stale relative to what the artist just typed.
        prompt = request.data.get("prompt") or relation.type_data.get("prompt")
        if not prompt or not str(prompt).strip():
            return Response(
                {"detail": "A prompt is required for inpainting."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        version_number = request.data.get("version_number")
        image_bytes = _version_file_bytes(
            source, int(version_number) if version_number is not None else None
        )
        if not image_bytes:
            return Response(
                {"detail": "Could not load source image bytes."},
                status=status.HTTP_422_UNPROCESSABLE_ENTITY,
            )
        mask_bytes = _version_file_bytes(mask_asset)
        if not mask_bytes:
            return Response(
                {"detail": "Could not load mask bytes."},
                status=status.HTTP_422_UNPROCESSABLE_ENTITY,
            )
        reference_uri = request.data.get("reference") or relation.type_data.get("reference")
        reference_bytes = _reference_bytes(reference_uri)

        import modal

        try:
            inpainter = modal.Cls.from_name(MODAL_APP_NAME, "Inpainter")()
            call = inpainter.inpaint.spawn(
                image_bytes,
                mask_bytes,
                str(prompt),
                negative_prompt=str(request.data.get("negative_prompt") or ""),
                reference_bytes=reference_bytes,
                num_inference_steps=(
                    int(request.data["num_inference_steps"])
                    if request.data.get("num_inference_steps")
                    else None
                ),
                mode=str(request.data.get("mode") or "fast"),
            )
        except Exception as exc:
            logger.exception("inpaint: Modal dispatch failed")
            return Response(
                {"detail": f"Modal dispatch failed: {exc}"},
                status=status.HTTP_502_BAD_GATEWAY,
            )

        relation.refresh_from_db()
        for key in list(relation.type_data):
            if key.startswith("inpaint_result"):
                relation.type_data.pop(key)
        relation.type_data.update(
            {
                "inpaint_call_id": call.object_id,
                "inpaint_dispatched_at": timezone.now().isoformat(),
                "inpaint_status": "working",
            }
        )
        relation.save(update_fields=["type_data", "updated_at"])

        return Response(
            {"call_id": call.object_id, "status": "working"},
            status=status.HTTP_202_ACCEPTED,
        )


class MaskInpaintStatusView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request, pk):
        source = get_object_or_404(MediaAsset.objects, pk=pk)
        layer_id = request.query_params.get("layer_id")
        if not layer_id:
            return Response(
                {"detail": "layer_id query parameter is required"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        mask_asset, relation = _mask_lookup(source, layer_id)
        if mask_asset is None or relation is None:
            return Response(
                {"detail": "No saved mask for this layer."},
                status=status.HTTP_404_NOT_FOUND,
            )
        call_id = relation.type_data.get("inpaint_call_id")
        if not call_id:
            return Response(
                {"detail": "No inpaint generation dispatched for this layer."},
                status=status.HTTP_409_CONFLICT,
            )

        # Idempotent re-poll: once done, keep returning the stored result rather
        # than re-fetching from Modal (outputs expire) or re-ingesting.
        if relation.type_data.get("inpaint_status") == "done":
            result_asset = MediaAsset.objects.filter(
                pk=relation.type_data.get("inpaint_result_asset_id")
            ).first()
            if result_asset is not None:
                return Response(self._done_payload(relation, result_asset))

        import modal

        try:
            fc = modal.FunctionCall.from_id(call_id)
            png_bytes = fc.get(timeout=0)
        except TimeoutError:
            return Response(
                {
                    "status": "working",
                    "dispatched_at": relation.type_data.get("inpaint_dispatched_at"),
                }
            )
        except Exception as exc:
            logger.exception("inpaint: generation failed (call %s)", call_id)
            relation.refresh_from_db()
            relation.type_data.update(
                {"inpaint_status": "error", "inpaint_error": str(exc)}
            )
            relation.save(update_fields=["type_data", "updated_at"])
            return Response(
                {"status": "error", "detail": str(exc)},
                status=status.HTTP_502_BAD_GATEWAY,
            )

        result_asset = self._store_result(request, source, layer_id, png_bytes)

        relation.refresh_from_db()
        dispatched_at = relation.type_data.get("inpaint_dispatched_at")
        result_at = timezone.now()
        latency_s = None
        if dispatched_at:
            try:
                from datetime import datetime

                latency_s = round(
                    (result_at - datetime.fromisoformat(dispatched_at)).total_seconds(), 2
                )
            except ValueError:
                pass
        relation.type_data.update(
            {
                "inpaint_status": "done",
                "inpaint_result_at": result_at.isoformat(),
                "inpaint_result_asset_id": result_asset.id,
                "inpaint_latency_s": latency_s,
            }
        )
        relation.save(update_fields=["type_data", "updated_at"])

        return Response(self._done_payload(relation, result_asset))

    @staticmethod
    def _done_payload(relation, result_asset):
        return {
            "status": "done",
            "result": asset_summary(result_asset),
            "dispatched_at": relation.type_data.get("inpaint_dispatched_at"),
            "result_at": relation.type_data.get("inpaint_result_at"),
            "latency_s": relation.type_data.get("inpaint_latency_s"),
        }

    @staticmethod
    def _store_result(request, source, layer_id, png_bytes):
        """Persist result bytes as the layer's preview asset (new version if it exists)."""
        uploaded = SimpleUploadedFile(
            f"{source.name}-inpaint-{layer_id}.png", png_bytes, content_type="image/png"
        )
        user = request.user if request.user.is_authenticated else None
        existing = MediaAsset.objects.filter(
            type_data__inpaint_preview_of_asset_id=source.id,
            type_data__inpaint_preview_layer_id=layer_id,
        ).first()
        if existing is not None:
            result_version, _ = add_version(existing, uploaded, created_by=user)
            result_asset = existing
        else:
            result_asset, _created = ingest_file(
                uploaded, name=f"{source.name} inpaint preview", created_by=user
            )
            result_version = result_asset.versions.order_by("-version_number").first()

        result_asset.type_data.update(
            {
                "inpaint_preview_of_asset_id": source.id,
                "inpaint_preview_layer_id": layer_id,
                "asset_functional_type": "inpaint_preview",
            }
        )
        result_asset.save(update_fields=["type_data", "updated_at"])

        EntityRelation.objects.update_or_create(
            asset=source,
            entity=result_asset,
            role=INPAINT_ROLE,
            defaults={
                "source": "ai",
                "confidence": 1.0,
                "entity_version": result_version,
                "entity_version_number": (
                    result_version.version_number if result_version else None
                ),
                "type_data": {"inpaint_preview_layer_id": layer_id},
            },
        )

        # Link the mask that produced this result so AssetPanel can show it.
        mask_asset, mask_rel = _mask_lookup(source, layer_id)
        if mask_asset and mask_rel:
            EntityRelation.objects.update_or_create(
                asset=result_asset,
                entity=mask_asset,
                role=MASK_ROLE,
                defaults={
                    "source": "ai",
                    "confidence": 1.0,
                    "entity_version": mask_rel.entity_version,
                    "entity_version_number": mask_rel.entity_version_number,
                    "type_data": {**mask_rel.type_data, "mask_of_asset_id": result_asset.id},
                },
            )

        return result_asset
