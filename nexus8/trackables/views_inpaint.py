"""
Live inpainting dispatch/poll endpoints (SRED_INPAINT_EXPERIMENT.md Phase 3).

  POST /api/library/assets/<id>/mask/inpaint/          dispatch a generation for a layer's saved mask
  GET  /api/library/assets/<id>/mask/inpaint/status/   poll; on completion store result as linked asset

The GPU work runs on Modal (modal_functions/inpaint.py, deployed separately as
app "nexus8-inpaint"). Django only spawns the call and tracks its id — no task
queue needed. Modal credentials come from ~/.modal.toml (CLI auth) or the
MODAL_TOKEN_ID / MODAL_TOKEN_SECRET environment variables.

Results land on the layer's render asset as single-variation runs
(versions × variations model — see LAYER_RENDER_SCHEMA.md), with lineage links
to the exact source-image and mask versions sent to Modal. Renders never touch
the source asset's version history.
"""

import logging
import os

from django.conf import settings
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import permissions, status
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import EntityRelation, MediaAsset, VersionedEntity
from .models.versions import Version
from .services import layer_renders
from .views_annotations import MASK_ROLE
from .views_blob import _file_ref, _parse_nexus8_uri, _resolve_version
from .views_library import asset_summary

logger = logging.getLogger(__name__)
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
    """The layer's mask asset + its relation to the source, as MaskSaveView stores them.

    Enters via the FK-indexed (asset, role) relation edge and matches the layer
    among the per-asset rows (LAYER_RENDER_SCHEMA.md F12 rule). Masks saved
    before relations carried layer_id fall back to the legacy JSONB lookup and
    are healed in place so the next call takes the indexed path.
    """
    for relation in EntityRelation.objects.filter(
        asset=source, role=MASK_ROLE
    ).select_related("entity"):
        if relation.type_data.get("layer_id") == layer_id:
            return relation.entity, relation

    mask_asset = MediaAsset.objects.filter(
        type_data__mask_of_asset_id=source.id,
        type_data__mask_layer_id=layer_id,
    ).first()
    if mask_asset is None:
        return None, None
    relation = EntityRelation.objects.filter(
        asset=source, entity=mask_asset, role=MASK_ROLE
    ).first()
    if relation is not None:
        relation.type_data["layer_id"] = layer_id
        relation.save(update_fields=["type_data", "updated_at"])
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

        # Resolve the exact versions whose bytes go to Modal so the stored
        # render can pin them as lineage (init_image / inpaint_mask).
        version_number = request.data.get("version_number")
        source_version = None
        if version_number is not None:
            source_version = source.versions.filter(
                version_number=int(version_number)
            ).first()
        if source_version is None:
            source_version = source.versions.order_by(
                "-version_number", "-variation_number"
            ).first()
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

        # The run's parameter record, held here until the poll stores it into
        # the render's Version.data — written once, never overwritten.
        params = {
            "prompt": str(prompt),
            "negative_prompt": str(request.data.get("negative_prompt") or ""),
            "mode": str(request.data.get("mode") or "fast"),
        }
        if request.data.get("num_inference_steps"):
            params["num_inference_steps"] = int(request.data["num_inference_steps"])
        if reference_uri:
            params["reference"] = str(reference_uri)
        mask_shapes = request.data.get("mask_shapes")
        if isinstance(mask_shapes, list) and mask_shapes:
            # The layer's vector strokes at dispatch — lets History restore the
            # exact input mask as editable shapes (stored once per run).
            params["mask_shapes"] = mask_shapes

        relation.refresh_from_db()
        for key in list(relation.type_data):
            if key.startswith("inpaint_result"):
                relation.type_data.pop(key)
        relation.type_data.update(
            {
                "inpaint_call_id": call.object_id,
                "inpaint_dispatched_at": timezone.now().isoformat(),
                "inpaint_status": "working",
                "inpaint_params": params,
                "inpaint_source_version_id": source_version.pk,
                "inpaint_mask_version_id": mask_version.pk,
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

        params = dict(relation.type_data.get("inpaint_params") or {})
        params["modal_call_id"] = call_id
        params["latency_s"] = latency_s

        render_asset, run, versions = layer_renders.store_run_results(
            source,
            layer_id,
            [png_bytes],
            op="inpaint",
            params=params,
            source_version=Version.objects.filter(
                pk=relation.type_data.get("inpaint_source_version_id")
            ).first(),
            guide_version=Version.objects.filter(
                pk=relation.type_data.get("inpaint_mask_version_id")
            ).first(),
            guide_role="inpaint_mask",
            created_by=request.user if request.user.is_authenticated else None,
        )

        relation.refresh_from_db()
        relation.type_data.update(
            {
                "inpaint_status": "done",
                "inpaint_result_at": result_at.isoformat(),
                "inpaint_run": run,
                "inpaint_result_version_id": versions[0].pk,
                "inpaint_latency_s": latency_s,
            }
        )
        relation.save(update_fields=["type_data", "updated_at"])

        return Response(self._done_payload(relation))

    @staticmethod
    def _done_payload(relation):
        """Done response from the stored render; None if it no longer exists
        (caller falls through to re-poll Modal). Keeps the pre-existing shape
        the SPA consumes (result.file_path)."""
        version_id = relation.type_data.get("inpaint_result_version_id")
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
                pk=relation.type_data.get("inpaint_result_asset_id")
            ).first()
            if asset is None:
                return None
            result = asset_summary(asset)
        return {
            "status": "done",
            "result": result,
            "run": relation.type_data.get("inpaint_run"),
            "dispatched_at": relation.type_data.get("inpaint_dispatched_at"),
            "result_at": relation.type_data.get("inpaint_result_at"),
            "latency_s": relation.type_data.get("inpaint_latency_s"),
        }
