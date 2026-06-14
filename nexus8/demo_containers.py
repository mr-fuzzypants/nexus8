#!/usr/bin/env python3
"""
Demo script showing the versioned container system with symlink references.
This demonstrates how to create containers that reference specific versions
of assets through symlinks, and how to query them efficiently.
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
    create_version, create_container_version, update_resolved_references
)
from django.db.models import Prefetch


def demo_versioned_containers():
    print("🚀 Versioned Container Demo")
    print("=" * 50)
    
    # Clean up any existing data for demo
    Container.objects.filter(code__startswith='demo_').delete()
    MediaAsset.objects.filter(code__startswith='demo_').delete()
    VersionedEntity.objects.filter(code__startswith='demo_').delete()
    
    print("\n1. Creating demo entities...")
    
    # Create some demo assets
    character = MediaAsset.objects.create(
        code='demo_character',
        name='Demo Character',
        file_path='/assets/characters/hero.fbx',
        media_type='3D_MODEL'
    )
    
    environment = MediaAsset.objects.create(
        code='demo_environment',
        name='Demo Environment',
        file_path='/assets/environments/forest.usd',
        media_type='SCENE'
    )
    
    audio_track = VersionedEntity.objects.create(
        code='demo_audio',
        name='Demo Audio Track'
    )
    
    # Create a container
    scene_container = Container.objects.create(
        code='demo_scene_01',
        name='Opening Scene Container',
        description='Container for the opening scene assets'
    )
    
    print(f"✅ Created entities: {character.code}, {environment.code}, {audio_track.code}")
    print(f"✅ Created container: {scene_container.code}")
    
    print("\n2. Creating asset versions with symlinks...")
    
    # Create versions for character
    char_v1 = create_version(character, {
        "model_file": "hero_v1.fbx",
        "textures": ["hero_diffuse_v1.png", "hero_normal_v1.png"],
        "poly_count": 5000
    }, symlinks=["latest", "approved", "draft"])
    
    char_v2 = create_version(character, {
        "model_file": "hero_v2.fbx", 
        "textures": ["hero_diffuse_v2.png", "hero_normal_v2.png"],
        "poly_count": 4500,
        "optimizations": "reduced polygon count"
    }, symlinks=["latest", "draft"])  # Move latest and draft, keep approved on v1
    
    # Create versions for environment
    env_v1 = create_version(environment, {
        "scene_file": "forest_v1.usd",
        "lighting": "daylight_setup_v1",
        "vegetation_density": "high"
    }, symlinks=["latest", "approved"])
    
    # Create versions for audio
    audio_v1 = create_version(audio_track, {
        "file": "ambient_forest_v1.wav",
        "duration": 120,
        "loop": True
    }, symlinks=["latest", "approved"])
    
    print(f"✅ Character versions: v{char_v1.version_number} (approved), v{char_v2.version_number} (latest)")
    print(f"✅ Environment versions: v{env_v1.version_number} (latest, approved)")
    print(f"✅ Audio versions: v{audio_v1.version_number} (latest, approved)")
    
    print("\n3. Creating container version with symlink references...")
    
    # Create first container version that references specific symlinks
    container_v1 = create_container_version(
        scene_container,
        references={
            "hero_character": (character, "approved"),     # Will get char_v1
            "scene_environment": (environment, "latest"),  # Will get env_v1  
            "background_audio": (audio_track, "approved")  # Will get audio_v1
        },
        symlinks=["latest", "approved"]  # Tag this container version
    )
    
    print(f"✅ Created container v{container_v1.version_number} with 3 references")
    
    print("\n4. Showing resolved references...")
    
    # Show what the container references resolve to
    resolved_refs = scene_container.get_resolved_references(container_v1.version_number)
    for ref in resolved_refs:
        print(f"  📎 {ref.reference_name}: {ref.referenced_entity.code}:{ref.symlink_name} "
              f"→ v{ref.symlink_version.version_number}")
    
    print("\n5. Creating new asset versions and updating symlinks...")
    
    # Create a new character version and move 'approved' symlink
    char_v3 = create_version(character, {
        "model_file": "hero_v3.fbx",
        "textures": ["hero_diffuse_v3.png", "hero_normal_v3.png"], 
        "poly_count": 4200,
        "optimizations": "further optimized, new UV layout"
    }, symlinks=["approved", "latest"])  # Move both symlinks to v3
    
    # Create new environment version
    env_v2 = create_version(environment, {
        "scene_file": "forest_v2.usd",
        "lighting": "dynamic_lighting_v1", 
        "vegetation_density": "medium",
        "weather_effects": "light_fog"
    }, symlinks=["latest"])  # Move latest, keep approved on v1
    
    print(f"✅ Character now: approved=v{char_v3.version_number}, latest=v{char_v3.version_number}")
    print(f"✅ Environment now: approved=v{env_v1.version_number}, latest=v{env_v2.version_number}")
    
    print("\n6. Creating second container version...")
    
    # Create another container version with the same reference names
    # but they'll resolve to different versions now
    container_v2 = create_container_version(
        scene_container,
        references={
            "hero_character": (character, "approved"),     # Will get char_v3 now!
            "scene_environment": (environment, "latest"),  # Will get env_v2 now!
            "background_audio": (audio_track, "approved")  # Still audio_v1
        },
        symlinks=["latest"]  # Update container's latest symlink
    )
    
    print(f"✅ Created container v{container_v2.version_number}")
    
    print("\n7. Comparing container versions...")
    
    print(f"\n📦 Container v{container_v1.version_number} references:")
    v1_resolved = scene_container.resolve_all_at_version(container_v1.version_number)
    for ref_name, info in v1_resolved.items():
        print(f"  {ref_name}: {info['entity'].code}:{info['symlink_name']} "
              f"was v{info['was_pinned_to'].version_number}, "
              f"now resolves to v{info['resolved_version'].version_number if info['resolved_version'] else 'None'}")
    
    print(f"\n📦 Container v{container_v2.version_number} references:")
    v2_resolved = scene_container.resolve_all_at_version(container_v2.version_number) 
    for ref_name, info in v2_resolved.items():
        print(f"  {ref_name}: {info['entity'].code}:{info['symlink_name']} "
              f"was v{info['was_pinned_to'].version_number}, "
              f"now resolves to v{info['resolved_version'].version_number if info['resolved_version'] else 'None'}")
    
    print("\n8. Efficient bulk queries...")
    
    # Update resolved references to current state
    updated_count = update_resolved_references()
    print(f"✅ Updated {updated_count} resolved reference caches")
    
    # Efficient query: get all containers with their references
    from trackables.models import ContainerReference
    containers = Container.objects.prefetch_related(
        Prefetch(
            'versions__references',
            queryset=ContainerReference.objects.select_related(
                'referenced_entity', 'symlink_version', 'resolved_version'
            ),
            to_attr='prefetched_refs'
        )
    ).prefetch_related('versions')
    
    print(f"\n📊 Found {containers.count()} containers")
    for container in containers:
        for version in container.versions.all():
            if hasattr(version, 'prefetched_refs'):
                print(f"  📦 {container.code} v{version.version_number}: {len(version.prefetched_refs)} references")
    
    print("\n9. Finding containers that use specific assets...")
    
    # Find all containers that reference the character asset
    containers_using_char = Container.objects.filter(
        versions__references__referenced_entity=character
    ).distinct()
    
    print(f"🔍 Containers using {character.code}: {list(containers_using_char.values_list('code', flat=True))}")
    
    print("\n✨ Demo completed successfully!")
    print("\nKey Features Demonstrated:")
    print("- ✅ Versioned containers with symlink references")  
    print("- ✅ Pinning to specific symlink versions at container creation time")
    print("- ✅ Efficient querying of resolved references")
    print("- ✅ Tracking when current symlinks differ from pinned versions")
    print("- ✅ Bulk operations and optimized database queries")
    print("- ✅ Finding containers that reference specific assets")


if __name__ == "__main__":
    demo_versioned_containers()
