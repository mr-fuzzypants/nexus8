#!/usr/bin/env python3
"""
Comprehensive Performance Test Suite for Nexus8 System

Tests all aspects of the system:
1. Core CRUD Operations (Create, Read, Update, Delete)
2. Versioned Container System Performance
3. Discussion & Notes System Performance
4. Complex Query Performance
5. Bulk Operations Performance
6. Memory Usage Analysis
7. Concurrent Operations Testing
8. Database Constraint Performance
9. JSON Field Performance
10. System Limits Testing

Author: Performance Testing Framework
Date: October 1, 2025
"""

import os
import django
import time
import gc
import random
import threading
import psutil
import json
from datetime import datetime, timedelta
from contextlib import contextmanager
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed

# Setup Django
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'nexus8.settings')
django.setup()

from django.db import transaction, connection
from django.utils import timezone
from django.core.exceptions import ValidationError
from trackables.models import VersionedEntity, Version, Container, ContainerVersion, ContainerReference
from discussions.models import Discussion, Comment, Note


class PerformanceMetrics:
    """Comprehensive performance metrics collection."""
    
    def __init__(self):
        self.metrics = {
            'timing': defaultdict(list),
            'memory': defaultdict(list),
            'queries': defaultdict(list),
            'errors': defaultdict(list),
            'throughput': defaultdict(list)
        }
        self.process = psutil.Process()
    
    def record_timing(self, operation, duration_ms):
        """Record timing for an operation."""
        self.metrics['timing'][operation].append(duration_ms)
    
    def record_memory(self, operation, memory_mb):
        """Record memory usage for an operation."""
        self.metrics['memory'][operation].append(memory_mb)
    
    def record_queries(self, operation, query_count):
        """Record database query count."""
        self.metrics['queries'][operation].append(query_count)
    
    def record_error(self, operation, error):
        """Record an error."""
        self.metrics['errors'][operation].append(str(error))
    
    def record_throughput(self, operation, items_per_second):
        """Record throughput metrics."""
        self.metrics['throughput'][operation].append(items_per_second)
    
    def get_memory_usage(self):
        """Get current memory usage in MB."""
        return self.process.memory_info().rss / 1024 / 1024
    
    def get_summary(self, operation):
        """Get performance summary for an operation."""
        if operation not in self.metrics['timing']:
            return None
        
        timings = self.metrics['timing'][operation]
        return {
            'count': len(timings),
            'avg_time_ms': sum(timings) / len(timings),
            'min_time_ms': min(timings),
            'max_time_ms': max(timings),
            'total_time_ms': sum(timings),
            'avg_memory_mb': sum(self.metrics['memory'][operation]) / len(self.metrics['memory'][operation]) if self.metrics['memory'][operation] else 0,
            'avg_queries': sum(self.metrics['queries'][operation]) / len(self.metrics['queries'][operation]) if self.metrics['queries'][operation] else 0,
            'error_count': len(self.metrics['errors'][operation]),
            'avg_throughput': sum(self.metrics['throughput'][operation]) / len(self.metrics['throughput'][operation]) if self.metrics['throughput'][operation] else 0
        }


class DatabaseProfiler:
    """Database query profiling context manager."""
    
    def __init__(self, metrics, operation_name):
        self.metrics = metrics
        self.operation_name = operation_name
        self.initial_queries = 0
        
    def __enter__(self):
        self.initial_queries = len(connection.queries)
        return self
        
    def __exit__(self, exc_type, exc_val, exc_tb):
        query_count = len(connection.queries) - self.initial_queries
        self.metrics.record_queries(self.operation_name, query_count)


@contextmanager
def performance_timer(metrics, operation_name, record_memory=True):
    """Context manager for timing operations with comprehensive metrics."""
    initial_memory = metrics.get_memory_usage() if record_memory else 0
    start_time = time.perf_counter()
    
    try:
        with DatabaseProfiler(metrics, operation_name):
            yield
    except Exception as e:
        metrics.record_error(operation_name, e)
        raise
    finally:
        duration_ms = (time.perf_counter() - start_time) * 1000
        metrics.record_timing(operation_name, duration_ms)
        
        if record_memory:
            final_memory = metrics.get_memory_usage()
            metrics.record_memory(operation_name, final_memory - initial_memory)


class ComprehensivePerformanceTestSuite:
    """Main performance test suite covering all system aspects."""
    
    def __init__(self):
        self.metrics = PerformanceMetrics()
        self.test_data = {
            'entities': [],
            'versions': [],
            'containers': [],
            'container_versions': [],
            'discussions': [],
            'comments': [],
            'notes': [],
            'references': []
        }
        
    def cleanup_test_data(self):
        """Clean up all test data."""
        print("🧹 Cleaning up test data...")
        
        with performance_timer(self.metrics, 'cleanup_all'):
            # Delete in correct order to respect foreign keys
            Comment.objects.filter(discussion__title__startswith='PERF_').delete()
            Discussion.objects.filter(title__startswith='PERF_').delete()
            Note.objects.filter(title__startswith='PERF_').delete()
            ContainerReference.objects.filter(container_version__entity__code__startswith='PERF_').delete()
            ContainerVersion.objects.filter(entity__code__startswith='PERF_').delete()
            Container.objects.filter(code__startswith='PERF_').delete()
            Version.objects.filter(entity__code__startswith='PERF_').delete()
            VersionedEntity.objects.filter(code__startswith='PERF_').delete()
        
        # Clear test data references
        for key in self.test_data:
            self.test_data[key].clear()
        
        # Force garbage collection
        gc.collect()
    
    def test_1_crud_operations(self):
        """Test basic CRUD operations performance."""
        print("\\n📊 TEST 1: CRUD Operations Performance")
        print("-" * 50)
        
        # CREATE operations
        print("Creating entities...")
        with performance_timer(self.metrics, 'entity_create_single'):
            entity = VersionedEntity.objects.create(
                code='PERF_ENTITY_CRUD_001',
                name='CRUD Test Entity'
            )
            self.test_data['entities'].append(entity)
        
        # Bulk create
        entities_data = []
        for i in range(100):
            entities_data.append(VersionedEntity(
                code=f'PERF_ENTITY_BULK_{i:03d}',
                name=f'Bulk Entity {i}'
            ))
        
        with performance_timer(self.metrics, 'entity_create_bulk'):
            bulk_entities = VersionedEntity.objects.bulk_create(entities_data)
            self.test_data['entities'].extend(bulk_entities)
        
        # READ operations
        with performance_timer(self.metrics, 'entity_read_single'):
            entity = VersionedEntity.objects.get(code='PERF_ENTITY_CRUD_001')
        
        with performance_timer(self.metrics, 'entity_read_filter'):
            entities = list(VersionedEntity.objects.filter(code__startswith='PERF_ENTITY_BULK_'))
        
        with performance_timer(self.metrics, 'entity_read_all'):
            all_entities = list(VersionedEntity.objects.filter(code__startswith='PERF_'))
        
        # UPDATE operations
        with performance_timer(self.metrics, 'entity_update_single'):
            entity.name = 'Updated CRUD Test Entity'
            entity.save()
        
        with performance_timer(self.metrics, 'entity_update_bulk'):
            VersionedEntity.objects.filter(code__startswith='PERF_ENTITY_BULK_').update(
                name='Bulk Updated Entity'
            )
        
        # Complex JSON update
        with performance_timer(self.metrics, 'version_json_update'):
            version = Version.objects.create(
                entity=entity,
                version_number=1,
                data={'status': 'active', 'metadata': {'test': True}}
            )
            version.data['metadata']['updated'] = True
            version.save()
            self.test_data['versions'].append(version)
        
        print(f"✅ CRUD Operations completed")
        
    def test_2_versioned_container_performance(self):
        """Test versioned container system performance."""
        print("\\n📦 TEST 2: Versioned Container System Performance")
        print("-" * 55)
        
        # Create base entities for container references
        print("Creating container test data...")
        
        # Create multiple versions per entity
        with performance_timer(self.metrics, 'container_setup_entities'):
            for i in range(50):
                entity = VersionedEntity.objects.create(
                    code=f'PERF_CONTAINER_ENTITY_{i:03d}',
                    name=f'Container Test Entity {i}'
                )
                self.test_data['entities'].append(entity)
                
                # Create multiple versions
                for v in range(5):
                    version = Version.objects.create(
                        entity=entity,
                        version_number=v,
                        data={
                            'status': random.choice(['active', 'inactive', 'deprecated']),
                            'metadata': {'version_info': f'v{v}', 'environment': 'test'}
                        }
                    )
                    self.test_data['versions'].append(version)
        
        # Create containers
        with performance_timer(self.metrics, 'container_create'):
            for i in range(25):
                container = Container.objects.create(
                    code=f'PERF_CONTAINER_{i:03d}',
                    name=f'Performance Container {i}',
                    description=f'Container for performance testing {i}'
                )
                self.test_data['containers'].append(container)
        
        # Create container versions with references
        print("Creating container versions with references...")
        with performance_timer(self.metrics, 'container_version_create_complex'):
            for container in self.test_data['containers']:
                container_version = ContainerVersion.objects.create(
                    entity=container,
                    version_number=0,
                    data={
                        'container_type': 'docker',
                        'base_image': 'ubuntu:22.04',
                        'metadata': {'created_by': 'perf_test'}
                    }
                )
                self.test_data['container_versions'].append(container_version)
                
                # Add references to random entities
                for j in range(random.randint(3, 8)):
                    if self.test_data['entities']:
                        target_entity = random.choice(self.test_data['entities'])
                        # Find versions for this entity
                        entity_versions = [v for v in self.test_data['versions'] if v.entity == target_entity]
                        if entity_versions:  # Only create reference if versions exist
                            chosen_version = random.choice(entity_versions)
                            reference = ContainerReference.objects.create(
                                container_version=container_version,
                                reference_name=f'ref_{j}',
                                referenced_entity=target_entity,
                                symlink_name='latest',
                                symlink_version=chosen_version,
                                resolved_version=chosen_version
                            )
                            self.test_data['references'].append(reference)
        
        # Test container resolution performance
        print("Testing container resolution...")
        with performance_timer(self.metrics, 'container_resolution_single'):
            if self.test_data['container_versions']:
                cv = self.test_data['container_versions'][0]
                references = list(ContainerReference.objects.filter(container_version=cv).select_related('referenced_entity', 'resolved_version'))
        
        with performance_timer(self.metrics, 'container_resolution_bulk'):
            all_references = list(ContainerReference.objects.filter(
                container_version__in=self.test_data['container_versions'][:10]
            ).select_related('referenced_entity', 'resolved_version', 'container_version'))
        
        # Test complex container queries
        with performance_timer(self.metrics, 'container_complex_query'):
            complex_query = ContainerVersion.objects.filter(
                entity__code__startswith='PERF_CONTAINER_',
                data__container_type='docker'
            ).select_related('entity').prefetch_related('references__referenced_entity')
            results = list(complex_query)
        
        print(f"✅ Container system performance tested")
    
    def test_3_discussion_notes_performance(self):
        """Test discussion and notes system performance."""
        print("\\n💬 TEST 3: Discussion & Notes System Performance")
        print("-" * 55)
        
        # Create discussions using optimized bulk creation
        print("Creating discussions...")
        with performance_timer(self.metrics, 'discussion_create_batch'):
            # Prepare discussion data for bulk creation
            discussion_data = []
            for i in range(200):
                # Randomly attach to different object types
                discussion_info = {
                    'title': f'PERF_Discussion_{i:03d}',
                    'description': f'Performance test discussion {i}',
                    'discussion_type': random.choice(['general', 'issue', 'review']),
                    'priority': random.choice(['low', 'normal', 'high']),
                    'created_by': f'user_{i % 10}'
                }
                
                if i % 4 == 0 and self.test_data['entities']:
                    discussion_info['versioned_entity'] = random.choice(self.test_data['entities'])
                elif i % 4 == 1 and self.test_data['versions']:
                    discussion_info['version'] = random.choice(self.test_data['versions'])
                elif i % 4 == 2 and self.test_data['containers']:
                    discussion_info['container'] = random.choice(self.test_data['containers'])
                else:
                    # Skip if no target objects available
                    continue
                    
                discussion_data.append(discussion_info)
            
            # Use optimized bulk creation
            if discussion_data:
                created_discussions = Discussion.objects.bulk_create_optimized(discussion_data)
                self.test_data['discussions'].extend(created_discussions)
        
        # Create comments with threading using optimized bulk method
        print("Creating threaded comments...")
        with performance_timer(self.metrics, 'comment_create_threaded'):
            comment_data = []
            
            for discussion in self.test_data['discussions'][:50]:  # Limit for performance
                num_comments = random.randint(3, 10)
                
                # Prepare root comments
                for c in range(num_comments):
                    comment_data.append({
                        'discussion': discussion,
                        'content': f'Performance test comment {c} for discussion {discussion.id}',
                        'author': f'commenter_{c % 5}',
                        'comment_type': 'comment'
                    })
            
            # Use optimized bulk creation for comments
            if comment_data:
                created_comments_result = Comment.objects.bulk_create_threaded(comment_data)
                # The bulk_create_threaded returns a dict with root_comments and threaded_comments
                if isinstance(created_comments_result, dict):
                    self.test_data['comments'].extend(created_comments_result.get('root_comments', []))
                    self.test_data['comments'].extend(created_comments_result.get('threaded_comments', []))
                else:
                    self.test_data['comments'].extend(created_comments_result)
        
        # Add reactions to comments using optimized bulk method
        print("Adding reactions...")
        with performance_timer(self.metrics, 'comment_reactions'):
            # Prepare reaction updates
            reaction_updates = []
            emojis = ['👍', '❤️', '😊', '🚀', '💯']
            
            for comment in self.test_data['comments'][:100]:  # Limit for performance
                selected_emojis = random.sample(emojis, random.randint(1, 3))
                reactions_dict = {}
                for emoji in selected_emojis:
                    reactor = f'reactor_{random.randint(1, 20)}'
                    if emoji not in reactions_dict:
                        reactions_dict[emoji] = []
                    reactions_dict[emoji].append(reactor)
                
                reaction_updates.append({
                    'comment': comment,
                    'reactions': reactions_dict
                })
            
            # Use optimized bulk reaction updates
            if reaction_updates:
                Comment.objects.bulk_update_reactions(reaction_updates)
        
        # Create notes
        print("Creating notes...")
        with performance_timer(self.metrics, 'note_create_batch'):
            for i in range(300):
                # Randomly attach to different object types
                if i % 3 == 0 and self.test_data['entities']:
                    target = random.choice(self.test_data['entities'])
                    note = Note.objects.create(
                        versioned_entity=target,
                        title=f'PERF_Note_{i:03d}',
                        content=f'Performance test note {i}',
                        note_type=random.choice(['general', 'todo', 'reminder']),
                        author=f'note_author_{i % 8}'
                    )
                elif i % 3 == 1 and self.test_data['versions']:
                    target = random.choice(self.test_data['versions'])
                    note = Note.objects.create(
                        version=target,
                        title=f'PERF_Note_{i:03d}',
                        content=f'Performance test note {i}',
                        note_type=random.choice(['general', 'todo', 'reminder']),
                        author=f'note_author_{i % 8}'
                    )
                elif i % 3 == 2 and self.test_data['containers']:
                    target = random.choice(self.test_data['containers'])
                    note = Note.objects.create(
                        container=target,
                        title=f'PERF_Note_{i:03d}',
                        content=f'Performance test note {i}',
                        note_type=random.choice(['general', 'todo', 'reminder']),
                        author=f'note_author_{i % 8}'
                    )
                else:
                    continue
                    
                self.test_data['notes'].append(note)
        
        print(f"✅ Discussion & Notes performance tested")
    
    def test_4_complex_query_performance(self):
        """Test complex query patterns performance."""
        print("\\n🔍 TEST 4: Complex Query Performance")
        print("-" * 45)
        
        # Complex joins and filtering
        with performance_timer(self.metrics, 'query_complex_join'):
            complex_results = list(Discussion.objects.select_related(
                'versioned_entity', 'version', 'container'
            ).prefetch_related(
                'comments'
            ).filter(
                status='open',
                priority__in=['normal', 'high']
            ))
        
        # Aggregation queries
        with performance_timer(self.metrics, 'query_aggregation'):
            from django.db.models import Count, Avg
            aggregated = Discussion.objects.filter(
                title__startswith='PERF_'
            ).aggregate(
                total_discussions=Count('id'),
                avg_comments=Avg('comments__id')
            )
        
        # JSON field queries
        with performance_timer(self.metrics, 'query_json_field'):
            json_results = list(Version.objects.filter(
                data__status='active',
                data__metadata__test=True
            ))
        
        # Subquery performance
        with performance_timer(self.metrics, 'query_subquery'):
            from django.db.models import Exists, OuterRef
            subquery_results = list(VersionedEntity.objects.filter(
                Exists(Discussion.objects.filter(versioned_entity=OuterRef('pk')))
            ))
        
        # Full-text search simulation
        with performance_timer(self.metrics, 'query_text_search'):
            search_results = list(Discussion.objects.filter(
                title__icontains='PERF_',
                description__icontains='performance'
            ))
        
        # Cross-model complex query
        with performance_timer(self.metrics, 'query_cross_model'):
            cross_results = list(Note.objects.select_related(
                'versioned_entity', 'version', 'container'
            ).filter(
                note_type='todo',
                is_completed=False
            ).order_by('-created_at'))
        
        print(f"✅ Complex queries performance tested")
    
    def test_5_bulk_operations_performance(self):
        """Test bulk operations performance."""
        print("\\n⚡ TEST 5: Bulk Operations Performance")
        print("-" * 45)
        
        # Bulk create large dataset
        print("Testing bulk create...")
        entities_data = []
        for i in range(500):
            entities_data.append(VersionedEntity(
                code=f'PERF_BULK_ENTITY_{i:04d}',
                name=f'Bulk Test Entity {i} - Created in bulk operation batch {i//100}'
            ))
        
        with performance_timer(self.metrics, 'bulk_create_500_entities'):
            bulk_entities = VersionedEntity.objects.bulk_create(entities_data)
            self.test_data['entities'].extend(bulk_entities)
        
        # Bulk create versions
        versions_data = []
        for entity in bulk_entities[:100]:  # Limit to prevent excessive data
            for v in range(3):
                versions_data.append(Version(
                    entity=entity,
                    version_number=v,
                    data={'bulk_created': True, 'version': v}
                ))
        
        with performance_timer(self.metrics, 'bulk_create_300_versions'):
            bulk_versions = Version.objects.bulk_create(versions_data)
            self.test_data['versions'].extend(bulk_versions)
        
        # Bulk update
        with performance_timer(self.metrics, 'bulk_update_500_entities'):
            VersionedEntity.objects.filter(
                code__startswith='PERF_BULK_ENTITY_'
            ).update(name='Bulk Updated Entity Name')
        
        # Bulk delete
        with performance_timer(self.metrics, 'bulk_delete_entities'):
            # Delete half of the bulk created entities
            VersionedEntity.objects.filter(
                code__startswith='PERF_BULK_ENTITY_02'
            ).delete()
        
        print(f"✅ Bulk operations performance tested")
    
    def test_6_memory_usage_analysis(self):
        """Test memory usage patterns."""
        print("\\n🧠 TEST 6: Memory Usage Analysis")
        print("-" * 40)
        
        initial_memory = self.metrics.get_memory_usage()
        
        # Large dataset creation
        with performance_timer(self.metrics, 'memory_large_dataset_creation'):
            large_entities = []
            for i in range(1000):
                entity = VersionedEntity(
                    code=f'PERF_MEMORY_{i:04d}',
                    name=f'Memory Test Entity {i} - ' + 'A' * 500  # Large name field
                )
                large_entities.append(entity)
            
            # Bulk create to test memory efficiency
            VersionedEntity.objects.bulk_create(large_entities)
        
        peak_memory = self.metrics.get_memory_usage()
        
        # Large query result memory usage
        with performance_timer(self.metrics, 'memory_large_query_result'):
            large_results = list(VersionedEntity.objects.filter(
                code__startswith='PERF_MEMORY_'
            ).select_related().prefetch_related())
        
        # Memory cleanup test
        with performance_timer(self.metrics, 'memory_cleanup'):
            del large_results
            del large_entities
            gc.collect()
        
        final_memory = self.metrics.get_memory_usage()
        
        print(f"   Initial Memory: {initial_memory:.1f} MB")
        print(f"   Peak Memory: {peak_memory:.1f} MB")
        print(f"   Final Memory: {final_memory:.1f} MB")
        print(f"   Memory Growth: {peak_memory - initial_memory:.1f} MB")
        
        print(f"✅ Memory usage analysis completed")
    
    def test_7_concurrent_operations(self):
        """Test concurrent operations performance."""
        print("\\n🔄 TEST 7: Concurrent Operations Performance")
        print("-" * 50)
        
        def create_discussion_worker(thread_id, count):
            """Worker function for concurrent discussion creation."""
            discussions_created = 0
            errors = []
            
            try:
                for i in range(count):
                    if self.test_data['entities']:
                        entity = random.choice(self.test_data['entities'])
                        discussion = Discussion.objects.create(
                            versioned_entity=entity,
                            title=f'PERF_CONCURRENT_T{thread_id}_{i:03d}',
                            description=f'Concurrent test discussion {i} from thread {thread_id}',
                            discussion_type='general',
                            created_by=f'thread_user_{thread_id}'
                        )
                        discussions_created += 1
            except Exception as e:
                errors.append(str(e))
            
            return discussions_created, errors
        
        # Test concurrent discussion creation
        with performance_timer(self.metrics, 'concurrent_discussion_creation'):
            with ThreadPoolExecutor(max_workers=5) as executor:
                futures = []
                for thread_id in range(5):
                    future = executor.submit(create_discussion_worker, thread_id, 20)
                    futures.append(future)
                
                total_created = 0
                total_errors = []
                for future in as_completed(futures):
                    created, errors = future.result()
                    total_created += created
                    total_errors.extend(errors)
        
        print(f"   Concurrent discussions created: {total_created}")
        print(f"   Concurrent errors: {len(total_errors)}")
        
        # Test concurrent read operations
        def read_worker():
            """Worker function for concurrent reads."""
            return len(list(Discussion.objects.filter(title__startswith='PERF_')[:10]))
        
        with performance_timer(self.metrics, 'concurrent_read_operations'):
            with ThreadPoolExecutor(max_workers=10) as executor:
                futures = [executor.submit(read_worker) for _ in range(20)]
                results = [future.result() for future in as_completed(futures)]
        
        print(f"✅ Concurrent operations performance tested")
    
    def test_8_database_constraint_performance(self):
        """Test database constraint validation performance."""
        print("\\n🔒 TEST 8: Database Constraint Performance")
        print("-" * 50)
        
        # Test single parent constraint validation
        with performance_timer(self.metrics, 'constraint_validation_valid'):
            if self.test_data['entities']:
                valid_discussion = Discussion.objects.create(
                    versioned_entity=self.test_data['entities'][0],
                    title='PERF_Constraint_Valid',
                    description='Valid constraint test',
                    created_by='constraint_tester'
                )
                self.test_data['discussions'].append(valid_discussion)
        
        # Test constraint violation (should raise error)
        with performance_timer(self.metrics, 'constraint_validation_invalid'):
            try:
                if self.test_data['entities'] and self.test_data['versions']:
                    # This should fail due to multiple parent constraint
                    invalid_discussion = Discussion(
                        versioned_entity=self.test_data['entities'][0],
                        version=self.test_data['versions'][0],  # Multiple parents - should fail
                        title='PERF_Constraint_Invalid',
                        description='Invalid constraint test',
                        created_by='constraint_tester'
                    )
                    invalid_discussion.save()
            except (ValidationError, Exception) as e:
                # Expected to fail - record the error handling performance
                pass
        
        # Test bulk constraint validation
        discussions_data = []
        if self.test_data['entities']:
            for i, entity in enumerate(self.test_data['entities'][:10]):
                discussions_data.append(Discussion(
                    versioned_entity=entity,
                    title=f'PERF_Constraint_Bulk_{i:03d}',
                    description=f'Bulk constraint test {i}',
                    created_by='bulk_constraint_tester'
                ))
        
        with performance_timer(self.metrics, 'constraint_bulk_validation'):
            if discussions_data:
                bulk_discussions = Discussion.objects.bulk_create(discussions_data)
                self.test_data['discussions'].extend(bulk_discussions)
        
        print(f"✅ Database constraint performance tested")
    
    def test_9_json_field_performance(self):
        """Test JSON field operations performance."""
        print("\\n📄 TEST 9: JSON Field Performance")  
        print("-" * 40)
        
        # Create versions with complex JSON data
        complex_json_data = []
        for i in range(100):
            json_data = {
                'status': random.choice(['active', 'inactive', 'pending']),
                'metadata': {
                    'author': f'user_{i % 10}',
                    'environment': random.choice(['dev', 'staging', 'prod']),
                    'tags': [f'tag_{j}' for j in range(random.randint(1, 5))],
                    'config': {
                        'enabled': random.choice([True, False]),
                        'priority': random.randint(1, 10),
                        'settings': {
                            'feature_flags': {f'flag_{k}': random.choice([True, False]) for k in range(3)}
                        }
                    }
                },
                'history': [
                    {'action': f'action_{j}', 'timestamp': f'2025-10-0{j+1}T10:00:00Z'} 
                    for j in range(random.randint(1, 3))
                ]
            }
            complex_json_data.append(json_data)
        
        # Test JSON field creation
        with performance_timer(self.metrics, 'json_field_creation'):
            if self.test_data['entities']:
                for i, json_data in enumerate(complex_json_data[:50]):
                    entity = self.test_data['entities'][i % len(self.test_data['entities'])]
                    version = Version.objects.create(
                        entity=entity,
                        version_number=i + 100,  # Avoid conflicts
                        data=json_data
                    )
                    self.test_data['versions'].append(version)
        
        # Test JSON field queries
        with performance_timer(self.metrics, 'json_field_simple_query'):
            results = list(Version.objects.filter(data__status='active'))
        
        with performance_timer(self.metrics, 'json_field_nested_query'):
            results = list(Version.objects.filter(
                data__metadata__environment='prod',
                data__metadata__config__enabled=True
            ))
        
        with performance_timer(self.metrics, 'json_field_array_query'):
            # SQLite doesn't support contains, so use a different approach
            results = list(Version.objects.filter(data__metadata__has_key='tags'))
        
        # Test JSON field updates
        with performance_timer(self.metrics, 'json_field_update'):
            # Update JSON field by getting objects and updating them
            active_versions = Version.objects.filter(data__status='active')
            for version in active_versions[:10]:  # Limit to first 10 for performance
                version.data['status'] = 'updated'
                version.save()
        
        print(f"✅ JSON field performance tested")
    
    def test_10_system_limits(self):
        """Test system limits and breaking points."""
        print("\\n🚨 TEST 10: System Limits Testing")
        print("-" * 40)
        
        # Test large single record
        with performance_timer(self.metrics, 'large_single_record'):
            large_data = {
                'large_text': 'A' * 10000,  # 10KB text
                'large_array': list(range(1000)),  # Large array
                'large_object': {f'key_{i}': f'value_{i}' for i in range(1000)}  # Large object
            }
            
            if self.test_data['entities']:
                large_version = Version.objects.create(
                    entity=self.test_data['entities'][0],
                    version_number=9999,
                    data=large_data
                )
                self.test_data['versions'].append(large_version)
        
        # Test query result size limits
        with performance_timer(self.metrics, 'large_result_set'):
            # Get all entities - this could be large
            all_test_entities = list(VersionedEntity.objects.filter(
                code__startswith='PERF_'
            ))
        
        # Test deeply nested JSON
        with performance_timer(self.metrics, 'deeply_nested_json'):
            nested_data = {'level_0': {}}
            current = nested_data['level_0']
            for i in range(50):  # 50 levels deep
                current[f'level_{i+1}'] = {}
                current = current[f'level_{i+1}']
            current['data'] = 'deeply nested value'
            
            if self.test_data['entities']:
                nested_version = Version.objects.create(
                    entity=self.test_data['entities'][0],
                    version_number=8888,
                    data=nested_data
                )
                self.test_data['versions'].append(nested_version)
        
        print(f"✅ System limits testing completed")
    
    def generate_comprehensive_report(self):
        """Generate comprehensive performance report."""
        print("\\n" + "=" * 80)
        print("📊 COMPREHENSIVE PERFORMANCE TEST REPORT")
        print("=" * 80)
        print(f"Test Date: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
        print(f"System: Nexus8 Versioned Container & Discussion System")
        print(f"Database: SQLite with Django ORM")
        print(f"Architecture: Explicit Foreign Keys (No GenericForeignKey)")
        
        # Calculate totals
        total_records = sum(len(data) for data in self.test_data.values())
        print(f"Total Test Records Created: {total_records:,}")
        
        print("\\n🎯 PERFORMANCE SUMMARY BY CATEGORY")
        print("-" * 50)
        
        categories = {
            'CRUD Operations': [
                'entity_create_single', 'entity_create_bulk', 'entity_read_single',
                'entity_read_filter', 'entity_update_single', 'entity_update_bulk'
            ],
            'Container System': [
                'container_setup_entities', 'container_create', 'container_version_create_complex',
                'container_resolution_single', 'container_resolution_bulk', 'container_complex_query'
            ],
            'Discussion & Notes': [
                'discussion_create_batch', 'comment_create_threaded', 'comment_reactions',
                'note_create_batch'
            ],
            'Complex Queries': [
                'query_complex_join', 'query_aggregation', 'query_json_field',
                'query_subquery', 'query_text_search', 'query_cross_model'
            ],
            'Bulk Operations': [
                'bulk_create_500_entities', 'bulk_create_300_versions',
                'bulk_update_500_entities', 'bulk_delete_entities'
            ],
            'Concurrent Operations': [
                'concurrent_discussion_creation', 'concurrent_read_operations'
            ],
            'JSON Performance': [
                'json_field_creation', 'json_field_simple_query', 'json_field_nested_query',
                'json_field_array_query', 'json_field_update'
            ]
        }
        
        overall_stats = {'fast_operations': 0, 'total_operations': 0, 'total_time': 0}
        
        for category, operations in categories.items():
            print(f"\\n📈 {category}:")
            category_stats = []
            
            for op in operations:
                summary = self.metrics.get_summary(op)
                if summary:
                    category_stats.append(summary)
                    overall_stats['total_operations'] += 1
                    overall_stats['total_time'] += summary['avg_time_ms']
                    if summary['avg_time_ms'] < 50:  # Under 50ms considered fast
                        overall_stats['fast_operations'] += 1
                    
                    print(f"   {op}: {summary['avg_time_ms']:.2f}ms avg "
                          f"({summary['count']} ops, {summary['avg_queries']:.1f} queries/op)")
                    
                    if summary['error_count'] > 0:
                        print(f"      ⚠️  {summary['error_count']} errors detected")
            
            if category_stats:
                avg_category_time = sum(s['avg_time_ms'] for s in category_stats) / len(category_stats)
                print(f"   📊 Category Average: {avg_category_time:.2f}ms")
        
        # Memory analysis
        print(f"\\n🧠 MEMORY USAGE ANALYSIS")
        print("-" * 30)
        memory_operations = [op for op in self.metrics.metrics['memory'].keys() if self.metrics.metrics['memory'][op]]
        if memory_operations:
            for op in memory_operations[:5]:  # Top 5 memory operations
                summary = self.metrics.get_summary(op)
                if summary:
                    print(f"   {op}: {summary['avg_memory_mb']:.1f}MB avg")
        
        # Overall performance rating
        print(f"\\n🏆 OVERALL PERFORMANCE RATING")
        print("-" * 35)
        
        if overall_stats['total_operations'] > 0:
            avg_operation_time = overall_stats['total_time'] / overall_stats['total_operations']
            fast_percentage = (overall_stats['fast_operations'] / overall_stats['total_operations']) * 100
            
            print(f"   Average Operation Time: {avg_operation_time:.2f}ms")
            print(f"   Fast Operations (< 50ms): {overall_stats['fast_operations']}/{overall_stats['total_operations']} ({fast_percentage:.1f}%)")
            
            # Performance rating
            if avg_operation_time < 20 and fast_percentage > 80:
                rating = "🟢 EXCELLENT"
                description = "Outstanding performance - production ready"
            elif avg_operation_time < 50 and fast_percentage > 60:
                rating = "🟡 GOOD"  
                description = "Good performance - suitable for production"
            elif avg_operation_time < 100 and fast_percentage > 40:
                rating = "🟠 ACCEPTABLE"
                description = "Acceptable performance - may need optimization"
            else:
                rating = "🔴 NEEDS IMPROVEMENT"
                description = "Performance issues detected - optimization required"
            
            print(f"\\n   RATING: {rating}")
            print(f"   {description}")
        
        # Error summary
        total_errors = sum(len(errors) for errors in self.metrics.metrics['errors'].values())
        if total_errors > 0:
            print(f"\\n⚠️  ERRORS DETECTED: {total_errors}")
            for operation, errors in self.metrics.metrics['errors'].items():
                if errors:
                    print(f"   {operation}: {len(errors)} errors")
        else:
            print(f"\\n✅ NO ERRORS DETECTED")
        
        # Recommendations
        print(f"\\n💡 OPTIMIZATION RECOMMENDATIONS")
        print("-" * 40)
        
        slow_operations = []
        for operation, timings in self.metrics.metrics['timing'].items():
            if timings:
                avg_time = sum(timings) / len(timings)
                if avg_time > 100:  # Operations over 100ms
                    slow_operations.append((operation, avg_time))
        
        if slow_operations:
            slow_operations.sort(key=lambda x: x[1], reverse=True)
            print("   Optimize these slow operations:")
            for op, time in slow_operations[:5]:
                print(f"   • {op}: {time:.1f}ms - Consider indexing or query optimization")
        else:
            print("   ✅ All operations performing well")
        
        print(f"\\n🎯 PRODUCTION READINESS ASSESSMENT")
        print("-" * 45)
        
        readiness_score = 0
        total_checks = 5
        
        # Check 1: Average performance
        if avg_operation_time < 50:
            print("   ✅ Average operation time < 50ms")
            readiness_score += 1
        else:
            print("   ❌ Average operation time > 50ms")
        
        # Check 2: Fast operations percentage
        if fast_percentage > 70:
            print("   ✅ >70% of operations are fast (< 50ms)")
            readiness_score += 1
        else:
            print("   ❌ <70% of operations are fast")
        
        # Check 3: Error rate
        if total_errors == 0:
            print("   ✅ No errors detected in testing")
            readiness_score += 1
        else:
            print(f"   ❌ {total_errors} errors detected")
        
        # Check 4: Memory efficiency
        avg_memory = sum(sum(mem) for mem in self.metrics.metrics['memory'].values()) / max(1, sum(len(mem) for mem in self.metrics.metrics['memory'].values()))
        if avg_memory < 10:  # Less than 10MB per operation
            print("   ✅ Memory usage efficient (< 10MB per operation)")
            readiness_score += 1
        else:
            print("   ❌ High memory usage detected")
        
        # Check 5: Database query efficiency
        avg_queries = sum(sum(q) for q in self.metrics.metrics['queries'].values()) / max(1, sum(len(q) for q in self.metrics.metrics['queries'].values()))
        if avg_queries < 5:  # Less than 5 queries per operation
            print("   ✅ Database query efficiency good (< 5 queries per operation)")
            readiness_score += 1
        else:
            print("   ❌ High database query count detected")
        
        readiness_percentage = (readiness_score / total_checks) * 100
        print(f"\\n   PRODUCTION READINESS: {readiness_score}/{total_checks} ({readiness_percentage:.0f}%)")
        
        if readiness_percentage >= 80:
            print("   🎉 SYSTEM IS PRODUCTION READY!")
        elif readiness_percentage >= 60:
            print("   ⚠️  System needs minor optimizations before production")
        else:
            print("   🚨 System requires significant optimization before production")
        
        print("\\n" + "=" * 80)
        print("✅ COMPREHENSIVE PERFORMANCE TEST COMPLETED")
        print("=" * 80)
    
    def run_all_tests(self):
        """Run all performance tests."""
        print("🚀 NEXUS8 COMPREHENSIVE PERFORMANCE TEST SUITE")
        print("=" * 60)
        print(f"Started at: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
        print(f"System: Explicit Foreign Key Architecture")
        print(f"Database: SQLite with Django ORM")
        
        start_time = time.perf_counter()
        
        try:
            # Clean up any existing test data
            self.cleanup_test_data()
            
            # Run all test suites
            self.test_1_crud_operations()
            self.test_2_versioned_container_performance()
            self.test_3_discussion_notes_performance()
            self.test_4_complex_query_performance()
            self.test_5_bulk_operations_performance()
            self.test_6_memory_usage_analysis()
            self.test_7_concurrent_operations()
            self.test_8_database_constraint_performance()
            self.test_9_json_field_performance()
            self.test_10_system_limits()
            
            # Generate comprehensive report
            self.generate_comprehensive_report()
            
        except Exception as e:
            print(f"\\n❌ Test suite failed with error: {e}")
            raise
        finally:
            # Final cleanup
            print(f"\\n🧹 Final cleanup...")
            self.cleanup_test_data()
            
            total_time = (time.perf_counter() - start_time) / 60
            print(f"\\n⏱️  Total test suite time: {total_time:.1f} minutes")


def main():
    """Main entry point for performance testing."""
    suite = ComprehensivePerformanceTestSuite()
    suite.run_all_tests()


if __name__ == '__main__':
    main()
