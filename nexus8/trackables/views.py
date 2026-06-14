from rest_framework import viewsets, status, permissions, serializers
from rest_framework.decorators import action
from rest_framework.response import Response
from django.db import transaction
from django.shortcuts import get_object_or_404
from asgiref.sync import async_to_sync
from django_filters import rest_framework as filters
from django_filters.rest_framework import DjangoFilterBackend
from rest_framework.filters import SearchFilter, OrderingFilter

from .models import Container, Version, ContainerVersion, ContainerReference, VersionedEntity, Symlink
from .serializers import (
    ContainerBasicSerializer,
    ContainerDetailSerializer,
    ContainerTreeSerializer,
    ContainerMoveSerializer,
    ContainerBulkMoveSerializer,
    ContainerWithReferencesSerializer,
    ContainerVersionSerializer,
    ContainerReferenceSerializer,
    VersionedEntitySerializer,
    SymlinkSerializer
)


class ContainerViewSet(viewsets.ModelViewSet):
    """
    ViewSet for Container operations with hierarchy support.
    
    Provides CRUD operations plus specialized actions for:
    - Tree navigation
    - Container moving
    - Hierarchy statistics
    - Bulk operations
    """
    queryset = Container.objects.all().select_related('parent_container').prefetch_related('child_containers')
    permission_classes = [permissions.IsAuthenticated]
    filter_backends = [DjangoFilterBackend, SearchFilter, OrderingFilter]
    filterset_fields = ['parent_container', 'depth']
    search_fields = ['code', 'name']
    ordering_fields = ['code', 'name', 'created_at', 'depth']
    ordering = ['path']  # Default ordering by materialized path
    
    def get_serializer_class(self):
        """Return appropriate serializer based on action."""
        if self.action == 'list':
            return ContainerBasicSerializer
        elif self.action in ['tree', 'subtree']:
            return ContainerTreeSerializer
        elif self.action == 'with_references':
            return ContainerWithReferencesSerializer
        else:
            return ContainerDetailSerializer
    
    def get_queryset(self):
        """Customize queryset based on query parameters."""
        queryset = super().get_queryset()
        
        # Filter by root containers
        if self.request.query_params.get('roots_only'):
            queryset = queryset.filter(parent_container__isnull=True)
        
        # Filter by depth range
        min_depth = self.request.query_params.get('min_depth')
        max_depth = self.request.query_params.get('max_depth')
        
        if min_depth is not None:
            queryset = queryset.filter(depth__gte=min_depth)
        if max_depth is not None:
            queryset = queryset.filter(depth__lte=max_depth)
        
        # Filter by ancestor
        ancestor_id = self.request.query_params.get('ancestor_id')
        if ancestor_id:
            try:
                ancestor = Container.objects.get(id=ancestor_id)
                if hasattr(ancestor, 'path') and ancestor.path:
                    # Use materialized path for fast filtering
                    queryset = queryset.filter(
                        path__startswith=ancestor.path,
                        depth__gt=ancestor.depth
                    )
                else:
                    # Fallback to manual descendant lookup
                    descendants = Container.objects.get_descendants(ancestor)
                    queryset = queryset.filter(id__in=[d.id for d in descendants])
            except Container.DoesNotExist:
                queryset = queryset.none()
        
        return queryset
    
    @action(detail=False, methods=['get'])
    def roots(self, request):
        """Get all root containers with their statistics."""
        roots_with_stats = Container.objects.get_hierarchy_roots_with_stats()
        
        data = []
        for root_stat in roots_with_stats:
            container_data = ContainerBasicSerializer(root_stat['container']).data
            container_data['hierarchy_stats'] = root_stat['stats']
            data.append(container_data)
        
        return Response(data)
    
    @action(detail=False, methods=['get'])
    def tree(self, request):
        """Get complete tree structure."""
        max_depth = int(request.query_params.get('max_depth', 5))
        root_containers = Container.objects.root_containers()
        
        serializer = ContainerTreeSerializer(
            root_containers, 
            many=True, 
            context={'max_depth': max_depth, 'request': request}
        )
        
        return Response(serializer.data)
    
    @action(detail=True, methods=['get'])
    def subtree(self, request, pk=None):
        """Get subtree starting from specific container."""
        container = self.get_object()
        max_depth = int(request.query_params.get('max_depth', 3))
        
        # Adjust max_depth relative to container's depth
        adjusted_max_depth = container.depth + max_depth
        
        serializer = ContainerTreeSerializer(
            container, 
            context={'max_depth': adjusted_max_depth, 'request': request}
        )
        
        return Response(serializer.data)
    
    @action(detail=True, methods=['get'])
    def ancestors(self, request, pk=None):
        """Get all ancestor containers."""
        container = self.get_object()
        
        if hasattr(container, 'path') and container.path:
            ancestors = container.get_ancestors_by_path()
        else:
            ancestors = Container.objects.get_ancestors(container)
        
        serializer = ContainerBasicSerializer(ancestors, many=True)
        return Response(serializer.data)
    
    @action(detail=True, methods=['get'])
    def descendants(self, request, pk=None):
        """Get all descendant containers."""
        container = self.get_object()
        include_self = request.query_params.get('include_self', 'false').lower() == 'true'
        max_depth = request.query_params.get('max_depth')
        
        if hasattr(container, 'path') and container.path:
            descendants = list(container.get_descendants_by_path())
            if include_self:
                descendants.insert(0, container)
        else:
            descendants = Container.objects.get_descendants(container, include_self=include_self)
        
        # Apply depth filter if specified
        if max_depth is not None:
            max_depth = int(max_depth)
            descendants = [d for d in descendants if d.depth <= container.depth + max_depth]
        
        serializer = ContainerBasicSerializer(descendants, many=True)
        return Response(serializer.data)
    
    @action(detail=True, methods=['get'])
    def children(self, request, pk=None):
        """Get direct children of container."""
        container = self.get_object()
        children = container.child_containers.all()
        
        serializer = ContainerBasicSerializer(children, many=True)
        return Response(serializer.data)
    
    @action(detail=True, methods=['get'])
    def siblings(self, request, pk=None):
        """Get sibling containers."""
        container = self.get_object()
        
        if hasattr(container, 'path') and container.path:
            siblings = container.get_siblings_by_path()
        else:
            if container.parent_container:
                siblings = container.parent_container.child_containers.exclude(id=container.id)
            else:
                siblings = Container.objects.filter(parent_container__isnull=True).exclude(id=container.id)
        
        serializer = ContainerBasicSerializer(siblings, many=True)
        return Response(serializer.data)
    
    @action(detail=True, methods=['get'])
    def path(self, request, pk=None):
        """Get the full path from root to container."""
        container = self.get_object()
        path_containers = []
        
        if hasattr(container, 'path') and container.path:
            ancestors = container.get_ancestors_by_path()
            path_containers = list(ancestors) + [container]
        else:
            current = container
            while current:
                path_containers.insert(0, current)
                current = current.parent_container
        
        serializer = ContainerBasicSerializer(path_containers, many=True)
        return Response({
            'path': serializer.data,
            'depth': container.depth,
            'path_string': ' / '.join([c.code for c in path_containers])
        })
    
    @action(detail=True, methods=['get'])
    def statistics(self, request, pk=None):
        """Get detailed hierarchy statistics for container."""
        container = self.get_object()
        
        if hasattr(container, 'path') and container.path:
            stats = container.get_hierarchy_statistics_by_path()
        else:
            descendants = Container.objects.get_descendants(container, include_self=True)
            stats = {
                'total_descendants': len(descendants) - 1,
                'max_descendant_depth': max([c.get_hierarchy_level() for c in descendants]) if descendants else container.depth,
                'leaf_containers': len([c for c in descendants if not c.child_containers.exists()])
            }
        
        # Add version statistics (single aggregate over the subtree)
        stats.update({
            'version_count': container.versions.count(),
            'total_descendant_versions': Version.objects.filter(
                entity__path__startswith=container.path,
                entity__entity_type='container',
            ).count(),
            'container_depth': container.depth,
            'direct_children': container.child_containers.count()
        })
        
        return Response(stats)
    
    @action(detail=True, methods=['post'])
    def move(self, request, pk=None):
        """Move container to new parent."""
        container = self.get_object()
        serializer = ContainerMoveSerializer(data={
            'container_id': container.id,
            **request.data
        })
        
        if serializer.is_valid():
            validated_data = serializer.validated_data
            new_parent = validated_data.get('new_parent_id')
            method = validated_data.get('method', 'auto')
            
            try:
                with transaction.atomic():
                    # Simple move (fallback if new methods not available)
                    container.parent_container = new_parent
                    container.save()
                    result = {
                        'containers_moved': 1,
                        'time_taken': 0.01,
                        'method': 'simple'
                    }
                
                return Response({
                    'message': 'Container moved successfully',
                    'container': ContainerDetailSerializer(container).data,
                    'move_statistics': result
                })
            
            except Exception as e:
                return Response(
                    {'error': f'Move failed: {str(e)}'}, 
                    status=status.HTTP_400_BAD_REQUEST
                )
        
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
    
    @action(detail=True, methods=['get'])
    def with_references(self, request, pk=None):
        """Get container with all its references."""
        container = self.get_object()
        serializer = ContainerWithReferencesSerializer(container, context={'request': request})
        return Response(serializer.data)
    
    @action(detail=True, methods=['get'])
    def move_impact(self, request, pk=None):
        """Analyze the impact of moving this container."""
        container = self.get_object()
        new_parent_id = request.query_params.get('new_parent_id')
        
        new_parent = None
        if new_parent_id:
            new_parent = get_object_or_404(Container, id=new_parent_id)
        
        # Basic impact analysis
        descendants = Container.objects.get_descendants(container)
        impact = {
            'containers_affected': len(descendants) + 1,
            'current_depth': container.depth,
            'new_depth': new_parent.depth + 1 if new_parent else 0,
            'descendants_count': len(descendants),
            'warnings': []
        }
        impact['depth_change'] = impact['new_depth'] - impact['current_depth']
        
        # Check if move is valid
        can_move = True
        reason = "Move is valid"
        
        if new_parent:
            if new_parent == container:
                can_move = False
                reason = "Cannot move container to itself"
            elif new_parent == container.parent_container:
                can_move = False
                reason = "Container is already a child of the target parent"
            elif container.is_ancestor_of(new_parent):
                can_move = False
                reason = "Cannot move container to its own descendant"
        
        return Response({
            'can_move': can_move,
            'reason': reason,
            'impact': impact
        })
    
    @action(detail=False, methods=['post'])
    def rebuild_paths(self, request):
        """Rebuild materialized paths for all containers."""
        if not request.user.is_staff:
            return Response(
                {'error': 'Only staff users can rebuild paths'}, 
                status=status.HTTP_403_FORBIDDEN
            )
        
        try:
            processed = Container.objects.rebuild_materialized_paths()
            return Response({
                'message': 'Materialized paths rebuilt successfully',
                'containers_processed': processed
            })
        except Exception as e:
            return Response(
                {'error': f'Path rebuild failed: {str(e)}'}, 
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )
    
    def destroy(self, request, *args, **kwargs):
        """Override destroy to handle hierarchy constraints."""
        container = self.get_object()
        
        # Check if container has children
        if container.child_containers.exists():
            return Response(
                {'error': 'Cannot delete container with children. Move or delete children first.'}, 
                status=status.HTTP_400_BAD_REQUEST
            )
        
        # Check if container has versions
        if container.versions.exists():
            cascade = request.query_params.get('cascade', 'false').lower() == 'true'
            if not cascade:
                return Response(
                    {'error': 'Container has versions. Use cascade=true to delete anyway.'}, 
                    status=status.HTTP_400_BAD_REQUEST
                )
        
        return super().destroy(request, *args, **kwargs)


class VersionViewSet(viewsets.ModelViewSet):
    """
    ViewSet for Version operations with JSON field querying.
    
    Provides CRUD operations plus JSON field searches and filtering.
    """
    queryset = Version.objects.all().select_related('entity')
    permission_classes = [permissions.IsAuthenticated]
    filter_backends = [DjangoFilterBackend, SearchFilter, OrderingFilter]
    filterset_fields = ['entity', 'version_number']
    search_fields = ['entity__code', 'entity__name']
    ordering_fields = ['version_number', 'created_at']
    ordering = ['-version_number']
    
    def get_serializer_class(self):
        """Return appropriate serializer based on action."""
        # Use a simple serializer since we don't have complex Version serializers yet
        
        class VersionSerializer(serializers.ModelSerializer):
            entity_code = serializers.CharField(source='entity.code', read_only=True)
            entity_name = serializers.CharField(source='entity.name', read_only=True)
            
            class Meta:
                model = Version
                fields = ['id', 'entity', 'entity_code', 'entity_name', 'version_number', 'data', 'created_at', 'updated_at']
                read_only_fields = ['created_at', 'updated_at']
        
        return VersionSerializer
    
    def get_queryset(self):
        """Customize queryset based on query parameters."""
        queryset = super().get_queryset()
        
        # Filter by JSON field values
        status = self.request.query_params.get('status')
        if status:
            queryset = queryset.filter(data__status=status)
        
        author = self.request.query_params.get('author')
        if author:
            queryset = queryset.filter(data__metadata__author=author)
        
        # Filter by entity type
        entity_type = self.request.query_params.get('entity_type')
        if entity_type:
            queryset = queryset.filter(entity__entity_type=entity_type)

        return queryset
    
    @action(detail=False, methods=['get'])
    def by_status(self, request):
        """Get versions filtered by status in JSON data."""
        status = request.query_params.get('status')
        if not status:
            return Response({'error': 'Status parameter required'}, status=400)
        
        versions = Version.objects.by_status(status)
        serializer = self.get_serializer(versions, many=True)
        return Response(serializer.data)
    
    @action(detail=False, methods=['get'])
    def json_stats(self, request):
        """Get aggregate statistics from JSON fields."""
        stats = Version.objects.aggregate_json_stats()
        return Response(stats)


class ContainerVersionViewSet(viewsets.ModelViewSet):
    """
    ViewSet for ContainerVersion operations with hierarchy support.
    
    Provides CRUD operations plus version hierarchy navigation.
    """
    queryset = ContainerVersion.objects.all().select_related('entity', 'parent_container_version')
    permission_classes = [permissions.IsAuthenticated]
    filter_backends = [DjangoFilterBackend, SearchFilter, OrderingFilter]
    filterset_fields = ['entity', 'parent_container_version']
    search_fields = ['entity__code', 'entity__name']
    ordering_fields = ['version_number', 'created_at']
    ordering = ['-version_number']
    
    def get_queryset(self):
        """Optimize queryset for different actions to prevent N+1 queries."""
        queryset = super().get_queryset()
        
        # Always select related data since the serializer accesses these fields
        queryset = queryset.select_related('entity', 'parent_container_version')
        
        # For list views, add prefetch_related to avoid N+1 queries on reference counts
        if self.action == 'list':
            # Prefetch references to avoid N+1 queries in get_reference_count()
            queryset = queryset.prefetch_related('references')
            
            # Also prefetch parent container version's entity for parent_version_display
            queryset = queryset.select_related('parent_container_version__entity')
        
        return queryset
    
    serializer_class = ContainerVersionSerializer
    
    @action(detail=True, methods=['get'])
    def references(self, request, pk=None):
        """Get all references for this container version."""
        container_version = self.get_object()
        references = container_version.references.all()
        serializer = ContainerReferenceSerializer(references, many=True)
        return Response(serializer.data)
    
    @action(detail=True, methods=['get'])
    def hierarchy_path(self, request, pk=None):
        """Get version hierarchy path."""
        container_version = self.get_object()
        path = container_version.get_version_hierarchy_path()
        return Response({'hierarchy_path': path})
    
    @action(detail=True, methods=['get'])
    def dependencies(self, request, pk=None):
        """Get dependency chain for this version."""
        container_version = self.get_object()
        
        # Get dependency information using the CTE method if available
        if hasattr(ContainerVersion.objects, 'get_dependency_chain_cte'):
            dependencies = ContainerVersion.objects.get_dependency_chain_cte(container_version, direction='up')
            dependents = ContainerVersion.objects.get_dependency_chain_cte(container_version, direction='down')
        else:
            # Fallback to simple parent/child relationships
            dependencies = []
            dependents = []
            
            current = container_version.parent_container_version
            depth = 1
            while current and depth <= 10:
                container = current.get_container()
                dependencies.append({
                    'id': current.id,
                    'container_code': container.code,
                    'version_number': current.version_number,
                    'depth': depth
                })
                current = current.parent_container_version
                depth += 1
            
            for child in container_version.child_container_versions.all():
                container = child.get_container()
                dependents.append({
                    'id': child.id,
                    'container_code': container.code,
                    'version_number': child.version_number,
                    'depth': 1
                })
        
        return Response({
            'dependencies': dependencies,
            'dependents': dependents
        })


class ContainerReferenceViewSet(viewsets.ModelViewSet):
    """
    ViewSet for ContainerReference operations.
    
    Provides CRUD operations for container references with symlink resolution.
    """
    queryset = ContainerReference.objects.all().select_related(
        'container_version', 'referenced_entity', 'symlink_version'
    )
    serializer_class = ContainerReferenceSerializer
    permission_classes = [permissions.IsAuthenticated]
    filter_backends = [DjangoFilterBackend, SearchFilter, OrderingFilter]
    filterset_fields = ['container_version', 'referenced_entity', 'symlink_name']
    search_fields = ['reference_name', 'referenced_entity__code']
    ordering_fields = ['reference_name', 'created_at']
    ordering = ['reference_name']
    
    def get_queryset(self):
        """Optimize queryset for different actions to prevent N+1 queries."""
        queryset = super().get_queryset()
        
        # Always select related data since the serializer accesses these fields
        queryset = queryset.select_related(
            'container_version', 'referenced_entity', 'symlink_version'
        )
        
        # For list views, add prefetch_related to avoid N+1 queries in is_current check
        if self.action == 'list':
            # Prefetch symlinks for referenced entities to avoid N+1 queries in get_is_current()
            queryset = queryset.prefetch_related('referenced_entity__symlinks')
        
        return queryset
    
    @action(detail=False, methods=['get'])
    def outdated(self, request):
        """Get references where symlink has changed since creation."""
        # Optimize by prefetching related data to avoid N+1 queries
        queryset = self.get_queryset().select_related(
            'referenced_entity', 'symlink_version'
        ).prefetch_related('referenced_entity__symlinks')
        
        outdated_refs = []
        
        for ref in queryset:
            try:
                current_version = ref.referenced_entity.resolve_symlink(ref.symlink_name)
                if current_version.id != ref.symlink_version.id:
                    outdated_refs.append(ref)
            except:
                # Broken symlinks are also considered outdated
                outdated_refs.append(ref)
        
        serializer = self.get_serializer(outdated_refs, many=True)
        return Response(serializer.data)
    
    @action(detail=False, methods=['get'])
    def broken(self, request):
        """Get references with broken symlinks."""
        # Optimize by prefetching related data to avoid N+1 queries
        queryset = self.get_queryset().select_related(
            'referenced_entity'
        ).prefetch_related('referenced_entity__symlinks')
        
        broken_refs = []
        
        for ref in queryset:
            try:
                ref.referenced_entity.resolve_symlink(ref.symlink_name)
            except:
                broken_refs.append(ref)
        
        serializer = self.get_serializer(broken_refs, many=True)
        return Response(serializer.data)


class VersionedEntityViewSet(viewsets.ModelViewSet):
    """
    ViewSet for VersionedEntity operations.
    
    Provides CRUD operations for versioned entities with version management.
    """
    queryset = VersionedEntity.objects.all().prefetch_related('versions', 'symlinks')
    permission_classes = [permissions.IsAuthenticated]
    filter_backends = [DjangoFilterBackend, SearchFilter, OrderingFilter]
    search_fields = ['code', 'name']
    ordering_fields = ['code', 'name', 'created_at']
    ordering = ['code']
    
    serializer_class = VersionedEntitySerializer
    
    @action(detail=True, methods=['get'])
    def versions(self, request, pk=None):
        """Get all versions for this entity."""
        entity = self.get_object()
        versions = entity.versions.all()
        
        # Use the Version serializer
        
        class SimpleVersionSerializer(serializers.ModelSerializer):
            class Meta:
                model = Version
                fields = ['id', 'version_number', 'data', 'created_at']
        
        serializer = SimpleVersionSerializer(versions, many=True)
        return Response(serializer.data)
    
    @action(detail=True, methods=['get'])
    def symlinks(self, request, pk=None):
        """Get all symlinks for this entity."""
        entity = self.get_object()
        # Optimize query to avoid N+1 when accessing version.version_number
        symlinks = entity.symlinks.select_related('version').all()
        
        
        class SimpleSymlinkSerializer(serializers.ModelSerializer):
            version_number = serializers.IntegerField(source='version.version_number', read_only=True)
            
            class Meta:
                model = Symlink
                fields = ['id', 'name', 'version', 'version_number']
        
        serializer = SimpleSymlinkSerializer(symlinks, many=True)
        return Response(serializer.data)


class SymlinkViewSet(viewsets.ModelViewSet):
    """
    ViewSet for Symlink operations.
    
    Provides CRUD operations for symlinks with resolution capabilities.
    """
    queryset = Symlink.objects.all()
    permission_classes = [permissions.IsAuthenticated]
    filter_backends = [DjangoFilterBackend, SearchFilter, OrderingFilter]
    filterset_fields = ['entity', 'name']
    search_fields = ['entity__code', 'name']
    ordering_fields = ['name', 'entity__code']
    ordering = ['entity__code', 'name']
    
    def get_queryset(self):
        """Optimize queryset for different actions to prevent N+1 queries."""
        queryset = super().get_queryset()
        
        # Always select related data since the serializer accesses these fields
        # This is critical to prevent N+1 queries when serializing lists
        queryset = queryset.select_related('entity', 'version')
        
        # Additional optimization for list views
        if self.action == 'list':
            # Only select the fields we actually need to reduce memory usage
            # Note: Symlink doesn't inherit from Trackable, so no created_at/updated_at
            queryset = queryset.only(
                'id', 'name', 'entity', 'version',
                'entity__id', 'entity__code', 'entity__name',
                'version__id', 'version__version_number'
            )
        
        return queryset
    
    serializer_class = SymlinkSerializer
    
    @action(detail=False, methods=['get'])
    def by_name(self, request):
        """Get all symlinks with specific name across all entities."""
        name = request.query_params.get('name')
        if not name:
            return Response({'error': 'Name parameter required'}, status=400)
        
        symlinks = self.get_queryset().filter(name=name)
        serializer = self.get_serializer(symlinks, many=True)
        return Response(serializer.data)
    
    @action(detail=True, methods=['post'])
    def resolve(self, request, pk=None):
        """Resolve symlink and return current version data."""
        symlink = self.get_object()
        
        try:
            current_version = symlink.entity.resolve_symlink(symlink.name)
            
            class ResolvedVersionSerializer(serializers.ModelSerializer):
                class Meta:
                    model = Version
                    fields = ['id', 'version_number', 'data', 'created_at']
            
            serializer = ResolvedVersionSerializer(current_version)
            return Response({
                'symlink': self.get_serializer(symlink).data,
                'resolved_version': serializer.data
            })
        
        except Exception as e:
            return Response({
                'error': f'Failed to resolve symlink: {str(e)}'
            }, status=400)


class UnifiedVersionedEntityViewSet(viewsets.ModelViewSet):
    """
    ViewSet for unified VersionedEntity and all derived models.
    
    Lists all VersionedEntity instances including derived models like:
    - VersionedEntity (base)
    - MediaAsset 
    - Container
    
    Provides a unified interface to see all versioned entities in the system
    with polymorphic field handling for derived model types.
    """
    permission_classes = [permissions.IsAuthenticated]
    filter_backends = [DjangoFilterBackend, SearchFilter, OrderingFilter]
    search_fields = ['code', 'name', 'description']
    ordering_fields = ['code', 'name', 'created_at', 'updated_at']
    ordering = ['code']
    
    def get_queryset(self):
        """
        Get all VersionedEntity instances across every entity type.

        Single-table design: one query returns every type; from_db() swaps
        each row to its registered proxy class (MediaAsset, Container, ...).
        """
        from .models import VersionedEntity

        return VersionedEntity.objects.all().prefetch_related('versions', 'symlinks')
    
    def get_serializer_class(self):
        """Return the unified serializer for all VersionedEntity types."""
        from .serializers import UnifiedVersionedEntitySerializer
        return UnifiedVersionedEntitySerializer
    
    @action(detail=False, methods=['get'])
    def summary(self, request):
        """Get summary statistics for all versioned entity types."""
        from django.db.models import Count
        from .models import VersionedEntity, ENTITY_TYPE_REGISTRY

        counts = dict(
            VersionedEntity.objects.values_list('entity_type').annotate(Count('id'))
        )
        by_type = {
            'versioned_entity': counts.pop('entity', 0),
            **{key: counts.pop(key, 0) for key in ENTITY_TYPE_REGISTRY},
            **counts,  # any unregistered types still show up
        }
        return Response({
            'total_count': sum(by_type.values()),
            'by_type': by_type,
            'types_available': ['versioned_entity', *ENTITY_TYPE_REGISTRY],
        })

    @action(detail=False, methods=['get'])
    def by_type(self, request):
        """Filter results by model type."""
        model_type = request.query_params.get('type', '').lower()

        if model_type:
            entity_type = 'entity' if model_type == 'versioned_entity' else model_type
            queryset = self.get_queryset().filter(entity_type=entity_type)
        else:
            # Default to all types
            queryset = self.get_queryset()
        
        # Apply pagination
        page = self.paginate_queryset(queryset)
        if page is not None:
            serializer = self.get_serializer(page, many=True)
            return self.get_paginated_response(serializer.data)
        
        serializer = self.get_serializer(queryset, many=True)
        return Response(serializer.data)


class UnifiedVersionViewSet(viewsets.ModelViewSet):
    """
    ViewSet for unified Version and all derived models.
    
    Lists all Version instances including derived models like:
    - Version (base)
    - ContainerVersion
    
    Provides a unified interface to see all versions in the system
    with polymorphic field handling for derived model types.
    """
    permission_classes = [permissions.IsAuthenticated]
    filter_backends = [DjangoFilterBackend, SearchFilter, OrderingFilter]
    filterset_fields = ['entity', 'version_number']
    search_fields = ['entity__code', 'entity__name', 'data']
    ordering_fields = ['entity__code', 'version_number', 'created_at', 'updated_at']
    ordering = ['-version_number', 'entity__code']
    
    def get_queryset(self):
        """
        Get all Version instances as the base queryset.
        
        For filtering and pagination to work, we return the base Version queryset.
        The polymorphic behavior is handled in the list() method.
        """
        from .models import Version
        
        return Version.objects.select_related('entity').all()
    
    def get_serializer_class(self):
        """Return the unified serializer for all Version types."""
        from .serializers import UnifiedVersionSerializer
        return UnifiedVersionSerializer
    
    def list(self, request, *args, **kwargs):
        """
        Custom list method to handle polymorphic Version querying.
        
        Since Version has a custom manager without select_subclasses,
        we manually combine results from all version types.
        """
        from .models import Version, ContainerVersion
        from itertools import chain

        # Get all base Version instances (excluding container versions)
        base_versions = Version.objects.exclude(
            entity__entity_type='container'
        ).select_related('entity')

        # Get all ContainerVersion instances
        container_versions = ContainerVersion.objects.select_related(
            'entity', 'parent_container_version'
        )
        
        # Apply search filtering if provided
        search = request.query_params.get('search')
        if search:
            from django.db.models import Q
            search_q = Q(entity__code__icontains=search) | Q(entity__name__icontains=search)
            base_versions = base_versions.filter(search_q)
            container_versions = container_versions.filter(search_q)
        
        # Apply entity filtering if provided
        entity_filter = request.query_params.get('entity')
        if entity_filter:
            base_versions = base_versions.filter(entity_id=entity_filter)
            container_versions = container_versions.filter(entity_id=entity_filter)
        
        # Apply version number filtering if provided
        version_number = request.query_params.get('version_number')
        if version_number:
            base_versions = base_versions.filter(version_number=version_number)
            container_versions = container_versions.filter(version_number=version_number)
        
        # Combine and convert to list for consistent ordering
        combined_versions = list(chain(base_versions, container_versions))
        
        # Sort by version_number descending, then by entity code
        combined_versions.sort(key=lambda v: (-v.version_number, v.entity.code))
        
        # Apply pagination
        page = self.paginate_queryset(combined_versions)
        if page is not None:
            serializer = self.get_serializer(page, many=True)
            return self.get_paginated_response(serializer.data)
        
        serializer = self.get_serializer(combined_versions, many=True)
        return Response(serializer.data)
    
    @action(detail=False, methods=['get'])
    def summary(self, request):
        """Get summary statistics for all version types."""
        from .models import Version, ContainerVersion
        
        # Count by model type
        total_count = Version.objects.count()
        container_version_count = ContainerVersion.objects.count()
        base_version_count = total_count - container_version_count
        
        return Response({
            'total_count': total_count,
            'by_type': {
                'version': base_version_count,
                'container_version': container_version_count,
            },
            'types_available': ['version', 'container_version']
        })
    
    @action(detail=False, methods=['get'])
    def by_type(self, request):
        """Filter results by model type."""
        model_type = request.query_params.get('type', '').lower()
        
        if model_type == 'container_version':
            from .models import ContainerVersion
            queryset = ContainerVersion.objects.all().select_related('entity', 'parent_container_version')
        elif model_type == 'version':
            # Get only base Version instances (not container versions)
            from .models import Version
            queryset = Version.objects.exclude(
                entity__entity_type='container'
            ).select_related('entity')
        else:
            # Default to all types
            queryset = self.get_queryset()
        
        # Apply pagination
        page = self.paginate_queryset(queryset)
        if page is not None:
            serializer = self.get_serializer(page, many=True)
            return self.get_paginated_response(serializer.data)
        
        serializer = self.get_serializer(queryset, many=True)
        return Response(serializer.data)
    
    @action(detail=False, methods=['get'])
    def by_entity(self, request):
        """Get versions grouped by entity with optional entity filtering."""
        entity_id = request.query_params.get('entity_id')
        entity_code = request.query_params.get('entity_code')
        
        queryset = self.get_queryset()
        
        if entity_id:
            queryset = queryset.filter(entity_id=entity_id)
        elif entity_code:
            queryset = queryset.filter(entity__code=entity_code)
        
        # Apply pagination
        page = self.paginate_queryset(queryset)
        if page is not None:
            serializer = self.get_serializer(page, many=True)
            return self.get_paginated_response(serializer.data)
        
        serializer = self.get_serializer(queryset, many=True)
        return Response(serializer.data)
    
    @action(detail=False, methods=['get'])
    def hierarchy(self, request):
        """Get container version hierarchy for ContainerVersion instances."""
        from .models import ContainerVersion
        
        # Only show ContainerVersion instances with hierarchy info
        container_versions = ContainerVersion.objects.select_related(
            'entity', 'parent_container_version'
        ).all()
        
        # Group by hierarchy level for better organization
        hierarchy_data = {}
        for cv in container_versions:
            level = cv.get_version_hierarchy_level()
            if level not in hierarchy_data:
                hierarchy_data[level] = []
            
            hierarchy_data[level].append({
                'id': cv.id,
                'entity_code': cv.entity.code,
                'version_number': cv.version_number,
                'hierarchy_level': level,
                'hierarchy_path': cv.get_version_hierarchy_path(),
                'parent_container_version': cv.parent_container_version_id,
                'created_at': cv.created_at,
            })
        
        return Response({
            'hierarchy_levels': sorted(hierarchy_data.keys()),
            'hierarchy_data': hierarchy_data,
            'total_container_versions': len(container_versions)
        })


class MediaAssetFilter(filters.FilterSet):
    """Filters for MediaAsset; payload attributes map to type_data JSON keys."""

    media_type = filters.CharFilter(field_name='type_data__media_type')
    asset_functional_type = filters.CharFilter(field_name='type_data__asset_functional_type')
    asset_structural_type = filters.CharFilter(field_name='type_data__asset_structural_type')
    production_stage = filters.CharFilter(field_name='type_data__production_stage')

    class Meta:
        from .models import MediaAsset
        model = MediaAsset
        fields = ['ai_analysis_status']


class MediaAssetViewSet(viewsets.ModelViewSet):
    """
    AI-Enhanced MediaAsset ViewSet with intelligent asset management.
    
    Provides CRUD operations plus AI-powered features:
    - Automatic AI analysis on upload
    - Semantic search across assets
    - AI-powered recommendations
    - OMC metadata auto-population
    - Quality assessment and scoring
    """
    from .models import MediaAsset
    from .serializers import MediaAssetSerializer

    queryset = MediaAsset.objects.all().prefetch_related('versions', 'symlinks')
    serializer_class = MediaAssetSerializer
    permission_classes = [permissions.IsAuthenticated]
    filter_backends = [DjangoFilterBackend, SearchFilter, OrderingFilter]

    filterset_class = MediaAssetFilter
    search_fields = [
        'code', 'name',
        'type_data__ai_generated_description',
        'type_data__ai_suggested_tags',
        'type_data__file_path',
    ]
    ordering_fields = [
        'code', 'name', 'created_at', 'ai_analysis_date',
        'type_data__ai_confidence_score', 'type_data__ai_quality_score',
    ]
    ordering = ['-created_at']

    def perform_create(self, serializer):
        """Override create to trigger AI analysis on new assets."""
        instance = serializer.save()
        
        # Trigger async AI analysis if file_path is provided
        if instance.file_path:
            # Queue AI analysis (will be processed asynchronously)
            from django.utils import timezone
            instance.ai_analysis_status = 'pending'
            instance.save()
            
            # In production, you might use Celery or similar for background processing
            # For now, we'll mark it as pending for manual processing
    
    def perform_update(self, serializer):
        """Override update to re-analyze if file_path changed."""
        instance = serializer.instance
        old_file_path = instance.file_path
        
        updated_instance = serializer.save()
        
        # If file_path changed, trigger re-analysis
        if updated_instance.file_path != old_file_path and updated_instance.file_path:
            updated_instance.ai_analysis_status = 'pending'
            updated_instance.save()

    @action(detail=True, methods=['post'])
    def analyze(self, request, pk=None):
        """
        Trigger AI analysis for a specific asset.

        POST /api/media-assets/{id}/analyze/
        Query params:
        - force: Force re-analysis even if already completed
        """
        asset = self.get_object()
        force_reanalysis = request.query_params.get('force', 'false').lower() == 'true'

        try:
            analysis_results = async_to_sync(asset.perform_ai_analysis)(force_reanalysis)
            
            if analysis_results:
                return Response({
                    'success': True,
                    'message': 'AI analysis completed successfully',
                    'analysis_results': analysis_results
                }, status=status.HTTP_200_OK)
            else:
                return Response({
                    'success': False,
                    'message': 'AI analysis could not be completed',
                    'reason': 'No file path or analysis failed'
                }, status=status.HTTP_400_BAD_REQUEST)
                
        except Exception as e:
            return Response({
                'success': False,
                'message': 'AI analysis failed',
                'error': str(e)
            }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

    @action(detail=False, methods=['get'])
    def semantic_search(self, request):
        """
        AI-powered semantic search across assets.
        
        GET /api/media-assets/semantic_search/
        Query params:
        - query: Natural language search query (required)
        - project_code: Filter by project code
        - limit: Number of results (default: 20)
        - similarity_threshold: Minimum similarity score (default: 0.7)
        """
        query = request.query_params.get('query')
        if not query:
            return Response({
                'error': 'Query parameter is required'
            }, status=status.HTTP_400_BAD_REQUEST)
        
        project_code = request.query_params.get('project_code')
        limit = int(request.query_params.get('limit', 20))
        similarity_threshold = float(request.query_params.get('similarity_threshold', 0.7))
        
        try:
            from .models import MediaAsset
            results = async_to_sync(MediaAsset.semantic_search)(
                query=query,
                project_code=project_code,
                limit=limit,
                similarity_threshold=similarity_threshold
            )
            
            # Serialize results
            serializer = self.get_serializer(results, many=True)
            
            return Response({
                'query': query,
                'results_count': len(results),
                'similarity_threshold': similarity_threshold,
                'results': serializer.data
            })
            
        except Exception as e:
            return Response({
                'error': f'Semantic search failed: {str(e)}'
            }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

    @action(detail=True, methods=['get'])
    def recommendations(self, request, pk=None):
        """
        Get AI-powered recommendations for an asset.
        
        GET /api/media-assets/{id}/recommendations/
        Query params:
        - type: Recommendation type (similar_content, usage_based, version_lineage)
        - limit: Number of recommendations (default: 10)
        """
        asset = self.get_object()
        recommendation_type = request.query_params.get('type', 'similar_content')
        limit = int(request.query_params.get('limit', 10))
        
        try:
            from .models import MediaAsset
            recommendations = async_to_sync(MediaAsset.get_recommendations)(
                asset_id=asset.id,
                recommendation_type=recommendation_type,
                limit=limit
            )
            
            # Serialize recommendations
            serializer = self.get_serializer(recommendations, many=True)
            
            return Response({
                'asset_id': asset.id,
                'asset_code': asset.code,
                'recommendation_type': recommendation_type,
                'recommendations_count': len(recommendations),
                'recommendations': serializer.data
            })
            
        except Exception as e:
            return Response({
                'error': f'Recommendations failed: {str(e)}'
            }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

    @action(detail=True, methods=['get'])
    def ai_analysis_status(self, request, pk=None):
        """
        Get AI analysis status and results for an asset.
        
        GET /api/media-assets/{id}/ai_analysis_status/
        """
        asset = self.get_object()
        
        analysis_data = asset.get_ai_analysis_results()
        
        return Response({
            'asset_id': asset.id,
            'asset_code': asset.code,
            'ai_analysis': analysis_data,
            'has_ai_analysis': asset.ai_analysis_status == 'completed',
            'can_analyze': bool(asset.file_path)
        })

    @action(detail=True, methods=['post'])
    def update_omc_metadata(self, request, pk=None):
        """
        Update OMC metadata based on AI analysis.

        POST /api/media-assets/{id}/update_omc_metadata/
        """
        asset = self.get_object()

        try:
            async_to_sync(asset.update_omc_metadata_from_ai)()
            
            return Response({
                'success': True,
                'message': 'OMC metadata updated from AI analysis',
                'asset_functional_type': asset.asset_functional_type,
                'asset_structural_type': asset.asset_structural_type
            })
            
        except Exception as e:
            return Response({
                'success': False,
                'message': 'Failed to update OMC metadata',
                'error': str(e)
            }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

    @action(detail=False, methods=['get'])
    def ai_analytics(self, request):
        """
        Get AI analytics and statistics across all assets.
        
        GET /api/media-assets/ai_analytics/
        """
        from django.db.models import Avg, Count, FloatField, Q
        from django.db.models.fields.json import KT
        from django.db.models.functions import Cast
        from .models import MediaAsset

        # AI Analysis Statistics (scores live in the type_data payload)
        analysis_stats = MediaAsset.objects.aggregate(
            total_assets=Count('id'),
            analyzed_assets=Count('id', filter=Q(ai_analysis_status='completed')),
            pending_analysis=Count('id', filter=Q(ai_analysis_status='pending')),
            failed_analysis=Count('id', filter=Q(ai_analysis_status='failed')),
            avg_confidence_score=Avg(
                Cast(KT('type_data__ai_confidence_score'), FloatField())
            ),
            avg_quality_score=Avg(
                Cast(KT('type_data__ai_quality_score'), FloatField())
            ),
        )

        # Media Type Distribution
        media_type_distribution = MediaAsset.objects.values(
            media_type=KT('type_data__media_type')
        ).annotate(
            count=Count('id'),
            analyzed_count=Count('id', filter=Q(ai_analysis_status='completed'))
        ).order_by('-count')

        # Asset Functional Type Distribution (OMC)
        omc_type_distribution = MediaAsset.objects.exclude(
            Q(type_data__asset_functional_type='') | Q(type_data__asset_functional_type__isnull=True)
        ).values(
            asset_functional_type=KT('type_data__asset_functional_type')
        ).annotate(count=Count('id')).order_by('-count')

        # Production Stage Distribution
        production_stage_distribution = MediaAsset.objects.exclude(
            Q(type_data__production_stage='') | Q(type_data__production_stage__isnull=True)
        ).values(
            production_stage=KT('type_data__production_stage')
        ).annotate(count=Count('id')).order_by('-count')
        
        return Response({
            'analysis_statistics': analysis_stats,
            'media_type_distribution': list(media_type_distribution),
            'omc_type_distribution': list(omc_type_distribution),
            'production_stage_distribution': list(production_stage_distribution),
            'ai_coverage': {
                'percentage_analyzed': (
                    analysis_stats['analyzed_assets'] / analysis_stats['total_assets'] * 100
                    if analysis_stats['total_assets'] > 0 else 0
                )
            }
        })
