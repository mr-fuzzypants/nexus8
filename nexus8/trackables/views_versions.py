"""
Version history + recommendations endpoints for the reference-platform SPA.

  GET  /library/assets/<pk>/versions/   version timeline + lineage edges
  POST /library/assets/<pk>/versions/   upload a file as a new version
  GET  /library/recommendations/        embedding-centroid neighbors
"""

from django.shortcuts import get_object_or_404
from pgvector.django import CosineDistance
from rest_framework import permissions, status
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import MediaAsset, VersionLink, VersionedEntity
from .services.ingest import add_version
from .views_library import asset_summary

RECOMMENDATION_LIMIT_MAX = 30


def version_node(version, symlink_names):
    data = version.data or {}
    return {
        "id": version.id,
        "version_number": version.version_number,
        "created_at": version.created_at.isoformat(),
        "created_by": version.created_by.username if version.created_by else "",
        "content_hash": (version.content_hash or "")[:10],
        "file_path": data.get("file_path", ""),
        "thumbnails": data.get("thumbnails") or {},
        "symlinks": symlink_names.get(version.id, []),
    }


class AssetVersionsView(APIView):
    permission_classes = [permissions.IsAuthenticated]
    parser_classes = [MultiPartParser, FormParser]

    def get(self, request, pk):
        asset = get_object_or_404(VersionedEntity.objects.all(), pk=pk)

        symlink_names = {}
        for symlink in asset.symlinks.all():
            symlink_names.setdefault(symlink.version_id, []).append(symlink.name)

        versions = list(
            asset.versions.select_related("created_by").order_by("-version_number")
        )
        nodes = [version_node(v, symlink_names) for v in versions]

        version_ids = [v.id for v in versions]
        derived_from = [
            {
                "role": link.role,
                "to_version_number": link.to_version.version_number,
                "entity_id": link.from_version.entity_id,
                "entity_name": link.from_version.entity.name,
                "version_number": link.from_version.version_number,
            }
            for link in VersionLink.objects.filter(to_version_id__in=version_ids)
            .select_related("from_version__entity", "to_version")
        ]
        derives = [
            {
                "role": link.role,
                "from_version_number": link.from_version.version_number,
                "entity_id": link.to_version.entity_id,
                "entity_name": link.to_version.entity.name,
                "version_number": link.to_version.version_number,
            }
            for link in VersionLink.objects.filter(from_version_id__in=version_ids)
            .select_related("to_version__entity", "from_version")
        ]

        return Response(
            {
                "asset_id": asset.id,
                "versions": nodes,
                "derived_from": derived_from,
                "derives": derives,
            }
        )

    def post(self, request, pk):
        asset = get_object_or_404(MediaAsset.objects.active(), pk=pk)
        uploaded = request.FILES.get("file")
        if uploaded is None:
            return Response(
                {"detail": "No file provided (use multipart field 'file')."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        version, created = add_version(
            asset,
            uploaded,
            created_by=request.user if request.user.is_authenticated else None,
        )
        return Response(
            {
                "version_number": version.version_number,
                "created": created,
                "asset": asset_summary(asset),
            },
            status=status.HTTP_201_CREATED if created else status.HTTP_200_OK,
        )


class RecommendationsView(APIView):
    """Neighbors of the centroid of the given assets' embeddings."""

    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        try:
            seed_ids = [
                int(value)
                for value in request.query_params.get("assets", "").split(",")
                if value.strip()
            ]
        except ValueError:
            return Response({"detail": "assets must be ids"}, status=400)
        limit = min(int(request.query_params.get("limit", 12)), RECOMMENDATION_LIMIT_MAX)

        embeddings = [
            asset.semantic_embedding
            for asset in MediaAsset.objects.filter(
                id__in=seed_ids, semantic_embedding__isnull=False
            )
        ]
        if not embeddings:
            # Cold start: most recent assets the user hasn't seeded with.
            recent = MediaAsset.objects.active().exclude(id__in=seed_ids).order_by(
                "-created_at"
            )[:limit]
            return Response({"basis": "recent", "results": [asset_summary(a) for a in recent]})

        dims = len(embeddings[0])
        centroid = [
            sum(vector[i] for vector in embeddings) / len(embeddings)
            for i in range(dims)
        ]
        neighbors = (
            MediaAsset.objects.active()
            .filter(semantic_embedding__isnull=False)
            .exclude(id__in=seed_ids)
            .annotate(distance=CosineDistance("semantic_embedding", centroid))
            .order_by("distance")[:limit]
        )
        results = []
        for neighbor in neighbors:
            summary = asset_summary(neighbor)
            summary["similarity"] = round(1.0 - neighbor.distance, 3)
            results.append(summary)
        return Response({"basis": "embedding", "results": results})
