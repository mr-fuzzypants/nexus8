#!/usr/bin/env python
"""
Quick test script to verify all API endpoints are properly registered.
"""
import os
import sys
import django
from django.conf import settings
from django.urls import reverse
from rest_framework.test import APIClient
from django.test import TestCase

# Setup Django
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'nexus8.settings')
django.setup()

def test_api_endpoints():
    """Test that all our API endpoints are accessible."""
    client = APIClient()
    
    endpoints = [
        'trackables:container-list',
        'trackables:version-list', 
        'trackables:containerversion-list',
        'trackables:containerreference-list',
        'trackables:versionedentity-list',
        'trackables:symlink-list'
    ]
    
    print("Testing API endpoint registration...")
    
    for endpoint_name in endpoints:
        try:
            url = reverse(endpoint_name)
            print(f"✅ {endpoint_name:<35} -> {url}")
        except Exception as e:
            print(f"❌ {endpoint_name:<35} -> ERROR: {e}")
    
    # Test some custom actions
    custom_actions = [
        ('trackables:container-roots', '/api/containers/roots/'),
        ('trackables:container-tree', '/api/containers/tree/'),
        ('trackables:version-by_status', '/api/versions/by_status/'),
        ('trackables:containerreference-outdated', '/api/container-references/outdated/'),
        ('trackables:symlink-by_name', '/api/symlinks/by_name/'),
    ]
    
    print("\nTesting custom action endpoints...")
    
    for endpoint_name, expected_path in custom_actions:
        try:
            url = reverse(endpoint_name)
            if expected_path in url:
                print(f"✅ {endpoint_name:<35} -> {url}")
            else:
                print(f"⚠️  {endpoint_name:<35} -> {url} (expected {expected_path})")
        except Exception as e:
            print(f"❌ {endpoint_name:<35} -> ERROR: {e}")

if __name__ == '__main__':
    test_api_endpoints()
