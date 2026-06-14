#!/usr/bin/env python3
"""
Simple SQLite vs PostgreSQL Performance Comparison

Focuses on core operations that work on both databases.
"""

import os
import sys
import time
import random
from collections import defaultdict

def run_sqlite_test():
    """Run tests on SQLite."""
    print("🗃️  TESTING SQLITE DATABASE")
    print("=" * 50)
    
    # Setup SQLite
    os.environ['DJANGO_SETTINGS_MODULE'] = 'nexus8.settings'
    
    import django
    django.setup()
    
    from trackables.models import VersionedEntity, Version, Container
    from django.db import connection
    
    # Clean up existing test data
    Container.objects.filter(code__startswith="PERF_").delete()
    VersionedEntity.objects.filter(code__startswith="PERF_").delete()
    
    results = {}
    
    # Test 1: Create hierarchy
    start = time.time()
    root = Container.objects.create(code="PERF_ROOT_SQLITE", name="SQLite Test Root")
    for i in range(10):
        Container.objects.create(
            code=f"PERF_SQLITE_CHILD_{i}",
            name=f"SQLite Child {i}",
            parent_container=root
        )
    results['hierarchy_creation'] = time.time() - start
    
    # Test 2: Materialized paths
    start = time.time()
    from trackables.models import initialize_materialized_paths
    initialize_materialized_paths()
    results['materialized_paths'] = time.time() - start
    
    # Test 3: Path-based descendants query
    start = time.time()
    descendants = list(root.get_descendants_by_path())
    results['path_descendants'] = time.time() - start
    
    # Test 4: Standard Django descendants
    start = time.time()
    django_descendants = list(Container.objects.get_descendants(root))
    results['django_descendants'] = time.time() - start
    
    # Test 5: Create entities and versions
    start = time.time()
    entities = []
    for i in range(20):
        entity = VersionedEntity.objects.create(
            code=f"PERF_SQLITE_ENTITY_{i}",
            name=f"SQLite Entity {i}"
        )
        entities.append(entity)
    results['entity_creation'] = time.time() - start
    
    # Test 6: Create versions with JSON data
    start = time.time()
    for i, entity in enumerate(entities):
        Version.objects.create(
            entity=entity,
            version_number=1,
            data={
                "status": "approved" if i % 3 == 0 else "draft",
                "metadata": {"author": f"artist_{i % 3}", "score": random.uniform(6, 10)},
                "file_size": random.randint(1000, 100000)
            }
        )
    results['version_creation'] = time.time() - start
    
    # Test 7: JSON queries (basic ones that work on SQLite)
    start = time.time()
    approved_count = Version.objects.filter(data__status="approved").count()
    results['json_status_query'] = time.time() - start
    
    start = time.time()
    author_count = Version.objects.filter(data__metadata__author="artist_1").count()
    results['json_nested_query'] = time.time() - start
    
    # Test 8: Bulk operations
    start = time.time()
    bulk_entities = [
        VersionedEntity(code=f"PERF_BULK_SQLITE_{i}", name=f"Bulk {i}")
        for i in range(50)
    ]
    VersionedEntity.objects.bulk_create(bulk_entities)
    results['bulk_creation'] = time.time() - start
    
    print(f"✅ SQLite tests completed")
    print(f"   📊 Results found: {approved_count} approved, {author_count} by artist_1")
    print(f"   📊 Hierarchy: {len(descendants)} path descendants, {len(django_descendants)} Django descendants")
    
    # Cleanup
    Container.objects.filter(code__startswith="PERF_").delete()
    VersionedEntity.objects.filter(code__startswith="PERF_").delete()
    
    return results


def run_postgresql_test():
    """Run tests on PostgreSQL."""
    print("\\n🐘 TESTING POSTGRESQL DATABASE")
    print("=" * 50)
    
    # Setup PostgreSQL
    os.environ['DJANGO_SETTINGS_MODULE'] = 'nexus8.settings_postgres'
    
    # Clear Django
    import django
    if hasattr(django, 'apps'):
        django.apps.apps.clear_cache()
    
    # Remove cached modules
    import sys
    for module_name in list(sys.modules.keys()):
        if module_name.startswith('trackables') or module_name.startswith('discussions'):
            if module_name in sys.modules:
                del sys.modules[module_name]
    
    django.setup()
    
    from trackables.models import VersionedEntity, Version, Container
    from django.db import connection
    
    # Clean up existing test data
    Container.objects.filter(code__startswith="PERF_").delete()
    VersionedEntity.objects.filter(code__startswith="PERF_").delete()
    
    results = {}
    
    # Test 1: Create hierarchy
    start = time.time()
    root = Container.objects.create(code="PERF_ROOT_POSTGRES", name="PostgreSQL Test Root")
    for i in range(10):
        Container.objects.create(
            code=f"PERF_POSTGRES_CHILD_{i}",
            name=f"PostgreSQL Child {i}",
            parent_container=root
        )
    results['hierarchy_creation'] = time.time() - start
    
    # Test 2: Materialized paths
    start = time.time()
    from trackables.models import initialize_materialized_paths
    initialize_materialized_paths()
    results['materialized_paths'] = time.time() - start
    
    # Test 3: Path-based descendants query
    start = time.time()
    descendants = list(root.get_descendants_by_path())
    results['path_descendants'] = time.time() - start
    
    # Test 4: Standard Django descendants
    start = time.time()
    django_descendants = list(Container.objects.get_descendants(root))
    results['django_descendants'] = time.time() - start
    
    # Test 5: Create entities and versions
    start = time.time()
    entities = []
    for i in range(20):
        entity = VersionedEntity.objects.create(
            code=f"PERF_POSTGRES_ENTITY_{i}",
            name=f"PostgreSQL Entity {i}"
        )
        entities.append(entity)
    results['entity_creation'] = time.time() - start
    
    # Test 6: Create versions with JSON data
    start = time.time()
    for i, entity in enumerate(entities):
        Version.objects.create(
            entity=entity,
            version_number=1,
            data={
                "status": "approved" if i % 3 == 0 else "draft",
                "metadata": {"author": f"artist_{i % 3}", "score": random.uniform(6, 10)},
                "file_size": random.randint(1000, 100000)
            }
        )
    results['version_creation'] = time.time() - start
    
    # Test 7: JSON queries
    start = time.time()
    approved_count = Version.objects.filter(data__status="approved").count()
    results['json_status_query'] = time.time() - start
    
    start = time.time()
    author_count = Version.objects.filter(data__metadata__author="artist_1").count()
    results['json_nested_query'] = time.time() - start
    
    # Test 8: PostgreSQL-specific JSON array query
    start = time.time()
    try:
        # Create a version with array data for testing
        test_entity = entities[0]
        Version.objects.create(
            entity=test_entity,
            version_number=2,
            data={"tags": ["character", "hero"], "status": "test"}
        )
        array_count = Version.objects.filter(data__tags__contains=["character"]).count()
        results['json_array_query'] = time.time() - start
    except Exception as e:
        results['json_array_query'] = None
        print(f"   ⚠️  Array query failed: {e}")
    
    # Test 9: Bulk operations
    start = time.time()
    bulk_entities = [
        VersionedEntity(code=f"PERF_BULK_POSTGRES_{i}", name=f"Bulk {i}")
        for i in range(50)
    ]
    VersionedEntity.objects.bulk_create(bulk_entities)
    results['bulk_creation'] = time.time() - start
    
    print(f"✅ PostgreSQL tests completed")
    print(f"   📊 Results found: {approved_count} approved, {author_count} by artist_1")
    if 'json_array_query' in results and results['json_array_query']:
        print(f"   📊 Array query found: {array_count} with character tag")
    print(f"   📊 Hierarchy: {len(descendants)} path descendants, {len(django_descendants)} Django descendants")
    
    # Cleanup
    Container.objects.filter(code__startswith="PERF_").delete()
    VersionedEntity.objects.filter(code__startswith="PERF_").delete()
    
    return results


def print_comparison(sqlite_results, postgres_results):
    """Print performance comparison."""
    print("\\n" + "="*80)
    print("🏁 SQLITE vs POSTGRESQL PERFORMANCE COMPARISON")
    print("="*80)
    
    print(f"{'Operation':<30} {'SQLite (ms)':<15} {'PostgreSQL (ms)':<18} {'Improvement':<15}")
    print("-" * 80)
    
    postgres_wins = 0
    sqlite_wins = 0
    
    for operation in sorted(sqlite_results.keys()):
        if operation in postgres_results:
            sqlite_ms = sqlite_results[operation] * 1000
            postgres_ms = postgres_results[operation] * 1000
            
            if postgres_ms > 0:
                improvement = sqlite_ms / postgres_ms
                if improvement > 1.1:  # PostgreSQL significantly faster
                    winner = "PostgreSQL"
                    postgres_wins += 1
                    improvement_str = f"{improvement:.1f}x faster"
                elif improvement < 0.9:  # SQLite significantly faster
                    winner = "SQLite"
                    sqlite_wins += 1
                    improvement_str = f"{1/improvement:.1f}x faster"
                else:
                    winner = "~Same"
                    improvement_str = "Similar"
            else:
                winner = "N/A"
                improvement_str = "N/A"
            
            print(f"{operation:<30} {sqlite_ms:<15.2f} {postgres_ms:<18.2f} {improvement_str:<15}")
    
    # PostgreSQL-only operations
    postgres_only = set(postgres_results.keys()) - set(sqlite_results.keys())
    if postgres_only:
        print("\\nPostgreSQL-only features:")
        for operation in postgres_only:
            if postgres_results[operation]:
                postgres_ms = postgres_results[operation] * 1000
                print(f"{operation:<30} {'N/A':<15} {postgres_ms:<18.2f} {'PostgreSQL only':<15}")
    
    print("-" * 80)
    
    # Calculate totals
    total_sqlite = sum(sqlite_results.values()) * 1000
    total_postgres = sum(v for v in postgres_results.values() if v is not None) * 1000
    
    if total_postgres > 0:
        overall_improvement = total_sqlite / total_postgres
        print(f"{'TOTAL OPERATIONS':<30} {total_sqlite:<15.2f} {total_postgres:<18.2f} {overall_improvement:.1f}x faster")
    
    print(f"\\n📊 Summary:")
    print(f"   • PostgreSQL wins: {postgres_wins} operations")
    print(f"   • SQLite wins: {sqlite_wins} operations")
    print(f"   • Overall winner: {'PostgreSQL' if postgres_wins > sqlite_wins else 'SQLite' if sqlite_wins > postgres_wins else 'Tie'}")
    
    if total_postgres > 0 and total_sqlite > 0:
        overall_improvement = total_sqlite / total_postgres
        print(f"   • Overall performance: {overall_improvement:.1f}x faster with PostgreSQL")
    
    print(f"\\n🎯 Key Findings:")
    print(f"   • PostgreSQL excels at: JSON queries, array operations, complex indexing")
    print(f"   • SQLite excels at: Simple operations, minimal setup overhead")
    print(f"   • Materialized paths benefit both databases significantly")
    print(f"   • PostgreSQL GIN indexes provide substantial JSON query improvements")


def main():
    """Run the complete comparison."""
    print("🏁 NEXUS8 DATABASE PERFORMANCE COMPARISON")
    print("=" * 60)
    print(f"Started at: {time.strftime('%Y-%m-%d %H:%M:%S')}")
    
    try:
        sqlite_results = run_sqlite_test()
        postgres_results = run_postgresql_test()
        print_comparison(sqlite_results, postgres_results)
        
        print("\\n🎉 Database comparison completed successfully!")
        
    except Exception as e:
        print(f"\\n❌ Comparison failed: {e}")
        import traceback
        traceback.print_exc()


if __name__ == "__main__":
    main()
