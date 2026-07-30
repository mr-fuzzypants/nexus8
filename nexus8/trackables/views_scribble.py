"""
Scribble-to-image dispatch/poll endpoints.

  POST /api/library/assets/<id>/scribble/         dispatch generation from a layer's saved scribble map
  GET  /api/library/assets/<id>/scribble/status/  poll; on completion store result as linked asset

Modal app: nexus8-scribble (modal_functions/scribble.py, deployed separately).

Unlike inpaint, no source image is sent to Modal — the scribble MAP is the
ControlNet conditioning input. Width/height come from the request body (client
sends imageDims). The scribble PNG is stored via the existing MaskSaveView
endpoint with mask_op="scribble" so the same _mask_lookup helper finds it.

Results land on the layer's render asset as one run of parallel variations
(versions × variations model — see LAYER_RENDER_SCHEMA.md), with lineage links
to the exact scribble-guide (and, in region mode, source-image) versions used.
"""

import json
import logging
import random

from django.http import HttpResponse
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import permissions, status
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import MediaAsset
from .models.versions import Version
from .services import layer_renders
from .views_inpaint import _file_ref, _mask_lookup, _media_bytes, _version_file_bytes
from .views_library import asset_summary

logger = logging.getLogger(__name__)

MODAL_APP_NAME = "nexus8-scribble"


class ScribbleTriggerView(APIView):
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
                {"detail": "No saved scribble map for this layer — save it first."},
                status=status.HTTP_404_NOT_FOUND,
            )

        prompt = request.data.get("prompt") or relation.type_data.get("prompt")
        if not prompt or not str(prompt).strip():
            return Response(
                {"detail": "A prompt is required for scribble-to-image."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Resolve the exact guide version whose bytes go to Modal so stored
        # renders can pin it as lineage (scribble_guide).
        guide_version = mask_asset.versions.order_by(
            "-version_number", "-variation_number"
        ).first()
        scribble_bytes = _media_bytes(_file_ref(guide_version)) if guide_version else None
        if not scribble_bytes:
            return Response(
                {"detail": "Could not load scribble bytes."},
                status=status.HTTP_422_UNPROCESSABLE_ENTITY,
            )

        tech = source.type_data.get("technical_metadata") or {}
        width = int(request.data.get("width") or tech.get("width") or 1024)
        height = int(request.data.get("height") or tech.get("height") or 1024)
        controlnet_scale = float(request.data.get("controlnet_scale") or 0.6)
        scribble_mode = request.data.get("scribble_mode") or "full"
        seed_raw = request.data.get("seed")
        # Always resolve a concrete seed: generating one server-side when the
        # client omits it makes every run reproducible and lets the status
        # endpoint report which seed produced each image. Modal generates
        # variant i with seed + i, so per-variant seeds are derivable here.
        seed = int(seed_raw) if seed_raw is not None else random.randint(0, 2**31 - 1)
        num_variants_raw = request.data.get("num_variants")
        num_variants = max(1, min(4, int(num_variants_raw))) if num_variants_raw is not None else 1
        num_steps_raw = request.data.get("num_inference_steps")
        num_inference_steps = max(1, min(8, int(num_steps_raw))) if num_steps_raw is not None else 4

        # Region mode: send the source image so Modal can crop+paste back.
        source_bytes = None
        source_version = None
        mask_dims = None
        if scribble_mode == "region":
            source_version = source.versions.order_by(
                "-version_number", "-variation_number"
            ).first()
            source_bytes = (
                _media_bytes(_file_ref(source_version)) if source_version else None
            )
            raw_dims = request.data.get("mask_dims")
            if raw_dims and isinstance(raw_dims, dict):
                mask_dims = {k: int(v) for k, v in raw_dims.items() if k in ("x", "y", "w", "h")}

        import modal

        try:
            generator = modal.Cls.from_name(MODAL_APP_NAME, "ScribbleGenerator")()
            spawn_kwargs = dict(
                negative_prompt=str(request.data.get("negative_prompt") or ""),
                width=width,
                height=height,
                controlnet_scale=controlnet_scale,
                num_variants=num_variants,
                num_inference_steps=num_inference_steps,
            )
            if source_bytes is not None:
                spawn_kwargs["source_bytes"] = source_bytes
            if mask_dims is not None:
                spawn_kwargs["mask_dims"] = mask_dims
            spawn_kwargs["seed"] = seed
            call = generator.generate.spawn(scribble_bytes, str(prompt), **spawn_kwargs)
        except Exception as exc:
            logger.exception("scribble: Modal dispatch failed")
            return Response(
                {"detail": f"Modal dispatch failed: {exc}"},
                status=status.HTTP_502_BAD_GATEWAY,
            )

        # The run's parameter record, held here until the poll stores it into
        # each variation's Version.data — written once, never overwritten.
        params = {
            "prompt": str(prompt),
            "negative_prompt": str(request.data.get("negative_prompt") or ""),
            "width": width,
            "height": height,
            "controlnet_scale": controlnet_scale,
            "num_inference_steps": num_inference_steps,
            "scribble_mode": scribble_mode,
            "num_variants": num_variants,
        }
        if mask_dims is not None:
            params["mask_dims"] = mask_dims
        mask_shapes = request.data.get("mask_shapes")
        if isinstance(mask_shapes, list) and mask_shapes:
            # The layer's vector strokes at dispatch — lets History restore the
            # exact input mask as editable shapes (stored once per run).
            params["mask_shapes"] = mask_shapes

        relation.refresh_from_db()
        for key in list(relation.type_data):
            if key.startswith("scribble_result"):
                relation.type_data.pop(key)
        relation.type_data.update(
            {
                "scribble_call_id": call.object_id,
                "scribble_dispatched_at": timezone.now().isoformat(),
                "scribble_status": "working",
                "scribble_seed": seed,
                "scribble_params": params,
                "scribble_guide_version_id": guide_version.pk,
                "scribble_source_version_id": (
                    source_version.pk if source_version else None
                ),
            }
        )
        relation.save(update_fields=["type_data", "updated_at"])

        return Response(
            {"call_id": call.object_id, "status": "working"},
            status=status.HTTP_202_ACCEPTED,
        )


class ScribbleDraftView(APIView):
    """``POST /api/library/assets/<id>/scribble/draft/`` — synchronous draft generation.

    The near-realtime path: scribble bytes arrive in the request (no saved mask
    asset), Modal runs synchronously at reduced resolution/steps, and the JPEG
    comes back in the same HTTP response (no result asset, no polling). Drafts
    are ephemeral by design — use the regular trigger/status flow for results
    worth keeping.
    """

    permission_classes = [permissions.IsAuthenticated]
    parser_classes = [MultiPartParser, FormParser]

    DRAFT_MAX_DIM = 576
    DRAFT_DEFAULT_STEPS = 2

    def post(self, request, pk):
        source = get_object_or_404(MediaAsset.objects, pk=pk)
        scribble_file = request.FILES.get("scribble")
        if scribble_file is None:
            return Response({"detail": "scribble file is required"}, status=status.HTTP_400_BAD_REQUEST)
        prompt = request.data.get("prompt")
        if not prompt or not str(prompt).strip():
            return Response({"detail": "A prompt is required."}, status=status.HTTP_400_BAD_REQUEST)

        scribble_bytes = scribble_file.read()
        tech = source.type_data.get("technical_metadata") or {}
        width = int(request.data.get("width") or tech.get("width") or 1024)
        height = int(request.data.get("height") or tech.get("height") or 1024)
        controlnet_scale = float(request.data.get("controlnet_scale") or 0.6)
        steps_raw = request.data.get("num_inference_steps")
        num_inference_steps = (
            max(1, min(8, int(steps_raw))) if steps_raw not in (None, "") else self.DRAFT_DEFAULT_STEPS
        )
        seed_raw = request.data.get("seed")
        seed = int(seed_raw) if seed_raw not in (None, "") else random.randint(0, 2**31 - 1)

        source_bytes = None
        mask_dims = None
        if (request.data.get("scribble_mode") or "full") == "region":
            source_bytes = _version_file_bytes(source)
            raw_dims = request.data.get("mask_dims")
            if raw_dims:
                try:
                    # Arrives as a JSON string via multipart FormData.
                    parsed = json.loads(raw_dims) if isinstance(raw_dims, str) else raw_dims
                    mask_dims = {k: int(v) for k, v in parsed.items() if k in ("x", "y", "w", "h")}
                except (ValueError, AttributeError):
                    mask_dims = None

        import modal

        try:
            generator = modal.Cls.from_name(MODAL_APP_NAME, "ScribbleGenerator")()
            kwargs = dict(
                width=width,
                height=height,
                controlnet_scale=controlnet_scale,
                num_variants=1,
                num_inference_steps=num_inference_steps,
                seed=seed,
                max_dim=self.DRAFT_MAX_DIM,
                output_format="jpeg",
            )
            if source_bytes is not None:
                kwargs["source_bytes"] = source_bytes
            if mask_dims is not None:
                kwargs["mask_dims"] = mask_dims
            images = generator.generate.remote(scribble_bytes, str(prompt), **kwargs)
        except Exception as exc:
            logger.exception("scribble: draft generation failed")
            return Response(
                {"detail": f"Draft generation failed: {exc}"},
                status=status.HTTP_502_BAD_GATEWAY,
            )

        response = HttpResponse(images[0], content_type="image/jpeg")
        response["X-Seed-Used"] = str(seed)
        return response


class ScribbleStatusView(APIView):
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
                {"detail": "No saved scribble map for this layer."},
                status=status.HTTP_404_NOT_FOUND,
            )

        call_id = relation.type_data.get("scribble_call_id")
        if not call_id:
            return Response(
                {"detail": "No scribble generation dispatched for this layer."},
                status=status.HTTP_409_CONFLICT,
            )

        if relation.type_data.get("scribble_status") == "done":
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
                    "dispatched_at": relation.type_data.get("scribble_dispatched_at"),
                }
            )
        except Exception as exc:
            logger.exception("scribble: generation failed (call %s)", call_id)
            relation.refresh_from_db()
            relation.type_data.update(
                {"scribble_status": "error", "scribble_error": str(exc)}
            )
            relation.save(update_fields=["type_data", "updated_at"])
            return Response(
                {"status": "error", "detail": str(exc)},
                status=status.HTTP_502_BAD_GATEWAY,
            )

        # Batched Modal function returns a list of PNGs (one per variant);
        # tolerate plain bytes from calls dispatched before the batch change.
        png_list = png_bytes if isinstance(png_bytes, list) else [png_bytes]

        dispatched_at = relation.type_data.get("scribble_dispatched_at")
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

        base_seed = relation.type_data.get("scribble_seed")
        params = dict(relation.type_data.get("scribble_params") or {})
        params["modal_call_id"] = call_id
        params["latency_s"] = latency_s

        render_asset, run, versions = layer_renders.store_run_results(
            source,
            layer_id,
            png_list,
            op="scribble",
            params=params,
            base_seed=base_seed if isinstance(base_seed, int) else None,
            source_version=Version.objects.filter(
                pk=relation.type_data.get("scribble_source_version_id")
            ).first(),
            guide_version=Version.objects.filter(
                pk=relation.type_data.get("scribble_guide_version_id")
            ).first(),
            guide_role="scribble_guide",
            created_by=request.user if request.user.is_authenticated else None,
        )

        relation.refresh_from_db()
        relation.type_data.update(
            {
                "scribble_status": "done",
                "scribble_result_at": result_at.isoformat(),
                "scribble_run": run,
                "scribble_results": [
                    {
                        "version_id": v.pk,
                        "version_number": v.version_number,
                        "variation_number": v.variation_number,
                        "seed": v.data.get("generation", {}).get("seed"),
                    }
                    for v in versions
                ],
                "scribble_latency_s": latency_s,
            }
        )
        relation.save(update_fields=["type_data", "updated_at"])

        return Response(self._done_payload(relation))

    @staticmethod
    def _done_payload(relation):
        """Build the done response from stored per-variation results.

        Returns None when the recorded versions no longer exist, so the caller
        can fall through and re-poll the Modal call instead. Entries keep the
        pre-existing shape the SPA consumes (file_path, seed) with the grid
        coordinates added.
        """
        stored = relation.type_data.get("scribble_results") or []
        if not stored:
            legacy_id = relation.type_data.get("scribble_result_asset_id")
            if legacy_id:
                stored = [{"asset_id": legacy_id, "seed": relation.type_data.get("scribble_seed")}]
        results = []
        for entry in stored:
            if "version_id" in entry:
                version = (
                    Version.objects.filter(pk=entry["version_id"])
                    .select_related("entity")
                    .first()
                )
                if version is not None:
                    results.append(
                        {
                            "asset_id": version.entity_id,
                            "file_path": version.data.get("file_path"),
                            "thumbnails": version.data.get("thumbnails"),
                            "version_number": version.version_number,
                            "variation_number": version.variation_number,
                            "seed": entry.get("seed"),
                        }
                    )
            else:
                # Legacy per-variant-slot record (pre versions × variations).
                asset = MediaAsset.objects.filter(pk=entry.get("asset_id")).first()
                if asset is not None:
                    results.append({**asset_summary(asset), "seed": entry.get("seed")})
        if not results:
            return None
        return {
            "status": "done",
            "result": results[0],
            "results": results,
            "run": relation.type_data.get("scribble_run"),
            "dispatched_at": relation.type_data.get("scribble_dispatched_at"),
            "result_at": relation.type_data.get("scribble_result_at"),
            "latency_s": relation.type_data.get("scribble_latency_s"),
            "seed_used": results[0].get("seed"),
        }
