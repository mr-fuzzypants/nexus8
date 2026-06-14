#!/usr/bin/env python3
"""
Large Scale CG Production Test with Extensive Discussions

This script creates a substantial CG film production dataset:
- 15 sequences
- 30 shots per sequence (450 total shots)
- 4 assets per shot (1,800 total assets)  
- Average 12 versions per asset (21,600 total versions)
- Comprehensive discussions, notes, and comments system
- Multiple user roles and collaboration workflows

Total entities created:
- 15 Sequences
- 450 Shots  
- 1,800 Assets
- 21,600 Versions
- ~8,000 Discussions/Notes/Comments
- ~7,200 Symlinks

Total: ~39,000+ entities with extensive collaboration data
"""

import os
import sys
import django
from django.conf import settings
import random
import time
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


class LargeScaleCGProductionTest:
    """Create large-scale CG production with extensive collaboration system."""
    
    def __init__(self):
        self.sequences = []
        self.shots = []
        self.assets = []
        self.versions = []
        self.discussions = []
        self.symlinks = []
        self.users = []
        
        self.production_name = "LARGE_EPIC"
        self.start_time = time.time()
        self.counter = 50000  # Start high to avoid conflicts
        
        # Comprehensive asset types
        self.asset_types = [
            'character_model', 'character_rig', 'character_texture',
            'environment_model', 'environment_texture', 'environment_lighting',
            'prop_model', 'prop_texture', 'vehicle_model', 'vehicle_rig',
            'fx_simulation', 'fx_cache', 'lighting_rig', 'camera_data',
            'matte_painting', 'concept_art', 'composite_script', 'final_render'
        ]
        
        # Extensive discussion types
        self.discussion_types = [
            'creative_review', 'technical_review', 'client_feedback', 'director_notes',
            'supervisor_notes', 'artist_questions', 'approval_request', 'revision_notes',
            'delivery_notes', 'dailies_feedback', 'milestone_review', 'quality_control',
            'performance_notes', 'optimization_discussion', 'pipeline_issue',
            'cross_department', 'scheduling_notes', 'resource_request', 'training_notes'
        ]
        
        # Comment/note types for threaded discussions
        self.comment_types = [
            'follow_up', 'clarification', 'suggestion', 'progress_update',
            'blocker_report', 'solution', 'approval', 'rejection',
            'alternative', 'reference', 'meeting_notes', 'action_item'
        ]
        
        self.departments = [
            'animation', 'modeling', 'texturing', 'rigging', 'lighting',
            'fx', 'compositing', 'editorial', 'previz', 'supervision', 'production'
        ]
        
        print("🎬 LARGE SCALE CG PRODUCTION TEST")
        print("=" * 70)
        print(f"Production: {self.production_name}")
        print("Target: 15 sequences, 30 shots/seq, 4 assets/shot, 12 versions/asset")
        print("Focus: Extensive discussions, notes, comments, and collaboration")
        print("=" * 70)
    
    def get_unique_code(self, prefix):
        """Generate guaranteed unique code."""
        self.counter += 1
        return f"{prefix}_{self.counter:06d}"
    
    def create_production_users(self):
        """Create comprehensive user base for realistic collaboration."""
        print("\\n👥 Creating production team users...")
        
        user_profiles = [
            ('director_main', 'Director Jane Smith', 'director'),
            ('vfx_supervisor', 'VFX Supervisor Mike Johnson', 'vfx_supervisor'), 
            ('anim_supervisor', 'Animation Supervisor Sarah Lee', 'anim_supervisor'),
            ('lighting_supervisor', 'Lighting Supervisor David Brown', 'lighting_supervisor'),
            ('comp_supervisor', 'Compositing Supervisor Lisa Wang', 'comp_supervisor'),
            ('lead_modeler', 'Lead Modeler Alex Chen', 'lead_artist'),
            ('lead_animator', 'Lead Animator Maria Rodriguez', 'lead_artist'),
            ('lead_lighter', 'Lead Lighter James Wilson', 'lead_artist'),
            ('senior_modeler_1', 'Senior Modeler Tom Anderson', 'senior_artist'),
            ('senior_modeler_2', 'Senior Modeler Emma Davis', 'senior_artist'),
            ('senior_animator_1', 'Senior Animator Carlos Martinez', 'senior_artist'),
            ('senior_animator_2', 'Senior Animator Anna Kowalski', 'senior_artist'),
            ('modeler_1', 'Modeler Jake Thompson', 'artist'),
            ('modeler_2', 'Modeler Sophie Miller', 'artist'),
            ('modeler_3', 'Modeler Ryan Garcia', 'artist'),
            ('animator_1', 'Animator Lucy Taylor', 'artist'),
            ('animator_2', 'Animator Mark Johnson', 'artist'),
            ('animator_3', 'Animator Nina Patel', 'artist'),
            ('lighter_1', 'Lighter Sam Kim', 'artist'),
            ('lighter_2', 'Lighter Rachel Green', 'artist'),
            ('fx_artist_1', 'FX Artist Paul Zhang', 'artist'),
            ('fx_artist_2', 'FX Artist Maya Singh', 'artist'),
            ('compositor_1', 'Compositor John Lee', 'artist'),
            ('compositor_2', 'Compositor Diana Ross', 'artist'),
            ('producer_main', 'Producer Robert Stone', 'producer'),
            ('coordinator_1', 'Coordinator Jenny Liu', 'coordinator'),
            ('coordinator_2', 'Coordinator Chris Parker', 'coordinator'),
            ('client_rep_1', 'Client Rep Amanda Johnson', 'client'),
            ('client_rep_2', 'Client Rep Michael Brown', 'client'),
            ('qa_specialist', 'QA Specialist Oliver Smith', 'qa'),
        ]
        
        created_users = []
        for username, full_name, role in user_profiles:
            user, created = User.objects.get_or_create(
                username=username,
                defaults={
                    'email': f'{username}@largeepic.com',
                    'first_name': full_name.split()[0],
                    'last_name': ' '.join(full_name.split()[1:])
                }
            )
            created_users.append((user, role))
        
        self.users = created_users
        print(f"   ✅ Created {len(self.users)} production team members")
        return self.users
    
    def create_sequences(self):
        """Create 15 sequences with thematic naming."""
        print("\\n📋 Creating 15 sequences...")
        
        sequence_themes = [
            'Opening Titles', 'Character Introduction', 'World Establishment', 'Inciting Incident',
            'First Quest', 'Character Development', 'Plot Complication', 'Chase Sequence',
            'Emotional Beat', 'Mid-Point Twist', 'Character Growth', 'Major Setback',
            'Final Preparation', 'Climactic Confrontation', 'Resolution & Epilogue'
        ]
        
        with transaction.atomic():
            for i in range(15):
                code = self.get_unique_code(f"{self.production_name}_SEQ")
                sequence = Container.objects.create(
                    code=code,
                    name=f"Seq{i+1:02d}: {sequence_themes[i]}",
                    description=f"Sequence {i+1} - {sequence_themes[i]} featuring complex VFX and character work",
                    parent_container=None
                )
                self.sequences.append(sequence)
        
        print(f"   ✅ Created {len(self.sequences)} sequences")
    
    def create_shots(self):
        """Create 30 shots per sequence (450 total)."""
        print("\\n🎯 Creating 450 shots (30 per sequence)...")
        
        shot_count = 0
        
        for seq_idx, sequence in enumerate(self.sequences):
            print(f"   📊 Creating shots for {sequence.name}...")
            
            with transaction.atomic():
                for shot_idx in range(30):  # 30 shots per sequence
                    code = self.get_unique_code(f"{self.production_name}_SHOT")
                    shot_type = random.choice(['Wide', 'Medium', 'Close', 'Tracking', 'Action', 'Dialog'])
                    
                    shot = Container.objects.create(
                        code=code,
                        name=f"Seq{seq_idx+1:02d}_Shot{shot_idx+1:03d}_{shot_type}",
                        description=f"Shot {shot_idx+1:03d} - {shot_type} shot with {random.choice(['minimal', 'moderate', 'complex'])} VFX requirements",
                        parent_container=sequence
                    )
                    self.shots.append(shot)
                    shot_count += 1
            
            if (seq_idx + 1) % 5 == 0:
                print(f"   📊 Completed {seq_idx + 1}/15 sequences ({shot_count} shots so far)...")
        
        print(f"   ✅ Created {len(self.shots)} shots")
    
    def create_assets(self):
        """Create 4 assets per shot (1,800 total)."""
        print("\\n🎨 Creating 1,800 assets (4 per shot)...")
        
        asset_count = 0
        batch_size = 50
        
        for batch_start in range(0, len(self.shots), batch_size):
            batch_end = min(batch_start + batch_size, len(self.shots))
            
            with transaction.atomic():
                for shot in self.shots[batch_start:batch_end]:
                    for asset_idx in range(4):  # 4 assets per shot
                        asset_type = random.choice(self.asset_types)
                        code = self.get_unique_code(f"{self.production_name}_AST")
                        
                        asset = MediaAsset.objects.create(
                            code=code,
                            name=f"{asset_type.replace('_', ' ').title()} {asset_idx+1}",
                            description=f"{asset_type} for {shot.name} - {self.get_asset_description(asset_type)}"
                        )
                        self.assets.append(asset)
                        asset_count += 1
            
            if asset_count % 500 == 0:
                print(f"   📊 Created {asset_count}/1800 assets...")
        
        print(f"   ✅ Created {len(self.assets)} assets")
    
    def create_versions(self):
        """Create average 12 versions per asset (21,600 total)."""
        print("\\n📦 Creating ~21,600 versions (avg 12 per asset)...")
        
        version_count = 0
        batch_size = 25
        
        for batch_start in range(0, len(self.assets), batch_size):
            batch_end = min(batch_start + batch_size, len(self.assets))
            
            with transaction.atomic():
                for asset in self.assets[batch_start:batch_end]:
                    # Vary version count (8-16 versions per asset)
                    num_versions = random.randint(8, 16)
                    
                    for version_num in range(1, num_versions + 1):
                        version_data = self.generate_detailed_version_data(asset, version_num)
                        
                        version = Version.objects.create(
                            entity=asset,
                            version_number=version_num,
                            data=version_data
                        )
                        self.versions.append(version)
                        version_count += 1
            
            if version_count % 2000 == 0:
                print(f"   📊 Created {version_count}/~21600 versions...")
        
        print(f"   ✅ Created {len(self.versions)} versions")
    
    def create_extensive_discussions(self):
        """Create comprehensive discussion system with notes and comments."""
        print("\\n💬 Creating extensive discussion system...")
        
        total_discussions = 0
        
        # Sequence discussions (4-6 per sequence)
        print("   📋 Creating sequence-level discussions...")
        for sequence in self.sequences:
            num_discussions = random.randint(4, 6)
            for i in range(num_discussions):
                user, role = random.choice(self.users)
                discussion = self.create_detailed_sequence_discussion(sequence, user, role)
                discussion.save()
                self.discussions.append(discussion)
                total_discussions += 1
                
                # Add follow-up comments (2-5 per discussion)
                self.create_threaded_comments(discussion, random.randint(2, 5))
        
        # Shot discussions (2-3 per shot, sample 50%)
        print("   🎯 Creating shot-level discussions...")
        sampled_shots = random.sample(self.shots, len(self.shots) // 2)
        for shot in sampled_shots:
            num_discussions = random.randint(2, 3)
            for i in range(num_discussions):
                user, role = random.choice(self.users)
                discussion = self.create_detailed_shot_discussion(shot, user, role)
                discussion.save()
                self.discussions.append(discussion)
                total_discussions += 1
                
                # Add follow-up comments (1-3 per discussion)
                self.create_threaded_comments(discussion, random.randint(1, 3))
        
        # Asset discussions (1-2 per asset, sample 40%)
        print("   🎨 Creating asset-level discussions...")
        sampled_assets = random.sample(self.assets, int(len(self.assets) * 0.4))
        for asset in sampled_assets:
            num_discussions = random.randint(1, 2)
            for i in range(num_discussions):
                user, role = random.choice(self.users)
                discussion = self.create_detailed_asset_discussion(asset, user, role)
                discussion.save()
                self.discussions.append(discussion)
                total_discussions += 1
                
                # Add follow-up comments (1-2 per discussion)
                self.create_threaded_comments(discussion, random.randint(1, 2))
        
        # Version discussions (sample 8% for key versions)
        print("   📦 Creating version-level discussions...")
        sampled_versions = random.sample(self.versions, int(len(self.versions) * 0.08))
        for version in sampled_versions:
            user, role = random.choice(self.users)
            discussion = self.create_detailed_version_discussion(version, user, role)
            discussion.save()
            self.discussions.append(discussion)
            total_discussions += 1
        
        print(f"   ✅ Created {len(self.discussions)} discussions with extensive threading")
    
    def create_threaded_comments(self, parent_discussion, num_comments):
        """Create threaded comments for discussions."""
        for i in range(num_comments):
            user, role = random.choice(self.users)
            comment_type = random.choice(self.comment_types)
            
            # Create threaded comment
            comment_title = f"Re: {parent_discussion.title}"
            if len(comment_title) > 200:  # Ensure title fits in database field
                comment_title = comment_title[:197] + "..."
            
            comment_content = self.generate_comment_content(comment_type, role, parent_discussion.discussion_type)
            
            comment = Discussion(
                container=parent_discussion.container,
                versioned_entity=parent_discussion.versioned_entity,
                version=parent_discussion.version,
                title=comment_title,
                description=comment_content,
                discussion_type=comment_type,
                priority=random.choice(['low', 'normal']),
                status=random.choice(['open', 'resolved']),
                created_by=user.username,
                assigned_to=random.choice([u[0].username for u in self.users[:10]] + ['']),
                tags=[comment_type, 'threaded', role],
                metadata={
                    'parent_discussion': 'referenced',  # Can't store actual ID before save
                    'thread_level': 1,
                    'comment_type': comment_type,
                    'user_role': role,
                    'original_discussion_type': parent_discussion.discussion_type
                }
            )
            comment.save()
            self.discussions.append(comment)
    
    def create_comprehensive_symlinks(self):
        """Create comprehensive symlink system."""
        print("\\n🔗 Creating comprehensive symlink system...")
        
        symlink_count = 0
        batch_size = 50
        
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
                    
                    # Create standard symlinks
                    symlinks_to_create = [
                        ('latest', asset_versions[-1]),
                        ('work_in_progress', asset_versions[-1]),
                    ]
                    
                    # Add approval levels
                    if len(asset_versions) > 4:
                        symlinks_to_create.extend([
                            ('approved_supervisor', asset_versions[-2]),
                            ('approved_director', asset_versions[-3]),
                            ('approved_client', asset_versions[-4]),
                        ])
                    elif len(asset_versions) > 1:
                        symlinks_to_create.append(('approved', asset_versions[-2]))
                    
                    # Add milestone versions
                    if len(asset_versions) > 8:
                        quarter = len(asset_versions) // 4
                        half = len(asset_versions) // 2
                        three_quarter = 3 * len(asset_versions) // 4
                        symlinks_to_create.extend([
                            ('milestone_25', asset_versions[quarter]),
                            ('milestone_50', asset_versions[half]),
                            ('milestone_75', asset_versions[three_quarter]),
                        ])
                    
                    # Add department-specific symlinks
                    dept_symlinks = {
                        'modeling_approved': asset_versions[min(2, len(asset_versions)-1)],
                        'texturing_approved': asset_versions[min(len(asset_versions)//2, len(asset_versions)-1)],
                        'final_approved': asset_versions[-1],
                    }
                    
                    for name, version in dept_symlinks.items():
                        symlinks_to_create.append((name, version))
                    
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
    
    def generate_detailed_version_data(self, asset, version_num):
        """Generate comprehensive version metadata."""
        user, role = random.choice(self.users)
        department = random.choice(self.departments)
        
        base_data = {
            'version': version_num,
            'status': self.get_realistic_status(version_num),
            'created_by': user.username,
            'department': department,
            'user_role': role,
            'file_size': random.randint(1024*1024*2, 1024*1024*1000),  # 2MB to 1GB
            'resolution': random.choice(['2K', '4K', '8K']),
            'format': random.choice(['EXR', 'TIFF', 'MOV', 'MP4', 'PRORES']),
            'color_space': random.choice(['sRGB', 'Rec709', 'ACES', 'Linear']),
            'render_time_minutes': random.randint(5, 480),  # 5 minutes to 8 hours
            'creation_timestamp': (datetime.now() - timedelta(days=random.randint(1, 180))).isoformat(),
            'notes': self.generate_detailed_notes(version_num, department, role),
            'quality_level': random.choice(['preview', 'review', 'final', 'delivery']),
            'approved_by': random.choice([u[0].username for u in self.users[:5]] + ['']),
            'client_reviewed': random.choice([True, False]),
            'pipeline_version': f"v{random.randint(1, 5)}.{random.randint(0, 9)}",
            'software_used': random.choice(['Maya 2024', 'Houdini 19.5', 'Nuke 14.0', 'Blender 4.0']),
            'plugins': random.sample(['Arnold', 'VRay', 'Redshift', 'Cycles'], random.randint(1, 2)),
            'render_settings': {
                'samples': random.randint(64, 1024),
                'bounces': random.randint(4, 16),
                'resolution_multiplier': random.choice([0.5, 1.0, 1.5, 2.0])
            },
            'metadata': {
                'project_code': self.production_name,
                'sequence_code': f"SEQ_{random.randint(1, 15):02d}",
                'shot_code': f"SHOT_{random.randint(1, 450):03d}",
                'asset_type': random.choice(self.asset_types),
                'priority': random.choice(['low', 'normal', 'high', 'critical']),
                'deadline': (datetime.now() + timedelta(days=random.randint(1, 30))).isoformat(),
                'budget_code': f"BDG_{random.randint(1000, 9999)}",
                'billing_hours': random.randint(1, 40)
            }
        }
        
        return base_data
    
    def get_realistic_status(self, version_num):
        """Get realistic status progression."""
        if version_num <= 2:
            return random.choice(['wip', 'wip', 'review'])
        elif version_num <= 5:
            return random.choice(['wip', 'review', 'review'])
        elif version_num <= 10:
            return random.choice(['review', 'approved', 'approved'])
        else:
            return random.choice(['approved', 'delivered', 'final'])
    
    def generate_detailed_notes(self, version_num, department, role):
        """Generate detailed version notes."""
        base_notes = {
            1: f"Initial {department} pass by {role} - establishing workflow and base structure",
            2: f"First iteration incorporating early feedback from {department} team",
            3: f"Refinements based on {role} review and technical requirements",
            4: f"Mid-development iteration with {department} supervisor input",
            5: f"Polish pass addressing director notes and creative feedback",
        }
        
        if version_num <= 5:
            return base_notes.get(version_num, f"Version {version_num} - continued {department} development")
        elif version_num <= 10:
            return f"Advanced iteration v{version_num} - {department} refinements and client feedback integration"
        else:
            return f"Final delivery version v{version_num} - {department} approved and ready for downstream"
    
    def get_asset_description(self, asset_type):
        """Get detailed asset descriptions."""
        descriptions = {
            'character_model': 'High-resolution character model with film-quality topology and detail',
            'character_rig': 'Complete character rig with facial controls and advanced deformation',
            'environment_model': 'Detailed environment model with modular construction and LOD variants',
            'fx_simulation': 'Complex particle/fluid simulation with realistic physics behavior',
            'lighting_rig': 'Professional lighting setup with HDR environments and practical lights',
            'composite_script': 'Advanced compositing script with color correction and effects integration'
        }
        return descriptions.get(asset_type, f'Professional {asset_type.replace("_", " ")} for production pipeline')
    
    def create_detailed_sequence_discussion(self, sequence, user, role):
        """Create comprehensive sequence discussion."""
        discussion_type = random.choice([
            'creative_review', 'milestone_review', 'scheduling_notes', 'cross_department'
        ])
        
        title_templates = {
            'creative_review': f"Creative Review: {sequence.name}",
            'milestone_review': f"Milestone Assessment: {sequence.name}",
            'scheduling_notes': f"Schedule Coordination: {sequence.name}",
            'cross_department': f"Department Sync: {sequence.name}"
        }
        
        description_templates = {
            'creative_review': f"Comprehensive creative review for {sequence.name}. Evaluating story structure, character development, and visual consistency with overall film vision. Director and key creatives providing detailed feedback on narrative flow and emotional beats.",
            'milestone_review': f"Milestone review for {sequence.name}. Assessing current progress against project timeline and identifying potential bottlenecks. Resource allocation and quality benchmarks under evaluation.",
            'scheduling_notes': f"Schedule coordination meeting for {sequence.name}. Coordinating cross-departmental dependencies and ensuring smooth pipeline flow. Critical path analysis and resource optimization discussion.",
            'cross_department': f"Cross-departmental coordination for {sequence.name}. Ensuring seamless handoffs between modeling, animation, lighting, and compositing teams. Technical requirements and asset delivery schedules."
        }
        
        return Discussion(
            container=sequence,
            title=title_templates[discussion_type],
            description=description_templates[discussion_type],
            discussion_type=discussion_type,
            priority=random.choice(['normal', 'high', 'critical']),
            status=random.choice(['open', 'in_progress', 'resolved']),
            created_by=user.username,
            assigned_to=random.choice([u[0].username for u in self.users[:8]] + ['']),
            tags=[discussion_type, 'sequence', role, random.choice(self.departments)],
            metadata={
                'sequence_duration': random.randint(30, 300),  # seconds
                'estimated_shots': random.randint(20, 40),
                'complexity_rating': random.choice(['simple', 'moderate', 'complex', 'extreme']),
                'budget_allocation': random.randint(50000, 500000),
                'key_stakeholders': random.sample([u[0].username for u in self.users[:10]], 3),
                'delivery_milestone': (datetime.now() + timedelta(days=random.randint(7, 60))).isoformat(),
                'creative_notes': f"Key creative direction from {role} perspective",
                'technical_requirements': random.choice(['standard', 'enhanced', 'cutting_edge'])
            }
        )
    
    def create_detailed_shot_discussion(self, shot, user, role):
        """Create comprehensive shot discussion."""
        discussion_type = random.choice([
            'technical_review', 'dailies_feedback', 'performance_notes', 'quality_control'
        ])
        
        title_templates = {
            'technical_review': f"Technical Review: {shot.name}",
            'dailies_feedback': f"Dailies Feedback: {shot.name}",
            'performance_notes': f"Performance Analysis: {shot.name}",
            'quality_control': f"QC Review: {shot.name}"
        }
        
        description_templates = {
            'technical_review': f"Detailed technical review of {shot.name}. Analyzing render quality, asset optimization, and pipeline compliance. Performance metrics and resource utilization under evaluation.",
            'dailies_feedback': f"Daily screening feedback for {shot.name}. Director, supervisor, and client notes from review session. Creative and technical adjustments identified for next iteration.",
            'performance_notes': f"Performance analysis for {shot.name}. Render time optimization, memory usage patterns, and computational efficiency review. Identifying bottlenecks and improvement strategies.",
            'quality_control': f"Quality control assessment for {shot.name}. Final technical and creative review before client delivery. Compliance with delivery specifications and brand guidelines."
        }
        
        return Discussion(
            container=shot,
            title=title_templates[discussion_type],
            description=description_templates[discussion_type],
            discussion_type=discussion_type,
            priority=random.choice(['normal', 'high']),
            status=random.choice(['open', 'in_progress', 'resolved']),
            created_by=user.username,
            assigned_to=random.choice([u[0].username for u in self.users[8:20]] + ['']),
            tags=[discussion_type, 'shot', role, random.choice(self.departments)],
            metadata={
                'shot_duration': random.randint(2, 15),  # seconds
                'frame_count': random.randint(48, 360),
                'render_time_hours': random.randint(1, 48),
                'asset_count': random.randint(3, 8),
                'complexity_factors': random.sample(['fx', 'crowds', 'destruction', 'weather', 'vehicles'], random.randint(1, 3)),
                'camera_type': random.choice(['static', 'tracking', 'handheld', 'crane', 'aerial']),
                'lighting_setup': random.choice(['natural', 'studio', 'practical', 'mixed']),
                'post_requirements': random.sample(['color_grade', 'cleanup', 'compositing', 'stabilization'], random.randint(1, 3))
            }
        )
    
    def create_detailed_asset_discussion(self, asset, user, role):
        """Create comprehensive asset discussion."""
        discussion_type = random.choice([
            'approval_request', 'revision_notes', 'client_feedback', 'workflow_improvement'
        ])
        
        title_templates = {
            'approval_request': f"Approval Request: {asset.name}",
            'revision_notes': f"Revision Notes: {asset.name}",
            'client_feedback': f"Client Feedback: {asset.name}",
            'workflow_improvement': f"Workflow Discussion: {asset.name}"
        }
        
        description_templates = {
            'approval_request': f"Formal approval request for {asset.name}. Asset development completed according to specifications. Ready for supervisor and client review and sign-off.",
            'revision_notes': f"Revision documentation for {asset.name}. Incorporating feedback from previous review cycles. Technical and creative adjustments detailed with implementation timeline.",
            'client_feedback': f"Client feedback integration for {asset.name}. Stakeholder notes and brand compliance requirements. Creative direction adjustments and approval pathway.",
            'workflow_improvement': f"Workflow optimization discussion for {asset.name}. Process improvements and pipeline efficiency enhancements. Best practices documentation and knowledge sharing."
        }
        
        return Discussion(
            versioned_entity=asset,
            title=title_templates[discussion_type],
            description=description_templates[discussion_type],
            discussion_type=discussion_type,
            priority=random.choice(['low', 'normal', 'high']),
            status=random.choice(['open', 'in_progress', 'resolved']),
            created_by=user.username,
            assigned_to=random.choice([u[0].username for u in self.users[5:15]] + ['']),
            tags=[discussion_type, 'asset', role, random.choice(self.departments)],
            metadata={
                'asset_category': random.choice(self.asset_types),
                'revision_count': random.randint(1, 8),
                'development_hours': random.randint(8, 120),
                'technical_specs': {
                    'polygon_count': random.randint(5000, 100000),
                    'texture_resolution': random.choice(['2K', '4K', '8K']),
                    'file_size_mb': random.randint(50, 2000)
                },
                'usage_shots': random.randint(1, 20),
                'dependencies': random.sample(['rigging', 'texturing', 'animation', 'lighting'], random.randint(1, 3)),
                'delivery_format': random.choice(['Maya', 'FBX', 'USD', 'Alembic'])
            }
        )
    
    def create_detailed_version_discussion(self, version, user, role):
        """Create detailed version-specific discussion."""
        discussion_type = random.choice([
            'revision_notes', 'approval_request', 'quality_control', 'delivery_notes'
        ])
        
        title = f"Version Review: {version.entity.name} v{version.version_number}"
        
        descriptions = {
            'revision_notes': f"Detailed revision notes for version {version.version_number} of {version.entity.name}. Incorporating feedback from {role} review and addressing technical requirements.",
            'approval_request': f"Approval request for version {version.version_number} of {version.entity.name}. Ready for {role} sign-off and progression to next pipeline stage.",
            'quality_control': f"Quality control review for version {version.version_number} of {version.entity.name}. Final technical assessment by {role} before delivery.",
            'delivery_notes': f"Delivery documentation for version {version.version_number} of {version.entity.name}. Final specifications and handoff notes from {role}."
        }
        
        return Discussion(
            version=version,
            title=title,
            description=descriptions[discussion_type],
            discussion_type=discussion_type,
            priority=random.choice(['normal', 'high']),
            status=random.choice(['open', 'resolved']),
            created_by=user.username,
            assigned_to=random.choice([u[0].username for u in self.users[10:]] + ['']),
            tags=[discussion_type, 'version', role],
            metadata={
                'version_number': version.version_number,
                'previous_version': version.version_number - 1 if version.version_number > 1 else None,
                'changes_summary': f"Key changes in v{version.version_number}",
                'testing_required': random.choice([True, False]),
                'backward_compatible': random.choice([True, False]),
                'performance_impact': random.choice(['none', 'minimal', 'moderate', 'significant'])
            }
        )
    
    def generate_comment_content(self, comment_type, role, original_type):
        """Generate realistic comment content."""
        templates = {
            'follow_up': f"Follow-up from {role}: Additional thoughts on {original_type} discussion.",
            'clarification': f"Clarification requested by {role}: Need more details on technical requirements.",
            'suggestion': f"Suggestion from {role}: Alternative approach that might improve efficiency.",
            'progress_update': f"Progress update from {role}: Current status and next steps outline.",
            'blocker_report': f"Blocker reported by {role}: Issue preventing progress, needs resolution.",
            'solution': f"Solution proposed by {role}: Recommended approach to resolve current challenges.",
            'approval': f"Approval confirmed by {role}: Requirements met, ready to proceed.",
            'rejection': f"Rejection by {role}: Specific issues require addressing before approval.",
            'alternative': f"Alternative approach by {role}: Different methodology for consideration.",
            'reference': f"Reference material from {role}: Relevant documentation and examples.",
            'meeting_notes': f"Meeting notes from {role}: Summary of discussion and action items.",
            'action_item': f"Action item from {role}: Specific tasks and responsibilities assigned."
        }
        
        return templates.get(comment_type, f"Comment from {role} regarding {original_type}")
    
    def print_comprehensive_results(self):
        """Print detailed results of the large-scale test."""
        elapsed_time = time.time() - self.start_time
        
        print("\\n" + "=" * 70)
        print("📊 LARGE SCALE CG PRODUCTION TEST RESULTS")
        print("=" * 70)
        
        print(f"🎬 Production: {self.production_name}")
        print(f"⏱️  Total Time: {elapsed_time:.2f} seconds")
        print(f"👥 Team Members: {len(self.users)} users")
        print()
        
        print("📈 PRODUCTION STRUCTURE:")
        print(f"   🎭 Sequences: {len(self.sequences):,}")
        print(f"   🎯 Shots: {len(self.shots):,}")
        print(f"   🎨 Assets: {len(self.assets):,}")
        print(f"   📦 Versions: {len(self.versions):,}")
        print(f"   🔗 Symlinks: {len(self.symlinks):,}")
        print()
        
        print("💬 COLLABORATION SYSTEM:")
        print(f"   💭 Total Discussions: {len(self.discussions):,}")
        
        # Analyze discussion types
        discussion_stats = {}
        for disc in self.discussions:
            dtype = disc.discussion_type or 'unknown'
            discussion_stats[dtype] = discussion_stats.get(dtype, 0) + 1
        
        print(f"   📊 Discussion Breakdown:")
        for dtype, count in sorted(discussion_stats.items(), key=lambda x: x[1], reverse=True)[:8]:
            print(f"      • {dtype}: {count:,}")
        
        # Status breakdown
        status_stats = {}
        for disc in self.discussions:
            status = disc.status or 'unknown'
            status_stats[status] = status_stats.get(status, 0) + 1
        
        print(f"   ⚡ Status Distribution:")
        for status, count in status_stats.items():
            print(f"      • {status}: {count:,}")
        
        print()
        total_entities = (len(self.sequences) + len(self.shots) + len(self.assets) + 
                         len(self.versions) + len(self.discussions) + len(self.symlinks))
        
        print(f"📊 TOTAL ENTITIES: {total_entities:,}")
        print(f"⚡ CREATION RATE: {total_entities/elapsed_time:.1f} entities/second")
        
        print("\\n🎉 LARGE SCALE TEST COMPLETED SUCCESSFULLY!")
        print("Your Nexus8 system now contains an extensive production dataset")
        print("with comprehensive collaboration workflows and realistic metadata.")
        print("=" * 70)
    
    def run_large_scale_test(self):
        """Execute the complete large-scale test."""
        try:
            self.create_production_users()
            self.create_sequences()
            self.create_shots()
            self.create_assets()
            self.create_versions()
            self.create_extensive_discussions()
            self.create_comprehensive_symlinks()
            self.print_comprehensive_results()
            return True
        except Exception as e:
            print(f"❌ Error in large-scale test: {e}")
            import traceback
            traceback.print_exc()
            return False


def main():
    """Main execution."""
    print("🎬 LARGE SCALE CG PRODUCTION TEST")
    print("This creates ~39,000+ entities with extensive discussions")
    print("Estimated time: 3-5 minutes")
    print()
    
    response = input("Proceed with large-scale dataset creation? (y/N): ")
    if response.lower() != 'y':
        print("Cancelled.")
        return False
    
    # Database check
    try:
        from django.db import connection
        cursor = connection.cursor()
        cursor.execute("SELECT 1")
        print("✅ Database ready")
    except Exception as e:
        print(f"❌ Database error: {e}")
        return False
    
    # Run test
    test = LargeScaleCGProductionTest()
    success = test.run_large_scale_test()
    
    if success:
        print("\\n🚀 LARGE SCALE DATASET READY!")
        print("Your system is now loaded with comprehensive production data")
        print("including extensive discussions, notes, and collaboration workflows.")
    else:
        print("\\n💥 Test failed.")
    
    return success


if __name__ == '__main__':
    success = main()
    sys.exit(0 if success else 1)
