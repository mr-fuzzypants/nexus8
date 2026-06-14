"""
Endpoints for the collaborative 2D tiled annotator (web/src/features/annotator).

  GET    /api/library/assets/<id>/            single asset summary (seeds the viewer)
  POST   /api/library/annotations/            get-or-create the doc for ?target_asset_id
  GET    /api/library/annotations/<id>/       fetch a doc (incl. persisted doc_state)
  PATCH  /api/library/annotations/<id>/       save working CRDT state (doc_state)
  POST   /api/library/annotations/<id>/snapshot/  publish an immutable Version
  POST   /api/library/assets/<id>/mask/       save a rasterized mask PNG as a linked asset
  GET    /api/library/assets/<id>/masks/      list masks linked to an asset (role="mask")

The live CRDT document is owned by the Yjs relay (room_snapshots table); these
endpoints own the *versioned* tier — doc_state + published snapshots.
"""

import uuid

from django.shortcuts import get_object_or_404
from rest_framework import permissions, status
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import EntityRelation, ImageAnnotation, MediaAsset
from .services.ingest import ingest_file
from .views_library import asset_summary

MASK_ROLE = "mask"


def annotation_summary(doc):
    latest = doc.versions.order_by("-version_number").first()
    return {
        "id": doc.id,
        "code": doc.code,
        "name": doc.name,
        "target_asset_id": doc.target_asset_id,
        "room_id": doc.room_id,
        "doc_state": doc.doc_state,
        "snapshot_version": latest.version_number if latest else None,
    }


class LibraryAssetDetailView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request, pk):
        asset = get_object_or_404(MediaAsset.objects, pk=pk)
        return Response(asset_summary(asset))


class AnnotationDocListCreateView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def _find(self, asset_id):
        return (
            ImageAnnotation.objects.active()
            .filter(type_data__target_asset_id=asset_id)
            .order_by("created_at")
            .first()
        )

    def get(self, request):
        asset_id = request.query_params.get("asset")
        if not asset_id:
            return Response(
                {"detail": "asset query parameter is required"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        doc = self._find(int(asset_id))
        if not doc:
            return Response(status=status.HTTP_404_NOT_FOUND)
        return Response(annotation_summary(doc))

    def post(self, request):
        asset_id = request.data.get("target_asset_id")
        if asset_id is None:
            return Response(
                {"detail": "target_asset_id is required"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        asset_id = int(asset_id)
        asset = get_object_or_404(MediaAsset.objects, pk=asset_id)

        existing = self._find(asset_id)
        if existing:
            return Response(annotation_summary(existing))

        doc = ImageAnnotation.objects.create(
            code=f"annot_{uuid.uuid4().hex[:10]}",
            name=f"Annotations · {asset.name}",
            type_data={
                "target_asset_id": asset_id,
                "room_id": "",
                "doc_state": "",
            },
        )
        # Room id needs the entity id, so stamp it after creation.
        doc.room_id = f"image-annotation:{doc.id}"
        doc.save(update_fields=["type_data", "updated_at"])
        return Response(annotation_summary(doc), status=status.HTTP_201_CREATED)


class AnnotationDocDetailView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get_doc(self, pk):
        return get_object_or_404(ImageAnnotation.objects.active(), pk=pk)

    def get(self, request, pk):
        return Response(annotation_summary(self.get_doc(pk)))

    def patch(self, request, pk):
        doc = self.get_doc(pk)
        if "doc_state" in request.data:
            doc.doc_state = request.data["doc_state"] or ""
            doc.save(update_fields=["type_data", "updated_at"])
        return Response(annotation_summary(doc))


class AnnotationDocSnapshotView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, pk):
        doc = get_object_or_404(ImageAnnotation.objects.active(), pk=pk)
        version = doc.snapshot(
            created_by=request.user if request.user.is_authenticated else None
        )
        return Response(
            {"version_number": version.version_number, "created_at": version.created_at},
            status=status.HTTP_201_CREATED,
        )


class MaskSaveView(APIView):
    permission_classes = [permissions.IsAuthenticated]
    parser_classes = [MultiPartParser, FormParser]

    def post(self, request, pk):
        source = get_object_or_404(MediaAsset.objects, pk=pk)
        uploaded = request.FILES.get("mask")
        if not uploaded:
            return Response(
                {"detail": "No mask provided (use multipart field 'mask')."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        mask_asset, _created = ingest_file(
            uploaded,
            name=uploaded.name or f"{source.name} mask",
            created_by=request.user if request.user.is_authenticated else None,
        )

        # Record provenance and link the mask back to its source asset.
        annotation_id = request.data.get("annotation_id")
        mask_asset.type_data["mask_of_asset_id"] = source.id
        if annotation_id:
            mask_asset.type_data["mask_annotation_id"] = int(annotation_id)
        mask_asset.type_data["asset_functional_type"] = "mask"
        mask_asset.save(update_fields=["type_data", "updated_at"])

        EntityRelation.objects.get_or_create(
            asset=source,
            entity=mask_asset,
            role=MASK_ROLE,
            defaults={"source": "user", "confidence": 1.0},
        )

        return Response(asset_summary(mask_asset), status=status.HTTP_201_CREATED)


class AssetMasksView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request, pk):
        relations = (
            EntityRelation.objects.filter(asset_id=pk, role=MASK_ROLE)
            .select_related("entity")
            .order_by("-created_at")
        )
        return Response([asset_summary(relation.entity) for relation in relations])
