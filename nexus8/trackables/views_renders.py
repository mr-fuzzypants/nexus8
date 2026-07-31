"""
Layer render grid + selection endpoints (versions × variations model,
LAYER_RENDER_SCHEMA.md).

  GET  /api/library/assets/<id>/renders/?layer_id=…   contact sheet: runs × variations
  POST /api/library/assets/<id>/renders/select/       pin the chosen render
  GET  /api/library/assets/<id>/renders/selected/     every layer's pinned render
"""

import logging

from django.shortcuts import get_object_or_404
from rest_framework import permissions, status
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import MediaAsset
from .models.versions import Version
from .services import layer_renders
from .views_library import asset_summary

logger = logging.getLogger(__name__)


class LayerRenderGridView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request, pk):
        source = get_object_or_404(MediaAsset.objects, pk=pk)
        layer_id = request.query_params.get("layer_id")
        if not layer_id:
            return Response(
                {"detail": "layer_id query parameter is required"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        render_asset = layer_renders.get_render_asset(source, layer_id)
        if render_asset is None:
            return Response({"asset": None, "selected": None, "runs": []})

        selected = layer_renders.selected_render(render_asset)
        return Response(
            {
                "asset": asset_summary(render_asset),
                "selected": (
                    {
                        "version_number": selected.version_number,
                        "variation_number": selected.variation_number,
                    }
                    if selected
                    else None
                ),
                "runs": layer_renders.render_grid(render_asset),
            }
        )


class LayerSelectedRendersView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request, pk):
        source = get_object_or_404(MediaAsset.objects, pk=pk)
        return Response({"selected": layer_renders.selected_renders_for_source(source)})


class LayerRenderSelectView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, pk):
        source = get_object_or_404(MediaAsset.objects, pk=pk)
        layer_id = request.data.get("layer_id")
        version_number = request.data.get("version_number")
        variation_number = request.data.get("variation_number", 0)
        if not layer_id or version_number is None:
            return Response(
                {"detail": "layer_id and version_number are required"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        try:
            version = layer_renders.select_render(
                source,
                layer_id,
                int(version_number),
                int(variation_number),
                actor=request.user if request.user.is_authenticated else None,
            )
        except ValueError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_404_NOT_FOUND)
        except Version.DoesNotExist:
            return Response(
                {"detail": "No such render (version, variation) for this layer."},
                status=status.HTTP_404_NOT_FOUND,
            )
        return Response(
            {
                "status": "selected",
                "version_number": version.version_number,
                "variation_number": version.variation_number,
                "file_path": version.data.get("file_path"),
            }
        )
