#!/usr/bin/env python
"""
CG Feature Film Production Scale Test - October 3, 2025

Simulates a complete CG feature film production pipeline with:
- Episodes/Sequences
- Shots within episodes
- Assets (characters, environments, props, effects)
- Multiple versions of each asset
- Cross-shot asset references via symlinks
- Container hierarchies matching film production structure

This test is parameterizable to scale from small indie films to massive
studio productions with thousands of shots and assets.
"""

import os
import sys
import django
import time
import random
import json
from datetime import datetime, timedelta
from typing import Dict, List, Tuple, Any
from dataclasses import dataclass
from collections import defaultdict

# Setup Django
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'nexus8.settings')
django.setup()

from django.db import transaction, connection
from django.utils import timezone
from trackables.models import (
    Container, ContainerVersion, ContainerReference, 
    VersionedEntity, Version, Symlink
)

@dataclass
class FilmProductionConfig:
    """Configuration for film production scale test."""
    # Film structure
    num_episodes: int = 3              # Number of episodes/sequences
    shots_per_episode: int = 50        # Shots per episode (total shots = episodes * shots_per_episode)
    
    # Asset counts
    num_characters: int = 12           # Main and supporting characters
    num_environments: int = 25         # Different environments/sets
    num_props: int = 40               # Props and set pieces
    num_effects: int = 30             # VFX elements and particle systems
    
    # Versioning
    avg_versions_per_asset: int = 8    # Average versions per asset
    version_variance: int = 4          # +/- variance in version count
    
    # References (how many assets each shot references)
    avg_character_refs_per_shot: int = 2    # Characters appearing in shot
    avg_environment_refs_per_shot: int = 1  # Usually one main environment
    avg_prop_refs_per_shot: int = 3         # Props in shot
    avg_effect_refs_per_shot: int = 2       # VFX elements
    
    # Symlink patterns (production workflow stages)
    symlink_types: List[str] = None
    
    def __post_init__(self):
        if self.symlink_types is None:
            self.symlink_types = [
                'latest',          # Latest version
                'approved',        # Director approved
                'animation_ready', # Ready for animation
                'lighting_ready',  # Ready for lighting
                'final',          # Final render version
                'archived'        # Archived/backup version
            ]
    
    @property
    def total_shots(self) -> int:
        return self.num_episodes * self.shots_per_episode
    
    @property
    def total_assets(self) -> int:
        return self.num_characters + self.num_environments + self.num_props + self.num_effects
    
    @property
    def estimated_total_versions(self) -> int:
        return self.total_assets * self.avg_versions_per_asset
    
    @property
    def estimated_total_references(self) -> int:
        return self.total_shots * (
            self.avg_character_refs_per_shot +
            self.avg_environment_refs_per_shot + 
            self.avg_prop_refs_per_shot +
            self.avg_effect_refs_per_shot
        )

# Predefined film production configurations
FILM_CONFIGS = {
    'indie_short': FilmProductionConfig(
        num_episodes=1,
        shots_per_episode=25,
        num_characters=4,
        num_environments=6,
        num_props=15,
        num_effects=8,
        avg_versions_per_asset=4
    ),
    
    'indie_feature': FilmProductionConfig(
        num_episodes=3,
        shots_per_episode=75,
        num_characters=8,
        num_environments=15,
        num_props=30,
        num_effects=20,
        avg_versions_per_asset=6
    ),
    
    'studio_feature': FilmProductionConfig(
        num_episodes=5,
        shots_per_episode=150,
        num_characters=15,
        num_environments=35,
        num_props=60,
        num_effects=45,
        avg_versions_per_asset=10
    ),
    
    'epic_blockbuster': FilmProductionConfig(
        num_episodes=8,
        shots_per_episode=200,
        num_characters=25,
        num_environments=60,
        num_props=100,
        num_effects=80,
        avg_versions_per_asset=12
    ),
    
    'massive_franchise': FilmProductionConfig(
        num_episodes=12,
        shots_per_episode=300,
        num_characters=40,
        num_environments=100,
        num_props=150,
        num_effects=120,
        avg_versions_per_asset=15
    )
}

class CGFilmProductionSimulator:
    """Simulates a complete CG film production pipeline."""
    
    def __init__(self, config: FilmProductionConfig, film_title: str = "Test Feature Film"):
        self.config = config
        self.film_title = film_title
        self.film_code = film_title.upper().replace(" ", "_")
        
        # Tracking objects
        self.film_container = None
        self.episode_containers = []
        self.shot_containers = []
        self.asset_entities = {}
        self.asset_versions = defaultdict(list)
        self.symlinks = defaultdict(dict)
        
        # Performance tracking
        self.creation_times = {}
        self.query_times = {}
        
        print(f"\n🎬 Initializing CG Film Production Simulator")
        print(f"📽️  Film: {self.film_title}")
        print(f"📊 Scale Configuration:")
        print(f"   Episodes: {self.config.num_episodes}")
        print(f"   Total Shots: {self.config.total_shots}")
        print(f"   Total Assets: {self.config.total_assets}")
        print(f"   Estimated Versions: {self.config.estimated_total_versions}")
        print(f"   Estimated References: {self.config.estimated_total_references}")
    
    def create_film_structure(self):
        """Create the complete film production structure."""
        print(f"\n🏗️  Creating film production structure...")
        
        start_time = time.time()
        
        with transaction.atomic():
            # Create root film container
            self.film_container = Container.objects.create(
                code=self.film_code,
                name=self.film_title
            )
            
            # Create episodes
            for ep_num in range(1, self.config.num_episodes + 1):
                episode = Container.objects.create(
                    code=f"{self.film_code}_EP{ep_num:02d}",
                    name=f"Episode {ep_num}",
                    parent_container=self.film_container
                )
                self.episode_containers.append(episode)
                
                # Create shots for this episode
                for shot_num in range(1, self.config.shots_per_episode + 1):
                    shot_code = f"{self.film_code}_EP{ep_num:02d}_SH{shot_num:03d}"
                    shot = Container.objects.create(
                        code=shot_code,
                        name=f"Episode {ep_num} Shot {shot_num}",
                        parent_container=episode
                    )
                    self.shot_containers.append(shot)
        
        self.creation_times['film_structure'] = time.time() - start_time
        print(f"✅ Created film structure in {self.creation_times['film_structure']:.2f}s")
        print(f"   📁 1 film container")
        print(f"   📁 {len(self.episode_containers)} episode containers") 
        print(f"   📁 {len(self.shot_containers)} shot containers")
    
    def create_assets(self):
        """Create all film assets with multiple versions."""
        print(f"\n🎨 Creating film assets...")
        
        start_time = time.time()
        
        # Asset categories and their naming patterns
        asset_categories = [
            ('characters', self.config.num_characters, 'CHAR', [
                'main_hero', 'villain', 'sidekick', 'mentor', 'comic_relief',
                'love_interest', 'antagonist', 'supporting_a', 'supporting_b',
                'crowd_member', 'background_char', 'creature'
            ]),
            ('environments', self.config.num_environments, 'ENV', [
                'hero_home', 'villain_lair', 'forest_clearing', 'mountain_peak',
                'city_street', 'spaceship_interior', 'alien_planet', 'underwater',
                'desert_oasis', 'ice_cave', 'ancient_temple', 'futuristic_city'
            ]),
            ('props', self.config.num_props, 'PROP', [
                'magic_sword', 'ancient_artifact', 'spaceship', 'vehicle',
                'weapon', 'tool', 'furniture', 'decoration', 'container',
                'device', 'instrument', 'jewelry'
            ]),
            ('effects', self.config.num_effects, 'FX', [
                'explosion', 'fire', 'water_splash', 'smoke', 'energy_beam',
                'particle_trail', 'magic_sparkle', 'weather_effect', 'destruction',
                'transformation', 'portal', 'force_field'
            ])
        ]
        
        with transaction.atomic():
            for category, count, prefix, base_names in asset_categories:
                print(f"   Creating {count} {category} assets...")
                
                for i in range(count):
                    # Generate asset name
                    base_name = base_names[i % len(base_names)]
                    asset_code = f"{prefix}_{base_name}_{i+1:03d}"
                    asset_name = f"{base_name.replace('_', ' ').title()} {i+1}"
                    
                    # Create versioned entity for asset
                    entity = VersionedEntity.objects.create(
                        code=asset_code,
                        name=asset_name
                    )
                    self.asset_entities[category] = self.asset_entities.get(category, []) + [entity]
                    
                    # Create versions for this asset
                    version_count = max(1, self.config.avg_versions_per_asset + 
                                      random.randint(-self.config.version_variance, 
                                                   self.config.version_variance))
                    
                    for v in range(1, version_count + 1):
                        # Generate realistic version data
                        version_data = self._generate_asset_version_data(category, v, version_count)
                        
                        version = Version.objects.create(
                            entity=entity,
                            version_number=v,
                            data=version_data
                        )
                        self.asset_versions[entity.code].append(version)
                    
                    # Create symlinks for production workflow
                    self._create_asset_symlinks(entity)
        
        self.creation_times['assets'] = time.time() - start_time
        total_versions = sum(len(versions) for versions in self.asset_versions.values())
        total_symlinks = sum(len(entity_symlinks) for entity_symlinks in self.symlinks.values())
        
        print(f"✅ Created assets in {self.creation_times['assets']:.2f}s")
        print(f"   🎭 {len(self.asset_entities['characters'])} character assets")
        print(f"   🏞️  {len(self.asset_entities['environments'])} environment assets") 
        print(f"   📦 {len(self.asset_entities['props'])} prop assets")
        print(f"   ✨ {len(self.asset_entities['effects'])} effect assets")
        print(f"   📄 {total_versions} total versions")
        print(f"   🔗 {total_symlinks} total symlinks")
    
    def _generate_asset_version_data(self, category: str, version_num: int, total_versions: int) -> Dict[str, Any]:
        """Generate realistic version data for an asset."""
        
        # Common metadata
        data = {
            'version_info': {
                'version_number': version_num,
                'is_latest': version_num == total_versions,
                'created_by': random.choice(['alice.artist', 'bob.modeler', 'charlie.animator', 'diana.lighter']),
                'created_date': (timezone.now() - timedelta(days=random.randint(1, 180))).isoformat(),
                'status': random.choice(['wip', 'review', 'approved', 'final']) if version_num < total_versions else 'latest'
            },
            'technical_info': {
                'file_size_mb': random.randint(10, 500),
                'polygon_count': random.randint(1000, 100000),
                'texture_resolution': random.choice(['1K', '2K', '4K', '8K']),
                'render_engine': random.choice(['Arnold', 'RenderMan', 'Cycles', 'V-Ray'])
            },
            'production_notes': f"Version {version_num} - " + random.choice([
                'Initial blockout',
                'Refined geometry',
                'Added detail pass',
                'Texture improvements', 
                'Animation tests',
                'Lighting adjustments',
                'Final polish',
                'Bug fixes',
                'Director feedback addressed',
                'Performance optimization'
            ])
        }
        
        # Category-specific data
        if category == 'characters':
            data['character_info'] = {
                'rig_version': f"v{random.randint(1, 5)}",
                'animation_ready': version_num >= 3,
                'facial_rig': version_num >= 4,
                'cloth_sim': version_num >= 5,
                'performance_level': random.choice(['hero', 'mid', 'background'])
            }
        elif category == 'environments':
            data['environment_info'] = {
                'scene_complexity': random.choice(['simple', 'medium', 'complex', 'hero']),
                'lighting_setup': version_num >= 2,
                'weather_variants': random.randint(1, 4),
                'time_of_day': random.choice(['dawn', 'day', 'dusk', 'night']),
                'season': random.choice(['spring', 'summer', 'fall', 'winter'])
            }
        elif category == 'props':
            data['prop_info'] = {
                'interactive': random.choice([True, False]),
                'destructible': random.choice([True, False]),
                'physics_enabled': version_num >= 3,
                'material_variants': random.randint(1, 3)
            }
        elif category == 'effects':
            data['fx_info'] = {
                'simulation_type': random.choice(['particle', 'fluid', 'destruction', 'procedural']),
                'cache_size_gb': random.randint(1, 50),
                'frame_range': [1, random.randint(50, 300)],
                'quality_level': random.choice(['preview', 'medium', 'high', 'final'])
            }
        
        return data
    
    def _create_asset_symlinks(self, entity: VersionedEntity):
        """Create symlinks for asset production workflow."""
        versions = self.asset_versions[entity.code]
        if not versions:
            return
        
        # Create symlinks based on production workflow
        symlink_assignments = {
            'latest': versions[-1],  # Always points to latest version
            'approved': versions[max(0, len(versions) - 2)],  # Usually second-to-last
            'animation_ready': versions[max(0, len(versions) // 2)],  # Mid-point version
            'lighting_ready': versions[max(0, len(versions) - 3)],  # Third-to-last
            'final': versions[-1] if len(versions) >= 5 else versions[0],  # Final or first if few versions
            'archived': versions[0] if len(versions) > 3 else None  # First version if enough versions
        }
        
        entity_symlinks = {}
        for symlink_name, version in symlink_assignments.items():
            if version:
                symlink = Symlink.objects.create(
                    entity=entity,
                    name=symlink_name,
                    version=version
                )
                entity_symlinks[symlink_name] = symlink
        
        self.symlinks[entity.code] = entity_symlinks
    
    def create_shot_asset_references(self):
        """Create references from shots to assets based on production needs."""
        print(f"\n🔗 Creating shot-to-asset references...")
        
        start_time = time.time()
        total_references = 0
        
        with transaction.atomic():
            for shot in self.shot_containers:
                # Create a container version for this shot
                shot_version = ContainerVersion.objects.create(
                    entity=shot,
                    version_number=1,
                    data={
                        'shot_info': {
                            'frame_range': [1001, 1001 + random.randint(50, 200)],
                            'camera_moves': random.choice([True, False]),
                            'complexity': random.choice(['simple', 'medium', 'complex']),
                            'vfx_heavy': random.choice([True, False])
                        },
                        'production_status': 'in_progress'
                    }
                )
                
                # Add character references
                char_count = max(1, self.config.avg_character_refs_per_shot + 
                               random.randint(-1, 2))
                selected_chars = random.sample(
                    self.asset_entities['characters'], 
                    min(char_count, len(self.asset_entities['characters']))
                )
                
                for i, char_entity in enumerate(selected_chars):
                    symlink_name = random.choice(['approved', 'animation_ready', 'latest'])
                    self._create_container_reference(
                        shot_version, f"character_{i+1}", char_entity, symlink_name
                    )
                    total_references += 1
                
                # Add environment reference (usually just one main environment)
                if self.asset_entities['environments']:
                    env_entity = random.choice(self.asset_entities['environments'])
                    symlink_name = random.choice(['approved', 'lighting_ready', 'final'])
                    self._create_container_reference(
                        shot_version, "environment", env_entity, symlink_name
                    )
                    total_references += 1
                
                # Add prop references
                prop_count = max(0, self.config.avg_prop_refs_per_shot + 
                               random.randint(-2, 3))
                if prop_count > 0:
                    selected_props = random.sample(
                        self.asset_entities['props'],
                        min(prop_count, len(self.asset_entities['props']))
                    )
                    
                    for i, prop_entity in enumerate(selected_props):
                        symlink_name = random.choice(['approved', 'latest', 'final'])
                        self._create_container_reference(
                            shot_version, f"prop_{i+1}", prop_entity, symlink_name
                        )
                        total_references += 1
                
                # Add effect references
                effect_count = max(0, self.config.avg_effect_refs_per_shot + 
                                 random.randint(-1, 2))
                if effect_count > 0:
                    selected_effects = random.sample(
                        self.asset_entities['effects'],
                        min(effect_count, len(self.asset_entities['effects']))
                    )
                    
                    for i, effect_entity in enumerate(selected_effects):
                        symlink_name = random.choice(['latest', 'approved', 'final'])
                        self._create_container_reference(
                            shot_version, f"effect_{i+1}", effect_entity, symlink_name
                        )
                        total_references += 1
        
        self.creation_times['references'] = time.time() - start_time
        print(f"✅ Created references in {self.creation_times['references']:.2f}s")
        print(f"   🔗 {total_references} total shot-to-asset references")
        print(f"   📊 Average {total_references / len(self.shot_containers):.1f} references per shot")
    
    def _create_container_reference(self, container_version: ContainerVersion, 
                                   ref_name: str, entity: VersionedEntity, symlink_name: str):
        """Create a container reference with proper symlink resolution."""
        try:
            # Resolve the symlink to get the current version
            symlink_version = entity.resolve_symlink(symlink_name)
            
            ContainerReference.objects.create(
                container_version=container_version,
                reference_name=ref_name,
                referenced_entity=entity,
                symlink_name=symlink_name,
                symlink_version=symlink_version,
                resolved_version=symlink_version  # Initially the same
            )
        except Exception as e:
            print(f"Warning: Could not create reference {ref_name} -> {entity.code}:{symlink_name}: {e}")
    
    def simulate_production_evolution(self):
        """Simulate the evolution of production over time with version updates."""
        print(f"\n⏰ Simulating production evolution...")
        
        start_time = time.time()
        
        # Simulate asset updates (some assets get new versions)
        assets_to_update = random.sample(
            list(self.asset_entities['characters']) + 
            list(self.asset_entities['props']) +
            list(self.asset_entities['effects']),
            k=min(20, len(self.asset_entities['characters']) + len(self.asset_entities['props']) + len(self.asset_entities['effects']))
        )
        
        with transaction.atomic():
            for entity in assets_to_update:
                # Add 1-3 more versions
                current_versions = len(self.asset_versions[entity.code])
                new_versions = random.randint(1, 3)
                
                for v in range(new_versions):
                    version_num = current_versions + v + 1
                    
                    # Determine category for version data
                    category = 'characters'
                    if entity.code.startswith('ENV_'):
                        category = 'environments'
                    elif entity.code.startswith('PROP_'):
                        category = 'props'
                    elif entity.code.startswith('FX_'):
                        category = 'effects'
                    
                    version_data = self._generate_asset_version_data(
                        category, version_num, version_num + 1
                    )
                    
                    new_version = Version.objects.create(
                        entity=entity,
                        version_number=version_num,
                        data=version_data
                    )
                    self.asset_versions[entity.code].append(new_version)
                
                # Update symlinks to point to newer versions
                if entity.code in self.symlinks:
                    latest_version = self.asset_versions[entity.code][-1]
                    if 'latest' in self.symlinks[entity.code]:
                        self.symlinks[entity.code]['latest'].version = latest_version
                        self.symlinks[entity.code]['latest'].save()
        
        self.creation_times['evolution'] = time.time() - start_time
        print(f"✅ Simulated production evolution in {self.creation_times['evolution']:.2f}s")
        print(f"   📄 Updated {len(assets_to_update)} assets with new versions")
        
        # Count outdated references
        outdated_count = self._count_outdated_references()
        print(f"   ⚠️  {outdated_count} references are now outdated")
    
    def _count_outdated_references(self) -> int:
        """Count how many references are now outdated."""
        outdated = 0
        
        for ref in ContainerReference.objects.all():
            try:
                current_version = ref.referenced_entity.resolve_symlink(ref.symlink_name)
                if current_version.id != ref.symlink_version.id:
                    outdated += 1
            except:
                outdated += 1  # Broken references are also outdated
        
        return outdated
    
    def run_performance_tests(self):
        """Run various performance tests on the created film production data."""
        print(f"\n⚡ Running performance tests...")
        
        # Test 1: Hierarchy queries
        start_time = time.time()
        root_containers = Container.objects.root_containers()
        descendants = Container.objects.get_descendants(self.film_container)
        self.query_times['hierarchy_basic'] = time.time() - start_time
        
        print(f"   📊 Basic hierarchy queries: {self.query_times['hierarchy_basic']:.3f}s")
        print(f"      - Found {len(root_containers)} root containers")
        print(f"      - Found {len(descendants)} descendants of film container")
        
        # Test 2: Deep hierarchy with materialized paths
        start_time = time.time()
        if hasattr(self.film_container, 'path') and self.film_container.path:
            path_descendants = list(self.film_container.get_descendants_by_path())
        else:
            path_descendants = []
        self.query_times['hierarchy_materialized'] = time.time() - start_time
        
        print(f"   🚀 Materialized path queries: {self.query_times['hierarchy_materialized']:.3f}s")
        print(f"      - Found {len(path_descendants)} descendants via materialized paths")
        
        # Test 3: Reference resolution
        start_time = time.time()
        total_refs = ContainerReference.objects.count()
        sample_refs = ContainerReference.objects.all()[:100]  # Sample for performance
        resolution_failures = 0
        
        for ref in sample_refs:
            try:
                current_version = ref.referenced_entity.resolve_symlink(ref.symlink_name)
            except:
                resolution_failures += 1
        
        self.query_times['reference_resolution'] = time.time() - start_time
        
        print(f"   🔗 Reference resolution (100 samples): {self.query_times['reference_resolution']:.3f}s")
        print(f"      - Total references in system: {total_refs}")
        print(f"      - Resolution failures: {resolution_failures}/100")
        
        # Test 4: Complex queries
        start_time = time.time()
        
        # Find shots with most references
        shots_with_refs = ContainerVersion.objects.filter(
            entity__in=self.shot_containers
        ).prefetch_related('references')
        
        shot_ref_counts = [(cv.entity.code, cv.references.count()) for cv in shots_with_refs[:50]]
        
        self.query_times['complex_queries'] = time.time() - start_time
        
        print(f"   🧮 Complex queries: {self.query_times['complex_queries']:.3f}s")
        top_shots = sorted(shot_ref_counts, key=lambda x: x[1], reverse=True)[:5]
        print(f"      - Top 5 shots by reference count: {top_shots}")
        
        # Test 5: Database statistics
        with connection.cursor() as cursor:
            cursor.execute("SELECT name FROM sqlite_master WHERE type='table';")
            tables = cursor.fetchall()
            
            print(f"   💾 Database statistics:")
            for table_name, in tables:
                if 'trackables' in table_name:
                    cursor.execute(f"SELECT COUNT(*) FROM {table_name};")
                    count = cursor.fetchone()[0]
                    print(f"      - {table_name}: {count} records")
    
    def generate_summary_report(self):
        """Generate a comprehensive summary report of the test."""
        print(f"\n📋 FILM PRODUCTION SIMULATION SUMMARY")
        print(f"=" * 60)
        print(f"🎬 Film: {self.film_title}")
        print(f"📅 Test Date: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
        print(f"")
        
        print(f"📊 PRODUCTION SCALE:")
        print(f"   Episodes: {self.config.num_episodes}")
        print(f"   Total Shots: {self.config.total_shots}")
        print(f"   Total Assets: {self.config.total_assets}")
        print(f"   - Characters: {self.config.num_characters}")
        print(f"   - Environments: {self.config.num_environments}")
        print(f"   - Props: {self.config.num_props}")
        print(f"   - Effects: {self.config.num_effects}")
        print(f"")
        
        # Count actual created objects
        total_containers = Container.objects.count()
        total_versions = Version.objects.count()
        total_references = ContainerReference.objects.count()
        total_symlinks = Symlink.objects.count()
        
        print(f"🏗️  CREATED OBJECTS:")
        print(f"   Containers: {total_containers}")
        print(f"   Versions: {total_versions}")
        print(f"   References: {total_references}")
        print(f"   Symlinks: {total_symlinks}")
        print(f"")
        
        print(f"⏱️  CREATION PERFORMANCE:")
        for operation, duration in self.creation_times.items():
            print(f"   {operation.replace('_', ' ').title()}: {duration:.2f}s")
        total_creation_time = sum(self.creation_times.values())
        print(f"   Total Creation Time: {total_creation_time:.2f}s")
        print(f"")
        
        print(f"⚡ QUERY PERFORMANCE:")
        for operation, duration in self.query_times.items():
            print(f"   {operation.replace('_', ' ').title()}: {duration:.3f}s")
        print(f"")
        
        # Calculate efficiency metrics
        containers_per_second = total_containers / total_creation_time if total_creation_time > 0 else 0
        versions_per_second = total_versions / total_creation_time if total_creation_time > 0 else 0
        
        print(f"📈 EFFICIENCY METRICS:")
        print(f"   Containers per second: {containers_per_second:.1f}")
        print(f"   Versions per second: {versions_per_second:.1f}")
        print(f"   References per shot: {total_references / self.config.total_shots:.1f}")
        print(f"   Versions per asset: {total_versions / self.config.total_assets:.1f}")
        print(f"")
        
        # System health check
        outdated_refs = self._count_outdated_references()
        broken_refs = ContainerReference.objects.filter(resolved_version__isnull=True).count()
        
        print(f"🔍 SYSTEM HEALTH:")
        print(f"   Current References: {total_references - outdated_refs - broken_refs}")
        print(f"   Outdated References: {outdated_refs}")
        print(f"   Broken References: {broken_refs}")
        print(f"   Health Score: {((total_references - outdated_refs - broken_refs) / total_references * 100):.1f}%")
        print(f"")
        
        return {
            'film_title': self.film_title,
            'config': self.config,
            'totals': {
                'containers': total_containers,
                'versions': total_versions,
                'references': total_references,
                'symlinks': total_symlinks
            },
            'performance': {
                'creation_times': self.creation_times,
                'query_times': self.query_times,
                'total_time': total_creation_time
            },
            'health': {
                'current_refs': total_references - outdated_refs - broken_refs,
                'outdated_refs': outdated_refs,
                'broken_refs': broken_refs,
                'health_score': (total_references - outdated_refs - broken_refs) / total_references * 100
            }
        }

def run_film_production_test(config_name: str = 'studio_feature', custom_config: FilmProductionConfig = None):
    """Run a complete film production simulation test."""
    
    if custom_config:
        config = custom_config
        film_title = f"Custom Scale Film ({config.total_shots} shots)"
    else:
        config = FILM_CONFIGS.get(config_name, FILM_CONFIGS['studio_feature'])
        film_title = f"{config_name.replace('_', ' ').title()} Film"
    
    # Clean database first
    print("🧹 Cleaning database...")
    ContainerReference.objects.all().delete()
    ContainerVersion.objects.all().delete()
    Symlink.objects.all().delete()
    Version.objects.all().delete()
    Container.objects.all().delete()
    VersionedEntity.objects.all().delete()
    
    # Run simulation
    simulator = CGFilmProductionSimulator(config, film_title)
    
    try:
        simulator.create_film_structure()
        simulator.create_assets()
        simulator.create_shot_asset_references()
        simulator.simulate_production_evolution()
        simulator.run_performance_tests()
        
        return simulator.generate_summary_report()
        
    except Exception as e:
        print(f"❌ Error during simulation: {e}")
        import traceback
        traceback.print_exc()
        return None

def run_scale_comparison():
    """Run multiple configurations to compare performance at different scales."""
    print("🏁 RUNNING SCALE COMPARISON TEST")
    print("=" * 80)
    
    results = []
    
    for config_name in ['indie_short', 'indie_feature', 'studio_feature', 'epic_blockbuster']:
        print(f"\n🎬 Testing {config_name}...")
        result = run_film_production_test(config_name)
        if result:
            results.append(result)
    
    # Compare results
    print(f"\n📊 SCALE COMPARISON RESULTS")
    print(f"=" * 80)
    
    print(f"{'Config':<18} {'Shots':<6} {'Assets':<7} {'Refs':<6} {'Time':<8} {'Health':<7}")
    print(f"{'-' * 18} {'-' * 6} {'-' * 7} {'-' * 6} {'-' * 8} {'-' * 7}")
    
    for result in results:
        config_name = result['film_title'].replace(' Film', '').replace(' ', '_').lower()
        shots = result['config'].total_shots
        assets = result['config'].total_assets  
        refs = result['totals']['references']
        time_taken = result['performance']['total_time']
        health = result['health']['health_score']
        
        print(f"{config_name:<18} {shots:<6} {assets:<7} {refs:<6} {time_taken:<8.1f} {health:<7.1f}%")

if __name__ == "__main__":
    import argparse
    
    parser = argparse.ArgumentParser(description="CG Feature Film Production Scale Test")
    parser.add_argument('--config', default='studio_feature', 
                       choices=list(FILM_CONFIGS.keys()),
                       help='Predefined configuration to use')
    parser.add_argument('--compare', action='store_true',
                       help='Run comparison across multiple scales')
    parser.add_argument('--episodes', type=int, help='Custom number of episodes')
    parser.add_argument('--shots-per-episode', type=int, help='Custom shots per episode')
    parser.add_argument('--characters', type=int, help='Custom number of characters')
    parser.add_argument('--environments', type=int, help='Custom number of environments')
    parser.add_argument('--props', type=int, help='Custom number of props')
    parser.add_argument('--effects', type=int, help='Custom number of effects')
    
    args = parser.parse_args()
    
    if args.compare:
        run_scale_comparison()
    else:
        # Build custom config if custom parameters provided
        custom_config = None
        if any([args.episodes, args.shots_per_episode, args.characters, 
                args.environments, args.props, args.effects]):
            base_config = FILM_CONFIGS[args.config]
            custom_config = FilmProductionConfig(
                num_episodes=args.episodes or base_config.num_episodes,
                shots_per_episode=args.shots_per_episode or base_config.shots_per_episode,
                num_characters=args.characters or base_config.num_characters,
                num_environments=args.environments or base_config.num_environments,
                num_props=args.props or base_config.num_props,
                num_effects=args.effects or base_config.num_effects,
                avg_versions_per_asset=base_config.avg_versions_per_asset
            )
        
        result = run_film_production_test(args.config, custom_config)
        
        if result:
            print(f"\n✅ Test completed successfully!")
            print(f"📄 Full report generated above.")
        else:
            print(f"\n❌ Test failed!")
