#!/usr/bin/env python3

"""
Data Serialization Performance Test for Nexus8

Tests serialization performance of versioned entities and containers
to ensure production-ready API response times.
"""

import os
import sys
import django
import json
import time
from decimal import Decimal

# Django setup
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'nexus8.settings')
django.setup()

from trackables.models import VersionedEntity, Version, Container, ContainerVersion, ContainerReference
from django.core import serializers
from django.forms.models import model_to_dict
from django.http import JsonResponse
from django.core.serializers.json import DjangoJSONEncoder


class PerformanceTimer:
    def __init__(self, description):
        self.description = description
        
    def __enter__(self):
        self.start = time.perf_counter()
        return self
        
    def __exit__(self, *args):
        self.end = time.perf_counter()
        self.duration = (self.end - self.start) * 1000  # Convert to milliseconds
        

def create_test_data():
    """Create test data for serialization testing."""
    print("🏗️  Creating test data for serialization...")
    
    # Create entities with complex JSON data
    entities = []
    for i in range(20):
        entity = VersionedEntity.objects.create(
            code=f"ENTITY_{i:03d}",
            name=f"Test Entity {i}"
        )
        entities.append(entity)
    
    # Create versions with rich JSON data
    versions = []
    for entity in entities:
        for v in range(10):  # 10 versions per entity
            version_data = {
                "status": "active" if v % 2 == 0 else "inactive",
                "version_number": f"1.{v}.0",
                "metadata": {
                    "author": f"user_{v % 5}",
                    "description": f"Version {v} of {entity.name}" * 3,  # Longer text
                    "created_by": "system",
                    "build_info": {
                        "compiler": "gcc-11.2",
                        "optimization": "-O2",
                        "debug": v % 3 == 0
                    }
                },
                "tags": [f"tag_{j}" for j in range(v % 5 + 1)],
                "files": [
                    {
                        "path": f"/app/src/file_{j}.py",
                        "size": 1024 * (j + 1),
                        "checksum": f"sha256_{j}" * 8
                    } for j in range(v % 3 + 1)
                ],
                "dependencies": [
                    {
                        "name": f"lib_{j}",
                        "version": f"2.{j}.0",
                        "required": True
                    } for j in range(v % 4 + 1)
                ],
                "performance_metrics": {
                    "build_time": 45.5 + v * 2.3,
                    "binary_size": 1024000 + v * 50000,
                    "test_coverage": 85.5 + v * 1.2
                }
            }
            
            version = Version.objects.create(
                entity=entity,
                data=version_data,
                version_number=v
            )
            versions.append(version)
    
    # Create containers
    containers = []
    for i in range(5):
        container = Container.objects.create(
            code=f"CONTAINER_{i:02d}",
            name=f"Test Container {i}"
        )
        containers.append(container)
        
        # Create container versions
        for v in range(3):
            container_version = ContainerVersion.objects.create(
                entity=container,
                data={
                    "container_type": "docker" if i % 2 == 0 else "singularity",
                    "base_image": f"ubuntu:20.04-v{v}",
                    "environment": {
                        "PATH": "/usr/local/bin:/usr/bin:/bin",
                        "PYTHON_VERSION": "3.9.0",
                        "NODE_VERSION": "16.14.0"
                    },
                    "volumes": [f"/data/volume_{j}" for j in range(v + 1)],
                    "ports": [8000 + j for j in range(v + 1)]
                },
                version_number=v
            )
            
            # Create references to entities
            for ref_idx in range(min(3, len(entities))):
                ContainerReference.objects.create(
                    container_version=container_version,
                    referenced_entity=entities[ref_idx],
                    reference_version=versions[ref_idx * 10 + v],  # Reference specific version
                    symlink_name=f"ref_{ref_idx}"
                )
    
    print(f"✅ Created {len(entities)} entities, {len(versions)} versions, {len(containers)} containers")
    return entities, versions, containers


def test_model_to_dict_serialization(entities, versions):
    """Test Django's model_to_dict serialization."""
    print("\n📊 Testing model_to_dict serialization...")
    
    times = []
    
    # Test single entity serialization
    with PerformanceTimer("Single entity") as timer:
        for entity in entities[:10]:  # Test 10 entities
            data = model_to_dict(entity)
    times.append(('Single Entity', timer.duration / 10))
    
    # Test single version with JSON data
    with PerformanceTimer("Single version") as timer:
        for version in versions[:20]:  # Test 20 versions
            data = model_to_dict(version)
    times.append(('Single Version (with JSON)', timer.duration / 20))
    
    # Test bulk entity serialization
    with PerformanceTimer("Bulk entities") as timer:
        entities_data = [model_to_dict(entity) for entity in entities]
    times.append(('Bulk Entities (20)', timer.duration))
    
    # Test bulk version serialization
    with PerformanceTimer("Bulk versions") as timer:
        versions_data = [model_to_dict(version) for version in versions[:50]]
    times.append(('Bulk Versions (50)', timer.duration))
    
    return times


def test_django_serializers(entities, versions):
    """Test Django's built-in serializers."""
    print("\n📊 Testing Django serializers...")
    
    times = []
    
    # JSON serializer
    with PerformanceTimer("Django JSON serializer") as timer:
        json_data = serializers.serialize('json', entities)
    times.append(('Django JSON (20 entities)', timer.duration))
    
    with PerformanceTimer("Django JSON versions") as timer:
        json_data = serializers.serialize('json', versions[:50])
    times.append(('Django JSON (50 versions)', timer.duration))
    
    return times


def test_custom_serialization(entities, versions, containers):
    """Test custom serialization methods."""
    print("\n📊 Testing custom serialization...")
    
    times = []
    
    def serialize_version_custom(version):
        """Custom version serialization."""
        return {
            'id': version.id,
            'entity_id': version.entity_id,
            'entity_code': version.entity.code,
            'entity_name': version.entity.name,
            'version_number': version.version_number,
            'created_at': version.created_at.isoformat(),
            'updated_at': version.updated_at.isoformat(),
            'data': version.data,  # JSON field
        }
    
    def serialize_container_with_references(container_version):
        """Custom container serialization with references."""
        references = list(container_version.references.select_related(
            'referenced_entity', 'reference_version'
        ))
        
        return {
            'id': container_version.id,
            'container_code': container_version.entity.code,
            'container_name': container_version.entity.name,
            'version_number': container_version.version_number,
            'data': container_version.data,
            'references': [
                {
                    'symlink_name': ref.symlink_name,
                    'entity_code': ref.referenced_entity.code,
                    'entity_name': ref.referenced_entity.name,
                    'version_number': ref.reference_version.version_number,
                    'version_data': ref.reference_version.data
                }
                for ref in references
            ]
        }
    
    # Test custom version serialization
    with PerformanceTimer("Custom version serialization") as timer:
        versions_data = [serialize_version_custom(v) for v in versions[:50]]
    times.append(('Custom Versions (50)', timer.duration))
    
    # Test container with references (complex serialization)
    container_versions = []
    for container in containers:
        container_versions.extend(list(container.versions.all()))
    
    with PerformanceTimer("Complex container serialization") as timer:
        containers_data = [serialize_container_with_references(cv) for cv in container_versions]
    times.append(('Complex Containers (15)', timer.duration))
    
    # Test JSON encoding of complex data
    with PerformanceTimer("JSON encoding") as timer:
        json_string = json.dumps(containers_data, cls=DjangoJSONEncoder, indent=None)
    times.append(('JSON Encoding (Complex)', timer.duration))
    
    # Test JSON decoding
    with PerformanceTimer("JSON decoding") as timer:
        decoded_data = json.loads(json_string)
    times.append(('JSON Decoding (Complex)', timer.duration))
    
    return times, json_string


def test_api_response_simulation(entities, versions):
    """Simulate API response generation."""
    print("\n📊 Testing API response simulation...")
    
    times = []
    
    def api_response_paginated(queryset, page_size=20):
        """Simulate paginated API response."""
        items = list(queryset[:page_size])
        serialized = []
        
        for item in items:
            if isinstance(item, Version):
                serialized.append({
                    'id': item.id,
                    'entity': {
                        'id': item.entity.id,
                        'code': item.entity.code,
                        'name': item.entity.name
                    },
                    'version_number': item.version_number,
                    'created_at': item.created_at.isoformat(),
                    'data': item.data
                })
            else:  # Entity
                serialized.append({
                    'id': item.id,
                    'code': item.code,
                    'name': item.name,
                    'created_at': item.created_at.isoformat(),
                    'versions_count': item.versions.count()
                })
        
        return {
            'count': len(serialized),
            'results': serialized
        }
    
    # Test paginated entity response
    with PerformanceTimer("API Entities Response") as timer:
        response_data = api_response_paginated(entities)
        json_response = json.dumps(response_data, cls=DjangoJSONEncoder)
    times.append(('API Entities (20)', timer.duration))
    
    # Test paginated versions response  
    with PerformanceTimer("API Versions Response") as timer:
        response_data = api_response_paginated(versions, page_size=50)
        json_response = json.dumps(response_data, cls=DjangoJSONEncoder)
    times.append(('API Versions (50)', timer.duration))
    
    # Test response size
    response_size_kb = len(json_response.encode('utf-8')) / 1024
    times.append(('Response Size', response_size_kb))
    
    return times


def calculate_serialization_metrics(all_times):
    """Calculate key serialization performance metrics."""
    print("\n📈 Serialization Performance Analysis")
    print("=" * 60)
    
    # Group times by category
    single_item_times = []
    bulk_times = []
    api_times = []
    
    for name, time_ms in all_times:
        if 'Single' in name:
            single_item_times.append(time_ms)
        elif 'Bulk' in name or 'API' in name or 'Complex' in name:
            bulk_times.append(time_ms)
    
    # Calculate key metrics
    if single_item_times:
        avg_single = sum(single_item_times) / len(single_item_times)
        print(f"Average Single Item Serialization: {avg_single:.3f}ms")
    
    if bulk_times:
        avg_bulk = sum(bulk_times) / len(bulk_times)
        print(f"Average Bulk Serialization: {avg_bulk:.3f}ms")
    
    # Print detailed results
    print("\nDetailed Results:")
    print("-" * 60)
    for name, time_ms in all_times:
        if isinstance(time_ms, float) and time_ms > 100:  # Likely size in KB
            print(f"{name:<30}: {time_ms:.1f} KB")
        else:
            print(f"{name:<30}: {time_ms:.3f}ms")
    
    return single_item_times, bulk_times


def main():
    """Run serialization performance tests."""
    print("🚀 Nexus8 Data Serialization Performance Test")
    print("=" * 60)
    
    # Create test data
    entities, versions, containers = create_test_data()
    
    all_times = []
    
    # Run serialization tests
    all_times.extend(test_model_to_dict_serialization(entities, versions))
    all_times.extend(test_django_serializers(entities, versions))
    custom_times, json_sample = test_custom_serialization(entities, versions, containers)
    all_times.extend(custom_times)
    all_times.extend(test_api_response_simulation(entities, versions))
    
    # Calculate metrics
    single_times, bulk_times = calculate_serialization_metrics(all_times)
    
    # Production readiness assessment
    print("\n🎯 Production Readiness Assessment")
    print("=" * 60)
    
    if single_times:
        avg_single = sum(single_times) / len(single_times)
        if avg_single < 1.0:
            status = "🟢 EXCELLENT"
        elif avg_single < 5.0:
            status = "🟡 GOOD" 
        else:
            status = "🔴 NEEDS OPTIMIZATION"
        print(f"Single Item Serialization: {avg_single:.3f}ms - {status}")
    
    if bulk_times:
        avg_bulk = sum(bulk_times) / len(bulk_times)
        if avg_bulk < 50.0:
            status = "🟢 EXCELLENT"
        elif avg_bulk < 200.0:
            status = "🟡 GOOD"
        else:
            status = "🔴 NEEDS OPTIMIZATION"
        print(f"Bulk Serialization: {avg_bulk:.3f}ms - {status}")
    
    # Sample JSON output size
    sample_size = len(json_sample.encode('utf-8')) / 1024
    print(f"Sample JSON Size: {sample_size:.1f} KB")
    
    # Clean up test data
    print("\n🧹 Cleaning up test data...")
    VersionedEntity.objects.filter(code__startswith='ENTITY_').delete()
    Container.objects.filter(code__startswith='CONTAINER_').delete()
    
    print("✅ Serialization performance test completed!")


if __name__ == "__main__":
    main()
