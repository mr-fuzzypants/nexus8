#!/usr/bin/env python3
"""
Simple Cross-Container Dependencies Example

This is a concise example showing how to use the get_cross_container_dependencies_cte method.

Example Usage:
    cd /path/to/nexus8/nexus8
    python simple_cross_container_example.py
"""

import os
import sys
import django

# Set up Django
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'nexus8.settings')
django.setup()

from trackables.models import Container, ContainerVersion, create_container_version_with_hierarchy
from django.db import transaction


def simple_cross_container_example():
    """Simple example demonstrating get_cross_container_dependencies_cte usage."""
    
    print("🔍 Simple Cross-Container Dependencies Example")
    print("=" * 55)
    
    with transaction.atomic():
        # Clean up
        for code in ['lib_shared', 'app_frontend', 'app_backend']:
            try:
                Container.objects.get(code=code).delete()
            except Container.DoesNotExist:
                pass
        
        # 1. Create shared library container
        shared_lib = Container.objects.create(
            code='lib_shared',
            name='Shared Component Library'
        )
        
        # 2. Create frontend app container
        frontend_app = Container.objects.create(
            code='app_frontend',
            name='Frontend Application'
        )
        
        # 3. Create backend app container
        backend_app = Container.objects.create(
            code='app_backend', 
            name='Backend Application'
        )
        
        # 4. Create container versions with dependencies
        
        # Shared lib v1 (no dependencies)
        shared_v1 = create_container_version_with_hierarchy(
            shared_lib,
            references={},
            parent_container_version=None
        )
        print(f"Created: {shared_lib.code} v{shared_v1.version_number}")
        
        # Frontend v1 depends on shared lib
        frontend_v1 = create_container_version_with_hierarchy(
            frontend_app,
            references={},
            parent_container_version=shared_v1  # Cross-container dependency!
        )
        print(f"Created: {frontend_app.code} v{frontend_v1.version_number} -> depends on {shared_lib.code}")
        
        # Backend v1 depends on frontend (which depends on shared lib)
        backend_v1 = create_container_version_with_hierarchy(
            backend_app,
            references={},
            parent_container_version=frontend_v1  # Cross-container dependency chain!
        )
        print(f"Created: {backend_app.code} v{backend_v1.version_number} -> depends on {frontend_app.code}")
        
        print("\n" + "=" * 55)
        print("🔍 ANALYZING CROSS-CONTAINER DEPENDENCIES")
        print("=" * 55)
        
        # Example 1: Analyze frontend dependencies
        print(f"\n📋 Dependencies for {frontend_app.code} v{frontend_v1.version_number}:")
        frontend_deps = ContainerVersion.objects.get_cross_container_dependencies_cte(frontend_v1)
        
        if frontend_deps:
            for dep_id, container_code, version_num, depth, parent_container_id, is_cross_container in frontend_deps:
                if is_cross_container:
                    print(f"   ├─ Cross-container: {container_code} v{version_num} (depth: {depth})")
                else:
                    print(f"   ├─ Internal: {container_code} v{version_num} (depth: {depth})")
        else:
            print("   No dependencies found")
        
        # Example 2: Analyze backend dependencies (should show chain)
        print(f"\n📋 Dependencies for {backend_app.code} v{backend_v1.version_number}:")
        backend_deps = ContainerVersion.objects.get_cross_container_dependencies_cte(backend_v1)
        
        if backend_deps:
            for dep_id, container_code, version_num, depth, parent_container_id, is_cross_container in backend_deps:
                if is_cross_container:
                    print(f"   ├─ Cross-container: {container_code} v{version_num} (depth: {depth})")
                else:
                    print(f"   ├─ Internal: {container_code} v{version_num} (depth: {depth})")
        else:
            print("   No dependencies found")
        
        print("\n" + "=" * 55)
        print("💡 USAGE PATTERNS")
        print("=" * 55)
        
        print("""
# Basic usage:
container_version = ContainerVersion.objects.get(id=123)
dependencies = ContainerVersion.objects.get_cross_container_dependencies_cte(container_version)

# Process results:
for dep_id, container_code, version_num, depth, parent_container_id, is_cross_container in dependencies:
    if is_cross_container:
        print(f"Depends on: {container_code} v{version_num} at depth {depth}")

# Impact analysis:
def find_affected_containers(changed_container_code):
    affected = set()
    for cv in ContainerVersion.objects.all():
        deps = ContainerVersion.objects.get_cross_container_dependencies_cte(cv)
        for dep in deps:
            _, container_code, _, _, _, is_cross in dep
            if container_code == changed_container_code and is_cross:
                affected.add(cv.get_container().code)
    return affected
        """)


if __name__ == '__main__':
    try:
        simple_cross_container_example()
        print("\n✅ Example completed successfully!")
    except Exception as e:
        print(f"\n❌ Example failed: {e}")
        import traceback
        traceback.print_exc()
