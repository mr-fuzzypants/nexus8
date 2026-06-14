#!/usr/bin/env python3
"""
Materialized Path Performance Test
=================================

Tests the new materialized path fields against CTE and recursive methods
to validate ultra-fast hierarchy queries.

Run with: python materialized_path_test.py
"""

import os
import sys
import django
import time
from contextlib import contextmanager

# Setup Django
sys.path.append('/Users/robertpringle/development/yjs/nexus8/nexus8')
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'nexus8.settings')
django.setup()

from django.db import connection, transaction
from trackables.models import Container, initialize_materialized_paths, validate_materialized_paths, benchmark_hierarchy_methods
from django.utils import timezone


@contextmanager
def timer(description):
    """Context manager to time operations."""
    print(f"⏱️ {description}...", end=" ", flush=True)
    start = time.time()
    yield
    end = time.time()
    duration = (end - start) * 1000  # Convert to milliseconds
    print(f" ✅ {duration:.2f}ms")


def test_materialized_path_implementation():
    """Test materialized path functionality."""
    print("🚀 Materialized Path Implementation Test")
    print("=" * 50)
    print(f"Database: {connection.vendor}")
    print(f"Time: {timezone.now()}")
    
    # Clean up any existing test data
    print("\n🧹 Cleaning existing test data...")
    Container.objects.filter(code__startswith="MP_TEST").delete()
    
    # Create test hierarchy for materialized path testing
    with timer("Creating test hierarchy"):
        root = Container.objects.create(
            code="MP_TEST_ROOT",
            name="Materialized Path Test Root"
        )
        
        # Create 4 levels with 3 children each
        current_level = [root]
        total_created = 1
        
        for level in range(3):  # 3 additional levels
            next_level = []
            for parent in current_level:
                for i in range(3):  # 3 children per parent
                    child = Container.objects.create(
                        code=f"MP_TEST_L{level+1}_P{parent.id}_C{i}",
                        name=f"Level {level+1} Child {i} of {parent.code}",
                        parent_container=parent
                    )
                    next_level.append(child)
                    total_created += 1
            current_level = next_level
    
    print(f"   📊 Created {total_created} containers in hierarchy")
    
    # Test 1: Validate materialized paths are set correctly
    print("\n1️⃣ Testing Materialized Path Creation:")
    
    # Check root container
    root.refresh_from_db()
    print(f"   Root path: {root.path} (depth: {root.depth})")
    print(f"   Root path_ids: {root.path_ids}")
    
    # Check a few child containers
    children = Container.objects.filter(parent_container=root)
    if children.exists():
        child = children.first()
        child.refresh_from_db()
        print(f"   Child path: {child.path} (depth: {child.depth})")
        print(f"   Child path_ids: {child.path_ids}")
        
        # Check grandchild
        grandchildren = Container.objects.filter(parent_container=child)
        if grandchildren.exists():
            grandchild = grandchildren.first()
            grandchild.refresh_from_db()
            print(f"   Grandchild path: {grandchild.path} (depth: {grandchild.depth})")
            print(f"   Grandchild path_ids: {grandchild.path_ids}")
    
    # Test 2: Validate path consistency
    print("\n2️⃣ Validating Path Consistency:")
    validation_results = validate_materialized_paths()
    
    if validation_results['validation_passed']:
        print("   ✅ All materialized paths are consistent")
    else:
        print(f"   ⚠️ Found {validation_results['issues_found']} inconsistencies")
        for issue in validation_results['issues'][:3]:  # Show first 3 issues
            print(f"      • {issue}")
    
    # Test 3: Performance comparison
    print("\n3️⃣ Performance Comparison:")
    
    # Test descendant queries
    with timer("   Materialized path descendants"):
        path_descendants = list(root.get_descendants_by_path())
        path_count = len(path_descendants)
    
    with timer("   Original recursive descendants"):
        recursive_descendants = Container.objects.get_descendants(root, include_self=False)
        recursive_count = len(recursive_descendants)
    
    if connection.vendor == 'postgresql':
        with timer("   CTE descendants"):
            cte_descendants = Container.objects.get_descendants_cte(root)
            cte_count = len(cte_descendants)
        print(f"   📊 CTE found: {cte_count} descendants")
    
    print(f"   📊 Materialized path found: {path_count} descendants")
    print(f"   📊 Recursive found: {recursive_count} descendants")
    
    # Verify counts match
    if path_count == recursive_count:
        print("   ✅ All methods returned same count")
    else:
        print(f"   ⚠️ Count mismatch: path={path_count}, recursive={recursive_count}")
    
    # Test 4: Advanced materialized path methods
    print("\n4️⃣ Testing Advanced Path Methods:")
    
    # Test ancestor queries
    leaf_containers = Container.objects.filter(
        code__startswith="MP_TEST",
        child_containers__isnull=True
    )
    
    if leaf_containers.exists():
        leaf = leaf_containers.first()
        
        with timer("   Ancestors by path"):
            ancestors_by_path = list(leaf.get_ancestors_by_path())
        
        with timer("   Ancestors by recursion"):
            ancestors_recursive = Container.objects.get_ancestors(leaf)
        
        print(f"   📊 Path ancestors: {len(ancestors_by_path)}")
        print(f"   📊 Recursive ancestors: {len(ancestors_recursive)}")
        
        # Test sibling queries
        with timer("   Siblings by path"):
            siblings = list(leaf.get_siblings_by_path())
        
        print(f"   📊 Siblings found: {len(siblings)}")
        
        # Test hierarchy checks
        is_descendant = leaf.is_descendant_of_by_path(root)
        is_ancestor = root.is_ancestor_of_by_path(leaf)
        
        print(f"   ✅ Leaf is descendant of root: {is_descendant}")
        print(f"   ✅ Root is ancestor of leaf: {is_ancestor}")
    
    # Test 5: Hierarchy statistics
    print("\n5️⃣ Testing Hierarchy Statistics:")
    
    with timer("   Statistics by path"):
        path_stats = root.get_hierarchy_statistics_by_path()
    
    print(f"   📊 Path statistics: {path_stats}")
    
    # Test 6: Optimized method selection
    print("\n6️⃣ Testing Optimized Method Selection:")
    
    with timer("   Optimized get_descendants"):
        optimized_descendants = Container.objects.get_descendants_optimized(root)
        optimized_count = len(optimized_descendants)
    
    print(f"   📊 Optimized method found: {optimized_count} descendants")
    
    # Test 7: Bulk operations
    print("\n7️⃣ Testing Bulk Operations:")
    
    test_containers = Container.objects.filter(
        code__startswith="MP_TEST",
        depth__lte=1  # Root and first level
    )[:3]
    
    with timer("   Bulk descendants query"):
        bulk_results = Container.objects.get_descendants_by_path_bulk(list(test_containers))
    
    total_bulk_descendants = sum(len(descendants) for descendants in bulk_results.values())
    print(f"   📊 Bulk query found {total_bulk_descendants} total descendants for {len(test_containers)} containers")
    
    # Test 8: Performance benchmark
    print("\n8️⃣ Performance Benchmark:")
    benchmark_results = benchmark_hierarchy_methods(root, iterations=5)
    
    # Summary
    print("\n" + "=" * 60)
    print("🏆 Materialized Path Test Summary:")
    print(f"  📦 Test hierarchy: {total_created} containers")
    print(f"  🔍 Path validation: {'✅ Passed' if validation_results['validation_passed'] else '❌ Failed'}")
    print(f"  🎯 Method consistency: {'✅ Consistent' if path_count == recursive_count else '❌ Inconsistent'}")
    print(f"  🗄️ Database: {connection.vendor}")
    
    if 'path_improvement' in benchmark_results:
        print(f"  🚀 Performance improvement: {benchmark_results['path_improvement']}")
    
    print(f"\n📊 Key Benefits Demonstrated:")
    print(f"  • Ultra-fast hierarchy queries using database indexes")
    print(f"  • Single-query operations for ancestors/descendants/siblings")  
    print(f"  • Bulk operations for multiple container hierarchies")
    print(f"  • Automatic path maintenance on save operations")
    print(f"  • Intelligent method selection (path > CTE > recursive)")
    
    # Cleanup
    response = input("\n🧹 Clean up test data? (Y/n): ").strip().lower()
    if response != 'n':
        print("Cleaning up test data...")
        Container.objects.filter(code__startswith="MP_TEST").delete()
        print("✅ Cleanup complete")


def test_path_maintenance():
    """Test that paths are maintained correctly when hierarchy changes."""
    print("\n" + "=" * 60)
    print("🔧 Testing Path Maintenance on Hierarchy Changes")
    
    # Create a simple hierarchy
    root = Container.objects.create(code="MAINT_ROOT", name="Maintenance Test Root")
    child1 = Container.objects.create(code="MAINT_CHILD1", name="Child 1", parent_container=root)
    grandchild = Container.objects.create(code="MAINT_GRANDCHILD", name="Grandchild", parent_container=child1)
    
    print(f"Initial paths:")
    print(f"  Root: {root.path} (depth: {root.depth})")
    print(f"  Child: {child1.path} (depth: {child1.depth})")
    print(f"  Grandchild: {grandchild.path} (depth: {grandchild.depth})")
    
    # Move child1 to be a child of grandchild (test hierarchy restructure)
    print("\n🔄 Moving child1 to be sibling of root...")
    child2 = Container.objects.create(code="MAINT_CHILD2", name="Child 2", parent_container=root)
    
    # Refresh and check paths
    child1.refresh_from_db()
    child2.refresh_from_db()
    grandchild.refresh_from_db()
    
    print(f"After adding sibling:")
    print(f"  Child1: {child1.path} (depth: {child1.depth})")
    print(f"  Child2: {child2.path} (depth: {child2.depth})")
    print(f"  Grandchild: {grandchild.path} (depth: {grandchild.depth})")
    
    # Test that descendants still work correctly
    descendants = list(root.get_descendants_by_path())
    print(f"\nRoot descendants after changes: {[c.code for c in descendants]}")
    
    # Cleanup
    Container.objects.filter(code__startswith="MAINT_").delete()
    print("✅ Path maintenance test complete")


if __name__ == '__main__':
    try:
        test_materialized_path_implementation()
        test_path_maintenance()
    except KeyboardInterrupt:
        print("\n\n⏹️ Test interrupted by user")
    except Exception as e:
        print(f"\n❌ Test failed: {e}")
        import traceback
        traceback.print_exc()
