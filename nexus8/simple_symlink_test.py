#!/usr/bin/env python
"""
Simple Symlink Query Test

Quick test to check the actual query count for symlink serialization.
"""

import os
import django

# Setup Django
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'nexus8.settings')
django.setup()

from django.db import connection, reset_queries
from trackables.models import Symlink
from trackables.serializers import SymlinkSerializer
import json

def test_symlink_query_count():
    """Test the actual number of queries when serializing symlinks."""
    
    print("🔍 Testing Symlink Query Optimization")
    print("=" * 50)
    
    # Get the total number of symlinks
    total_symlinks = Symlink.objects.count()
    print(f"📊 Total symlinks in database: {total_symlinks}")
    
    if total_symlinks == 0:
        print("⚠️  No symlinks found. Creating test data...")
        
        # Create some test data
        from trackables.models import VersionedEntity, Version
        
        entity = VersionedEntity.objects.create(
            code='TEST_ENTITY',
            name='Test Entity'
        )
        
        version = Version.objects.create(
            entity=entity,
            version_number=1,
            data={'test': 'data'}
        )
        
        # Create some symlinks
        symlink_names = ['latest', 'stable', 'dev']
        for name in symlink_names:
            Symlink.objects.create(
                entity=entity,
                name=name,
                version=version
            )
        
        total_symlinks = Symlink.objects.count()
        print(f"✅ Created {total_symlinks} test symlinks")
    
    print("\n🚀 Testing Query Performance...")
    print("-" * 50)
    
    # Test 1: Without optimization
    reset_queries()
    queryset_basic = Symlink.objects.all()
    serializer_basic = SymlinkSerializer(queryset_basic, many=True)
    data_basic = serializer_basic.data  # This triggers serialization
    queries_basic = len(connection.queries)
    
    print(f"❌ Basic queryset: {queries_basic} queries for {len(data_basic)} symlinks")
    
    # Test 2: With select_related optimization
    reset_queries()
    queryset_optimized = Symlink.objects.select_related('entity', 'version')
    serializer_optimized = SymlinkSerializer(queryset_optimized, many=True)
    data_optimized = serializer_optimized.data  # This triggers serialization
    queries_optimized = len(connection.queries)
    
    print(f"✅ Optimized queryset: {queries_optimized} queries for {len(data_optimized)} symlinks")
    
    # Test 3: With full optimization (select_related + only)
    reset_queries()
    queryset_full_optimized = Symlink.objects.select_related('entity', 'version').only(
        'id', 'name', 'entity', 'version',
        'entity__id', 'entity__code', 'entity__name',
        'version__id', 'version__version_number'
    )
    serializer_full_optimized = SymlinkSerializer(queryset_full_optimized, many=True)
    data_full_optimized = serializer_full_optimized.data  # This triggers serialization
    queries_full_optimized = len(connection.queries)
    
    print(f"🚀 Fully optimized queryset: {queries_full_optimized} queries for {len(data_full_optimized)} symlinks")
    
    # Analysis
    print("\n📈 Performance Analysis")
    print("-" * 50)
    
    improvement_basic_to_optimized = queries_basic - queries_optimized
    improvement_basic_to_full = queries_basic - queries_full_optimized
    
    print(f"Improvement (basic → optimized): -{improvement_basic_to_optimized} queries")
    print(f"Improvement (basic → full): -{improvement_basic_to_full} queries")
    
    if queries_optimized <= 3:
        print("🎉 Query optimization is working perfectly!")
    elif queries_optimized <= 10:
        print("✅ Query optimization is working well")
    else:
        print("⚠️  Still room for improvement")
    
    # Show some actual queries if there are issues
    if queries_optimized > 10:
        print("\n🔍 Sample Queries (last 5):")
        print("-" * 50)
        for i, query in enumerate(connection.queries[-5:], 1):
            print(f"{i}. {query['sql'][:100]}...")
    
    # Test a sample of the data to make sure it's correct
    if data_optimized:
        print(f"\n📝 Sample serialized data:")
        print("-" * 50)
        sample = data_optimized[0]
        print(json.dumps(sample, indent=2))
    
    return {
        'basic_queries': queries_basic,
        'optimized_queries': queries_optimized,
        'full_optimized_queries': queries_full_optimized,
        'symlink_count': total_symlinks
    }

if __name__ == '__main__':
    results = test_symlink_query_count()
    
    print(f"\n🏁 Test completed!")
    print(f"Results: {results}")
