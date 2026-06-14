#!/usr/bin/env python3
"""
Massive CG Film Production Scale Test

This script creates a truly massive CG film production dataset:
- 20 sequences
- 50 shots per sequence (1,000 total shots)
- 5 assets per shot (5,000 total assets)
- Average 15 versions per asset (75,000 total versions)
- Extensive discussions, notes, and comments for comprehensive workflow testing
- Multiple discussion types per entity with threaded conversations

Total entities created:
- 20 Sequences (Containers)
- 1,000 Shots (Containers)
- 5,000 Assets (MediaAssets)
- 75,000 Versions
- ~15,000 Discussions/Notes/Comments
- ~15,000 Symlinks

Usage:
    python massive_cg_production_test.py
"""

import os
import sys
import django
from django.conf import settings
import random
import time
import uuid
from datetime import datetime, timedelta

# Add the nexus8 directory to Python path
sys.path.insert(0, '/Users/robertpringle/development/yjs/nexus8/nexus8')

# Configure Django settings
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'nexus8.settings')
django.setup()

from django.db import transaction
from django.contrib.auth.models import User
from trackables.models import Container, MediaAsset, Version, Symlink
from discussions.models import Discussion


class MassiveCGProductionTest:
    """Create a massive CG production dataset with extensive discussions."""
    
    def __init__(self):
        self.sequences = []
        self.shots = []
        self.assets = []
        self.versions = []
        self.discussions = []
        self.symlinks = []
        
        self.production_name = "EPIC_PRODUCTION"
        self.start_time = time.time()
        self.counter = 10000  # Start high to avoid conflicts
        
        # Expanded asset types for realistic CG production
        self.asset_types = [
            'character_model', 'character_rig', 'character_texture', 'character_animation',
            'environment_model', 'environment_texture', 'environment_lighting',
            'prop_model', 'prop_texture', 'prop_animation',
            'vehicle_model', 'vehicle_rig', 'vehicle_texture',
            'fx_simulation', 'fx_cache', 'fx_shader',
            'matte_painting', 'concept_art', 'reference_image',
            'camera_data', 'tracking_data', 'layout_animation',
            'lighting_rig', 'lighting_setup', 'render_layer',
            'composite_script', 'color_grade', 'final_render'
        ]
        
        # Expanded discussion types for comprehensive workflow
        self.discussion_types = [
            'creative_review', 'technical_review', 'client_feedback',
            'director_notes', 'supervisor_notes', 'artist_questions',
            'approval_request', 'revision_notes', 'delivery_notes',
            'dailies_feedback', 'milestone_review', 'quality_control',
            'performance_notes', 'optimization_discussion', 'pipeline_issue',
            'cross_department', 'scheduling_notes', 'resource_request',
            'training_notes', 'documentation_update', 'workflow_improvement'
        ]
        
        # Comment types for threaded discussions
        self.comment_types = [
            'implementation_note', 'technical_clarification', 'creative_suggestion',
            'progress_update', 'blocker_report', 'solution_proposal',
            'feedback_response', 'approval_confirmation', 'rejection_reason',
            'alternative_approach', 'resource_link', 'meeting_summary'
        ]
        
        # Departments and roles
        self.departments = [
            'animation', 'modeling', 'texturing', 'rigging', 'lighting', 
            'fx', 'compositing', 'editorial', 'previz', 'postvis',
            'pipeline', 'supervision', 'production', 'client_services'
        ]
        
        self.roles = [
            'artist', 'senior_artist', 'lead_artist', 'supervisor',
            'coordinator', 'producer', 'director', 'client',
            'td', 'pipeline_engineer', 'qa_specialist'
        ]
        
        print("🎬 MASSIVE CG FILM PRODUCTION SCALE TEST")
        print("=" * 80)
        print(f"Production: {self.production_name}")
        print("Target: 20 sequences, 50 shots/seq, 5 assets/shot, 15 versions/asset")
        print("Enhanced: Extensive discussions, notes, comments, and workflow simulation")
        print("=" * 80)
    
    def get_unique_code(self, prefix):
        """Generate a guaranteed unique code."""
        self.counter += 1
        return f"{prefix}_{self.counter:06d}"
    
    def get_or_create_users(self):
        """Create multiple test users for realistic collaboration."""
        users = []
        user_data = [
            ('director_smith', 'Director Smith', 'director'),
            ('supervisor_jones', 'VFX Supervisor Jones', 'supervisor'),
            ('lead_artist_1', 'Lead Artist Alpha', 'lead_artist'),
            ('lead_artist_2', 'Lead Artist Beta', 'lead_artist'),
            ('senior_artist_1', 'Senior Artist One', 'senior_artist'),
            ('senior_artist_2', 'Senior Artist Two', 'senior_artist'),
            ('artist_1', 'Artist Alice', 'artist'),
            ('artist_2', 'Artist Bob', 'artist'),
            ('artist_3', 'Artist Carol', 'artist'),
            ('producer_main', 'Producer Main', 'producer'),
            ('client_rep', 'Client Representative', 'client'),
            ('coordinator_1', 'Production Coordinator', 'coordinator')
        ]
        
        for username, full_name, role in user_data:
            user, created = User.objects.get_or_create(
                username=username,
                defaults={
                    'email': f'{username}@epicproduction.com',
                    'first_name': full_name.split()[0],
                    'last_name': ' '.join(full_name.split()[1:])
                }
            )
            users.append((user, role))
        
        return users
    
    def create_sequences(self):
        """Create 20 sequences."""
        print("\\n📋 Creating 20 sequences...")
        
        sequence_themes = [
            'Opening Credits', 'Character Introduction', 'World Building', 'Inciting Incident',
            'First Action Sequence', 'Character Development', 'Plot Twist', 'Chase Scene',
            'Emotional Moment', 'Second Act Climax', 'Character Arc', 'Subplot Resolution',
            'Major Setback', 'Revelation Scene', 'Final Preparation', 'Climactic Battle',
            'Resolution', 'Character Goodbye', 'Denouement', 'End Credits'
        ]
        
        with transaction.atomic():
            for i in range(20):
                code = self.get_unique_code(f"{self.production_name}_SEQ")
                sequence = Container.objects.create(
                    code=code,
                    name=f"Sequence {i+1:02d}: {sequence_themes[i]}",
                    description=f"Sequence {i+1} - {sequence_themes[i]} with multiple complex shots requiring extensive VFX work",
                    parent_container=None
                )
                self.sequences.append(sequence)
        
        print(f"   ✅ Created {len(self.sequences)} sequences")
        return self.sequences
    
    def create_shots(self):
        """Create 50 shots per sequence (1,000 total shots)."""
        print("\\n🎯 Creating 1,000 shots (50 per sequence)...")
        
        shot_types = [
            'Establishing Wide', 'Medium Shot', 'Close Up', 'Over Shoulder',
            'Tracking Shot', 'Crane Shot', 'Dolly Shot', 'Handheld',
            'Aerial Shot', 'POV Shot', 'Insert Shot', 'Cutaway',
            'Master Shot', 'Two Shot', 'Single Shot', 'Group Shot',
            'Action Shot', 'Reaction Shot', 'Transition Shot', 'VFX Heavy'
        ]
        
        shot_count = 0
        batch_size = 100
        shots_batch = []
        
        for seq_idx, sequence in enumerate(self.sequences):
            for shot_idx in range(50):  # 50 shots per sequence
                shot_type = shot_types[shot_idx % len(shot_types)]
                code = self.get_unique_code(f"{self.production_name}_SHOT")
                
                shot = Container(
                    code=code,
                    name=f"Seq{seq_idx+1:02d}_Shot{shot_idx+1:03d}_{shot_type.replace(' ', '_')}",
                    description=f"Shot {shot_idx+1:03d} - {shot_type} requiring {random.choice(['minimal', 'moderate', 'extensive', 'complex'])} VFX work",
                    parent_container=sequence
                )
                shots_batch.append(shot)
                shot_count += 1
                
                # Create individually (can't bulk_create multi-table inherited models)
                if len(shots_batch) >= batch_size:
                    with transaction.atomic():
                        for shot in shots_batch:
                            created_shot = Container.objects.create(
                                code=shot.code,
                                name=shot.name,
                                description=shot.description,
                                parent_container=shot.parent_container
                            )
                            self.shots.append(created_shot)
                    shots_batch = []
                    
                    if shot_count % 200 == 0:
                        print(f"   📊 Created {shot_count}/1000 shots...")
        
        # Create remaining shots
        if shots_batch:
            with transaction.atomic():
                for shot in shots_batch:
                    created_shot = Container.objects.create(
                        code=shot.code,
                        name=shot.name,
                        description=shot.description,
                        parent_container=shot.parent_container
                    )
                    self.shots.append(created_shot)
        
        print(f"   ✅ Created {len(self.shots)} shots")
        return self.shots
    
    def create_assets(self):
        """Create 5 assets per shot (5,000 total assets)."""
        print("\\n🎨 Creating 5,000 assets (5 per shot)...")
        
        asset_count = 0
        batch_size = 100
        
        for batch_start in range(0, len(self.shots), batch_size):
            batch_end = min(batch_start + batch_size, len(self.shots))
            shot_batch = self.shots[batch_start:batch_end]
            
            with transaction.atomic():
                for shot in shot_batch:
                    for asset_idx in range(5):  # 5 assets per shot
                        asset_type = random.choice(self.asset_types)
                        code = self.get_unique_code(f"{self.production_name}_AST")
                        
                        asset = MediaAsset.objects.create(
                            code=code,
                            name=f"{asset_type.replace('_', ' ').title()} {asset_idx+1}",
                            description=f"{asset_type} asset for {shot.name} - {self.get_asset_description(asset_type)}"
                        )
                        self.assets.append(asset)
                        asset_count += 1
            
            if asset_count % 500 == 0:
                print(f"   📊 Created {asset_count}/5000 assets...")
        
        print(f"   ✅ Created {len(self.assets)} assets")
        return self.assets
    
    def create_versions(self):
        """Create average 15 versions per asset (75,000 total versions)."""
        print("\\n📦 Creating ~75,000 versions (avg 15 per asset)...")
        
        version_count = 0
        batch_size = 50
        
        for batch_start in range(0, len(self.assets), batch_size):
            batch_end = min(batch_start + batch_size, len(self.assets))
            
            with transaction.atomic():
                for asset in self.assets[batch_start:batch_end]:
                    # Vary version count (10-20 versions per asset)
                    num_versions = random.randint(10, 20)
                    
                    for version_num in range(1, num_versions + 1):
                        version_data = self.generate_comprehensive_version_data(asset, version_num)
                        
                        version = Version.objects.create(
                            entity=asset,
                            version_number=version_num,
                            data=version_data
                        )
                        self.versions.append(version)
                        version_count += 1
            
            if version_count % 5000 == 0:
                print(f"   📊 Created {version_count}/~75000 versions...")
        
        print(f"   ✅ Created {len(self.versions)} versions")
        return self.versions
    
    def create_comprehensive_discussions(self):
        """Create extensive discussions, notes, and comments."""
        print("\\n💬 Creating comprehensive discussions system...")
        
        users = self.get_or_create_users()
        discussion_count = 0
        
        # Discussions for sequences (3-5 per sequence)
        print("   📋 Creating sequence discussions...")
        for sequence in self.sequences:
            num_discussions = random.randint(3, 5)
            for i in range(num_discussions):
                user, role = random.choice(users)
                discussion = self.create_sequence_discussion(sequence, user, role)
                discussion.save()
                self.discussions.append(discussion)
                
                # Add follow-up comments/notes (1-4 per discussion)
                self.create_discussion_comments(discussion, users, random.randint(1, 4))
                discussion_count += 1
        
        # Discussions for shots (2-3 per shot, sample 40% to manage size)
        print("   🎯 Creating shot discussions...")
        sampled_shots = random.sample(self.shots, int(len(self.shots) * 0.4))
        for shot in sampled_shots:
            num_discussions = random.randint(2, 3)
            for i in range(num_discussions):
                user, role = random.choice(users)
                discussion = self.create_shot_discussion(shot, user, role)
                discussion.save()
                self.discussions.append(discussion)
                
                # Add follow-up comments (1-3 per discussion)
                self.create_discussion_comments(discussion, users, random.randint(1, 3))
                discussion_count += 1
        
        # Discussions for assets (1-2 per asset, sample 30%)
        print("   🎨 Creating asset discussions...")
        sampled_assets = random.sample(self.assets, int(len(self.assets) * 0.3))
        for asset in sampled_assets:
            num_discussions = random.randint(1, 2)
            for i in range(num_discussions):
                user, role = random.choice(users)
                discussion = self.create_asset_discussion(asset, user, role)
                discussion.save()
                self.discussions.append(discussion)
                
                # Add follow-up comments (1-2 per discussion)
                self.create_discussion_comments(discussion, users, random.randint(1, 2))
                discussion_count += 1
        
        # Discussions for versions (sample 5% to avoid overwhelming)
        print("   📦 Creating version discussions...")
        sampled_versions = random.sample(self.versions, int(len(self.versions) * 0.05))
        for version in sampled_versions:
            user, role = random.choice(users)
            discussion = self.create_version_discussion(version, user, role)
            discussion.save()
            self.discussions.append(discussion)
            discussion_count += 1
        
        print(f"   ✅ Created {len(self.discussions)} discussions with extensive comments")
        return self.discussions
    
    def create_discussion_comments(self, parent_discussion, users, num_comments):
        """Create follow-up comments for a discussion (simulating threaded conversations)."""
        for i in range(num_comments):
            user, role = random.choice(users)
            comment_type = random.choice(self.comment_types)
            
            # Create a follow-up discussion that references the parent
            comment_title = f"Re: {parent_discussion.title}"
            if len(comment_title) > 50:
                comment_title = comment_title[:47] + "..."
            
            comment = Discussion(
                container=parent_discussion.container,
                versioned_entity=parent_discussion.versioned_entity,
                version=parent_discussion.version,
                title=comment_title,
                description=f"{comment_type.replace('_', ' ').title()}: {self.get_comment_content(comment_type, role)}",
                discussion_type=comment_type,
                priority=random.choice(['low', 'normal', 'high']),
                status=random.choice(['open', 'resolved']),
                created_by=user.username,
                assigned_to=random.choice([u[0].username for u in users] + ['']),
                tags=[comment_type, role, 'follow_up'],
                metadata={
                    'parent_discussion_id': parent_discussion.id if hasattr(parent_discussion, 'id') else None,
                    'comment_type': comment_type,
                    'user_role': role,
                    'thread_level': 1,
                    'timestamp': datetime.now().isoformat()
                }
            )
            comment.save()
            self.discussions.append(comment)
    
    def create_symlinks(self):
        """Create comprehensive symlink system."""
        print("\\n🔗 Creating comprehensive symlink system...")
        
        symlink_count = 0
        batch_size = 100
        
        for batch_start in range(0, len(self.assets), batch_size):
            batch_end = min(batch_start + batch_size, len(self.assets))
            
            with transaction.atomic():
                for asset in self.assets[batch_start:batch_end]:
                    # Get versions for this asset
                    asset_versions = [v for v in self.versions if v.entity_id == asset.id]
                    if not asset_versions:
                        continue
                    
                    # Sort by version number
                    asset_versions.sort(key=lambda v: v.version_number)
                    
                    # Create comprehensive symlinks
                    symlinks_to_create = [
                        ('latest', asset_versions[-1]),
                        ('work_in_progress', asset_versions[-1]),
                    ]
                    
                    # Add approved versions (multiple approval levels)
                    if len(asset_versions) > 5:
                        symlinks_to_create.extend([
                            ('approved_final', asset_versions[-2]),
                            ('approved_client', asset_versions[-3]),
                            ('approved_director', asset_versions[-4]),
                        ])
                    elif len(asset_versions) > 2:
                        symlinks_to_create.append(('approved', asset_versions[-2]))
                    
                    # Add milestone versions
                    if len(asset_versions) > 10:
                        mid_point = len(asset_versions) // 2
                        quarter_point = len(asset_versions) // 4
                        symlinks_to_create.extend([
                            ('milestone_v1', asset_versions[quarter_point]),
                            ('milestone_v2', asset_versions[mid_point]),
                            ('milestone_final', asset_versions[-5]),
                        ])
                    
                    # Add department-specific symlinks
                    dept_versions = {
                        'modeling_final': asset_versions[random.randint(0, len(asset_versions)//3)],
                        'texturing_final': asset_versions[random.randint(len(asset_versions)//3, 2*len(asset_versions)//3)],
                        'lighting_final': asset_versions[random.randint(2*len(asset_versions)//3, len(asset_versions)-1)],
                    }
                    
                    for dept_name, version in dept_versions.items():
                        symlinks_to_create.append((dept_name, version))
                    
                    # Create all symlinks for this asset
                    for symlink_name, version in symlinks_to_create:
                        symlink = Symlink.objects.create(
                            entity=asset,
                            name=symlink_name,
                            version=version
                        )
                        self.symlinks.append(symlink)
                        symlink_count += 1
            
            if symlink_count % 1000 == 0:
                print(f"   📊 Created {symlink_count} symlinks...")
        
        print(f"   ✅ Created {len(self.symlinks)} symlinks")
        return self.symlinks
    
    def generate_comprehensive_version_data(self, asset, version_num):
        """Generate comprehensive version data with realistic metadata."""
        department = random.choice(self.departments)
        artist = random.choice(['alice_johnson', 'bob_smith', 'carol_brown', 'david_wilson', 'emma_davis'])
        
        base_data = {
            'version': version_num,
            'status': self.get_version_status(version_num),
            'created_by': artist,
            'department': department,
            'file_size': random.randint(1024*1024*5, 1024*1024*2000),  # 5MB to 2GB
            'resolution': random.choice(['1K', '2K', '4K', '8K', '16K']),
            'format': random.choice(['EXR', 'TIFF', 'PNG', 'JPG', 'MOV', 'MP4', 'AVI', 'PRORES']),
            'color_space': random.choice(['sRGB', 'Rec709', 'ACES', 'Linear', 'P3', 'Rec2020']),
            'render_time': random.randint(60, 28800),  # 1 minute to 8 hours
            'notes': f'Version {version_num} - {self.get_detailed_version_notes(version_num, department)}',
            'creation_date': (datetime.now() - timedelta(days=random.randint(1, 365))).isoformat(),
            'modification_date': (datetime.now() - timedelta(hours=random.randint(1, 24))).isoformat(),
        }
        
        # Add asset-type specific data
        asset_type = random.choice(self.asset_types)
        if 'model' in asset_type:
            base_data.update({
                'polygon_count': random.randint(10000, 2000000),
                'subdivision_level': random.randint(0, 4),
                'topology': random.choice(['quads', 'triangles', 'mixed', 'optimized']),
                'uv_sets': random.randint(1, 8),
                'materials': random.randint(1, 15)
            })
        elif 'texture' in asset_type:
            base_data.update({
                'texture_resolution': random.choice(['512', '1K', '2K', '4K', '8K', '16K']),
                'texture_type': random.choice(['diffuse', 'normal', 'roughness', 'metallic', 'specular', 'displacement']),
                'udim_tiles': random.randint(1, 20),
                'texture_format': random.choice(['TIFF', 'EXR', 'PNG', 'TGA']),
                'bit_depth': random.choice([8, 16, 32])
            })
        elif 'animation' in asset_type:
            base_data.update({
                'frame_count': random.randint(24, 7200),  # 1 second to 5 minutes at 24fps
                'fps': random.choice([23.976, 24, 25, 29.97, 30, 50, 59.94, 60]),
                'animation_type': random.choice(['keyframe', 'mocap', 'procedural', 'simulation']),
                'curves': random.randint(50, 2000),
                'keys': random.randint(100, 50000)
            })
        elif 'fx' in asset_type:
            base_data.update({
                'simulation_type': random.choice(['fluid', 'smoke', 'fire', 'particles', 'cloth', 'hair', 'destruction']),
                'particle_count': random.randint(10000, 10000000),
                'simulation_time': random.randint(1800, 86400),  # 30 minutes to 24 hours
                'cache_size': random.randint(1024*1024*100, 1024*1024*10000),  # 100MB to 10GB
                'solver': random.choice(['Houdini', 'Maya', 'Blender', 'Custom'])
            })
        
        # Add technical metadata
        base_data.update({
            'software_version': f"{random.choice(['Maya', 'Houdini', 'Blender', 'Nuke', '3dsMax'])} {random.randint(2020, 2025)}.{random.randint(1, 5)}",
            'plugins_used': random.sample(['Arnold', 'VRay', 'Redshift', 'Octane', 'Cycles', 'Mantra'], random.randint(1, 3)),
            'render_layers': random.randint(1, 20),
            'output_passes': random.randint(5, 30),
            'quality_level': random.choice(['preview', 'review', 'final', 'delivery']),
            'approval_status': random.choice(['pending', 'approved', 'rejected', 'needs_revision']),
            'client_reviewed': random.choice([True, False]),
            'delivery_format': random.choice(['ProRes', 'H264', 'DNxHD', 'EXR_sequence', 'TIFF_sequence']),
        })
        
        return base_data
    
    def get_version_status(self, version_num):
        """Get realistic version status based on version number."""
        if version_num <= 3:
            return random.choice(['wip', 'wip', 'review'])
        elif version_num <= 8:
            return random.choice(['wip', 'review', 'approved'])
        elif version_num <= 12:
            return random.choice(['review', 'approved', 'approved'])
        else:
            return random.choice(['approved', 'delivered', 'final'])
    
    def get_asset_description(self, asset_type):
        """Get detailed asset description based on type."""
        descriptions = {
            'character_model': 'High-resolution character model with detailed facial features and clean topology',
            'character_rig': 'Full body character rig with facial controls and deformation setup',
            'character_texture': 'PBR texture set with diffuse, normal, roughness, and subsurface maps',
            'environment_model': 'Detailed environment geometry with modular construction',
            'prop_model': 'Hero prop model with accurate proportions and materials',
            'fx_simulation': 'Complex particle simulation with realistic physics behavior',
            'lighting_rig': 'Scene lighting setup with HDR environment and key lights',
            'composite_script': 'Nuke composition script with color correction and effects'
        }
        return descriptions.get(asset_type, f'Professional {asset_type.replace("_", " ")} asset for production use')
    
    def get_detailed_version_notes(self, version_num, department):
        """Generate detailed version notes based on version number and department."""
        if version_num == 1:
            return f"Initial {department} pass - establishing base structure and workflow"
        elif version_num <= 3:
            return f"Early iteration - refining {department} approach and addressing initial feedback"
        elif version_num <= 6:
            return f"Mid-development - incorporating director notes and technical requirements"
        elif version_num <= 10:
            return f"Polish phase - fine-tuning details and optimizing for pipeline integration"
        elif version_num <= 15:
            return f"Final refinements - client feedback integration and delivery preparation"
        else:
            return f"Final delivery - approved version ready for downstream departments"
    
    def create_sequence_discussion(self, sequence, user, role):
        """Create comprehensive sequence-level discussion."""
        discussion_type = random.choice([
            'creative_review', 'milestone_review', 'scheduling_notes',
            'resource_request', 'cross_department', 'client_feedback'
        ])
        
        titles = {
            'creative_review': f"Creative Review: {sequence.name}",
            'milestone_review': f"Milestone Review: {sequence.name}",
            'scheduling_notes': f"Schedule Discussion: {sequence.name}",
            'resource_request': f"Resource Planning: {sequence.name}",
            'cross_department': f"Department Coordination: {sequence.name}",
            'client_feedback': f"Client Notes: {sequence.name}"
        }
        
        descriptions = {
            'creative_review': f"Comprehensive creative review for {sequence.name}. Discussing story beats, character arcs, and visual language. Need to ensure consistency with overall film vision.",
            'milestone_review': f"Milestone assessment for {sequence.name}. Evaluating progress against schedule and identifying potential bottlenecks.",
            'scheduling_notes': f"Schedule coordination for {sequence.name}. Balancing resource allocation and deadline requirements.",
            'resource_request': f"Resource planning discussion for {sequence.name}. Evaluating staffing needs and equipment requirements.",
            'cross_department': f"Cross-department coordination for {sequence.name}. Ensuring smooth handoffs between teams.",
            'client_feedback': f"Client feedback integration for {sequence.name}. Incorporating stakeholder notes and approval requirements."
        }
        
        return Discussion(
            container=sequence,
            title=titles[discussion_type],
            description=descriptions[discussion_type],
            discussion_type=discussion_type,
            priority=random.choice(['normal', 'high', 'critical']),
            status=random.choice(['open', 'in_progress', 'resolved']),
            created_by=user.username,
            assigned_to=random.choice(['supervisor', 'lead_artist', 'producer', '']),
            tags=[discussion_type, 'sequence', role, random.choice(self.departments)],
            metadata={
                'sequence_id': sequence.id if hasattr(sequence, 'id') else None,
                'user_role': role,
                'discussion_level': 'sequence',
                'estimated_hours': random.randint(40, 200),
                'affects_schedule': random.choice([True, False]),
                'requires_approval': random.choice([True, False])
            }
        )
    
    def create_shot_discussion(self, shot, user, role):
        """Create comprehensive shot-level discussion."""
        discussion_type = random.choice([
            'technical_review', 'dailies_feedback', 'performance_notes',
            'optimization_discussion', 'pipeline_issue', 'quality_control'
        ])
        
        titles = {
            'technical_review': f"Technical Review: {shot.name}",
            'dailies_feedback': f"Dailies Notes: {shot.name}",
            'performance_notes': f"Performance Analysis: {shot.name}",
            'optimization_discussion': f"Optimization Required: {shot.name}",
            'pipeline_issue': f"Pipeline Issue: {shot.name}",
            'quality_control': f"QC Notes: {shot.name}"
        }
        
        descriptions = {
            'technical_review': f"Technical assessment of {shot.name}. Reviewing render quality, performance metrics, and pipeline compliance.",
            'dailies_feedback': f"Daily review feedback for {shot.name}. Director and supervisor notes from screening session.",
            'performance_notes': f"Performance analysis for {shot.name}. Render times, memory usage, and optimization opportunities.",
            'optimization_discussion': f"Optimization discussion for {shot.name}. Identifying bottlenecks and improvement strategies.",
            'pipeline_issue': f"Pipeline issue reported for {shot.name}. Technical problem requiring immediate attention.",
            'quality_control': f"Quality control review for {shot.name}. Final checks before client delivery."
        }
        
        return Discussion(
            container=shot,
            title=titles[discussion_type],
            description=descriptions[discussion_type],
            discussion_type=discussion_type,
            priority=random.choice(['normal', 'high']),
            status=random.choice(['open', 'in_progress', 'resolved']),
            created_by=user.username,
            assigned_to=random.choice(['artist', 'senior_artist', 'lead_artist', '']),
            tags=[discussion_type, 'shot', role, random.choice(self.departments)],
            metadata={
                'shot_id': shot.id if hasattr(shot, 'id') else None,
                'user_role': role,
                'discussion_level': 'shot',
                'render_time_hours': random.randint(1, 24),
                'complexity_level': random.choice(['simple', 'moderate', 'complex', 'extreme']),
                'requires_retake': random.choice([True, False])
            }
        )
    
    def create_asset_discussion(self, asset, user, role):
        """Create comprehensive asset-level discussion."""
        discussion_type = random.choice([
            'approval_request', 'revision_notes', 'technical_review',
            'client_feedback', 'workflow_improvement', 'documentation_update'
        ])
        
        titles = {
            'approval_request': f"Approval Request: {asset.name}",
            'revision_notes': f"Revision Required: {asset.name}",
            'technical_review': f"Technical Review: {asset.name}",
            'client_feedback': f"Client Feedback: {asset.name}",
            'workflow_improvement': f"Workflow Notes: {asset.name}",
            'documentation_update': f"Documentation: {asset.name}"
        }
        
        descriptions = {
            'approval_request': f"Requesting approval for {asset.name}. Asset completed and ready for review by supervisor and client.",
            'revision_notes': f"Revision notes for {asset.name}. Feedback incorporated, addressing technical and creative requirements.",
            'technical_review': f"Technical review of {asset.name}. Evaluating topology, textures, and pipeline compatibility.",
            'client_feedback': f"Client feedback integration for {asset.name}. Incorporating stakeholder notes and brand requirements.",
            'workflow_improvement': f"Workflow improvement notes for {asset.name}. Documenting best practices and lessons learned.",
            'documentation_update': f"Documentation update for {asset.name}. Technical specifications and usage guidelines."
        }
        
        return Discussion(
            versioned_entity=asset,
            title=titles[discussion_type],
            description=descriptions[discussion_type],
            discussion_type=discussion_type,
            priority=random.choice(['low', 'normal', 'high']),
            status=random.choice(['open', 'in_progress', 'resolved']),
            created_by=user.username,
            assigned_to=random.choice(['artist', 'supervisor', 'client', '']),
            tags=[discussion_type, 'asset', role, random.choice(self.departments)],
            metadata={
                'asset_id': asset.id if hasattr(asset, 'id') else None,
                'user_role': role,
                'discussion_level': 'asset',
                'estimated_revision_hours': random.randint(2, 40),
                'affects_downstream': random.choice([True, False]),
                'budget_impact': random.choice(['none', 'minor', 'moderate', 'significant'])
            }
        )
    
    def create_version_discussion(self, version, user, role):
        """Create version-specific discussion."""
        discussion_type = random.choice([
            'revision_notes', 'approval_request', 'quality_control', 'delivery_notes'
        ])
        
        title = f"Version Review: {version.entity.name} v{version.version_number}"
        description = f"Review and feedback for version {version.version_number} of {version.entity.name}. {self.get_version_discussion_content(discussion_type, role)}"
        
        return Discussion(
            version=version,
            title=title,
            description=description,
            discussion_type=discussion_type,
            priority=random.choice(['normal', 'high']),
            status=random.choice(['open', 'resolved']),
            created_by=user.username,
            assigned_to=random.choice(['artist', 'supervisor']),
            tags=[discussion_type, 'version', role],
            metadata={
                'version_id': version.id if hasattr(version, 'id') else None,
                'version_number': version.version_number,
                'user_role': role,
                'discussion_level': 'version',
                'review_type': discussion_type,
                'requires_changes': random.choice([True, False])
            }
        )
    
    def get_comment_content(self, comment_type, role):
        """Generate realistic comment content based on type and role."""
        comments = {
            'implementation_note': f"Implementation approach looks solid. As {role}, I recommend proceeding with current methodology.",
            'technical_clarification': f"Need clarification on technical requirements. From {role} perspective, we should verify specifications.",
            'creative_suggestion': f"Creative suggestion from {role} viewpoint: consider alternative approach for better visual impact.",
            'progress_update': f"Progress update from {role}: currently on schedule with quality meeting expectations.",
            'blocker_report': f"Blocker identified by {role}: technical issue preventing progress, needs immediate attention.",
            'solution_proposal': f"Solution proposal from {role}: alternative approach that should resolve current challenges.",
            'feedback_response': f"Response to feedback from {role}: incorporated suggested changes and ready for next review.",
            'approval_confirmation': f"Approval confirmed by {role}: meets all requirements and ready for next stage.",
            'rejection_reason': f"Rejection noted by {role}: specific issues identified that require revision before approval.",
            'alternative_approach': f"Alternative approach suggested by {role}: different methodology might yield better results."
        }
        return comments.get(comment_type, f"Comment from {role} regarding {comment_type.replace('_', ' ')}")
    
    def get_version_discussion_content(self, discussion_type, role):
        """Generate version discussion content."""
        content = {
            'revision_notes': f"Revision feedback from {role}: addressing technical and creative notes for improved quality.",
            'approval_request': f"Approval request from {role}: version meets requirements and ready for sign-off.",
            'quality_control': f"Quality control review by {role}: comprehensive check against delivery standards.",
            'delivery_notes': f"Delivery preparation by {role}: final version ready for client handoff."
        }
        return content.get(discussion_type, f"Version feedback from {role}")
    
    def print_comprehensive_statistics(self):
        """Print detailed statistics about the massive dataset."""
        elapsed_time = time.time() - self.start_time
        
        print("\\n" + "=" * 80)
        print("📊 MASSIVE CG PRODUCTION SCALE TEST RESULTS")
        print("=" * 80)
        
        print(f"🎬 Production: {self.production_name}")
        print(f"⏱️  Total Creation Time: {elapsed_time:.2f} seconds")
        print(f"💾 Database Performance: {(len(self.sequences) + len(self.shots) + len(self.assets) + len(self.versions) + len(self.discussions) + len(self.symlinks))/elapsed_time:.1f} entities/second")
        print()
        
        print("📈 PRODUCTION HIERARCHY:")
        print(f"   🎭 Sequences: {len(self.sequences):,}")
        print(f"   🎯 Shots: {len(self.shots):,}")
        print(f"   📦 Total Containers: {len(self.sequences) + len(self.shots):,}")
        print()
        
        print("🎨 DIGITAL ASSETS:")
        print(f"   🖼️  Media Assets: {len(self.assets):,}")
        print(f"   📦 Versions: {len(self.versions):,}")
        print(f"   🔗 Symlinks: {len(self.symlinks):,}")
        print()
        
        print("💬 COLLABORATION SYSTEM:")
        print(f"   💭 Discussions/Notes/Comments: {len(self.discussions):,}")
        
        # Discussion type breakdown
        discussion_types = {}
        for discussion in self.discussions:
            dtype = discussion.discussion_type or 'unknown'
            discussion_types[dtype] = discussion_types.get(dtype, 0) + 1
        
        print(f"   📊 Discussion Types:")
        for dtype, count in sorted(discussion_types.items(), key=lambda x: x[1], reverse=True)[:10]:
            print(f"      • {dtype}: {count:,}")
        if len(discussion_types) > 10:
            print(f"      • ... and {len(discussion_types) - 10} more types")
        
        print()
        total_entities = len(self.sequences) + len(self.shots) + len(self.assets) + len(self.versions) + len(self.discussions) + len(self.symlinks)
        print(f"📊 TOTAL ENTITIES: {total_entities:,}")
        print(f"⚡ AVERAGE CREATION RATE: {total_entities/elapsed_time:.1f} entities/second")
        
        print("\\n🎉 MASSIVE SCALE TEST COMPLETED SUCCESSFULLY!")
        print("Your Nexus8 system has been stress-tested with an extensive production dataset")
        print("including comprehensive discussions, notes, comments, and workflow simulations.")
        print("=" * 80)
    
    def run_massive_simulation(self):
        """Run the complete massive CG production simulation."""
        try:
            print("Starting massive dataset creation...")
            
            # Create production hierarchy
            self.create_sequences()
            self.create_shots()
            self.create_assets()
            self.create_versions()
            self.create_comprehensive_discussions()
            self.create_symlinks()
            
            # Print comprehensive statistics
            self.print_comprehensive_statistics()
            
            return True
            
        except Exception as e:
            print(f"❌ Error during massive simulation: {e}")
            import traceback
            traceback.print_exc()
            return False


def main():
    """Main execution function."""
    print("🎬 STARTING MASSIVE CG FILM PRODUCTION SCALE TEST")
    print("This will create an extensive production dataset with comprehensive discussions")
    print("Warning: This will create ~95,000+ entities and may take several minutes")
    print()
    
    # Confirm execution
    response = input("Continue with massive dataset creation? (y/N): ")
    if response.lower() != 'y':
        print("Cancelled by user.")
        return False
    
    # Test database connection
    try:
        from django.db import connection
        cursor = connection.cursor()
        cursor.execute("SELECT 1")
        print("✅ Database connection successful")
    except Exception as e:
        print(f"❌ Database connection failed: {e}")
        return False
    
    # Run massive simulation
    simulator = MassiveCGProductionTest()
    success = simulator.run_massive_simulation()
    
    if success:
        print("\\n🚀 MASSIVE DATASET READY!")
        print("Your system now contains a comprehensive CG production dataset")
        print("suitable for enterprise-scale workflow testing and validation.")
    else:
        print("\\n💥 Massive simulation failed. Check error messages above.")
    
    return success


if __name__ == '__main__':
    success = main()
    sys.exit(0 if success else 1)
