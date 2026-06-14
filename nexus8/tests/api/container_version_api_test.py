#!/usr/bin/env python3
"""
Test script to measure database queries for ContainerVersion API endpoint.
This will help identify N+1 query issues and measure optimization effectiveness.
"""

import os
import sys
import django
import json

# Setup Django
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'nexus8.settings')
sys.path.append(os.path.dirname(__file__))
django.setup()

from django.db import connection, reset_queries
from django.test import Client
from django.contrib.auth.models import User
from trackables.models import ContainerVersion

def test_container_version_api_endpoint():
    """Test the container version API endpoint performance."""
    print('🌐 Testing ContainerVersion API Endpoint')
    print('=' * 60)
    
    # Create a test client
    client = Client()
    
    # Get or create a user
    user, created = User.objects.get_or_create(
        username='testuser',
        defaults={'email': 'test@test.com'}
    )
    if created:
        user.set_password('password')
        user.save()
    
    # Login the user
    client.force_login(user)
    
    # Get container version count
    container_version_count = ContainerVersion.objects.count()
    print(f'📊 Total container versions in database: {container_version_count}')
    
    if container_version_count == 0:
        print('⚠️  No container versions found, cannot test')
        return
    
    # Test the API endpoint
    print('\n🚀 Making API request to /trackables/api/container-versions/')
    reset_queries()
    
    # Make the actual API call
    response = client.get('/trackables/api/container-versions/')
    
    query_count = len(connection.queries)
    
    print(f'\n📈 API Response Results:')
    print(f'   Status Code: {response.status_code}')
    print(f'   Total Database Queries: {query_count}')
    
    if response.status_code == 200:
        try:
            response_data = response.json()
            
            # Handle paginated response
            if isinstance(response_data, dict) and 'results' in response_data:
                data = response_data['results']
                total_count = response_data.get('count', len(data))
                print(f'   Response Items: {len(data)} (page) / {total_count} (total)')
                print(f'   Pagination: {response_data.get("next") is not None}')
            else:
                data = response_data
                print(f'   Response Items: {len(data)}')
            
            # Show sample data
            if data and len(data) > 0:
                print(f'\n📝 Sample Response Data:')
                sample = data[0]
                for key, value in sample.items():
                    print(f'   {key}: {value}')
            else:
                print(f'\n⚠️  No data items in response')
                    
        except json.JSONDecodeError:
            print('   ❌ Response is not valid JSON')
            print(f'   Content: {response.content[:200]}...')
    else:
        print(f'   ❌ Error Response: {response.content}')
    
    # Analyze query performance
    print(f'\n🔍 Query Performance Analysis:')
    
    # Filter out Silk middleware queries to see actual data queries
    data_queries = [q for q in connection.queries if not any(silk_term in q['sql'] for silk_term in ['silk_', 'SAVEPOINT', 'RELEASE SAVEPOINT', 'COMMIT'])]
    data_query_count = len(data_queries)
    
    print(f'   Total queries: {query_count}')
    print(f'   Silk middleware queries: {query_count - data_query_count}')
    print(f'   Actual data queries: {data_query_count}')
    
    if data_query_count == 1:
        print('   🎉 EXCELLENT: Only 1 data query - perfectly optimized!')
    elif data_query_count <= 3:
        print('   ✅ GOOD: Low data query count')
    elif data_query_count <= 10:
        print('   ⚠️  MODERATE: Some room for improvement')
    else:
        print('   🔴 CRITICAL: High data query count detected!')
        
    print(f'\n   Data query breakdown:')
    for i, query in enumerate(data_queries, 1):
        sql = query['sql']
        time = query['time']
        # Truncate long queries
        if len(sql) > 150:
            sql = sql[:150] + '...'
        print(f'   {i:2d}. [{time}s] {sql}')
    
    # Check for specific N+1 patterns
    if data_query_count > container_version_count * 0.1:  # If queries > 10% of container versions
        print(f'\n🚨 Potential N+1 Query Problem Detected!')
        print(f'   Expected: 1-3 queries')
        print(f'   Actual: {data_query_count} queries')
        print(f'   This suggests missing select_related() or prefetch_related()')
        
        # Look for repetitive query patterns
        query_patterns = {}
        for query in data_queries:
            sql_pattern = query['sql'].split('WHERE')[0] if 'WHERE' in query['sql'] else query['sql']
            query_patterns[sql_pattern] = query_patterns.get(sql_pattern, 0) + 1
        
        print(f'\n   Query patterns (showing repeated patterns):')
        for pattern, count in sorted(query_patterns.items(), key=lambda x: x[1], reverse=True)[:5]:
            if count > 1:
                truncated = pattern[:80] + '...' if len(pattern) > 80 else pattern
                print(f'   {count:3d}x: {truncated}')
    
    return {
        'status_code': response.status_code,
        'query_count': query_count,
        'data_queries': data_query_count,
        'container_version_count': container_version_count,
        'items_returned': len(data) if response.status_code == 200 and 'data' in locals() else 0
    }

if __name__ == '__main__':
    try:
        results = test_container_version_api_endpoint()
        print(f'\n🏁 Test completed: {results}')
    except Exception as e:
        print(f'❌ Test failed with error: {e}')
        import traceback
        traceback.print_exc()
