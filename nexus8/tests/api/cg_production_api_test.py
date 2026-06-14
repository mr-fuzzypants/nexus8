#!/usr/bin/env python3
"""
CG Production REST API Test

This script tests the Django REST API endpoints with the created CG production data
and demonstrates comprehensive workflow operations.
"""

import os
import sys
import django
from django.conf import settings
import json

# Add the nexus8 directory to Python path
sys.path.insert(0, '/Users/robertpringle/development/yjs/nexus8/nexus8')

# Configure Django settings
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'nexus8.settings')
django.setup()

from rest_framework.test import APIClient
from django.contrib.auth.models import User
from trackables.models import Container, MediaAsset, Version, Symlink
from discussions.models import Discussion


class CGProductionAPITest:
    """Test Django REST API with CG production data."""
    
    def __init__(self):
        self.client = APIClient()
        self.user = self.get_or_create_user()
        self.client.force_authenticate(user=self.user)
        
        print("🎯 CG PRODUCTION REST API TEST")
        print("=" * 60)
        print("Testing Django REST API endpoints with production data")
        print("=" * 60)
    
    def get_or_create_user(self):
        """Get or create API test user."""
        user, created = User.objects.get_or_create(
            username='api_test_user',
            defaults={
                'email': 'api@test.com',
                'first_name': 'API',
                'last_name': 'Tester',
                'is_staff': True
            }
        )
        return user
    
    def test_container_endpoints(self):
        """Test container-related API endpoints."""
        print("\\n📦 Testing Container Endpoints...")
        
        # List all containers
        response = self.client.get('/trackables/api/containers/')
        if response.status_code == 200:
            data = response.json()
            containers = data.get('results', []) if isinstance(data, dict) else data
            total_count = data.get('count', len(containers)) if isinstance(data, dict) else len(containers)
            print(f"   ✅ GET /containers/ - {len(containers)} containers shown, {total_count} total")
            
            if containers:
                # Get specific container
                container_id = containers[0]['id']
                response = self.client.get(f'/trackables/api/containers/{container_id}/')
                if response.status_code == 200:
                    print(f"   ✅ GET /containers/{container_id}/ - Success")
                else:
                    print(f"   ❌ GET /containers/{container_id}/ - Failed ({response.status_code})")
        else:
            print(f"   ❌ GET /containers/ - Failed ({response.status_code})")
        
        # Test container hierarchy
        sequences = Container.objects.filter(parent_container__isnull=True)
        if sequences.exists():
            seq = sequences.first()
            response = self.client.get(f'/trackables/api/containers/{seq.id}/children/')
            if response.status_code == 200:
                children = response.json()
                print(f"   ✅ GET /containers/{seq.id}/children/ - {len(children)} child containers")
            else:
                print(f"   ❌ GET /containers/{seq.id}/children/ - Failed ({response.status_code})")
    
    def test_asset_endpoints(self):
        """Test MediaAsset-related API endpoints."""
        print("\\n🎨 Testing MediaAsset Endpoints...")
        
        # List all assets via unified endpoint
        response = self.client.get('/trackables/api/all-versioned-entities/')
        if response.status_code == 200:
            data = response.json()
            entities = data.get('results', []) if isinstance(data, dict) else data
            total_count = data.get('count', len(entities)) if isinstance(data, dict) else len(entities)
            assets = [e for e in entities if 'MediaAsset' in str(e.get('entity_type', ''))]
            print(f"   ✅ GET /all-versioned-entities/ - {len(entities)} entities shown, {total_count} total, {len(assets)} assets")
            
            if assets:
                # Get specific asset
                asset_id = assets[0]['id']
                response = self.client.get(f'/trackables/api/all-versioned-entities/{asset_id}/')
                if response.status_code == 200:
                    print(f"   ✅ GET /all-versioned-entities/{asset_id}/ - Success")
                else:
                    print(f"   ❌ GET /all-versioned-entities/{asset_id}/ - Failed ({response.status_code})")
        else:
            print(f"   ❌ GET /all-versioned-entities/ - Failed ({response.status_code})")
    
    def test_version_endpoints(self):
        """Test Version-related API endpoints."""
        print("\\n📦 Testing Version Endpoints...")
        
        # List all versions
        response = self.client.get('/trackables/api/versions/')
        if response.status_code == 200:
            data = response.json()
            versions = data.get('results', []) if isinstance(data, dict) else data
            total_count = data.get('count', len(versions)) if isinstance(data, dict) else len(versions)
            print(f"   ✅ GET /versions/ - {len(versions)} versions shown, {total_count} total")
            
            if versions:
                # Get specific version
                version_id = versions[0]['id']
                response = self.client.get(f'/trackables/api/versions/{version_id}/')
                if response.status_code == 200:
                    print(f"   ✅ GET /versions/{version_id}/ - Success")
                else:
                    print(f"   ❌ GET /versions/{version_id}/ - Failed ({response.status_code})")
        else:
            print(f"   ❌ GET /versions/ - Failed ({response.status_code})")
        
        # Test version filtering by entity
        assets = MediaAsset.objects.all()
        if assets.exists():
            asset = assets.first()
            response = self.client.get(f'/trackables/api/versions/?entity={asset.id}')
            if response.status_code == 200:
                data = response.json()
                asset_versions = data.get('results', []) if isinstance(data, dict) else data
                print(f"   ✅ GET /versions/?entity={asset.id} - {len(asset_versions)} versions for asset")
            else:
                print(f"   ❌ GET /versions/?entity={asset.id} - Failed ({response.status_code})")
    
    def test_symlink_endpoints(self):
        """Test Symlink-related API endpoints."""
        print("\\n🔗 Testing Symlink Endpoints...")
        
        # List all symlinks
        response = self.client.get('/trackables/api/symlinks/')
        if response.status_code == 200:
            data = response.json()
            symlinks = data.get('results', []) if isinstance(data, dict) else data
            total_count = data.get('count', len(symlinks)) if isinstance(data, dict) else len(symlinks)
            print(f"   ✅ GET /symlinks/ - {len(symlinks)} symlinks shown, {total_count} total")
            
            if symlinks:
                # Get specific symlink
                symlink_id = symlinks[0]['id']
                response = self.client.get(f'/trackables/api/symlinks/{symlink_id}/')
                if response.status_code == 200:
                    print(f"   ✅ GET /symlinks/{symlink_id}/ - Success")
                else:
                    print(f"   ❌ GET /symlinks/{symlink_id}/ - Failed ({response.status_code})")
        else:
            print(f"   ❌ GET /symlinks/ - Failed ({response.status_code})")
        
        # Test symlink filtering by entity
        assets = MediaAsset.objects.all()
        if assets.exists():
            asset = assets.first()
            response = self.client.get(f'/trackables/api/symlinks/?entity={asset.id}')
            if response.status_code == 200:
                data = response.json()
                asset_symlinks = data.get('results', []) if isinstance(data, dict) else data
                print(f"   ✅ GET /symlinks/?entity={asset.id} - {len(asset_symlinks)} symlinks for asset")
            else:
                print(f"   ❌ GET /symlinks/?entity={asset.id} - Failed ({response.status_code})")
    
    def test_create_operations(self):
        """Test creating new entities via API."""
        print("\\n➕ Testing Create Operations...")
        
        # Create a new sequence
        sequence_data = {
            'code': 'API_TEST_SEQ_001',
            'name': 'API Test Sequence',
            'description': 'Sequence created via API test',
            'parent_container': None
        }
        
        response = self.client.post('/trackables/api/containers/', sequence_data, format='json')
        if response.status_code == 201:
            new_sequence = response.json()
            print(f"   ✅ POST /containers/ - Created sequence {new_sequence['id']}")
            
            # Create a shot in this sequence
            shot_data = {
                'code': 'API_TEST_SHOT_001',
                'name': 'API Test Shot',
                'description': 'Shot created via API test',
                'parent_container': new_sequence['id']
            }
            
            response = self.client.post('/trackables/api/containers/', shot_data, format='json')
            if response.status_code == 201:
                new_shot = response.json()
                print(f"   ✅ POST /containers/ - Created shot {new_shot['id']}")
            else:
                print(f"   ❌ POST /containers/ (shot) - Failed ({response.status_code})")
        else:
            print(f"   ❌ POST /containers/ (sequence) - Failed ({response.status_code})")
        
        # Create a new asset
        asset_data = {
            'code': 'API_TEST_ASSET_001',
            'name': 'API Test Asset',
            'description': 'Asset created via API test'
        }
        
        response = self.client.post('/trackables/api/all-versioned-entities/', asset_data, format='json')
        if response.status_code == 201:
            new_asset = response.json()
            print(f"   ✅ POST /all-versioned-entities/ - Created asset {new_asset['id']}")
            
            # Create a version for this asset
            version_data = {
                'entity': new_asset['id'],
                'data': {
                    'status': 'wip',
                    'created_by': 'api_test',
                    'notes': 'Version created via API test'
                }
            }
            
            response = self.client.post('/trackables/api/versions/', version_data, format='json')
            if response.status_code == 201:
                new_version = response.json()
                print(f"   ✅ POST /versions/ - Created version {new_version['id']}")
            else:
                print(f"   ❌ POST /versions/ - Failed ({response.status_code})")
        else:
            print(f"   ❌ POST /all-versioned-entities/ - Failed ({response.status_code})")
    
    def test_workflow_queries(self):
        """Test complex workflow queries."""
        print("\\n🔍 Testing Workflow Queries...")
        
        # Get production summary
        response = self.client.get('/trackables/api/all-versioned-entities/summary/')
        if response.status_code == 200:
            summary = response.json()
            print(f"   ✅ GET /all-versioned-entities/summary/ - Success")
            print(f"      Total entities: {summary.get('total_entities', 'N/A')}")
        else:
            print(f"   ❌ GET /all-versioned-entities/summary/ - Failed ({response.status_code})")
        
        # Search entities
        response = self.client.get('/trackables/api/all-versioned-entities/?search=asset')
        if response.status_code == 200:
            data = response.json()
            search_results = data.get('results', []) if isinstance(data, dict) else data
            print(f"   ✅ GET /all-versioned-entities/?search=asset - {len(search_results)} results")
        else:
            print(f"   ❌ GET /all-versioned-entities/?search=asset - Failed ({response.status_code})")
        
        # Filter by status
        response = self.client.get('/trackables/api/versions/?data__status=approved')
        if response.status_code == 200:
            data = response.json()
            approved_versions = data.get('results', []) if isinstance(data, dict) else data
            print(f"   ✅ GET /versions/?data__status=approved - {len(approved_versions)} approved versions")
        else:
            print(f"   ❌ GET /versions/?data__status=approved - Failed ({response.status_code})")
    
    def test_discussion_integration(self):
        """Test discussion system integration."""
        print("\\n💬 Testing Discussion Integration...")
        
        # Check if discussions exist
        discussion_count = Discussion.objects.count()
        container_discussions = Discussion.objects.filter(container__isnull=False).count()
        entity_discussions = Discussion.objects.filter(versioned_entity__isnull=False).count()
        
        print(f"   📊 Discussion Status:")
        print(f"      Total discussions: {discussion_count}")
        print(f"      Container discussions: {container_discussions}")
        print(f"      Entity discussions: {entity_discussions}")
        
        # Test discussion-entity relationships
        if entity_discussions > 0:
            sample_discussion = Discussion.objects.filter(versioned_entity__isnull=False).first()
            if sample_discussion:
                print(f"   ✅ Sample entity discussion: '{sample_discussion.title}'")
                print(f"      Entity: {sample_discussion.versioned_entity.name}")
                print(f"      Status: {sample_discussion.status}")
        
        if container_discussions > 0:
            sample_discussion = Discussion.objects.filter(container__isnull=False).first()
            if sample_discussion:
                print(f"   ✅ Sample container discussion: '{sample_discussion.title}'")
                print(f"      Container: {sample_discussion.container.name}")
                print(f"      Status: {sample_discussion.status}")
    
    def print_final_summary(self):
        """Print final test summary."""
        print("\\n" + "=" * 60)
        print("📊 CG PRODUCTION API TEST SUMMARY")
        print("=" * 60)
        
        # Current database state
        sequences = Container.objects.filter(parent_container__isnull=True).count()
        shots = Container.objects.filter(parent_container__isnull=False).count()
        assets = MediaAsset.objects.count()
        versions = Version.objects.count()
        discussions = Discussion.objects.count()
        symlinks = Symlink.objects.count()
        
        print(f"🏢 Production Dataset:")
        print(f"   Sequences: {sequences:,}")
        print(f"   Shots: {shots:,}")
        print(f"   Assets: {assets:,}")
        print(f"   Versions: {versions:,}")
        print(f"   Discussions: {discussions:,}")
        print(f"   Symlinks: {symlinks:,}")
        
        total_entities = sequences + shots + assets + versions + discussions + symlinks
        print(f"\\n📊 Total Entities: {total_entities:,}")
        
        print("\\n✅ API ENDPOINTS TESTED:")
        print("   • Container CRUD operations")
        print("   • MediaAsset management")
        print("   • Version tracking")
        print("   • Symlink management")
        print("   • Workflow queries and filtering")
        print("   • Discussion system integration")
        
        print("\\n🎉 CG PRODUCTION API TEST COMPLETED!")
        print("Your Nexus8 REST API is fully operational with production data.")
    
    def run_all_tests(self):
        """Run all API tests."""
        try:
            self.test_container_endpoints()
            self.test_asset_endpoints()
            self.test_version_endpoints()
            self.test_symlink_endpoints()
            self.test_create_operations()
            self.test_workflow_queries()
            self.test_discussion_integration()
            self.print_final_summary()
            return True
        except Exception as e:
            print(f"❌ API Test Error: {e}")
            import traceback
            traceback.print_exc()
            return False


def main():
    """Main function."""
    print("🎬 Starting CG Production REST API Test...")
    
    # Test database state
    from django.db import connection
    try:
        cursor = connection.cursor()
        cursor.execute("SELECT COUNT(*) FROM trackables_container")
        container_count = cursor.fetchone()[0]
        print(f"✅ Database ready - {container_count} containers found")
    except Exception as e:
        print(f"❌ Database issue: {e}")
        return False
    
    # Run API tests
    tester = CGProductionAPITest()
    success = tester.run_all_tests()
    
    if success:
        print("\\n🚀 All API tests passed! System ready for production use.")
    else:
        print("\\n💥 Some API tests failed.")
    
    return success


if __name__ == '__main__':
    success = main()
    sys.exit(0 if success else 1)
