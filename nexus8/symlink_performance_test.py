#!/usr/bin/env python
"""
Symlink ViewSet Performance Test

This script tests and measures the N+1 query issues in symlink-related endpoints
and validates the fixes.
"""

import os
import sys
import django
import time
from django.test.utils import override_settings
from django.db import connection, reset_queries

# Setup Django
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'nexus8.settings')
django.setup()

from django.test import TestCase
from rest_framework.test import APIClient
from trackables.models import VersionedEntity, Version, Symlink, Container, ContainerVersion, ContainerReference
from django.contrib.auth.models import User


class SymlinkPerformanceTest:
    """Test symlink endpoint performance and N+1 query issues."""
    
    def __init__(self):
        self.client = APIClient()
        self.setup_test_data()
    
    def setup_test_data(self):
        """Create test data for performance testing."""
        print("📦 Setting up test data...")
        
        # Create test entities with versions and symlinks
        self.entities = []
        self.symlinks = []
        
        for i in range(20):  # Create 20 entities
            entity = VersionedEntity.objects.create(
                code=f'TEST_ENTITY_{i:03d}',
                name=f'Test Entity {i}',
                description=f'Test entity {i} for performance testing'
            )
            self.entities.append(entity)
            
            # Create versions for each entity
            versions = []
            for v in range(5):  # 5 versions per entity
                version = Version.objects.create(
                    entity=entity,
                    version_number=v + 1,
                    data={'test': f'data_v{v+1}'}
                )
                versions.append(version)
            
            # Create symlinks for each entity
            symlink_names = ['latest', 'stable', 'dev', 'release']
            for name in symlink_names:
                symlink = Symlink.objects.create(
                    entity=entity,
                    name=name,
                    version=versions[-1]  # Point to latest version
                )
                self.symlinks.append(symlink)
        
        # Create container references with symlinks
        container = Container.objects.create(code='TEST_CONTAINER', name='Test Container')
        container_version = ContainerVersion.objects.create(
            container=container,
            version_number=1
        )
        
        # Create references using symlinks
        for i, entity in enumerate(self.entities[:10]):  # First 10 entities
            ContainerReference.objects.create(
                container_version=container_version,
                reference_name=f'ref_{i}',
                referenced_entity=entity,
                symlink_name='latest',
                symlink_version=entity.versions.latest('version_number')
            )
        
        print(f"✅ Created {len(self.entities)} entities with {len(self.symlinks)} symlinks")
    
    def measure_queries(self, func_name, func):
        """Measure the number of database queries for a function."""
        reset_queries()
        start_time = time.time()
        
        result = func()
        
        end_time = time.time()
        query_count = len(connection.queries)
        execution_time = end_time - start_time
        
        print(f"🔍 {func_name}:")
        print(f"   Queries: {query_count}")
        print(f"   Time: {execution_time:.4f}s")
        
        if query_count > 50:
            print(f"   ⚠️  WARNING: High query count detected!")
        elif query_count > 100:
            print(f"   🔴 CRITICAL: Very high query count detected!")
        
        return {
            'query_count': query_count,
            'execution_time': execution_time,
            'result': result
        }
    
    def test_symlink_list_endpoint(self):
        """Test the symlink list endpoint for N+1 queries."""
        def make_request():
            response = self.client.get('/trackables/symlinks/')
            return response.status_code, len(response.data) if hasattr(response, 'data') else 0
        
        return self.measure_queries("Symlink List Endpoint", make_request)
    
    def test_versioned_entity_list_with_symlink_count(self):
        """Test the versioned entity list with symlink counts."""
        def make_request():
            response = self.client.get('/trackables/entities/')
            return response.status_code, len(response.data) if hasattr(response, 'data') else 0
        
        return self.measure_queries("VersionedEntity List (with symlink_count)", make_request)
    
    def test_entity_symlinks_endpoint(self):
        """Test individual entity symlinks endpoint."""
        def make_request():
            entity = self.entities[0]
            response = self.client.get(f'/trackables/entities/{entity.id}/symlinks/')
            return response.status_code, len(response.data) if hasattr(response, 'data') else 0
        
        return self.measure_queries("Entity Symlinks Endpoint", make_request)
    
    def test_container_references_outdated(self):
        """Test the outdated container references endpoint."""
        def make_request():
            response = self.client.get('/trackables/container-references/outdated/')
            return response.status_code, len(response.data) if hasattr(response, 'data') else 0
        
        return self.measure_queries("Container References - Outdated", make_request)
    
    def test_container_references_broken(self):
        """Test the broken container references endpoint."""
        def make_request():
            response = self.client.get('/trackables/container-references/broken/')
            return response.status_code, len(response.data) if hasattr(response, 'data') else 0
        
        return self.measure_queries("Container References - Broken", make_request)
    
    def run_all_tests(self):
        """Run all performance tests."""
        print("🚀 Starting Symlink ViewSet Performance Tests")
        print("=" * 60)
        
        results = {}
        
        # Test all endpoints
        test_methods = [
            ('symlink_list', self.test_symlink_list_endpoint),
            ('entity_list_with_counts', self.test_versioned_entity_list_with_symlink_count),
            ('entity_symlinks', self.test_entity_symlinks_endpoint),
            ('references_outdated', self.test_container_references_outdated),
            ('references_broken', self.test_container_references_broken),
        ]
        
        for test_name, test_method in test_methods:
            try:
                results[test_name] = test_method()
                print()
            except Exception as e:
                print(f"❌ {test_name} failed: {e}")
                results[test_name] = {'error': str(e)}
                print()
        
        # Summary
        print("📊 PERFORMANCE SUMMARY")
        print("=" * 60)
        
        total_queries = 0
        total_time = 0
        
        for test_name, result in results.items():
            if 'error' not in result:
                queries = result['query_count']
                time_taken = result['execution_time']
                total_queries += queries
                total_time += time_taken
                
                status = "✅" if queries <= 20 else "⚠️" if queries <= 50 else "🔴"
                print(f"{status} {test_name:25} | {queries:3d} queries | {time_taken:.4f}s")
            else:
                print(f"❌ {test_name:25} | ERROR: {result['error']}")
        
        print("-" * 60)
        print(f"📈 Total Queries: {total_queries}")
        print(f"⏱️  Total Time: {total_time:.4f}s")
        
        # Performance recommendations
        print("\n💡 RECOMMENDATIONS")
        print("=" * 60)
        
        high_query_tests = [name for name, result in results.items() 
                          if 'query_count' in result and result['query_count'] > 20]
        
        if high_query_tests:
            print("🔧 High query count detected in:")
            for test_name in high_query_tests:
                queries = results[test_name]['query_count']
                print(f"   - {test_name}: {queries} queries")
            
            print("\n   Suggested optimizations:")
            print("   1. Add select_related() for foreign key access")
            print("   2. Add prefetch_related() for reverse foreign keys")
            print("   3. Use queryset annotations instead of SerializerMethodField")
            print("   4. Consider caching for frequently accessed data")
        else:
            print("🎉 All endpoints are well optimized!")
        
        return results


def main():
    """Main test execution."""
    print("🧪 Nexus8 Symlink Performance Testing")
    print("Testing N+1 query issues and optimization fixes")
    print()
    
    # Run the tests
    test_runner = SymlinkPerformanceTest()
    results = test_runner.run_all_tests()
    
    print("\n🏁 Performance testing completed!")
    
    # Cleanup
    print("\n🧹 Cleaning up test data...")
    
    # Delete test data
    VersionedEntity.objects.filter(code__startswith='TEST_ENTITY_').delete()
    Container.objects.filter(code='TEST_CONTAINER').delete()
    
    print("✅ Cleanup completed!")


if __name__ == '__main__':
    main()
