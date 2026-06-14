#!/usr/bin/env python3
"""
Simple CG Production Test Script

Creates a smaller, focused dataset to stress test the system:
- 5 sequences
- 10 shots per sequence (50 shots total)
- 2 assets per shot (100 assets total)
- 5 versions per asset (500 versions total)
- Discussions for workflow testing
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


class SimpleCGProductionTest:
    """Simple CG production test with guaranteed unique codes."""
    
    def __init__(self):
        self.sequences = []
        self.shots = []
        self.assets = []
        self.versions = []
        self.discussions = []
        self.symlinks = []
        
        self.production_name = "SIMPLE_CG"
        self.start_time = time.time()
        self.counter = 1000  # Start counter high to avoid conflicts
        
        # Asset types
        self.asset_types = [
            'character', 'environment', 'prop', 'texture', 'shader', 'animation'
        ]
        
        print("🎬 Simple CG Production Test")
        print("=" * 50)
        print("Creating: 5 sequences, 10 shots/seq, 2 assets/shot, 5 versions/asset")
        print("=" * 50)
    
    def get_unique_code(self, prefix):
        """Generate a guaranteed unique code."""
        self.counter += 1
        return f"{prefix}_{self.counter:06d}"
    
    def get_or_create_user(self):
        """Get or create test user."""
        user, created = User.objects.get_or_create(
            username='simple_cg_test',
            defaults={'email': 'test@cg.com', 'first_name': 'Test', 'last_name': 'User'}
        )
        return user
    
    def create_sequences(self):
        """Create 5 sequences."""
        print("\\n📋 Creating 5 sequences...")
        
        for i in range(5):
            code = self.get_unique_code(f"{self.production_name}_SEQ")
            sequence = Container.objects.create(
                code=code,
                name=f"Sequence {i+1:02d}",
                description=f"Test sequence {i+1} for stress testing",
                parent_container=None
            )
            self.sequences.append(sequence)
        
        print(f"   ✅ Created {len(self.sequences)} sequences")
    
    def create_shots(self):
        """Create 10 shots per sequence."""
        print("\\n🎯 Creating 50 shots...")
        
        for seq_idx, sequence in enumerate(self.sequences):
            for shot_idx in range(10):
                code = self.get_unique_code(f"{self.production_name}_SHOT")
                shot = Container.objects.create(
                    code=code,
                    name=f"Seq{seq_idx+1:02d}_Shot{shot_idx+1:02d}",
                    description=f"Shot {shot_idx+1} in sequence {seq_idx+1}",
                    parent_container=sequence
                )
                self.shots.append(shot)
        
        print(f"   ✅ Created {len(self.shots)} shots")
    
    def create_assets(self):
        """Create 2 assets per shot."""
        print("\\n🎨 Creating 100 assets...")
        
        for shot in self.shots:
            for asset_idx in range(2):
                asset_type = random.choice(self.asset_types)
                code = self.get_unique_code(f"{self.production_name}_AST")
                
                asset = MediaAsset.objects.create(
                    code=code,
                    name=f"{asset_type.title()} Asset {asset_idx+1}",
                    description=f"{asset_type} for {shot.name}"
                )
                self.assets.append(asset)
        
        print(f"   ✅ Created {len(self.assets)} assets")
    
    def create_versions(self):
        """Create 5 versions per asset."""
        print("\\n📦 Creating 500 versions...")
        
        version_count = 0
        batch_size = 50
        
        for batch_start in range(0, len(self.assets), batch_size):
            batch_end = min(batch_start + batch_size, len(self.assets))
            
            with transaction.atomic():
                for asset in self.assets[batch_start:batch_end]:
                    for version_num in range(1, 6):  # 5 versions per asset
                        version_data = {
                            'version': version_num,
                            'status': random.choice(['wip', 'ready', 'approved']),
                            'created_by': random.choice(['artist1', 'artist2', 'artist3']),
                            'department': random.choice(['modeling', 'texturing', 'animation']),
                            'file_size': random.randint(1024*100, 1024*1000),  # 100KB to 1MB
                            'format': random.choice(['EXR', 'TIFF', 'MOV']),
                            'notes': f'Version {version_num} iteration'
                        }
                        
                        version = Version.objects.create(
                            entity=asset,
                            version_number=version_num,
                            data=version_data
                        )
                        self.versions.append(version)
                        version_count += 1
            
            if version_count % 100 == 0:
                print(f"   📊 Created {version_count}/500 versions...")
        
        print(f"   ✅ Created {len(self.versions)} versions")
    
    def create_discussions(self):
        """Create discussions for entities."""
        print("\\n💬 Creating discussions...")
        
        user = self.get_or_create_user()
        
        # Discussions for sequences
        for sequence in self.sequences:
            discussion = Discussion.objects.create(
                container=sequence,
                title=f"Review: {sequence.name}",
                description=f"Creative review for {sequence.name}",
                discussion_type='creative_review',
                priority='normal',
                status='open',
                created_by=user.username,
                tags=['sequence', 'review'],
                metadata={'type': 'sequence_review'}
            )
            self.discussions.append(discussion)
        
        # Discussions for sample shots (25%)
        sample_shots = random.sample(self.shots, len(self.shots) // 4)
        for shot in sample_shots:
            discussion = Discussion.objects.create(
                container=shot,
                title=f"Technical Review: {shot.name}",
                description=f"Technical review for {shot.name}",
                discussion_type='technical_review',
                priority='high',
                status='in_progress',
                created_by=user.username,
                tags=['shot', 'technical'],
                metadata={'type': 'shot_review'}
            )
            self.discussions.append(discussion)
        
        # Discussions for sample assets (20%)
        sample_assets = random.sample(self.assets, len(self.assets) // 5)
        for asset in sample_assets:
            discussion = Discussion.objects.create(
                versioned_entity=asset,
                title=f"Asset Feedback: {asset.name}",
                description=f"Feedback for {asset.name}",
                discussion_type='client_feedback',
                priority='normal',
                status='resolved',
                created_by=user.username,
                tags=['asset', 'feedback'],
                metadata={'type': 'asset_feedback'}
            )
            self.discussions.append(discussion)
        
        print(f"   ✅ Created {len(self.discussions)} discussions")
    
    def create_symlinks(self):
        """Create symlinks for version management."""
        print("\\n🔗 Creating symlinks...")
        
        for asset in self.assets:
            asset_versions = [v for v in self.versions if v.entity_id == asset.id]
            if asset_versions:
                asset_versions.sort(key=lambda v: v.version_number)
                
                # Create latest and approved symlinks
                latest_symlink = Symlink.objects.create(
                    entity=asset,
                    name='latest',
                    version=asset_versions[-1]
                )
                self.symlinks.append(latest_symlink)
                
                if len(asset_versions) > 2:
                    approved_symlink = Symlink.objects.create(
                        entity=asset,
                        name='approved',
                        version=asset_versions[-2]
                    )
                    self.symlinks.append(approved_symlink)
        
        print(f"   ✅ Created {len(self.symlinks)} symlinks")
    
    def print_statistics(self):
        """Print final statistics."""
        elapsed_time = time.time() - self.start_time
        
        print("\\n" + "=" * 50)
        print("📊 SIMPLE CG PRODUCTION TEST RESULTS")
        print("=" * 50)
        
        print(f"⏱️  Total Time: {elapsed_time:.2f} seconds")
        print()
        print("📈 ENTITIES CREATED:")
        print(f"   Sequences: {len(self.sequences)}")
        print(f"   Shots: {len(self.shots)}")
        print(f"   Assets: {len(self.assets)}")
        print(f"   Versions: {len(self.versions)}")
        print(f"   Discussions: {len(self.discussions)}")
        print(f"   Symlinks: {len(self.symlinks)}")
        
        total = len(self.sequences) + len(self.shots) + len(self.assets) + len(self.versions) + len(self.discussions) + len(self.symlinks)
        print(f"\\n📊 TOTAL ENTITIES: {total}")
        print(f"⚡ Creation Rate: {total/elapsed_time:.1f} entities/second")
        print("\\n🎉 TEST COMPLETED SUCCESSFULLY!")
    
    def run_test(self):
        """Run the complete test."""
        try:
            self.create_sequences()
            self.create_shots()
            self.create_assets()
            self.create_versions()
            self.create_discussions()
            self.create_symlinks()
            self.print_statistics()
            return True
        except Exception as e:
            print(f"❌ Error: {e}")
            import traceback
            traceback.print_exc()
            return False


def main():
    """Main function."""
    print("🎬 Starting Simple CG Production Test...")
    
    # Test database connection
    try:
        from django.db import connection
        cursor = connection.cursor()
        cursor.execute("SELECT 1")
        print("✅ Database connection successful")
    except Exception as e:
        print(f"❌ Database connection failed: {e}")
        return False
    
    # Run test
    test = SimpleCGProductionTest()
    success = test.run_test()
    
    if success:
        print("\\n🚀 Dataset ready for workflow testing!")
    else:
        print("\\n💥 Test failed.")
    
    return success


if __name__ == '__main__':
    success = main()
    sys.exit(0 if success else 1)
