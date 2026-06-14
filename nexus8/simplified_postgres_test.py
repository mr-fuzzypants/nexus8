#!/usr/bin/env python3
"""
Simplified PostgreSQL Performance Test for Nexus8 System

This script runs essential performance tests using PostgreSQL with correct table structure.

Author: Performance Testing Framework  
Date: October 2, 2025
"""

import os
import sys
import django
import time
import gc
import random
from datetime import datetime, timedelta
from contextlib import contextmanager
from collections import defaultdict

# Use PostgreSQL settings
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'nexus8.settings_postgres')
django.setup()

from django.db import transaction, connection
from django.utils import timezone
from trackables.models import (
    VersionedEntity, Version, Container, ContainerVersion, ContainerReference,
    create_json_indexes, initialize_materialized_paths, validate_materialized_paths
)
from discussions.models import Discussion, Comment, Note


class SimplePerformanceMetrics:
    """Simple performance metrics collection."""
    
    def __init__(self):
        self.metrics = {
            'timing': defaultdict(list),
            'query_count': defaultdict(int)
        }
        self.test_start_time = time.time()
        
    def record_timing(self, operation, duration):
        """Record timing for an operation."""
        self.metrics['timing'][operation].append(duration)
        
    def record_query_count(self, operation, count):
        """Record query count for an operation."""
        self.metrics['query_count'][operation] += count
    
    def print_summary(self):
        """Print comprehensive performance summary."""
        print("\\n" + "="*80)
        print("🚀 POSTGRESQL PERFORMANCE TEST SUMMARY")
        print("="*80)
        
        print(f"Database: PostgreSQL")
        print(f"Test Duration: {time.time() - self.test_start_time:.2f} seconds")
        
        print("\\n⏱️  Performance Timing Results:")
        for operation, times in self.metrics['timing'].items():
            if times:
                avg_time = sum(times) / len(times)
                min_time = min(times)
                max_time = max(times)
                print(f"  • {operation}:")
                print(f"    - Average: {avg_time*1000:.2f}ms")
                print(f"    - Min: {min_time*1000:.2f}ms") 
                print(f"    - Max: {max_time*1000:.2f}ms")
                print(f"    - Operations: {len(times)}")
        
        print("\\n🔍 Query Count Summary:")
        for operation, count in self.metrics['query_count'].items():
            print(f"  • {operation}: {count} queries")


@contextmanager
def timer(description, metrics=None):
    """Context manager to time operations."""
    start = time.time()
    initial_queries = len(connection.queries) if hasattr(connection, 'queries') else 0
    
    print(f"🏃 {description}...")
    yield
    
    duration = time.time() - start
    final_queries = len(connection.queries) if hasattr(connection, 'queries') else 0
    query_count = final_queries - initial_queries
    
    print(f"   ✅ Completed in {duration*1000:.2f}ms ({query_count} queries)")
    
    if metrics:
        metrics.record_timing(description, duration)
        metrics.record_query_count(description, query_count)


def setup_postgres_database():
    """Set up PostgreSQL database and create necessary indexes."""
    print("🔧 Setting up PostgreSQL database...")
    
    # Create database if it doesn't exist
    try:
        with connection.cursor() as cursor:
            cursor.execute("SELECT 1;")
        print("   ✅ Database connection successful")
    except Exception as e:
        print(f"   ❌ Database connection failed: {e}")
        return False
    
    # Run migrations
    print("🔄 Running Django migrations...")
    try:
        from django.core.management import execute_from_command_line
        execute_from_command_line(['manage.py', 'migrate', '--verbosity=0'])
        print("   ✅ Migrations completed")
    except Exception as e:
        print(f"   ❌ Migration failed: {e}")
        return False
    
    # Create PostgreSQL-specific indexes
    print("📊 Creating PostgreSQL-specific indexes...")
    try:
        create_json_indexes()
        print("   ✅ JSON indexes created")
    except Exception as e:
        print(f"   ⚠️  Index creation warning: {e}")
    
    return True


def test_basic_hierarchy_performance(metrics):
    """Test basic hierarchy operations with materialized paths."""
    print("\\n🛤️  Testing Basic Hierarchy Performance")
    print("-" * 50)
    
    # Create test hierarchy with timestamp
    timestamp = int(time.time())
    with timer("Creating hierarchy test data", metrics):
        root = Container.objects.create(code=f"PERF_ROOT_{timestamp}", name="Performance Test Root")
        
        # Create 3 levels with 4 children each
        current_level = [root]
        total_created = 1
        
        for level in range(2):
            next_level = []
            for parent in current_level:
                for i in range(4):
                    child = Container.objects.create(
                        code=f"PERF_{timestamp}_L{level+1}_P{parent.id}_C{i}",
                        name=f"Level {level+1} Child {i}",
                        parent_container=parent
                    )
                    next_level.append(child)
                    total_created += 1
            current_level = next_level
    
    print(f"   📦 Created {total_created} containers")
    
    # Initialize materialized paths
    with timer("Initializing materialized paths", metrics):
        initialize_materialized_paths()
    
    # Validate materialized paths
    with timer("Validating materialized paths", metrics):
        validation_results = validate_materialized_paths()
    
    print(f"   ✅ Path validation: {validation_results}")
    
    # Test materialized path queries
    with timer("Materialized path descendants query", metrics):
        descendants = list(root.get_descendants_by_path())
    
    with timer("Materialized path ancestors query", metrics):
        if current_level:
            leaf = current_level[0]
            ancestors = list(leaf.get_ancestors_by_path())
        else:
            ancestors = []
    
    print(f"   📊 Results: {len(descendants)} descendants, {len(ancestors)} ancestors")
    
    # Test standard Django ORM queries for comparison
    with timer("Standard Django descendants query", metrics):
        django_descendants = list(Container.objects.get_descendants(root))
    
    with timer("Standard Django ancestors query", metrics):
        if current_level:
            django_ancestors = list(Container.objects.get_ancestors(leaf))
        else:
            django_ancestors = []
    
    print(f"   📊 Django ORM: {len(django_descendants)} descendants, {len(django_ancestors)} ancestors")
    
    # Compare results
    if len(descendants) == len(django_descendants) and len(ancestors) == len(django_ancestors):
        print("   ✅ Materialized path results match Django ORM")
    else:
        print("   ⚠️  Results mismatch - needs investigation")
    
    # Cleanup
    Container.objects.filter(code__startswith=f"PERF_{timestamp}").delete()


def test_json_field_performance(metrics):
    """Test JSON field performance with PostgreSQL GIN indexes."""
    print("\\n📄 Testing JSON Field Performance")
    print("-" * 50)
    
    # Create test entities with JSON data
    with timer("Creating entities with JSON data", metrics):
        entities = []
        for i in range(50):
            entity = VersionedEntity.objects.create(
                code=f"JSON_ENTITY_{i:03d}",
                name=f"JSON Test Entity {i}"
            )
            entities.append(entity)
    
    # Create versions with complex JSON data
    with timer("Creating versions with complex JSON", metrics):
        versions = []
        for i, entity in enumerate(entities):
            data = {
                "status": random.choice(["draft", "review", "approved", "published"]),
                "metadata": {
                    "author": f"artist_{i % 5}",
                    "department": ["modeling", "texturing", "rigging"][i % 3],
                    "quality_score": round(random.uniform(6.0, 10.0), 2),
                    "file_size": random.randint(1024000, 50000000),
                    "tags": random.sample(["character", "environment", "prop", "vehicle"], k=random.randint(1, 3))
                },
                "technical_specs": {
                    "poly_count": random.randint(1000, 100000),
                    "texture_resolution": random.choice([1024, 2048, 4096])
                }
            }
            
            version = Version.objects.create(
                entity=entity,
                version_number=1,
                data=data
            )
            versions.append(version)
    
    print(f"   📦 Created {len(versions)} versions with JSON data")
    
    # Test JSON field queries
    with timer("JSON status query", metrics):
        approved_versions = Version.objects.filter(data__status="approved")
        approved_count = approved_versions.count()
    
    with timer("JSON nested field query", metrics):
        artist_versions = Version.objects.filter(data__metadata__author="artist_1")
        artist_count = artist_versions.count()
    
    with timer("JSON array contains query", metrics):
        character_versions = Version.objects.filter(data__metadata__tags__contains=["character"])
        character_count = character_versions.count()
    
    with timer("JSON numeric range query", metrics):
        high_quality = Version.objects.filter(data__metadata__quality_score__gte=8.5)
        quality_count = high_quality.count()
    
    print(f"   🔍 JSON Query Results:")
    print(f"     • Approved versions: {approved_count}")
    print(f"     • Artist_1 versions: {artist_count}")
    print(f"     • Character tagged: {character_count}")
    print(f"     • High quality (>8.5): {quality_count}")
    
    # Test aggregate operations
    with timer("JSON aggregate stats", metrics):
        try:
            stats = Version.objects.aggregate_json_stats()
            print(f"     • Aggregate stats: {stats.get('total_versions', 'N/A')} total versions")
        except Exception as e:
            print(f"     • Aggregate stats failed: {e}")
    
    # Cleanup
    VersionedEntity.objects.filter(code__startswith="JSON_ENTITY_").delete()


def test_bulk_operations(metrics):
    """Test bulk operations performance."""
    print("\\n📦 Testing Bulk Operations")
    print("-" * 50)
    
    # Test bulk entity creation
    with timer("Bulk entity creation", metrics):
        entities_to_create = []
        for i in range(100):
            entities_to_create.append(VersionedEntity(
                code=f"BULK_ENTITY_{i:04d}",
                name=f"Bulk Entity {i}"
            ))
        
        created_entities = VersionedEntity.objects.bulk_create(entities_to_create)
    
    print(f"   📦 Created {len(created_entities)} entities in bulk")
    
    # Test bulk version creation using the first entity
    if created_entities:
        test_entity = created_entities[0]
        with timer("Bulk version creation", metrics):
            versions_to_create = []
            for i in range(20):
                versions_to_create.append(Version(
                    entity=test_entity,
                    version_number=i + 1,
                    data={
                        "status": f"bulk_test_{i}",
                        "metadata": {"batch_id": i // 5, "index": i},
                        "file_size": random.randint(1000, 1000000)
                    }
                ))
            
            created_versions = Version.objects.bulk_create(versions_to_create)
        
        print(f"   📄 Created {len(created_versions)} versions in bulk")
    
    # Test bulk queries
    with timer("Bulk query operations", metrics):
        entity_count = VersionedEntity.objects.filter(code__startswith="BULK_").count()
        version_count = Version.objects.filter(entity__code__startswith="BULK_").count()
    
    print(f"   🔍 Bulk query results: {entity_count} entities, {version_count} versions")
    
    # Cleanup
    VersionedEntity.objects.filter(code__startswith="BULK_").delete()


def test_raw_sql_performance(metrics):
    """Test raw SQL queries on PostgreSQL."""
    print("\\n🐘 Testing Raw SQL Performance")
    print("-" * 50)
    
    # Create test data
    with timer("Creating SQL test data", metrics):
        root = Container.objects.create(code="SQL_ROOT", name="SQL Test Root")
        containers = []
        for i in range(20):
            container = Container.objects.create(
                code=f"SQL_CHILD_{i:02d}",
                name=f"SQL Child {i}",
                parent_container=root
            )
            containers.append(container)
    
    print(f"   📦 Created {len(containers) + 1} containers for SQL testing")
    
    # Test raw PostgreSQL queries
    with timer("Raw SQL hierarchy query", metrics):
        with connection.cursor() as cursor:
            cursor.execute("""
                SELECT ve.id, ve.code, ve.name, c.parent_container_id, c.depth
                FROM trackables_versionedentity ve
                JOIN trackables_container c ON ve.id = c.versionedentity_ptr_id
                WHERE c.parent_container_id = %s
                ORDER BY ve.code
            """, [root.id])
            raw_results = cursor.fetchall()
    
    print(f"   🔍 Raw SQL found {len(raw_results)} child containers")
    
    # Test JSON queries with raw SQL
    entity = VersionedEntity.objects.create(code="SQL_JSON_TEST", name="SQL JSON Test")
    Version.objects.create(
        entity=entity,
        version_number=1,
        data={"status": "sql_test", "score": 9.5, "tags": ["test", "sql"]}
    )
    
    with timer("Raw SQL JSON query", metrics):
        with connection.cursor() as cursor:
            cursor.execute("""
                SELECT v.id, v.data->>'status' as status, 
                       CAST(v.data->>'score' AS FLOAT) as score,
                       v.data->'tags' as tags
                FROM trackables_version v
                JOIN trackables_versionedentity ve ON v.entity_id = ve.id
                WHERE ve.code = %s
            """, ['SQL_JSON_TEST'])
            json_results = cursor.fetchall()
    
    print(f"   📄 Raw SQL JSON query found {len(json_results)} results")
    if json_results:
        result = json_results[0]
        print(f"     • Status: {result[1]}, Score: {result[2]}, Tags: {result[3]}")
    
    # Cleanup
    Container.objects.filter(code__startswith="SQL_").delete()
    VersionedEntity.objects.filter(code="SQL_JSON_TEST").delete()


def run_simplified_postgres_test():
    """Run the simplified PostgreSQL performance test suite."""
    print("🐘 NEXUS8 SIMPLIFIED POSTGRESQL PERFORMANCE TEST")
    print("=" * 60)
    print(f"Started at: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    
    try:
        with connection.cursor() as cursor:
            cursor.execute("SELECT version();")
            pg_version = cursor.fetchone()[0]
            print(f"PostgreSQL Version: {pg_version}")
    except:
        print("PostgreSQL Version: Unknown")
    
    # Clean up any existing test data first
    print("🧹 Cleaning up any existing test data...")
    try:
        Container.objects.filter(code__startswith=("PERF_", "JSON_", "BULK_", "SQL_")).delete()
        VersionedEntity.objects.filter(code__startswith=("PERF_", "JSON_", "BULK_", "SQL_")).delete()
        print("   ✅ Pre-test cleanup completed")
    except Exception as e:
        print(f"   ⚠️  Pre-test cleanup warning: {e}")
    
    # Initialize metrics
    metrics = SimplePerformanceMetrics()
    
    # Setup database
    if not setup_postgres_database():
        print("❌ Database setup failed. Exiting.")
        return
    
    try:
        # Run test suites
        test_basic_hierarchy_performance(metrics)
        test_json_field_performance(metrics)
        test_bulk_operations(metrics)
        test_raw_sql_performance(metrics)
        
        # Print comprehensive summary
        metrics.print_summary()
        
        print("\\n🎉 All PostgreSQL performance tests completed successfully!")
        
    except Exception as e:
        print(f"\\n❌ Test suite failed with error: {e}")
        import traceback
        traceback.print_exc()
    
    finally:
        # Cleanup any remaining test data
        print("\\n🧹 Cleaning up test data...")
        try:
            Container.objects.filter(code__startswith=("PERF_", "SQL_")).delete()
            VersionedEntity.objects.filter(code__startswith=("JSON_ENTITY_", "BULK_", "SQL_")).delete()
            print("   ✅ Cleanup completed")
        except Exception as e:
            print(f"   ⚠️  Cleanup warning: {e}")


if __name__ == "__main__":
    run_simplified_postgres_test()
