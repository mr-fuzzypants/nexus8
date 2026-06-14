"""
Container API Usage Examples
============================

This file demonstrates how to use the Container API views and admin interface.
"""

# Example API Usage (using Django REST client or curl)

# 1. List all containers
# GET /api/containers/
# Response: List of containers with basic information

# 2. Get root containers with statistics
# GET /api/containers/roots/
# Response: Root containers with hierarchy stats

# 3. Get complete tree structure (limited depth)
# GET /api/containers/tree/?max_depth=3
# Response: Nested tree structure

# 4. Get container details
# GET /api/containers/123/
# Response: Full container details with hierarchy info

# 5. Get container ancestors
# GET /api/containers/123/ancestors/
# Response: All parent containers up to root

# 6. Get container descendants  
# GET /api/containers/123/descendants/?max_depth=2
# Response: All child containers (limited depth)

# 7. Get container path
# GET /api/containers/123/path/
# Response: Full path from root to container

# 8. Get hierarchy statistics
# GET /api/containers/123/statistics/
# Response: Detailed hierarchy metrics

# 9. Move container
# POST /api/containers/123/move/
# {
#     "new_parent_id": 456,  # or null for root
#     "method": "auto"       # auto, optimized, cte, simple
# }

# 10. Analyze move impact
# GET /api/containers/123/move_impact/?new_parent_id=456
# Response: Impact analysis without performing move

# 11. Search containers
# GET /api/containers/?search=character&depth=2
# Response: Containers matching search at specific depth

# 12. Filter by ancestor
# GET /api/containers/?ancestor_id=123
# Response: All descendants of specified container

# Python API Usage Examples
from trackables.models import Container
from trackables.serializers import ContainerDetailSerializer, ContainerTreeSerializer

def example_usage():
    """Example of using Container model and serializers in Python."""
    
    # 1. Create a container hierarchy
    studio = Container.objects.create(code="STUDIO", name="Animation Studio")
    project = Container.objects.create(
        code="PROJ_A", 
        name="Project Alpha", 
        parent_container=studio
    )
    assets = Container.objects.create(
        code="ASSETS", 
        name="Assets", 
        parent_container=project
    )
    
    # 2. Use materialized path for fast queries
    descendants = studio.get_descendants_by_path()
    print(f"Studio has {len(descendants)} descendants")
    
    # 3. Get hierarchy statistics
    stats = studio.get_hierarchy_statistics_by_path()
    print(f"Max depth: {stats['max_descendant_depth']}")
    
    # 4. Serialize for API
    serializer = ContainerDetailSerializer(studio)
    container_data = serializer.data
    
    # 5. Tree serialization
    tree_serializer = ContainerTreeSerializer(studio, context={'max_depth': 3})
    tree_data = tree_serializer.data
    
    # 6. Move operations (if enhanced methods are available)
    # impact = assets.get_move_impact(studio)  # Analyze first
    # assets.move_to(studio, method='auto')    # Perform move
    
    return {
        'container_data': container_data,
        'tree_data': tree_data,
        'stats': stats
    }

# Admin Interface Features

"""
The Container admin interface provides:

1. Hierarchy Display:
   - Tree-like indented display in list view
   - Materialized path ordering
   - Parent/child relationships

2. Filtering & Search:
   - Filter by depth, parent, creation date
   - Search by code and name
   - Custom hierarchy filters

3. Custom Actions:
   - Move container to new parent
   - Rebuild materialized paths
   - Tree view visualization
   - Hierarchy statistics

4. Validation:
   - Prevents circular references
   - Validates move operations
   - Handles deletion constraints

5. Performance:
   - Uses select_related and prefetch_related
   - Materialized path for fast queries
   - Batch operations for updates

6. Custom Views:
   - /admin/trackables/container/{id}/move/
   - /admin/trackables/container/rebuild-paths/
   - /admin/trackables/container/tree-view/

Usage in Django Admin:
1. Navigate to /admin/trackables/container/
2. Use hierarchy display to see tree structure
3. Click "Move" button on container to relocate
4. Use "Tree View" for visual hierarchy
5. Use "Rebuild Paths" after bulk operations
"""

# Query Examples for Large Datasets

def performance_examples():
    """Examples optimized for large container hierarchies."""
    
    # 1. Fast root container lookup
    roots = Container.objects.root_containers()
    
    # 2. Efficient descendant queries using materialized path
    studio = Container.objects.get(code="STUDIO")
    descendants = studio.get_descendants_by_path()  # Ultra-fast
    
    # 3. Bulk descendant lookup for multiple containers
    containers = Container.objects.filter(depth=1)  # All level-1 containers
    bulk_descendants = Container.objects.get_descendants_by_path_bulk(containers)
    
    # 4. Statistics for all root containers
    root_stats = Container.objects.get_hierarchy_roots_with_stats()
    
    # 5. Filtered queries using materialized path
    deep_containers = Container.objects.filter(depth__gte=3)
    
    # 6. Ancestor lookup using the materialized path
    container = Container.objects.get(code="SOME_DEEP_CONTAINER")
    ancestors = container.get_ancestors_by_path()  # Uses path field
    
    return {
        'roots_count': roots.count(),
        'descendants_count': len(descendants),
        'deep_containers_count': deep_containers.count()
    }

# Error Handling Examples

def error_handling_examples():
    """Examples of proper error handling with Container operations."""
    
    try:
        # Attempt to move container
        container = Container.objects.get(code="ASSETS")
        new_parent = Container.objects.get(code="STUDIO")
        
        # Check if move is valid first
        if hasattr(container, 'can_move_to'):
            can_move, reason = container.can_move_to(new_parent)
            if not can_move:
                print(f"Cannot move: {reason}")
                return
        
        # Analyze impact
        if hasattr(container, 'get_move_impact'):
            impact = container.get_move_impact(new_parent)
            if impact['containers_affected'] > 1000:
                print("Large move operation - consider maintenance window")
        
        # Perform move
        container.parent_container = new_parent
        container.save()
        
    except Container.DoesNotExist:
        print("Container not found")
    except Exception as e:
        print(f"Move failed: {e}")

if __name__ == "__main__":
    # Run examples (would need Django setup)
    print("Container API Examples")
    print("See function docstrings for usage details")
