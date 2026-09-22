"""
Image-to-3D dispatch/poll endpoints (TRELLIS2_IMAGETO3D_PLAN.md Phase 4).

  POST /api/library/assets/<id>/image-to-3d/          dispatch generation from an image asset
  GET  /api/library/assets/<id>/image-to-3d/status/   poll; on completion store the GLB/splat
                                                       as a new 3d_model asset linked to the source
  POST /api/library/image-to-3d/                       standalone: upload an image, ingest it, dispatch

GPU work runs on Modal (modal_functions/trellis2_gen.py, deployed as app
"nexus8-trellis2"). Django spawns the call and tracks its id on the source
asset's type_data — no task queue. Modal credentials come from ~/.modal.toml or
MODAL_TOKEN_ID / MODAL_TOKEN_SECRET.

The generated asset is a first-class MediaAsset (media_type '3d_model' or
'gaussian_splat') with a rendered thumbnail and an ``init_image`` lineage edge to
the exact source-image version it was generated from — it appears in the library
grid and opens in the Three.js viewer. The source asset's history is untouched.
"""

import logging

from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import permissions, status
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import MediaAsset
from .models.versions import Version
from .services.ingest import ingest_file, ingest_generated_asset
from .views_blob import _file_ref
from .views_inpaint import _media_bytes
from .views_library import asset_summary

logger = logging.getLogger(__name__)
MODAL_APP_NAME = "nexus8-trellis2"
TIERS = {"fast", "balanced", "max"}
CALLS_KEY = "gen3d"  # source.type_data[CALLS_KEY][call_id] holds pending/finished run state


def _parse_params(request):
    """Validate + normalize the generation params from the request body."""
    tier = str(request.data.get("tier") or "balanced")
    if tier not in TIERS:
        return None, f"tier must be one of {sorted(TIERS)}"
    output_format = str(request.data.get("output_format") or "glb")
    if output_format not in ("glb", "splat"):
        return None, "output_format must be 'glb' or 'splat'"
    if output_format == "splat":
        # Splat synthesis is Phase 3b — not wired into the Modal method yet.
        return None, "Gaussian-splat output is not available yet (Phase 3b)."
    try:
        texture_size = int(request.data.get("texture_size") or 2048)
    except (TypeError, ValueError):
        return None, "texture_size must be an integer"
    seed = request.data.get("seed")
    try:
        seed = int(seed) if seed is not None and seed != "" else None
    except (TypeError, ValueError):
        return None, "seed must be an integer"
    # seed=None → Modal auto-selects random seeds and retries until the mesh isn't a flat plane
    # (TRELLIS.2 stochastically collapses to a billboard for some image+seed pairs). A pinned
    # seed is passed through verbatim for reproducibility. The chosen seed comes back in meta.
    return {
        "tier": tier,
        "texture_size": texture_size,
        "output_format": output_format,
        "seed": seed,
    }, None


def _dispatch(source, source_version, image_bytes, params, request):
    """Spawn the Modal generation and persist pending state on the source asset."""
    import modal

    gen = modal.Cls.from_name(MODAL_APP_NAME, "Trellis2Generator")()
    call = gen.generate.spawn(
        image_bytes,
        tier=params["tier"],
        texture_size=params["texture_size"],
        want_normal=True,
        output_format=params["output_format"],
        seed=params["seed"],
    )

    source.refresh_from_db()
    calls = source.type_data.setdefault(CALLS_KEY, {})
    calls[call.object_id] = {
        "status": "working",
        "dispatched_at": timezone.now().isoformat(),
        "params": params,
        "source_version_id": source_version.pk,
    }
    source.save(update_fields=["type_data", "updated_at"])
    return call.object_id


def _resolve_source_version(source, request):
    version_number = request.data.get("version_number")
    version = None
    if version_number is not None:
        version = source.versions.filter(version_number=int(version_number)).first()
    if version is None:
        version = source.versions.order_by(
            "-version_number", "-variation_number"
        ).first()
    return version


class ImageTo3DTriggerView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, pk):
        source = get_object_or_404(MediaAsset.objects, pk=pk)
        params, err = _parse_params(request)
        if err:
            return Response({"detail": err}, status=status.HTTP_400_BAD_REQUEST)

        source_version = _resolve_source_version(source, request)
        image_bytes = _media_bytes(_file_ref(source_version)) if source_version else None
        if not image_bytes:
            return Response(
                {"detail": "Could not load source image bytes."},
                status=status.HTTP_422_UNPROCESSABLE_ENTITY,
            )

        try:
            call_id = _dispatch(source, source_version, image_bytes, params, request)
        except Exception as exc:
            logger.exception("image-to-3d: Modal dispatch failed")
            return Response(
                {"detail": f"Modal dispatch failed: {exc}"},
                status=status.HTTP_502_BAD_GATEWAY,
            )
        return Response(
            {"call_id": call_id, "status": "working"}, status=status.HTTP_202_ACCEPTED
        )


class ImageTo3DStatusView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request, pk):
        source = get_object_or_404(MediaAsset.objects, pk=pk)
        call_id = request.query_params.get("call_id")
        if not call_id:
            return Response(
                {"detail": "call_id query parameter is required"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        state = (source.type_data.get(CALLS_KEY) or {}).get(call_id)
        if state is None:
            return Response(
                {"detail": "Unknown call_id for this asset."},
                status=status.HTTP_404_NOT_FOUND,
            )

        # Idempotent re-poll: once stored, return the result asset, never re-ingest.
        if state.get("status") == "done":
            payload = self._done_payload(state)
            if payload is not None:
                return Response(payload)

        import modal

        try:
            fc = modal.FunctionCall.from_id(call_id)
            asset_bytes, thumb_bytes, meta = fc.get(timeout=0)
        except TimeoutError:
            return Response(
                {"status": "working", "dispatched_at": state.get("dispatched_at")}
            )
        except Exception as exc:
            logger.exception("image-to-3d: generation failed (call %s)", call_id)
            self._mark(source, call_id, {"status": "error", "error": str(exc)})
            return Response(
                {"status": "error", "detail": str(exc)},
                status=status.HTTP_502_BAD_GATEWAY,
            )

        params = dict(state.get("params") or {})
        source_version = Version.objects.filter(pk=state.get("source_version_id")).first()
        is_splat = params.get("output_format") == "splat"
        ext = ".ply" if is_splat else ".glb"
        media_type = "gaussian_splat" if is_splat else "3d_model"
        # meta carries the seed Modal actually used (after auto-retry) + shape flatness telemetry.
        generation = {"op": "image_to_3d", "modal_call_id": call_id, **params, **(meta or {})}

        new_asset, version, _created = ingest_generated_asset(
            asset_bytes,
            filename=f"{source.name}-3d{ext}",
            thumbnail_bytes=thumb_bytes,
            media_type=media_type,
            name=f"{source.name} (3D)",
            created_by=request.user if request.user.is_authenticated else None,
            upstream={"init_image": source_version} if source_version else None,
            generation=generation,
            project_id=source.project_id,  # inherit the source's project so it lands in the grid
        )

        self._mark(
            source,
            call_id,
            {
                "status": "done",
                "result_asset_id": new_asset.pk,
                "result_version_id": version.pk,
                "result_at": timezone.now().isoformat(),
            },
        )
        return Response(self._done_payload({"result_asset_id": new_asset.pk, **state}))

    @staticmethod
    def _mark(source, call_id, updates):
        source.refresh_from_db()
        calls = source.type_data.setdefault(CALLS_KEY, {})
        calls.setdefault(call_id, {}).update(updates)
        source.save(update_fields=["type_data", "updated_at"])

    @staticmethod
    def _done_payload(state):
        asset = MediaAsset.objects.filter(pk=state.get("result_asset_id")).first()
        if asset is None:
            return None
        return {"status": "done", "result": asset_summary(asset)}


class ImageTo3DPendingView(APIView):
    """The asset's latest still-running generation, so the panel can **resume polling after a
    page refresh** (the frontend keeps call ids only in memory; the backend persists them on
    the source's type_data). Also lets a finished-but-unpolled job get ingested on reopen."""

    permission_classes = [permissions.IsAuthenticated]

    def get(self, request, pk):
        source = get_object_or_404(MediaAsset.objects, pk=pk)
        calls = source.type_data.get(CALLS_KEY) or {}
        working = [(cid, st) for cid, st in calls.items() if st.get("status") == "working"]
        if not working:
            return Response({"call_id": None})
        cid, st = max(working, key=lambda kv: kv[1].get("dispatched_at") or "")
        return Response(
            {"call_id": cid, "status": "working", "dispatched_at": st.get("dispatched_at")}
        )


class ImageTo3DUploadView(APIView):
    """Standalone: upload an image, ingest it as the source, then dispatch. Poll via the
    asset-scoped status endpoint using the returned asset_id + call_id."""

    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        uploaded = request.FILES.get("file")
        if uploaded is None:
            return Response(
                {"detail": "an image 'file' is required"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        params, err = _parse_params(request)
        if err:
            return Response({"detail": err}, status=status.HTTP_400_BAD_REQUEST)

        image_bytes = uploaded.read()
        from django.core.files.uploadedfile import SimpleUploadedFile

        source, _created = ingest_file(
            SimpleUploadedFile(uploaded.name, image_bytes, content_type=uploaded.content_type),
            created_by=request.user if request.user.is_authenticated else None,
        )
        source_version = source.versions.order_by("-version_number", "-variation_number").first()

        try:
            call_id = _dispatch(source, source_version, image_bytes, params, request)
        except Exception as exc:
            logger.exception("image-to-3d: Modal dispatch failed")
            return Response(
                {"detail": f"Modal dispatch failed: {exc}"},
                status=status.HTTP_502_BAD_GATEWAY,
            )
        return Response(
            {"asset_id": source.pk, "call_id": call_id, "status": "working"},
            status=status.HTTP_202_ACCEPTED,
        )
