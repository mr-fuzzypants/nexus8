"""API endpoints for version dependencies."""

from rest_framework import viewsets, status, permissions, filters
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.pagination import PageNumberPagination
from django.db import connection
from django.db.models import Count
from django.shortcuts import get_object_or_404
from django_filters.rest_framework import DjangoFilterBackend

from .models import DependencyLink, Version
from .serializers_container_links import (
    DependencyLinkSerializer,
    DependencyLinkMinimalSerializer,
)


def _dependency_edges(version_id, max_depth, direction):
    """Recursively collect dependency edges around a version via CTE.

    direction:
      "downstream" — edges this version (transitively) uses/depends on
      "upstream"   — edges that (transitively) use this version
      "both"       — union of the two

    Returns a list of (source_version_id, target_version_id, relationship_type,
    role, depth) tuples. Edges are de-duplicated; `depth` is the shortest hop
    count at which the edge was first reached.
    """
    # Each branch seeds from the focused version and walks the FK in the
    # relevant direction, following target->source (downstream) or
    # source->target (upstream) on each recursion step.
    seeds = {
        "downstream": "dl.source_version_id = %s",
        "upstream": "dl.target_version_id = %s",
    }
    steps = {
        "downstream": "dl.source_version_id = g.tgt",
        "upstream": "dl.target_version_id = g.src",
    }
    branches = ["downstream", "upstream"] if direction == "both" else [direction]

    edges = {}
    with connection.cursor() as cursor:
        for branch in branches:
            cursor.execute(
                f"""
                WITH RECURSIVE g AS (
                    SELECT dl.source_version_id AS src, dl.target_version_id AS tgt,
                           dl.relationship_type, dl.role, 1 AS depth
                    FROM trackables_dependencylink dl
                    WHERE {seeds[branch]}

                    UNION ALL

                    SELECT dl.source_version_id, dl.target_version_id,
                           dl.relationship_type, dl.role, g.depth + 1
                    FROM trackables_dependencylink dl
                    INNER JOIN g ON {steps[branch]}
                    WHERE g.depth < %s
                )
                SELECT src, tgt, relationship_type, role, MIN(depth) AS depth
                FROM g
                GROUP BY src, tgt, relationship_type, role
                """,
                [version_id, max_depth],
            )
            for src, tgt, rel_type, role, depth in cursor.fetchall():
                key = (src, tgt, rel_type)
                if key not in edges or depth < edges[key][4]:
                    edges[key] = (src, tgt, rel_type, role, depth)
    return list(edges.values())


class DependencyLinkPagination(PageNumberPagination):
    """Pagination for dependency link lists."""

    page_size = 50
    page_size_query_param = 'page_size'
    max_page_size = 500


class DependencyLinkViewSet(viewsets.ModelViewSet):
    """
    API for generic version dependencies.

    Allows querying and creating "uses" relationships between any version types
    (assets, containers, etc.). Supports impact analysis and dependency graphs.

    ## Query Parameters

    - `relationship_type` — Filter by type (uses, depends_on, imports, references, extends)
    - `role` — Filter by role (texture_package, material_library, etc.)
    - `source_version_id` — Filter by source version
    - `target_version_id` — Filter by target version
    - `page_size` — Results per page (default 50, max 500)
    """

    permission_classes = [permissions.IsAuthenticated]
    pagination_class = DependencyLinkPagination
    filter_backends = [DjangoFilterBackend, filters.SearchFilter]
    filterset_fields = [
        'relationship_type',
        'role',
        'source_version_id',
        'target_version_id',
    ]
    search_fields = ['role']

    def get_queryset(self):
        """Optimize queries based on action."""
        queryset = DependencyLink.objects.all().select_related(
            "source_version__entity",
            "target_version__entity",
        )
        return queryset

    def get_serializer_class(self):
        """Use minimal serializer for list/filter views (faster)."""
        if self.action == 'list':
            return DependencyLinkMinimalSerializer
        return DependencyLinkSerializer

    @action(detail=False, methods=["get"])
    def what_uses(self, request):
        """Get all versions that use a specific version (impact analysis).

        Query: /api/dependency-links/what_uses/?version_id=123&page=1&page_size=50
        """
        version_id = request.query_params.get("version_id")
        if not version_id:
            return Response(
                {"error": "version_id required"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        links = self.get_queryset().filter(target_version_id=version_id)

        # Apply pagination
        page = self.paginate_queryset(links)
        if page is not None:
            serializer = DependencyLinkSerializer(page, many=True)
            return self.get_paginated_response({
                "version_id": version_id,
                "used_by": serializer.data,
            })

        serializer = DependencyLinkSerializer(links, many=True)
        return Response({
            "version_id": version_id,
            "used_by": serializer.data,
        })

    @action(detail=False, methods=["get"])
    def what_it_uses(self, request):
        """Get all versions a specific version uses.

        Query: /api/dependency-links/what_it_uses/?version_id=123&page=1&page_size=50
        """
        version_id = request.query_params.get("version_id")
        if not version_id:
            return Response(
                {"error": "version_id required"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        links = self.get_queryset().filter(source_version_id=version_id)

        # Apply pagination
        page = self.paginate_queryset(links)
        if page is not None:
            serializer = DependencyLinkSerializer(page, many=True)
            return self.get_paginated_response({
                "version_id": version_id,
                "uses": serializer.data,
            })

        serializer = DependencyLinkSerializer(links, many=True)
        return Response({
            "version_id": version_id,
            "uses": serializer.data,
        })

    @action(detail=False, methods=["get"])
    def dependency_graph(self, request):
        """Get full dependency graph for a version (recursive).

        Query: /api/dependency-links/dependency_graph/?version_id=123&max_depth=5
        """
        version_id = request.query_params.get("version_id")
        max_depth = int(request.query_params.get("max_depth", 10))

        if not version_id:
            return Response(
                {"error": "version_id required"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        version = get_object_or_404(Version, pk=version_id)

        # Get all links for this version
        direct_links = self.get_queryset().filter(source_version=version)

        # Build nested response
        dependencies = []
        for link in direct_links:
            dependencies.append(
                {
                    "target": {
                        "id": link.target_version.id,
                        "entity_id": link.target_version.entity.id,
                        "entity_name": link.target_version.entity.name,
                        "entity_type": link.target_version.entity.entity_type,
                        "version": link.target_version.version_number,
                    },
                    "relationship_type": link.relationship_type,
                    "role": link.role,
                }
            )

        return Response(
            {
                "source": {
                    "id": version.id,
                    "entity_id": version.entity.id,
                    "entity_name": version.entity.name,
                    "entity_type": version.entity.entity_type,
                    "version": version.version_number,
                },
                "direct_dependencies": dependencies,
                "total": len(dependencies),
            }
        )

    @action(detail=False, methods=["get"])
    def graph(self, request):
        """Flat {nodes, edges} dependency graph for client-side layout (xyflow).

        Query: /api/dependency-links/graph/?version_id=123
                 &direction=downstream|upstream|both&max_depth=10

        Unlike `dependency_graph` (direct deps, nested), this walks the
        transitive closure and returns a node/edge list ready for a graph view.
        """
        version_id = request.query_params.get("version_id")
        if not version_id:
            return Response(
                {"error": "version_id required"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        direction = request.query_params.get("direction", "downstream")
        if direction not in ("downstream", "upstream", "both"):
            return Response(
                {"error": "direction must be downstream, upstream, or both"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        max_depth = min(int(request.query_params.get("max_depth", 10)), 25)

        root = get_object_or_404(Version, pk=version_id)
        edge_rows = _dependency_edges(root.id, max_depth, direction)

        edges = [
            {
                "id": f"v{src}-v{tgt}-{rel_type}",
                "source": str(src),
                "target": str(tgt),
                "relationship_type": rel_type,
                "role": role,
            }
            for src, tgt, rel_type, role, _depth in edge_rows
        ]

        # Resolve every version touched by an edge (plus the root) in one query.
        version_ids = {root.id}
        for src, tgt, *_ in edge_rows:
            version_ids.add(src)
            version_ids.add(tgt)
        # Direction-aware count of each node's *direct* neighbors, so the client
        # can show an "expand (+N)" affordance on collapsed nodes without fetching
        # them. Downstream counts outgoing edges; upstream incoming; both, either.
        def _degree(field):
            return dict(
                DependencyLink.objects.filter(**{f"{field}_id__in": version_ids})
                .values(f"{field}_id")
                .annotate(c=Count("id"))
                .values_list(f"{field}_id", "c")
            )

        out_deg = _degree("source_version") if direction in ("downstream", "both") else {}
        in_deg = _degree("target_version") if direction in ("upstream", "both") else {}

        def _child_count(vid):
            return out_deg.get(vid, 0) + in_deg.get(vid, 0)

        versions = Version.objects.filter(id__in=version_ids).select_related("entity")
        nodes = [
            {
                "id": str(v.id),
                "version_id": v.id,
                "entity_id": v.entity.id,
                "entity_name": v.entity.name,
                "entity_type": v.entity.entity_type,
                "version_number": v.version_number,
                "child_count": _child_count(v.id),
            }
            for v in versions
        ]

        truncated = any(depth >= max_depth for *_, depth in edge_rows)

        return Response(
            {
                "root": str(root.id),
                "direction": direction,
                "nodes": nodes,
                "edges": edges,
                "truncated": truncated,
            }
        )

    @action(detail=False, methods=["post"])
    def create_link(self, request):
        """Create a dependency link between two versions.

        POST /api/dependency-links/create_link/
        {
            "source_version_id": 123,
            "target_version_id": 456,
            "relationship_type": "uses",
            "role": "material"
        }
        """
        source_id = request.data.get("source_version_id")
        target_id = request.data.get("target_version_id")
        relationship_type = request.data.get("relationship_type", "uses")
        role = request.data.get("role", "")

        if not source_id or not target_id:
            return Response(
                {"error": "source_version_id and target_version_id required"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        source_version = get_object_or_404(Version, pk=source_id)
        target_version = get_object_or_404(Version, pk=target_id)

        # Prevent self-references
        if source_version.entity_id == target_version.entity_id:
            return Response(
                {"error": "Cannot create self-referential dependency"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        link, created = DependencyLink.objects.get_or_create(
            source_version=source_version,
            target_version=target_version,
            relationship_type=relationship_type,
            defaults={"role": role},
        )

        serializer = self.get_serializer(link)
        return Response(
            serializer.data,
            status=status.HTTP_201_CREATED if created else status.HTTP_200_OK,
        )
