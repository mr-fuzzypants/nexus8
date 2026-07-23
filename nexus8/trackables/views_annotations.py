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

from .models import EntityRelation, ImageAnnotation, MediaAsset, Version
from .services.ingest import add_version, ingest_file
from .views_library import asset_summary

MASK_ROLE = "mask"


def annotation_summary(doc):
    latest = doc.versions.order_by("-version_number").first()
    return {
        "id": doc.id,
        "code": doc.code,
        "name": doc.name,
        "target_asset_id": doc.target_asset_id,
        "target_asset_version_number": doc.type_data.get("target_asset_version_number"),
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

    def _find(self, asset_id, version_number=None):
        qs = ImageAnnotation.objects.active().filter(
            type_data__target_asset_id=asset_id
        )
        if version_number is not None:
            qs = qs.filter(type_data__target_asset_version_number=version_number)
        else:
            # Entity-level doc: no version pinned.
            qs = qs.filter(type_data__target_asset_version_number__isnull=True)
        return qs.order_by("created_at").first()

    def get(self, request):
        asset_id = request.query_params.get("asset")
        if not asset_id:
            return Response(
                {"detail": "asset query parameter is required"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        version_number = request.query_params.get("version_number")
        doc = self._find(int(asset_id), int(version_number) if version_number else None)
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

        version_number = request.data.get("target_asset_version_number")
        version_number = int(version_number) if version_number is not None else None

        existing = self._find(asset_id, version_number)
        if existing:
            return Response(annotation_summary(existing))

        version_label = f" v{version_number}" if version_number is not None else ""
        doc = ImageAnnotation.objects.create(
            code=f"annot_{uuid.uuid4().hex[:10]}",
            name=f"Annotations · {asset.name}{version_label}",
            type_data={
                "target_asset_id": asset_id,
                "target_asset_version_number": version_number,
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

        annotation_id = request.data.get("annotation_id")
        layer_id = request.data.get("layer_id")
        mask_op = request.data.get("mask_op") or None
        prompt = request.data.get("prompt") or None
        reference = request.data.get("reference") or None
        mask_dims_raw = request.data.get("mask_dims")
        mask_dims = None
        if mask_dims_raw:
            try:
                import json
                mask_dims = json.loads(mask_dims_raw)
            except (ValueError, TypeError):
                pass
        display_name = (
            uploaded.name.rsplit(".", 1)[0] if uploaded.name else None
        ) or f"{source.name} mask"

        # Resolve the source version: client sends version_number, we default to latest.
        version_number = request.data.get("version_number")
        asset_version = None
        if version_number is not None:
            asset_version = Version.objects.filter(
                entity=source, version_number=int(version_number)
            ).first()
        if asset_version is None:
            asset_version = source.versions.order_by("-version_number").first()

        # If a layer_id is provided, look for the existing mask asset for this layer
        # so we can add a new version rather than creating a whole new asset.
        existing_mask = None
        if layer_id:
            existing_mask = MediaAsset.objects.filter(
                type_data__mask_of_asset_id=source.id,
                type_data__mask_layer_id=layer_id,
            ).first()

        if existing_mask is not None:
            mask_version, _ = add_version(
                existing_mask,
                uploaded,
                created_by=request.user if request.user.is_authenticated else None,
            )
            # Keep the asset name in sync with the layer name.
            if existing_mask.name != display_name:
                existing_mask.name = display_name
                existing_mask.save(update_fields=["name", "updated_at"])
            mask_asset = existing_mask
        else:
            mask_asset, _created = ingest_file(
                uploaded,
                name=display_name,
                created_by=request.user if request.user.is_authenticated else None,
            )
            mask_version = mask_asset.versions.order_by("-version_number").first()

        # Record / refresh provenance on the mask asset.
        mask_asset.type_data["mask_of_asset_id"] = source.id
        mask_asset.type_data["asset_functional_type"] = "mask"
        if annotation_id:
            mask_asset.type_data["mask_annotation_id"] = int(annotation_id)
        if layer_id:
            mask_asset.type_data["mask_layer_id"] = layer_id
        mask_asset.save(update_fields=["type_data", "updated_at"])

        # Build relation metadata from submitted fields, preserving any existing
        # values for fields not included in this request.
        relation_type_data: dict = {}
        if mask_op is not None:
            relation_type_data["mask_op"] = mask_op
        if prompt is not None:
            relation_type_data["prompt"] = prompt
        if reference is not None:
            relation_type_data["reference"] = reference
        if mask_dims is not None:
            relation_type_data["mask_dims"] = mask_dims

        existing_relation = EntityRelation.objects.filter(
            asset=source, entity=mask_asset, role=MASK_ROLE
        ).first()
        merged_type_data = {**(existing_relation.type_data if existing_relation else {}), **relation_type_data}

        # Link (or update link) to the source asset, always pointing to the latest version.
        EntityRelation.objects.update_or_create(
            asset=source,
            entity=mask_asset,
            role=MASK_ROLE,
            defaults={
                "source": "user",
                "confidence": 1.0,
                "asset_version": asset_version,
                "entity_version": mask_version,
                "entity_version_number": mask_version.version_number if mask_version else None,
                "type_data": merged_type_data,
            },
        )

        return Response(asset_summary(mask_asset), status=status.HTTP_201_CREATED)


class AssetMasksView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request, pk):
        qs = EntityRelation.objects.filter(asset_id=pk, role=MASK_ROLE).select_related("entity")
        version_number = request.query_params.get("version_number")
        if version_number is not None:
            qs = qs.filter(asset_version__version_number=int(version_number))
        return Response([asset_summary(r.entity) for r in qs.order_by("-created_at")])
