"""API endpoints for version dependencies."""

from rest_framework import viewsets, status, permissions, filters
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.pagination import PageNumberPagination
from django.shortcuts import get_object_or_404
from django_filters.rest_framework import DjangoFilterBackend

from .models import DependencyLink, Version
from .serializers_container_links import (
    DependencyLinkSerializer,
    DependencyLinkMinimalSerializer,
)


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
