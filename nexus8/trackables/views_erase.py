"""
Magic erase dispatch/poll endpoints (BigLaMa).

  POST /api/library/assets/<id>/erase/         dispatch erase for a layer's saved mask
  GET  /api/library/assets/<id>/erase/status/  poll

Modal app: nexus8-lama (modal_functions/lama.py, deployed separately).

Sends both source image bytes AND mask bytes to Modal. No prompt — BigLaMa is a
GAN-based fill that requires no text conditioning. Expected warm latency: ~0.3 s.
Wires the existing 'remove' MaskOp to a real backend for the first time.

Results land on the layer's render asset as single-variation runs
(versions × variations model — see LAYER_RENDER_SCHEMA.md), with lineage links
to the exact source-image and erase-mask versions sent to Modal.
"""

import logging

from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import permissions, status
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import MediaAsset
from .models.versions import Version
from .services import layer_renders
from .views_inpaint import _file_ref, _mask_lookup, _media_bytes
from .views_library import asset_summary

logger = logging.getLogger(__name__)

MODAL_APP_NAME = "nexus8-lama"


def _resolve_source_version(source, version_number):
    if version_number is not None:
        version = source.versions.filter(version_number=int(version_number)).first()
        if version is not None:
            return version
    return source.versions.order_by("-version_number", "-variation_number").first()


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

        # Resolve the exact versions whose bytes go to Modal so the stored
        # render can pin them as lineage (init_image / erase_mask).
        source_version = _resolve_source_version(
            source, request.data.get("version_number")
        )
        image_bytes = _media_bytes(_file_ref(source_version)) if source_version else None
        if not image_bytes:
            return Response(
                {"detail": "Could not load source image bytes."},
                status=status.HTTP_422_UNPROCESSABLE_ENTITY,
            )

        mask_version = mask_asset.versions.order_by(
            "-version_number", "-variation_number"
        ).first()
        mask_bytes = _media_bytes(_file_ref(mask_version)) if mask_version else None
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

        params = {}
        mask_shapes = request.data.get("mask_shapes")
        if isinstance(mask_shapes, list) and mask_shapes:
            # The layer's vector strokes at dispatch — lets History restore the
            # exact input mask as editable shapes (stored once per run).
            params["mask_shapes"] = mask_shapes

        relation.refresh_from_db()
        for key in list(relation.type_data):
            if key.startswith("erase_result"):
                relation.type_data.pop(key)
        relation.type_data.update(
            {
                "erase_call_id": call.object_id,
                "erase_dispatched_at": timezone.now().isoformat(),
                "erase_status": "working",
                "erase_params": params,
                "erase_source_version_id": source_version.pk,
                "erase_mask_version_id": mask_version.pk,
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
            payload = self._done_payload(relation)
            if payload is not None:
                return Response(payload)

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

        params = dict(relation.type_data.get("erase_params") or {})
        params["modal_call_id"] = call_id
        params["latency_s"] = latency_s

        render_asset, run, versions = layer_renders.store_run_results(
            source,
            layer_id,
            [png_bytes],
            op="erase",
            params=params,
            source_version=Version.objects.filter(
                pk=relation.type_data.get("erase_source_version_id")
            ).first(),
            guide_version=Version.objects.filter(
                pk=relation.type_data.get("erase_mask_version_id")
            ).first(),
            guide_role="erase_mask",
            created_by=request.user if request.user.is_authenticated else None,
        )

        relation.refresh_from_db()
        relation.type_data.update(
            {
                "erase_status": "done",
                "erase_result_at": result_at.isoformat(),
                "erase_run": run,
                "erase_result_version_id": versions[0].pk,
                "erase_latency_s": latency_s,
            }
        )
        relation.save(update_fields=["type_data", "updated_at"])

        return Response(self._done_payload(relation))

    @staticmethod
    def _done_payload(relation):
        """Done response from the stored render; None if it no longer exists
        (caller falls through to re-poll Modal). Keeps the pre-existing shape
        the SPA consumes (result.file_path)."""
        version_id = relation.type_data.get("erase_result_version_id")
        if version_id:
            version = (
                Version.objects.filter(pk=version_id).select_related("entity").first()
            )
            if version is None:
                return None
            result = {
                "asset_id": version.entity_id,
                "file_path": version.data.get("file_path"),
                "thumbnails": version.data.get("thumbnails"),
                "version_number": version.version_number,
                "variation_number": version.variation_number,
            }
        else:
            # Legacy per-layer preview asset (pre versions × variations).
            asset = MediaAsset.objects.filter(
                pk=relation.type_data.get("erase_result_asset_id")
            ).first()
            if asset is None:
                return None
            result = asset_summary(asset)
        return {
            "status": "done",
            "result": result,
            "run": relation.type_data.get("erase_run"),
            "dispatched_at": relation.type_data.get("erase_dispatched_at"),
            "result_at": relation.type_data.get("erase_result_at"),
            "latency_s": relation.type_data.get("erase_latency_s"),
        }
