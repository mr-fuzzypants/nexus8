#!/usr/bin/env python3
"""
Test script for Unified Version ViewSet endpoint.
Tests the new endpoint that lists all Version instances and derived models.
"""

import os
import sys
import json

# Add the nexus8 project to the Python path
sys.path.insert(0, '/Users/robertpringle/development/yjs/nexus8/nexus8')

# Setup Django environment
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'nexus8.settings')

import django
django.setup()

# Import after Django setup
from django.test import Client
from django.contrib.auth.models import User
from trackables.models import Version, ContainerVersion


def test_unified_versions_endpoint():
    """Test the unified versions endpoint."""
    print("🌐 Testing Unified Version API Endpoint")
    print("=" * 60)
    
    # Count different types in database
    total_versions = Version.objects.count()
    container_versions_count = ContainerVersion.objects.count()
    
    print(f"📊 Database counts:")
    print(f"   Total Version: {total_versions}")
    print(f"   ContainerVersion instances: {container_versions_count}")
    print()
    
    # Create test client
    client = Client()
    
    # Create or get test user
    user, created = User.objects.get_or_create(
        username='testuser',
        defaults={'email': 'test@test.com', 'password': 'testpass'}
    )
    
    # Login
    client.force_login(user)
    
    results = {}
    
    try:
        # Test 1: Main unified endpoint
        print("🚀 Test 1: Main unified endpoint")
        response = client.get('/trackables/api/all-versions/')
        
        if response.status_code == 200:
            data = response.json()
            results_count = len(data.get('results', data) if isinstance(data, dict) and 'results' in data else data)
            print(f"   ✅ Success! Retrieved {results_count} items")
            
            # Show sample data
            if results_count > 0:
                sample_data = data.get('results', data)[0] if isinstance(data, dict) and 'results' in data else data[0]
                print(f"   📝 Sample item:")
                print(f"      - ID: {sample_data.get('id')}")
                print(f"      - Entity Code: {sample_data.get('entity_code')}")
                print(f"      - Entity Name: {sample_data.get('entity_name')}")
                print(f"      - Version Number: {sample_data.get('version_number')}")
                print(f"      - Model Type: {sample_data.get('model_type')}")
                print(f"      - Model Name: {sample_data.get('model_name')}")
                
                # Show any ContainerVersion-specific fields
                if sample_data.get('model_type') == 'container_version':
                    print(f"      - Parent Container Version: {sample_data.get('parent_container_version')}")
                    print(f"      - Version Hierarchy Level: {sample_data.get('version_hierarchy_level')}")
                    print(f"      - Container Code: {sample_data.get('container_code')}")
            
            results['main_endpoint'] = True
        else:
            print(f"   ❌ Failed with status: {response.status_code}")
            print(f"   Error: {response.content.decode()}")
            results['main_endpoint'] = False
        
        print()
        
        # Test 2: Summary endpoint
        print("🚀 Test 2: Summary statistics")
        response = client.get('/trackables/api/all-versions/summary/')
        
        if response.status_code == 200:
            data = response.json()
            print(f"   ✅ Success! Summary data:")
            print(f"      - Total count: {data.get('total_count')}")
            print(f"      - By type: {data.get('by_type')}")
            print(f"      - Available types: {data.get('types_available')}")
            results['summary'] = True
        else:
            print(f"   ❌ Failed with status: {response.status_code}")
            results['summary'] = False
        
        print()
        
        # Test 3: Filter by type - ContainerVersions
        if container_versions_count > 0:
            print("🚀 Test 3: Filter by ContainerVersion type")
            response = client.get('/trackables/api/all-versions/by_type/?type=container_version')
            
            if response.status_code == 200:
                data = response.json()
                results_count = len(data.get('results', data) if isinstance(data, dict) and 'results' in data else data)
                print(f"   ✅ Success! Retrieved {results_count} container versions")
                
                if results_count > 0:
                    sample = data.get('results', data)[0] if isinstance(data, dict) and 'results' in data else data[0]
                    print(f"   📝 Sample container version:")
                    print(f"      - Entity Code: {sample.get('entity_code')}")
                    print(f"      - Version Number: {sample.get('version_number')}")
                    print(f"      - Model Type: {sample.get('model_type')}")
                    print(f"      - Hierarchy Level: {sample.get('version_hierarchy_level')}")
                    print(f"      - Container Code: {sample.get('container_code')}")
                
                results['filter_container_versions'] = True
            else:
                print(f"   ❌ Failed with status: {response.status_code}")
                results['filter_container_versions'] = False
        else:
            print("   ⏭️  Skipped - No container versions in database")
            results['filter_container_versions'] = 'skipped'
        
        print()
        
        # Test 4: Filter by type - Base Versions
        print("🚀 Test 4: Filter by base Version type")
        response = client.get('/trackables/api/all-versions/by_type/?type=version')
        
        if response.status_code == 200:
            data = response.json()
            results_count = len(data.get('results', data) if isinstance(data, dict) and 'results' in data else data)
            print(f"   ✅ Success! Retrieved {results_count} base versions")
            results['filter_base_versions'] = True
        else:
            print(f"   ❌ Failed with status: {response.status_code}")
            results['filter_base_versions'] = False
        
        print()
        
        # Test 5: Hierarchy view
        if container_versions_count > 0:
            print("🚀 Test 5: Container version hierarchy")
            response = client.get('/trackables/api/all-versions/hierarchy/')
            
            if response.status_code == 200:
                data = response.json()
                print(f"   ✅ Success! Hierarchy data:")
                print(f"      - Hierarchy levels: {data.get('hierarchy_levels')}")
                print(f"      - Total container versions: {data.get('total_container_versions')}")
                
                # Show sample hierarchy data
                hierarchy_data = data.get('hierarchy_data', {})
                if hierarchy_data:
                    for level, versions in list(hierarchy_data.items())[:2]:  # Show first 2 levels
                        print(f"      - Level {level}: {len(versions)} versions")
                        if versions:
                            sample_version = versions[0]
                            print(f"        Example: {sample_version.get('entity_code')} v{sample_version.get('version_number')}")
                
                results['hierarchy'] = True
            else:
                print(f"   ❌ Failed with status: {response.status_code}")
                results['hierarchy'] = False
        else:
            print("   ⏭️  Skipped - No container versions in database")
            results['hierarchy'] = 'skipped'
        
        print()
        
        # Test 6: Search functionality
        print("🚀 Test 6: Search functionality")
        response = client.get('/trackables/api/all-versions/?search=CHAR')
        
        if response.status_code == 200:
            data = response.json()
            results_count = len(data.get('results', data) if isinstance(data, dict) and 'results' in data else data)
            print(f"   ✅ Success! Search returned {results_count} results")
            results['search'] = True
        else:
            print(f"   ❌ Failed with status: {response.status_code}")
            results['search'] = False
        
        print()
        
    except Exception as e:
        print(f"❌ Test failed with exception: {str(e)}")
        import traceback
        traceback.print_exc()
        return False
    
    # Summary
    print("📈 Test Results Summary:")
    print("=" * 30)
    
    for test_name, result in results.items():
        if result is True:
            print(f"   ✅ {test_name}: PASSED")
        elif result == 'skipped':
            print(f"   ⏭️  {test_name}: SKIPPED")
        else:
            print(f"   ❌ {test_name}: FAILED")
    
    passed_tests = sum(1 for r in results.values() if r is True)
    total_tests = len([r for r in results.values() if r != 'skipped'])
    
    print(f"\n🎯 Overall: {passed_tests}/{total_tests} tests passed")
    
    return passed_tests == total_tests


if __name__ == '__main__':
    success = test_unified_versions_endpoint()
    sys.exit(0 if success else 1)
