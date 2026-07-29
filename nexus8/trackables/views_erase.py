"""
Magic erase dispatch/poll endpoints (BigLaMa).

  POST /api/library/assets/<id>/erase/         dispatch erase for a layer's saved mask
  GET  /api/library/assets/<id>/erase/status/  poll; on completion store result as linked asset

Modal app: nexus8-lama (modal_functions/lama.py, deployed separately).

Sends both source image bytes AND mask bytes to Modal. No prompt — BigLaMa is a
GAN-based fill that requires no text conditioning. Expected warm latency: ~0.3 s.
Wires the existing 'remove' MaskOp to a real backend for the first time.
"""

import logging

from django.core.files.uploadedfile import SimpleUploadedFile
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import permissions, status
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import EntityRelation, MediaAsset
from .services.ingest import add_version, ingest_file
from .views_inpaint import _mask_lookup, _version_file_bytes
from .views_library import asset_summary

logger = logging.getLogger(__name__)

ERASE_ROLE = "erase_preview"
MODAL_APP_NAME = "nexus8-lama"


class EraseImageTriggerView(APIView):
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

        import modal

        try:
            eraser = modal.Cls.from_name(MODAL_APP_NAME, "Eraser")()
            call = eraser.erase.spawn(image_bytes, mask_bytes)
        except Exception as exc:
            logger.exception("erase: Modal dispatch failed")
            return Response(
                {"detail": f"Modal dispatch failed: {exc}"},
                status=status.HTTP_502_BAD_GATEWAY,
            )

        relation.refresh_from_db()
        for key in list(relation.type_data):
            if key.startswith("erase_result"):
                relation.type_data.pop(key)
        relation.type_data.update(
            {
                "erase_call_id": call.object_id,
                "erase_dispatched_at": timezone.now().isoformat(),
                "erase_status": "working",
            }
        )
        relation.save(update_fields=["type_data", "updated_at"])

        return Response(
            {"call_id": call.object_id, "status": "working"},
            status=status.HTTP_202_ACCEPTED,
        )


class EraseImageStatusView(APIView):
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

        call_id = relation.type_data.get("erase_call_id")
        if not call_id:
            return Response(
                {"detail": "No erase generation dispatched for this layer."},
                status=status.HTTP_409_CONFLICT,
            )

        if relation.type_data.get("erase_status") == "done":
            result_asset = MediaAsset.objects.filter(
                pk=relation.type_data.get("erase_result_asset_id")
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
                    "dispatched_at": relation.type_data.get("erase_dispatched_at"),
                }
            )
        except Exception as exc:
            logger.exception("erase: generation failed (call %s)", call_id)
            relation.refresh_from_db()
            relation.type_data.update(
                {"erase_status": "error", "erase_error": str(exc)}
            )
            relation.save(update_fields=["type_data", "updated_at"])
            return Response(
                {"status": "error", "detail": str(exc)},
                status=status.HTTP_502_BAD_GATEWAY,
            )

        result_asset = self._store_result(request, source, layer_id, png_bytes)

        relation.refresh_from_db()
        dispatched_at = relation.type_data.get("erase_dispatched_at")
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
                "erase_status": "done",
                "erase_result_at": result_at.isoformat(),
                "erase_result_asset_id": result_asset.id,
                "erase_latency_s": latency_s,
            }
        )
        relation.save(update_fields=["type_data", "updated_at"])

        return Response(self._done_payload(relation, result_asset))

    @staticmethod
    def _done_payload(relation, result_asset):
        return {
            "status": "done",
            "result": asset_summary(result_asset),
            "dispatched_at": relation.type_data.get("erase_dispatched_at"),
            "result_at": relation.type_data.get("erase_result_at"),
            "latency_s": relation.type_data.get("erase_latency_s"),
        }

    @staticmethod
    def _store_result(request, source, layer_id, png_bytes):
        uploaded = SimpleUploadedFile(
            f"{source.name}-erase-{layer_id}.png", png_bytes, content_type="image/png"
        )
        user = request.user if request.user.is_authenticated else None
        existing = MediaAsset.objects.filter(
            type_data__erase_preview_of_asset_id=source.id,
            type_data__erase_preview_layer_id=layer_id,
        ).first()
        if existing is not None:
            result_version, _ = add_version(existing, uploaded, created_by=user)
            result_asset = existing
        else:
            result_asset, _created = ingest_file(
                uploaded, name=f"{source.name} erase preview", created_by=user
            )
            result_version = result_asset.versions.order_by("-version_number").first()

        result_asset.type_data.update(
            {
                "erase_preview_of_asset_id": source.id,
                "erase_preview_layer_id": layer_id,
                "asset_functional_type": "erase_preview",
            }
        )
        result_asset.save(update_fields=["type_data", "updated_at"])

        EntityRelation.objects.update_or_create(
            asset=source,
            entity=result_asset,
            role=ERASE_ROLE,
            defaults={
                "source": "ai",
                "confidence": 1.0,
                "entity_version": result_version,
                "entity_version_number": (
                    result_version.version_number if result_version else None
                ),
                "type_data": {"erase_preview_layer_id": layer_id},
            },
        )
        return result_asset
