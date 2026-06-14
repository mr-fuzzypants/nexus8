"""
Demonstration of how semantic serializers can be integrated into existing ViewSets
with minimal changes to achieve MovieLabs compliance.
"""

from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response
from django.http import JsonResponse
from django.shortcuts import get_object_or_404

from trackables.models import VersionedEntity, Container
from trackables.serializers import ContainerDetailSerializer  # Your existing serializers
from trackables.semantic_serializers import (
    SemanticTaskSerializer,
    SemanticContainerSerializer, 
    SemanticAPIResponseSerializer,
    WorkflowDrivenSchemaSerializer,
    SAMPLE_WORKFLOW_SCHEMA
)


class SemanticEnabledViewSetMixin:
    """
    Mixin that adds semantic transformation capabilities to existing ViewSets.
    Simply add this mixin to enable MovieLabs-compliant responses.
    """
    
    def get_semantic_serializer_class(self):
        """Override to specify semantic serializer."""
        if hasattr(self, 'semantic_serializer_class'):
            return self.semantic_serializer_class
        return None
    
    def should_use_semantic_response(self):
        """Determine if semantic response should be used."""
        # Check Accept header for JSON-LD
        accept_header = self.request.headers.get('Accept', '')
        if 'application/ld+json' in accept_header:
            return True
        
        # Check query parameter
        if self.request.query_params.get('format') == 'semantic':
            return True
        
        # Check if client requested MovieLabs compliance
        if self.request.query_params.get('movielabs') == 'true':
            return True
        
        return False
    
    def get_semantic_response(self, instance):
        """Generate semantic response for an instance."""
        semantic_serializer_class = self.get_semantic_serializer_class()
        if not semantic_serializer_class:
            return None
        
        semantic_serializer = semantic_serializer_class(instance, context={'request': self.request})
        semantic_data = semantic_serializer.data
        
        # Wrap in semantic response format
        response_serializer = SemanticAPIResponseSerializer(semantic_data)
        return response_serializer.data
    
    def retrieve(self, request, *args, **kwargs):
        """Override retrieve to optionally provide semantic response."""
        instance = self.get_object()
        
        if self.should_use_semantic_response():
            semantic_data = self.get_semantic_response(instance)
            if semantic_data:
                return Response(semantic_data, headers={
                    'Content-Type': 'application/ld+json'
                })
        
        # Fall back to standard response
        return super().retrieve(request, *args, **kwargs)
    
    def list(self, request, *args, **kwargs):
        """Override list to optionally provide semantic responses."""
        if self.should_use_semantic_response():
            queryset = self.filter_queryset(self.get_queryset())
            page = self.paginate_queryset(queryset)
            
            semantic_serializer_class = self.get_semantic_serializer_class()
            if semantic_serializer_class:
                if page is not None:
                    semantic_serializer = semantic_serializer_class(page, many=True, context={'request': request})
                    semantic_data = semantic_serializer.data
                    response_data = SemanticAPIResponseSerializer(semantic_data).data
                    return self.get_paginated_response(response_data)
                
                semantic_serializer = semantic_serializer_class(queryset, many=True, context={'request': request})
                semantic_data = semantic_serializer.data
                response_data = SemanticAPIResponseSerializer(semantic_data).data
                return Response(response_data, headers={
                    'Content-Type': 'application/ld+json'
                })
        
        # Fall back to standard response
        return super().list(request, *args, **kwargs)


class SemanticContainerViewSet(SemanticEnabledViewSetMixin, viewsets.ModelViewSet):
    """
    Enhanced Container ViewSet with semantic capabilities.
    Existing functionality preserved, semantic features added.
    """
    queryset = Container.objects.all()
    serializer_class = ContainerDetailSerializer  # Your existing serializer
    semantic_serializer_class = SemanticContainerSerializer  # New semantic serializer
    
    @action(detail=True, methods=['get'])
    def semantic(self, request, pk=None):
        """Explicit semantic endpoint for MovieLabs-compliant response."""
        container = self.get_object()
        semantic_data = self.get_semantic_response(container)
        
        return JsonResponse(semantic_data, json_dumps_params={'indent': 2}, headers={
            'Content-Type': 'application/ld+json'
        })
    
    @action(detail=True, methods=['get'])
    def movielabs(self, request, pk=None):
        """MovieLabs-specific endpoint."""
        container = self.get_object()
        semantic_serializer = SemanticContainerSerializer(container, context={'request': request})
        
        # Add MovieLabs-specific metadata
        response_data = {
            '@context': {
                'omc': 'https://movielabs.com/ontology/omc/v2.6/',
                'movielabs': 'https://movielabs.com/ngmp/',
                'nexus8': 'https://nexus8.movielabs.com/ontology/'
            },
            '@type': 'movielabs:ProductionContainer',
            'compliance': 'MovieLabs 2030 Vision',
            'version': 'OMC v2.6',
            'container': semantic_serializer.data
        }
        
        return JsonResponse(response_data, json_dumps_params={'indent': 2}, headers={
            'Content-Type': 'application/ld+json',
            'MovieLabs-Compliance': 'OMC-v2.6'
        })


class SemanticEntityViewSet(SemanticEnabledViewSetMixin, viewsets.ModelViewSet):
    """
    Enhanced Entity ViewSet with semantic task representation.
    """
    queryset = VersionedEntity.objects.all()
    # serializer_class = YourExistingEntitySerializer  # Your existing serializer
    semantic_serializer_class = SemanticTaskSerializer
    
    @action(detail=True, methods=['post'])
    def validate_workflow(self, request, pk=None):
        """Validate entity data against a workflow schema."""
        entity = self.get_object()
        latest_version = entity.versions.first()
        
        if not latest_version:
            return Response({'error': 'No versions found'}, status=status.HTTP_404_NOT_FOUND)
        
        # Get workflow schema from request or use default
        workflow_schema = request.data.get('workflow_schema', SAMPLE_WORKFLOW_SCHEMA)
        
        # Validate data against workflow schema
        serializer = WorkflowDrivenSchemaSerializer(
            data=latest_version.data,
            workflow_schema=workflow_schema
        )
        
        if serializer.is_valid():
            return Response({
                'valid': True,
                'data': serializer.validated_data,
                'workflow': workflow_schema.get('name', 'Unknown'),
                'compliance': 'MovieLabs workflow-driven',
                'entity': entity.code
            })
        else:
            return Response({
                'valid': False,
                'errors': serializer.errors,
                'workflow': workflow_schema.get('name', 'Unknown'),
                'entity': entity.code
            }, status=status.HTTP_400_BAD_REQUEST)
    
    @action(detail=True, methods=['get'])
    def production_task(self, request, pk=None):
        """Present entity as MovieLabs ProductionTask."""
        entity = self.get_object()
        semantic_serializer = SemanticTaskSerializer(entity, context={'request': request})
        
        # MovieLabs ProductionTask-specific response
        response_data = {
            '@context': {
                'omc': 'https://movielabs.com/ontology/omc/v2.6/',
                'movielabs': 'https://movielabs.com/ngmp/'
            },
            '@type': 'omc:ProductionTask',
            'movielabs_compliance': 'OMC v2.6',
            'task': semantic_serializer.data
        }
        
        return JsonResponse(response_data, json_dumps_params={'indent': 2}, headers={
            'Content-Type': 'application/ld+json',
            'MovieLabs-TaskType': 'ProductionTask'
        })


# Example usage in urls.py:
"""
from rest_framework.routers import DefaultRouter
from .views_semantic import SemanticContainerViewSet, SemanticEntityViewSet

router = DefaultRouter()
router.register(r'containers', SemanticContainerViewSet)
router.register(r'entities', SemanticEntityViewSet)

# This creates these endpoints:
# GET /containers/                          # Standard or semantic list (based on Accept header)
# GET /containers/{id}/                     # Standard or semantic detail (based on Accept header)
# GET /containers/{id}/semantic/            # Explicit semantic response
# GET /containers/{id}/movielabs/           # MovieLabs-specific response
# 
# GET /entities/                            # Standard or semantic list
# GET /entities/{id}/                       # Standard or semantic detail  
# GET /entities/{id}/production_task/       # MovieLabs ProductionTask response
# POST /entities/{id}/validate_workflow/    # Workflow schema validation

# Example client requests:

# 1. Standard response:
# GET /containers/1/
# Accept: application/json

# 2. Semantic response via header:
# GET /containers/1/
# Accept: application/ld+json

# 3. Semantic response via parameter:
# GET /containers/1/?format=semantic

# 4. MovieLabs compliance via parameter:
# GET /containers/1/?movielabs=true

# 5. Explicit MovieLabs endpoint:
# GET /containers/1/movielabs/
"""


def demonstrate_client_usage():
    """
    Show how clients can consume the semantic API.
    """
    examples = {
        'standard_request': {
            'url': '/api/containers/1/',
            'headers': {'Accept': 'application/json'},
            'description': 'Standard Django REST response'
        },
        
        'semantic_request': {
            'url': '/api/containers/1/',
            'headers': {'Accept': 'application/ld+json'},
            'description': 'Automatic semantic transformation'
        },
        
        'movielabs_request': {
            'url': '/api/containers/1/?movielabs=true',
            'headers': {'Accept': 'application/json'},
            'description': 'MovieLabs compliance via parameter'
        },
        
        'explicit_semantic': {
            'url': '/api/containers/1/semantic/',
            'headers': {},
            'description': 'Explicit semantic endpoint'
        },
        
        'movielabs_endpoint': {
            'url': '/api/containers/1/movielabs/',
            'headers': {},
            'description': 'Dedicated MovieLabs endpoint'
        },
        
        'workflow_validation': {
            'url': '/api/entities/1/validate_workflow/',
            'method': 'POST',
            'data': {'workflow_schema': SAMPLE_WORKFLOW_SCHEMA},
            'description': 'Validate data against workflow schema'
        }
    }
    
    return examples


if __name__ == "__main__":
    print("🔗 SEMANTIC API INTEGRATION EXAMPLES")
    print("=" * 50)
    
    examples = demonstrate_client_usage()
    
    for name, example in examples.items():
        print(f"\n📋 {name.upper().replace('_', ' ')}:")
        print(f"   URL: {example['url']}")
        if 'headers' in example and example['headers']:
            print(f"   Headers: {example['headers']}")
        if 'method' in example:
            print(f"   Method: {example['method']}")
        if 'data' in example:
            print(f"   Data: {example['data']}")
        print(f"   Purpose: {example['description']}")
    
    print(f"\n✅ INTEGRATION BENEFITS:")
    print("   • Existing API functionality preserved")
    print("   • MovieLabs compliance added incrementally") 
    print("   • Clients choose response format")
    print("   • Zero breaking changes")
    print("   • Performance maintained")
    print("   • Gradual adoption possible")
