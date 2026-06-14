"""
Intelligence endpoints for the reference-platform frontend:

  GET    /library/assets/<pk>/similar/      embedding- or tag-based neighbors
  GET/POST /library/assets/<pk>/relations/  asset ↔ entity links
  DELETE /library/relations/<pk>/
  GET/POST /library/entities/               entities (character/costume/...)
  GET    /library/entities/<pk>/            entity hub: detail + related assets
  GET/POST /library/smart-collections/      saved searches
  DELETE /library/smart-collections/<pk>/
"""

import re
import uuid

from django.db.models import Count
from django.shortcuts import get_object_or_404
from pgvector.django import CosineDistance
from rest_framework import permissions, status
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import EntityRelation, MediaAsset, SmartCollection, VersionedEntity
from .views_library import asset_summary

ENTITY_CATEGORIES = ["character", "costume", "location", "prop", "scene", "style"]


def _slug(value):
    value = re.sub(r"[^a-zA-Z0-9]+", "_", value).strip("_").lower()
    return value or "entity"


# ---------------------------------------------------------------------------
# Similar assets
# ---------------------------------------------------------------------------

class AssetSimilarView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request, pk):
        asset = get_object_or_404(MediaAsset.objects.active(), pk=pk)
        limit = min(int(request.query_params.get("limit", 12)), 50)
        mode = request.query_params.get("mode", "embedding")

        if mode == "embedding" and asset.semantic_embedding is not None:
            neighbors = (
                MediaAsset.objects.active()
                .filter(semantic_embedding__isnull=False)
                .exclude(pk=asset.pk)
                .annotate(distance=CosineDistance("semantic_embedding", asset.semantic_embedding))
                .order_by("distance")[:limit]
            )
            results = []
            for neighbor in neighbors:
                summary = asset_summary(neighbor)
                summary["similarity"] = round(1.0 - neighbor.distance, 3)
                results.append(summary)
            return Response({"mode": "embedding", "results": results})

        # Tag-overlap fallback (also used when the asset has no embedding yet).
        own = set((asset.type_data or {}).get("tags") or []) | set(
            (asset.type_data or {}).get("ai_suggested_tags") or []
        )
        scored = []
        candidates = MediaAsset.objects.active().exclude(pk=asset.pk)[:2000]
        for candidate in candidates:
            data = candidate.type_data or {}
            tags = set(data.get("tags") or []) | set(data.get("ai_suggested_tags") or [])
            overlap = len(own & tags)
            if overlap:
                scored.append((overlap, candidate))
        scored.sort(key=lambda pair: -pair[0])
        results = []
        for overlap, candidate in scored[:limit]:
            summary = asset_summary(candidate)
            summary["similarity"] = overlap
            results.append(summary)
        return Response({"mode": "tags", "results": results})


# ---------------------------------------------------------------------------
# Entities & relations
# ---------------------------------------------------------------------------

def entity_summary(entity, asset_count=None):
    return {
        "id": entity.id,
        "code": entity.code,
        "name": entity.name,
        "category": (entity.type_data or {}).get("category", ""),
        "description": entity.description,
        "asset_count": asset_count,
        "parent_id": entity.parent_container_id,
    }




def relation_payload(relation):
    return {
        "id": relation.id,
        "role": relation.role,
        "source": relation.source,
        "entity": entity_summary(relation.entity),
    }


class EntityListView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        entities = (
            VersionedEntity.objects.filter(entity_type="entity", archived_at__isnull=True)
            .annotate(n_assets=Count("asset_relations"))
            .order_by("name")
        )
        category = request.query_params.get("category")
        if category:
            entities = entities.filter(type_data__category=category)

        payload = []
        for entity in entities[:500]:
            row = entity_summary(entity, asset_count=entity.n_assets)
            first = (
                EntityRelation.objects.filter(entity=entity)
                .select_related("asset")
                .order_by("-confidence")
                .first()
            )
            if first:
                data = first.asset.type_data or {}
                row["thumb"] = (data.get("thumbnails") or {}).get("256") or data.get(
                    "file_path", ""
                )
            payload.append(row)
        return Response(payload)

    def post(self, request):
        name = (request.data.get("name") or "").strip()
        category = (request.data.get("category") or "").strip().lower()
        if not name or category not in ENTITY_CATEGORIES:
            return Response(
                {"detail": f"name and category (one of {ENTITY_CATEGORIES}) required"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        entity = VersionedEntity.objects.create(
            entity_type="entity",
            code=f"{category}_{_slug(name)}_{uuid.uuid4().hex[:6]}",
            name=name,
            type_data={"category": category},
        )
        return Response(entity_summary(entity, asset_count=0), status=status.HTTP_201_CREATED)


class EntityDetailView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request, pk):
        entity = get_object_or_404(
            VersionedEntity.objects.filter(entity_type="entity"), pk=pk
        )
        relations = (
            EntityRelation.objects.filter(entity=entity)
            .select_related("asset")
            .order_by("-created_at")[:500]
        )
        return Response(
            {
                **entity_summary(entity, asset_count=len(relations)),
                "assets": [asset_summary(r.asset) for r in relations],
            }
        )




class AssetRelationsView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request, pk):
        relations = (
            EntityRelation.objects.filter(asset_id=pk)
            .select_related("entity")
            .order_by("role")
        )
        return Response([relation_payload(r) for r in relations])

    def post(self, request, pk):
        asset = get_object_or_404(VersionedEntity.objects.all(), pk=pk)
        entity = get_object_or_404(
            VersionedEntity.objects.filter(entity_type="entity"),
            pk=request.data.get("entity_id"),
        )
        role = (request.data.get("role") or "").strip().lower() or (
            (entity.type_data or {}).get("category", "related")
        )
        relation, _ = EntityRelation.objects.get_or_create(
            asset=asset, entity=entity, role=role, defaults={"source": "user"}
        )
        return Response(relation_payload(relation), status=status.HTTP_201_CREATED)


class RelationDetailView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def delete(self, request, pk):
        get_object_or_404(EntityRelation, pk=pk).delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


# ---------------------------------------------------------------------------
# Smart collections (saved searches)
# ---------------------------------------------------------------------------

def smart_collection_summary(collection):
    return {
        "id": collection.id,
        "name": collection.name,
        "query": collection.query,
        "created_at": collection.created_at.isoformat(),
    }


class SmartCollectionListView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        collections = SmartCollection.objects.active().order_by("-created_at")
        return Response([smart_collection_summary(c) for c in collections])

    def post(self, request):
        name = (request.data.get("name") or "").strip()
        query = (request.data.get("query") or "").strip()
        if not name:
            return Response({"detail": "name required"}, status=status.HTTP_400_BAD_REQUEST)
        collection = SmartCollection.objects.create(
            code=f"smart_{uuid.uuid4().hex[:10]}",
            name=name,
            type_data={"query": query},
        )
        return Response(smart_collection_summary(collection), status=status.HTTP_201_CREATED)


class SmartCollectionDetailView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def delete(self, request, pk):
        collection = get_object_or_404(SmartCollection.objects.active(), pk=pk)
        collection.archive()
        return Response(status=status.HTTP_204_NO_CONTENT)


# ---------------------------------------------------------------------------
# Entity organization: containers (file browser)
# ---------------------------------------------------------------------------

def container_summary(container):
    """Summary of a container for tree display."""
    return {
        "id": container.id,
        "code": container.code,
        "name": container.name,
        "parent_id": container.parent_container_id,
    }


def container_tree_node(container, include_entities=False):
    """Container node for tree display, optionally with its entities."""
    node = container_summary(container)
    node["children"] = []
    if include_entities:
        entities = VersionedEntity.objects.filter(
            entity_type="entity", parent_container=container, archived_at__isnull=True
        ).order_by("name")
        node["entities"] = [entity_summary(e) for e in entities]
    return node


class ContainerTreeView(APIView):
    """Get container hierarchy for file browser."""
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        from .models import Container

        # Get or create root "Entities" container
        root, _ = Container.objects.get_or_create(
            code="container_entities_root",
            defaults={"name": "Entities", "parent_container": None},
        )

        # Fetch all descendants in one efficient CTE query
        all_containers = Container.objects.get_descendants_cte(root, include_self=True)

        # Build lookup dict and initialize nodes
        nodes_by_id = {}
        for container in all_containers:
            node = container_tree_node(container, include_entities=True)
            nodes_by_id[container.id] = node

        # Build tree structure by linking parents and children
        for container in all_containers:
            if container.parent_container_id and container.parent_container_id in nodes_by_id:
                parent_node = nodes_by_id[container.parent_container_id]
                parent_node["children"].append(nodes_by_id[container.id])

        # Sort children by name at each level
        def sort_tree(nodes: list) -> None:
            nodes.sort(key=lambda n: n["name"])
            for node in nodes:
                sort_tree(node["children"])

        if root.id in nodes_by_id:
            sort_tree(nodes_by_id[root.id]["children"])
            return Response([nodes_by_id[root.id]])

        # Fallback if root not found
        return Response([container_tree_node(root, include_entities=True)])

    def post(self, request):
        """Create a new container."""
        from .models import Container

        name = (request.data.get("name") or "").strip()
        parent_id = request.data.get("parent_id")

        if not name:
            return Response({"detail": "name required"}, status=status.HTTP_400_BAD_REQUEST)

        # Get parent container (default to root Entities container)
        if parent_id:
            parent = get_object_or_404(Container, pk=parent_id)
        else:
            parent, _ = Container.objects.get_or_create(
                code="container_entities_root",
                defaults={"name": "Entities", "parent_container": None},
            )

        container = Container.objects.create(
            code=f"container_{_slug(name)}_{uuid.uuid4().hex[:6]}",
            name=name,
            parent_container=parent,
        )
        return Response(container_summary(container), status=status.HTTP_201_CREATED)


class EntityContainerView(APIView):
    """Move an entity to a container."""
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        """Assign entity to a container."""
        entity_id = request.data.get("entity_id")
        container_id = request.data.get("container_id")

        entity = get_object_or_404(
            VersionedEntity.objects.filter(entity_type="entity"), pk=entity_id
        )

        if container_id:
            from .models import Container
            container = get_object_or_404(Container, pk=container_id)
            entity.parent_container = container
        else:
            # Remove from container (move to root)
            entity.parent_container = None

        entity.save()
        return Response(entity_summary(entity))


class RootEntitiesView(APIView):
    """Get entities not assigned to any container (root level)."""
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        category = request.query_params.get("category")
        entities = VersionedEntity.objects.filter(
            entity_type="entity", parent_container__isnull=True, archived_at__isnull=True
        ).order_by("name")

        if category:
            entities = entities.filter(type_data__category=category)

        return Response([entity_summary(e) for e in entities])
