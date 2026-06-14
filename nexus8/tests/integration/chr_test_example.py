#!/usr/bin/env python3
"""
Complete example demonstrating the versioned container system.

This script creates:
- An asset called chr_test with three versions (draft, approved, latest symlinks)
- A project container called expired_sun
- A shot container underneath the project container
- Three versions of the shot container, each referencing different versions of chr_test

Example Usage:
    cd /path/to/nexus8
    python chr_test_example.py
"""

import os
import sys
import django

# Add the current directory to the Python path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

# Set up Django
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'nexus8.settings')
django.setup()

from trackables.models import (
    VersionedEntity, MediaAsset, Container, Version, Symlink,
    update_symlink, create_container_version
)
from django.db import transaction
from django.db.models import Max


def create_version(entity: VersionedEntity, data: dict, symlinks=None):
    """
    Create a new version of an entity with optional symlinks.
    
    Args:
        entity: The VersionedEntity to create a version for
        data: Dictionary of version data
        symlinks: Optional list of symlink names to create/update
    
    Returns:
        Version: The created version
    """
    version_number = (
        entity.versions.aggregate(Max("version_number"))["version_number__max"] or 0
    ) + 1

    version = Version.objects.create(
        entity=entity,
        version_number=version_number,
        data=data
    )

    if symlinks:
        for name in symlinks:
            update_symlink(entity, name, version)

    return version


def create_chr_test_example():
    """
    Create the complete chr_test example scenario.
    """
    print("🎬 Creating chr_test example scenario...")
    print("=" * 60)
    
    # Clean up any existing data to ensure clean example
    print("\n🧹 Cleaning up existing chr_test data...")
    VersionedEntity.objects.filter(code__in=['chr_test', 'expired_sun']).delete()
    Container.objects.filter(code__in=['expired_sun', 'shot_001']).delete()
    
    with transaction.atomic():
        
        # 1. Create the chr_test asset with three versions
        print("\n1️⃣ Creating chr_test asset...")
        chr_test = MediaAsset.objects.create(
            code='chr_test',
            name='Test Character Asset'
        )
        print(f"   ✅ Created asset: {chr_test}")
        
        # Version 1 - Draft (symlink: draft)
        print("\n   📦 Creating version 1 (draft)...")
        chr_v1 = create_version(
            entity=chr_test,
            data={
                "status": "draft",
                "description": "Initial character design",
                "file_path": "/assets/characters/chr_test_v001.fbx",
                "metadata": {
                    "artist": "John Doe",
                    "created_date": "2025-10-01",
                    "polygon_count": 15420,
                    "texture_resolution": "2048x2048"
                }
            },
            symlinks=["draft"]  # Only draft symlink for version 1
        )
        print(f"      ✅ Version {chr_v1.version_number}: draft status, draft symlink")
        
        # Version 2 - Approved
        print("\n   📦 Creating version 2 (approved)...")
        chr_v2 = create_version(
            entity=chr_test,
            data={
                "status": "approved",
                "description": "Approved character design with texture improvements",
                "file_path": "/assets/characters/chr_test_v002.fbx",
                "metadata": {
                    "artist": "John Doe",
                    "created_date": "2025-10-02", 
                    "polygon_count": 16100,
                    "texture_resolution": "4096x4096",
                    "approved_by": "Jane Smith",
                    "approval_date": "2025-10-02"
                }
            },
            symlinks=["approved"]  # Only approved symlink for version 2
        )
        print(f"      ✅ Version {chr_v2.version_number}: approved status, approved symlink")
        
        # Version 3 - Latest
        print("\n   📦 Creating version 3 (latest)...")
        chr_v3 = create_version(
            entity=chr_test,
            data={
                "status": "latest",
                "description": "Latest character version with animation rig",
                "file_path": "/assets/characters/chr_test_v003.fbx",
                "metadata": {
                    "artist": "John Doe",
                    "created_date": "2025-10-03",
                    "polygon_count": 16800,
                    "texture_resolution": "4096x4096",
                    "has_animation_rig": True,
                    "rig_complexity": "advanced"
                }
            },
            symlinks=["latest"]  # Only latest symlink for version 3
        )
        print(f"      ✅ Version {chr_v3.version_number}: latest status, latest symlink")
        
        # Show current symlinks
        print("\n   🔗 Current symlinks for chr_test:")
        for symlink in chr_test.symlinks.all():
            print(f"      {symlink.name} → v{symlink.version.version_number} ({symlink.version.data.get('status')})")
        
        # 2. Create project container "expired_sun"
        print("\n2️⃣ Creating project container 'expired_sun'...")
        expired_sun = Container.objects.create(
            code='expired_sun',
            name='Expired Sun Project'
        )
        print(f"   ✅ Created project container: {expired_sun}")
        
        # 3. Create shot container underneath the project
        print("\n3️⃣ Creating shot container under project...")
        shot_001 = Container.objects.create(
            code='shot_001',
            name='Opening Shot 001',
            parent_container=expired_sun
        )
        print(f"   ✅ Created shot container: {shot_001}")
        print(f"      Parent: {shot_001.parent_container}")
        
        # 4. Create three versions of the shot container, each referencing different chr_test versions
        print("\n4️⃣ Creating shot container versions...")
        
        # Shot Version 1 - References chr_test:draft (version 1)
        print("\n   📦 Creating shot version 1 (references chr_test:draft)...")
        shot_v1 = create_container_version(
            container=shot_001,
            references={
                "main_character": (chr_test, "draft")  # Will resolve to chr_v1
            }
        )
        print(f"      ✅ Shot v{shot_v1.version_number} created")
        
        # Shot Version 2 - References chr_test:approved (version 2)  
        print("\n   📦 Creating shot version 2 (references chr_test:approved)...")
        shot_v2 = create_container_version(
            container=shot_001,
            references={
                "main_character": (chr_test, "approved")  # Will resolve to chr_v2
            }
        )
        print(f"      ✅ Shot v{shot_v2.version_number} created")
        
        # Shot Version 3 - References chr_test:latest (version 3)
        print("\n   📦 Creating shot version 3 (references chr_test:latest)...")
        shot_v3 = create_container_version(
            container=shot_001,
            references={
                "main_character": (chr_test, "latest")  # Will resolve to chr_v3
            }
        )
        print(f"      ✅ Shot v{shot_v3.version_number} created")
        
        print("\n🎯 Example creation completed successfully!")
        print("=" * 60)
        
        # 5. Demonstrate the results
        print("\n📊 RESULTS SUMMARY:")
        print("=" * 60)
        
        print(f"\n🎨 Asset: {chr_test.code} ({chr_test.name})")
        print(f"   Total versions: {chr_test.versions.count()}")
        
        for version in chr_test.versions.all():
            symlinks = version.symlinks.values_list('name', flat=True)
            symlink_str = f" → {', '.join(symlinks)}" if symlinks else ""
            print(f"   • v{version.version_number}: {version.data.get('status')}{symlink_str}")
        
        print(f"\n🏗️ Project: {expired_sun.code} ({expired_sun.name})")
        print(f"   Child containers: {expired_sun.child_containers.count()}")
        
        print(f"\n🎬 Shot: {shot_001.code} ({shot_001.name})")
        print(f"   Parent: {shot_001.parent_container.code}")
        print(f"   Total versions: {shot_001.versions.count()}")
        
        # Show what each shot version references
        for shot_version in shot_001.versions.all():
            print(f"\n   📦 Shot v{shot_version.version_number} references:")
            for ref in shot_version.references.all():
                ref_version = ref.symlink_version
                print(f"      • {ref.reference_name}: {ref.referenced_entity.code}:{ref.symlink_name}")
                print(f"        └─ Resolved to v{ref_version.version_number} ({ref_version.data.get('status')})")
                print(f"        └─ File: {ref_version.data.get('file_path', 'N/A')}")
        
        print("\n🔍 VERIFICATION QUERIES:")
        print("=" * 60)
        
        # Verify hierarchy
        print(f"\n🌳 Container Hierarchy:")
        print(f"   {expired_sun.code} (project)")
        print(f"   └─ {shot_001.code} (shot)")
        
        # Verify symlink resolution
        print(f"\n🔗 Current Symlink Resolutions for {chr_test.code}:")
        for symlink in chr_test.symlinks.all():
            version = symlink.version
            print(f"   {symlink.name} → v{version.version_number} ({version.data.get('status')})")
        
        # Show reference tracking
        print(f"\n📎 Container References to {chr_test.code}:")
        from trackables.models import ContainerReference
        refs = ContainerReference.objects.filter(referenced_entity=chr_test)
        for ref in refs:
            container_version = ref.container_version
            print(f"   {container_version.entity.code} v{container_version.version_number} → {ref.symlink_name}")
        
        print("\n✨ Example completed! The system now contains:")
        print(f"   • 1 chr_test asset with 3 versions and 3 symlinks")
        print(f"   • 1 expired_sun project container")
        print(f"   • 1 shot_001 container under the project")
        print(f"   • 3 shot container versions referencing different chr_test versions")
        print("\n🎉 All requirements fulfilled!")


if __name__ == "__main__":
    create_chr_test_example()
