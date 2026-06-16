from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import (
    ContainerViewSet,
    VersionViewSet,
    ContainerVersionViewSet,
    ContainerReferenceViewSet,
    VersionedEntityViewSet,
    SymlinkViewSet,
    UnifiedVersionedEntityViewSet,
    UnifiedVersionViewSet,
    MediaAssetViewSet,
)
from .views_container_links import DependencyLinkViewSet

# Create router for API views
router = DefaultRouter()

# Container management endpoints
router.register(r'containers', ContainerViewSet)

# Version management endpoints  
router.register(r'versions', VersionViewSet)
router.register(r'container-versions', ContainerVersionViewSet)

# Reference and symlink endpoints
router.register(r'container-references', ContainerReferenceViewSet)
router.register(r'versioned-entities', VersionedEntityViewSet)
router.register(r'symlinks', SymlinkViewSet)

# AI-Enhanced MediaAsset endpoints
router.register(r'media-assets', MediaAssetViewSet)

# Dependency and relationship endpoints
router.register(r'dependency-links', DependencyLinkViewSet, basename='dependency-link')

# Unified endpoints for all versioned entity types
router.register(r'all-versioned-entities', UnifiedVersionedEntityViewSet, basename='unified-versioned-entity')

# Unified endpoints for all version types
router.register(r'all-versions', UnifiedVersionViewSet, basename='unified-version')

from .views_library import (
    BoardDetailView,
    BoardListView,
    BoardSnapshotView,
    CollectionCreateView,
    LibrarySearchView,
    LibraryUploadView,
)
from .views_versions import (
    AssetVersionsView,
    RecommendationsView,
)
from .views_annotations import (
    AnnotationDocDetailView,
    AnnotationDocListCreateView,
    AnnotationDocSnapshotView,
    AssetMasksView,
    LibraryAssetDetailView,
    MaskSaveView,
)
from .views_projects import (
    ProjectAssignView,
    ProjectDetailView,
    ProjectListView,
)
from .views_intelligence import (
    AssetRelationsView,
    AssetSimilarView,
    ContainerTreeView,
    EntityContainerView,
    EntityDetailView,
    EntityListView,
    RelationDetailView,
    RootEntitiesView,
    SmartCollectionDetailView,
    SmartCollectionListView,
)

app_name = 'trackables'

urlpatterns = [
    # Library endpoints for the reference-platform SPA (web/)
    path('api/library/upload/', LibraryUploadView.as_view(), name='library-upload'),
    path('api/library/search/', LibrarySearchView.as_view(), name='library-search'),
    path('api/library/boards/', BoardListView.as_view(), name='library-boards'),
    path('api/library/boards/<int:pk>/', BoardDetailView.as_view(), name='library-board'),
    path('api/library/boards/<int:pk>/snapshot/', BoardSnapshotView.as_view(), name='library-board-snapshot'),
    path('api/library/collections/', CollectionCreateView.as_view(), name='library-collections'),
    # Annotator (2D tiled viewer) endpoints
    path('api/library/assets/<int:pk>/', LibraryAssetDetailView.as_view(), name='library-asset-detail'),
    path('api/library/assets/<int:pk>/mask/', MaskSaveView.as_view(), name='library-asset-mask'),
    path('api/library/assets/<int:pk>/masks/', AssetMasksView.as_view(), name='library-asset-masks'),
    path('api/library/annotations/', AnnotationDocListCreateView.as_view(), name='library-annotations'),
    path('api/library/annotations/<int:pk>/', AnnotationDocDetailView.as_view(), name='library-annotation'),
    path('api/library/annotations/<int:pk>/snapshot/', AnnotationDocSnapshotView.as_view(), name='library-annotation-snapshot'),
    path('api/library/assets/<int:pk>/similar/', AssetSimilarView.as_view(), name='library-asset-similar'),
    path('api/library/assets/<int:pk>/versions/', AssetVersionsView.as_view(), name='library-asset-versions'),
    path('api/library/recommendations/', RecommendationsView.as_view(), name='library-recommendations'),
    path('api/library/assets/<int:pk>/relations/', AssetRelationsView.as_view(), name='library-asset-relations'),
    path('api/library/relations/<int:pk>/', RelationDetailView.as_view(), name='library-relation'),
    path('api/library/projects/', ProjectListView.as_view(), name='library-projects'),
    path('api/library/projects/<str:code>/', ProjectDetailView.as_view(), name='library-project'),
    path('api/library/projects/<str:code>/assign/', ProjectAssignView.as_view(), name='library-project-assign'),
    path('api/library/entities/', EntityListView.as_view(), name='library-entities'),
    path('api/library/entities/<int:pk>/', EntityDetailView.as_view(), name='library-entity'),
    path('api/library/containers/tree/', ContainerTreeView.as_view(), name='library-container-tree'),
    path('api/library/entity-container/', EntityContainerView.as_view(), name='library-entity-container'),
    path('api/library/root-entities/', RootEntitiesView.as_view(), name='library-root-entities'),
    path('api/library/smart-collections/', SmartCollectionListView.as_view(), name='library-smart-collections'),
    path('api/library/smart-collections/<int:pk>/', SmartCollectionDetailView.as_view(), name='library-smart-collection'),
    # API endpoints
    path('api/', include(router.urls)),
]

# Complete API Endpoint Documentation:
#
# ===================
# CONTAINER ENDPOINTS
# ===================
# GET    /api/containers/                    - List all containers
# POST   /api/containers/                    - Create new container
# GET    /api/containers/{id}/               - Get container details
# PUT    /api/containers/{id}/               - Update container
# DELETE /api/containers/{id}/               - Delete container
#
# Container Custom Actions:
# GET    /api/containers/roots/              - Get root containers with stats
# GET    /api/containers/tree/               - Get complete tree structure
# GET    /api/containers/{id}/subtree/       - Get subtree from container
# GET    /api/containers/{id}/ancestors/     - Get ancestor containers
# GET    /api/containers/{id}/descendants/   - Get descendant containers
# GET    /api/containers/{id}/children/      - Get direct children
# GET    /api/containers/{id}/siblings/      - Get sibling containers
# POST   /api/containers/{id}/move/          - Move container to new parent
# POST   /api/containers/bulk_move/          - Move multiple containers
# GET    /api/containers/{id}/statistics/    - Get detailed container stats
# POST   /api/containers/rebuild_paths/      - Rebuild materialized paths
# POST   /api/containers/validate/           - Validate hierarchy integrity
#
# ================
# VERSION ENDPOINTS
# ================
# GET    /api/versions/                      - List all versions
# POST   /api/versions/                      - Create new version
# GET    /api/versions/{id}/                 - Get version details
# PUT    /api/versions/{id}/                 - Update version
# DELETE /api/versions/{id}/                 - Delete version
#
# Version Custom Actions:
# GET    /api/versions/by_status/            - Filter versions by JSON status
# GET    /api/versions/json_stats/           - Get JSON field statistics
#
# ========================
# CONTAINER VERSION ENDPOINTS
# ========================
# GET    /api/container-versions/            - List all container versions
# POST   /api/container-versions/            - Create new container version
# GET    /api/container-versions/{id}/       - Get container version details
# PUT    /api/container-versions/{id}/       - Update container version
# DELETE /api/container-versions/{id}/       - Delete container version
#
# Container Version Custom Actions:
# GET    /api/container-versions/{id}/references/      - Get version references
# GET    /api/container-versions/{id}/hierarchy_path/  - Get version hierarchy
# GET    /api/container-versions/{id}/dependencies/    - Get dependency chain
#
# ==========================
# CONTAINER REFERENCE ENDPOINTS
# ==========================
# GET    /api/container-references/          - List all container references
# POST   /api/container-references/          - Create new container reference
# GET    /api/container-references/{id}/     - Get container reference details
# PUT    /api/container-references/{id}/     - Update container reference
# DELETE /api/container-references/{id}/     - Delete container reference
#
# Container Reference Custom Actions:
# GET    /api/container-references/outdated/ - Get references with changed symlinks
# GET    /api/container-references/broken/   - Get references with broken symlinks
#
# ========================
# VERSIONED ENTITY ENDPOINTS
# ========================
# GET    /api/versioned-entities/            - List all versioned entities
# POST   /api/versioned-entities/            - Create new versioned entity
# GET    /api/versioned-entities/{id}/       - Get versioned entity details
# PUT    /api/versioned-entities/{id}/       - Update versioned entity
# DELETE /api/versioned-entities/{id}/       - Delete versioned entity
#
# Versioned Entity Custom Actions:
# GET    /api/versioned-entities/{id}/versions/  - Get all versions for entity
# GET    /api/versioned-entities/{id}/symlinks/  - Get all symlinks for entity
#
# ================
# SYMLINK ENDPOINTS
# ================
# GET    /api/symlinks/                      - List all symlinks
# POST   /api/symlinks/                      - Create new symlink
# GET    /api/symlinks/{id}/                 - Get symlink details
# PUT    /api/symlinks/{id}/                 - Update symlink
# DELETE /api/symlinks/{id}/                 - Delete symlink
#
# Symlink Custom Actions:
# GET    /api/symlinks/by_name/              - Get symlinks by name across entities
# POST   /api/symlinks/{id}/resolve/         - Resolve symlink to current version
#
# ====================================
# UNIFIED VERSIONED ENTITY ENDPOINTS
# ====================================
# GET    /api/all-versioned-entities/        - List all VersionedEntity types (polymorphic)
# POST   /api/all-versioned-entities/        - Create new versioned entity  
# GET    /api/all-versioned-entities/{id}/   - Get versioned entity details
# PUT    /api/all-versioned-entities/{id}/   - Update versioned entity
# DELETE /api/all-versioned-entities/{id}/   - Delete versioned entity
#
# Unified Custom Actions:
# GET    /api/all-versioned-entities/summary/           - Get counts by entity type
# GET    /api/all-versioned-entities/by_type/?type=X    - Filter by specific type
#
# Supported type filters:
# ?type=versioned_entity          - Base VersionedEntity instances only
# ?type=media_asset               - MediaAsset instances only  
# ?type=container                 - Container instances only
#
# Standard query parameters supported:
# ?search=text                    - Search by code, name, or description
# ?ordering=field                 - Order by field (code, name, created_at, updated_at)
# ?page=N                         - Pagination support
#
# ============================
# UNIFIED VERSION ENDPOINTS
# ============================
# GET    /api/all-versions/                   - List all Version types (polymorphic)
# POST   /api/all-versions/                   - Create new version
# GET    /api/all-versions/{id}/              - Get version details
# PUT    /api/all-versions/{id}/              - Update version
# DELETE /api/all-versions/{id}/              - Delete version
#
# Unified Version Custom Actions:
# GET    /api/all-versions/summary/           - Get counts by version type
# GET    /api/all-versions/by_type/?type=X    - Filter by specific type
# GET    /api/all-versions/by_entity/         - Get versions grouped by entity
# GET    /api/all-versions/hierarchy/         - Get ContainerVersion hierarchy view
#
# Supported type filters:
# ?type=version                   - Base Version instances only
# ?type=container_version         - ContainerVersion instances only
#
# Additional query parameters:
# ?entity_id=N                    - Filter by specific entity ID
# ?entity_code=code               - Filter by entity code
# ?entity=N                       - Filter by entity (DRF filterset)
# ?version_number=N               - Filter by version number
# GET    /api/containers/{id}/path/          - Get full path to container
# GET    /api/containers/{id}/statistics/    - Get hierarchy statistics
# POST   /api/containers/{id}/move/          - Move container to new parent
# GET    /api/containers/{id}/with_references/ - Get container with references
# GET    /api/containers/{id}/move_impact/   - Analyze move impact
# POST   /api/containers/rebuild_paths/      - Rebuild materialized paths
#
# Query Parameters:
# ?roots_only=true                 - Filter to root containers only
# ?min_depth=N                     - Filter by minimum depth
# ?max_depth=N                     - Filter by maximum depth
# ?ancestor_id=N                   - Filter descendants of specific container
# ?search=text                     - Search by code or name
# ?ordering=field                  - Order by field (code, name, created_at, depth)
# ?max_depth=N (for tree/subtree)  - Limit tree depth
# ?include_self=true (descendants) - Include container itself in results
# ?cascade=true (delete)           - Force delete with versions
