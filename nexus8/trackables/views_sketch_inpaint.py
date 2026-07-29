"""
Sketch-guided inpaint dispatch/poll endpoints.

  POST /api/library/assets/<id>/sketch-inpaint/         dispatch
  GET  /api/library/assets/<id>/sketch-inpaint/status/  poll

Modal app: nexus8-sketch-inpaint (modal_functions/sketch_inpaint.py).
Sends the source image + scribble map + mask bounding box to Modal.
Result is stored as a linked MediaAsset with role "sketch_inpaint_preview".
"""

import logging
import random

from django.core.files.uploadedfile import SimpleUploadedFile
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import permissions, status
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import EntityRelation, MediaAsset
from .services.ingest import add_version, ingest_file
from .views_inpaint import _mask_lookup, _reference_bytes, _version_file_bytes
from .views_library import asset_summary

logger = logging.getLogger(__name__)

ROLE = "sketch_inpaint_preview"
MODAL_APP_NAME = "nexus8-sketch-inpaint"


class SketchInpaintTriggerView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, pk):
        source = get_object_or_404(MediaAsset.objects, pk=pk)
        layer_id = request.data.get("layer_id")
        if not layer_id:
            return Response({"detail": "layer_id is required"}, status=status.HTTP_400_BAD_REQUEST)

        mask_asset, relation = _mask_lookup(source, layer_id)
        if mask_asset is None or relation is None:
            return Response(
                {"detail": "No saved sketch map for this layer — save it first."},
                status=status.HTTP_404_NOT_FOUND,
            )

        prompt = request.data.get("prompt") or relation.type_data.get("prompt")
        if not prompt or not str(prompt).strip():
            return Response(
                {"detail": "A prompt is required for sketch inpainting."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        scribble_bytes = _version_file_bytes(mask_asset)
        if not scribble_bytes:
            return Response(
                {"detail": "Could not load sketch bytes."},
                status=status.HTTP_422_UNPROCESSABLE_ENTITY,
            )

        source_bytes = _version_file_bytes(source)
        if not source_bytes:
            return Response(
                {"detail": "Could not load source image bytes."},
                status=status.HTTP_422_UNPROCESSABLE_ENTITY,
            )

        raw_dims = request.data.get("mask_dims")
        if not raw_dims or not isinstance(raw_dims, dict):
            return Response(
                {"detail": "mask_dims {x, y, w, h} is required for sketch inpainting."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        mask_dims = {k: int(v) for k, v in raw_dims.items() if k in ("x", "y", "w", "h")}

        controlnet_scale = float(request.data.get("controlnet_scale") or 0.4)
        guidance_scale_raw = request.data.get("guidance_scale")
        guidance_scale = float(guidance_scale_raw) if guidance_scale_raw is not None else 7.5
        num_steps_raw = request.data.get("num_inference_steps")
        num_inference_steps = int(num_steps_raw) if num_steps_raw is not None else 20
        denoise_raw = request.data.get("denoise_strength")
        denoise_strength = float(denoise_raw) if denoise_raw is not None else 1.0

        # Optional image reference (IP-Adapter conditioning). Fail-soft: an
        # unset, unresolvable, or non-image reference simply runs without it.
        reference_uri = request.data.get("reference") or relation.type_data.get("reference")
        reference_bytes = _reference_bytes(str(reference_uri)) if reference_uri else None
        reference_scale_raw = request.data.get("reference_scale")
        reference_scale = float(reference_scale_raw) if reference_scale_raw is not None else 0.5
        seed_raw = request.data.get("seed")
        # Always resolve a concrete seed: generating one server-side when the
        # client omits it makes every run reproducible and lets the status
        # endpoint report which seed produced each image. Modal generates
        # variant i with seed + i, so per-variant seeds are derivable here.
        seed = int(seed_raw) if seed_raw is not None else random.randint(0, 2**31 - 1)
        num_variants_raw = request.data.get("num_variants")
        num_variants = max(1, min(4, int(num_variants_raw))) if num_variants_raw is not None else 1

        import modal

        try:
            inpainter = modal.Cls.from_name(MODAL_APP_NAME, "SketchInpainter")()
            spawn_kwargs = dict(
                negative_prompt=str(request.data.get("negative_prompt") or ""),
                controlnet_scale=controlnet_scale,
                guidance_scale=guidance_scale,
                num_inference_steps=num_inference_steps,
                seed=seed,
                num_variants=num_variants,
                strength=denoise_strength,
            )
            if reference_bytes:
                spawn_kwargs["reference_bytes"] = reference_bytes
                spawn_kwargs["reference_scale"] = reference_scale
            call = inpainter.generate.spawn(
                scribble_bytes,
                source_bytes,
                mask_dims,
                str(prompt),
                **spawn_kwargs,
            )
        except Exception as exc:
            logger.exception("sketch_inpaint: Modal dispatch failed")
            return Response(
                {"detail": f"Modal dispatch failed: {exc}"},
                status=status.HTTP_502_BAD_GATEWAY,
            )

        relation.refresh_from_db()
        for key in list(relation.type_data):
            if key.startswith("sketch_inpaint_result"):
                relation.type_data.pop(key)
        relation.type_data.update(
            {
                "sketch_inpaint_call_id": call.object_id,
                "sketch_inpaint_dispatched_at": timezone.now().isoformat(),
                "sketch_inpaint_status": "working",
                "sketch_inpaint_seed": seed,
            }
        )
        relation.save(update_fields=["type_data", "updated_at"])

        return Response({"call_id": call.object_id, "status": "working"}, status=status.HTTP_202_ACCEPTED)


class SketchInpaintStatusView(APIView):
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
            return Response({"detail": "No saved sketch map for this layer."}, status=status.HTTP_404_NOT_FOUND)

        call_id = relation.type_data.get("sketch_inpaint_call_id")
        if not call_id:
            return Response(
                {"detail": "No sketch inpaint generation dispatched for this layer."},
                status=status.HTTP_409_CONFLICT,
            )

        if relation.type_data.get("sketch_inpaint_status") == "done":
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
                    "dispatched_at": relation.type_data.get("sketch_inpaint_dispatched_at"),
                }
            )
        except Exception as exc:
            logger.exception("sketch_inpaint: generation failed (call %s)", call_id)
            relation.refresh_from_db()
            relation.type_data.update({"sketch_inpaint_status": "error", "sketch_inpaint_error": str(exc)})
            relation.save(update_fields=["type_data", "updated_at"])
            return Response({"status": "error", "detail": str(exc)}, status=status.HTTP_502_BAD_GATEWAY)

        # Batched Modal function returns a list of PNGs (one per variant);
        # tolerate plain bytes from calls dispatched before the batch change.
        png_list = png_bytes if isinstance(png_bytes, list) else [png_bytes]
        base_seed = relation.type_data.get("sketch_inpaint_seed")
        stored = []
        for index, png in enumerate(png_list):
            result_asset = self._store_result(request, source, layer_id, png, index)
            stored.append(
                {
                    "asset_id": result_asset.id,
                    # Mirrors Modal's per-variant seed rule (base seed + index).
                    "seed": base_seed + index if isinstance(base_seed, int) else None,
                }
            )

        relation.refresh_from_db()
        dispatched_at = relation.type_data.get("sketch_inpaint_dispatched_at")
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
                "sketch_inpaint_status": "done",
                "sketch_inpaint_result_at": result_at.isoformat(),
                "sketch_inpaint_result_asset_id": stored[0]["asset_id"],
                "sketch_inpaint_results": stored,
                "sketch_inpaint_latency_s": latency_s,
            }
        )
        relation.save(update_fields=["type_data", "updated_at"])
        return Response(self._done_payload(relation))

    @staticmethod
    def _done_payload(relation):
        """Build the done response from stored per-variant results.

        Returns None when the recorded result assets no longer exist, so the
        caller can fall through and re-poll the Modal call instead.
        """
        stored = relation.type_data.get("sketch_inpaint_results") or []
        if not stored:
            legacy_id = relation.type_data.get("sketch_inpaint_result_asset_id")
            if legacy_id:
                stored = [{"asset_id": legacy_id, "seed": relation.type_data.get("sketch_inpaint_seed")}]
        results = []
        for entry in stored:
            asset = MediaAsset.objects.filter(pk=entry.get("asset_id")).first()
            if asset is not None:
                results.append({**asset_summary(asset), "seed": entry.get("seed")})
        if not results:
            return None
        return {
            "status": "done",
            "result": results[0],
            "results": results,
            "dispatched_at": relation.type_data.get("sketch_inpaint_dispatched_at"),
            "result_at": relation.type_data.get("sketch_inpaint_result_at"),
            "latency_s": relation.type_data.get("sketch_inpaint_latency_s"),
            "seed_used": results[0].get("seed"),
        }

    @staticmethod
    def _store_result(request, source, layer_id, png_bytes, variant=0):
        uploaded = SimpleUploadedFile(
            f"{source.name}-sketch-inpaint-{layer_id}-v{variant}.png",
            png_bytes,
            content_type="image/png",
        )
        user = request.user if request.user.is_authenticated else None
        existing = MediaAsset.objects.filter(
            type_data__sketch_inpaint_preview_of_asset_id=source.id,
            type_data__sketch_inpaint_preview_layer_id=layer_id,
            type_data__sketch_inpaint_preview_variant=variant,
        ).first()
        if existing is not None:
            result_version, _ = add_version(existing, uploaded, created_by=user)
            result_asset = existing
        else:
            result_asset, _ = ingest_file(
                uploaded, name=f"{source.name} sketch inpaint preview v{variant}", created_by=user
            )
            result_version = result_asset.versions.order_by("-version_number").first()

        result_asset.type_data.update(
            {
                "sketch_inpaint_preview_of_asset_id": source.id,
                "sketch_inpaint_preview_layer_id": layer_id,
                "sketch_inpaint_preview_variant": variant,
                "asset_functional_type": "sketch_inpaint_preview",
            }
        )
        result_asset.save(update_fields=["type_data", "updated_at"])

        EntityRelation.objects.update_or_create(
            asset=source,
            entity=result_asset,
            role=ROLE,
            defaults={
                "source": "ai",
                "confidence": 1.0,
                "entity_version": result_version,
                "entity_version_number": result_version.version_number if result_version else None,
                "type_data": {
                    "sketch_inpaint_preview_layer_id": layer_id,
                    "sketch_inpaint_preview_variant": variant,
                },
            },
        )
        return result_asset
