"""
Experimental semantic serializers that transform Django models into MovieLabs-compliant representations.
This demonstrates how much semantic transformation can be achieved at the serialization layer.
"""
from rest_framework import serializers
from django.urls import reverse
from .models import Container, Version, ContainerVersion, VersionedEntity, Symlink
import json
from datetime import datetime


class OMCSemanticSerializer(serializers.ModelSerializer):
    """
    Base serializer that transforms Django models into OMC-compliant semantic structure.
    Adds URI-based identity, JSON-LD context, and controlled vocabulary.
    """
    
    # OMC semantic fields
    context = serializers.SerializerMethodField()
    id = serializers.SerializerMethodField()  # URI-based identity
    type = serializers.SerializerMethodField()  # OMC ontology type
    
    def get_context(self, obj):
        """Add JSON-LD context for semantic meaning."""
        return {
            "@context": {
                "omc": "https://movielabs.com/ontology/omc/v2.6/",
                "dc": "http://purl.org/dc/terms/",
                "xsd": "http://www.w3.org/2001/XMLSchema#",
                "rdfs": "http://www.w3.org/2000/01/rdf-schema#"
            }
        }
    
    def get_id(self, obj):
        """Generate URI-based identity following OMC standards."""
        request = self.context.get('request')
        if request:
            base_uri = request.build_absolute_uri('/')
        else:
            base_uri = "https://nexus8.movielabs.com/"  # Your domain
        
        # Generate semantic URI based on model type
        model_name = obj.__class__.__name__.lower()
        return f"{base_uri}omc/{model_name}/{obj.code}"
    
    def get_type(self, obj):
        """Map Django model to OMC ontology type."""
        type_mapping = {
            'Container': 'omc:Container',
            'Version': 'omc:Asset',
            'MediaAsset': 'omc:CreativeWork',
            'VersionedEntity': 'omc:Entity'
        }
        return type_mapping.get(obj.__class__.__name__, 'omc:Entity')


class SemanticTaskSerializer(OMCSemanticSerializer):
    """
    Transform Django Task model into MovieLabs ProductionTask representation.
    This shows how to present workflow-driven, semantic structure via serialization.
    """
    
    # OMC ProductionTask fields
    identifier = serializers.CharField(source='code')
    title = serializers.CharField(source='name')
    description = serializers.CharField()
    status = serializers.SerializerMethodField()
    workflow = serializers.SerializerMethodField()
    context_metadata = serializers.SerializerMethodField()
    dependencies = serializers.SerializerMethodField()
    outputs = serializers.SerializerMethodField()
    
    # Semantic relationships
    isPartOf = serializers.SerializerMethodField()
    hasPart = serializers.SerializerMethodField()
    relatedTo = serializers.SerializerMethodField()
    
    class Meta:
        model = VersionedEntity  # Using as base for Task-like entities
        fields = [
            'context', 'id', 'type', 'identifier', 'title', 'description',
            'status', 'workflow', 'context_metadata', 'dependencies', 'outputs',
            'isPartOf', 'hasPart', 'relatedTo'
        ]
    
    def get_type(self, obj):
        return 'omc:ProductionTask'
    
    def get_status(self, obj):
        """Map internal status to OMC controlled vocabulary."""
        # Assuming status is stored in Version.data.status
        latest_version = obj.versions.first()
        if latest_version and 'status' in latest_version.data:
            internal_status = latest_version.data['status']
            
            # Map to OMC status vocabulary
            status_mapping = {
                'draft': 'omc:Draft',
                'review': 'omc:InReview', 
                'approved': 'omc:Approved',
                'published': 'omc:Published',
                'archived': 'omc:Archived'
            }
            
            return {
                '@type': 'omc:TaskStatus',
                'value': status_mapping.get(internal_status, 'omc:Unknown'),
                'label': internal_status.title(),
                'updated': latest_version.updated_at.isoformat()
            }
        
        return {'@type': 'omc:TaskStatus', 'value': 'omc:Unknown'}
    
    def get_workflow(self, obj):
        """Transform to workflow-driven schema definition."""
        latest_version = obj.versions.first()
        if latest_version and 'workflow' in latest_version.data:
            workflow_data = latest_version.data['workflow']
            
            return {
                '@type': 'omc:Workflow',
                'identifier': workflow_data.get('id', 'default-workflow'),
                'name': workflow_data.get('name', 'Standard Production Workflow'),
                'version': workflow_data.get('version', '1.0'),
                'schema': {
                    '@type': 'omc:WorkflowSchema',
                    'required_fields': workflow_data.get('required_fields', []),
                    'optional_fields': workflow_data.get('optional_fields', []),
                    'validation_rules': workflow_data.get('validation_rules', [])
                }
            }
        
        # Default workflow structure
        return {
            '@type': 'omc:Workflow',
            'identifier': 'nexus8-default',
            'name': 'Nexus8 Default Workflow',
            'version': '1.0'
        }
    
    def get_context_metadata(self, obj):
        """Transform Django JSONField to semantic context metadata."""
        latest_version = obj.versions.first()
        if not latest_version:
            return {}
        
        # Transform flat JSON to semantic structure
        metadata = {}
        
        # Extract creative context (if present)
        if 'creative_context' in latest_version.data:
            creative = latest_version.data['creative_context']
            metadata['creative'] = {
                '@type': 'omc:CreativeContext',
                'scene': creative.get('scene'),
                'sequence': creative.get('sequence'),
                'character': creative.get('character'),
                'location': creative.get('location')
            }
        
        # Extract technical context
        if 'technical_specs' in latest_version.data:
            tech = latest_version.data['technical_specs']
            metadata['technical'] = {
                '@type': 'omc:TechnicalSpecification',
                'format': tech.get('format'),
                'resolution': tech.get('resolution'),
                'frame_rate': tech.get('frame_rate'),
                'color_space': tech.get('color_space')
            }
        
        # Extract production context
        if 'production' in latest_version.data:
            prod = latest_version.data['production']
            metadata['production'] = {
                '@type': 'omc:ProductionContext',
                'department': prod.get('department'),
                'phase': prod.get('phase'),
                'milestone' : prod.get('milestone')
            }
        
        return metadata
    
    def get_dependencies(self, obj):
        """Transform container relationships to semantic dependencies."""
        dependencies = []
        
        # If this entity is in containers, get container relationships
        container_refs = getattr(obj, 'container_references', None)
        if container_refs:
            for ref in container_refs.all()[:10]:  # Limit to prevent N+1
                dependencies.append({
                    '@type': 'omc:Dependency',
                    'dependsOn': f"{self.get_base_uri()}omc/entity/{ref.referenced_entity.code}",
                    'relationship': ref.reference_name,
                    'version': ref.symlink_version.version_number
                })
        
        return dependencies
    
    def get_outputs(self, obj):
        """Transform versions to semantic outputs."""
        outputs = []
        
        for version in obj.versions.all()[:5]:  # Latest 5 versions
            outputs.append({
                '@type': 'omc:Asset',
                'id': f"{self.get_base_uri()}omc/version/{obj.code}/v{version.version_number}",
                'version': version.version_number,
                'created': version.created_at.isoformat(),
                'status': version.data.get('status', 'unknown')
            })
        
        return outputs
    
    def get_isPartOf(self, obj):
        """Semantic hierarchical relationship."""
        # Find containers this entity belongs to
        containers = Container.objects.filter(versions__entity=obj).distinct()
        
        return [
            {
                '@type': 'omc:Container',
                'id': f"{self.get_base_uri()}omc/container/{container.code}",
                'title': container.name
            }
            for container in containers[:3]  # Limit results
        ]
    
    def get_hasPart(self, obj):
        """Semantic composition relationship."""
        # This would be sub-tasks or components
        return []  # Placeholder - would need Task model relationships
    
    def get_relatedTo(self, obj):
        """Semantic association relationships."""
        related = []
        
        # Find related entities through symlinks
        symlinks = Symlink.objects.filter(entity=obj)
        for symlink in symlinks[:5]:
            related.append({
                '@type': 'omc:Association',
                'relationship': f"nexus8:{symlink.name}",
                'target': f"{self.get_base_uri()}omc/version/{obj.code}/v{symlink.version.version_number}"
            })
        
        return related
    
    def get_base_uri(self):
        """Helper to get base URI."""
        request = self.context.get('request')
        if request:
            return request.build_absolute_uri('/')
        return "https://nexus8.movielabs.com/"


class SemanticContainerSerializer(OMCSemanticSerializer):
    """
    Transform Container model into OMC-compliant Container representation.
    Shows hierarchical and compositional relationships semantically.
    """
    
    identifier = serializers.CharField(source='code')
    title = serializers.CharField(source='name')
    description = serializers.CharField()
    
    # Semantic structure
    contains = serializers.SerializerMethodField()
    containedBy = serializers.SerializerMethodField()
    references = serializers.SerializerMethodField()
    hierarchy = serializers.SerializerMethodField()
    
    class Meta:
        model = Container
        fields = [
            'context', 'id', 'type', 'identifier', 'title', 'description',
            'contains', 'containedBy', 'references', 'hierarchy'
        ]
    
    def get_type(self, obj):
        return 'omc:Container'
    
    def get_contains(self, obj):
        """Semantic representation of contained entities."""
        contained = []
        
        # Get contained entities through versions
        for version in obj.versions.all()[:10]:
            for ref in version.references.all():
                contained.append({
                    '@type': 'omc:ContainmentRelation',
                    'contains': f"{self.get_base_uri()}omc/entity/{ref.referenced_entity.code}",
                    'role': ref.reference_name,
                    'version': ref.symlink_version.version_number,
                    'symlink': ref.symlink_name
                })
        
        return contained
    
    def get_containedBy(self, obj):
        """Parent container relationships."""
        if obj.parent_container:
            return {
                '@type': 'omc:Container',
                'id': f"{self.get_base_uri()}omc/container/{obj.parent_container.code}",
                'title': obj.parent_container.name
            }
        return None
    
    def get_references(self, obj):
        """Transform container references to semantic links."""
        references = []
        
        latest_version = obj.versions.first()
        if latest_version:
            for ref in latest_version.references.all():
                references.append({
                    '@type': 'omc:Reference',
                    'identifier': ref.reference_name,
                    'target': {
                        '@type': 'omc:Entity',
                        'id': f"{self.get_base_uri()}omc/entity/{ref.referenced_entity.code}",
                        'title': ref.referenced_entity.name
                    },
                    'symlink': {
                        '@type': 'omc:Symlink',
                        'name': ref.symlink_name,
                        'resolves_to': f"{self.get_base_uri()}omc/version/{ref.referenced_entity.code}/v{ref.symlink_version.version_number}"
                    }
                })
        
        return references
    
    def get_hierarchy(self, obj):
        """Semantic hierarchy representation."""
        return {
            '@type': 'omc:Hierarchy',
            'depth': obj.depth,
            'path': obj.get_hierarchy_path(),
            'ancestors': [
                {
                    '@type': 'omc:Container',
                    'id': f"{self.get_base_uri()}omc/container/{ancestor.code}",
                    'title': ancestor.name,
                    'depth': ancestor.depth
                }
                for ancestor in (obj.get_ancestors_by_path() if hasattr(obj, 'path') else [])
            ],
            'children_count': obj.child_containers.count(),
            'descendants_count': obj.get_descendants_by_path().count() if hasattr(obj, 'path') else 0
        }


class WorkflowDrivenSchemaSerializer(serializers.Serializer):
    """
    Experimental serializer that dynamically validates and presents data 
    based on workflow-defined schemas (MovieLabs workflow-driven approach).
    """
    
    def __init__(self, *args, **kwargs):
        self.workflow_schema = kwargs.pop('workflow_schema', None)
        super().__init__(*args, **kwargs)
        
        if self.workflow_schema:
            self._setup_dynamic_fields()
    
    def _setup_dynamic_fields(self):
        """Dynamically create fields based on workflow schema."""
        if not self.workflow_schema:
            return
        
        # Add required fields
        for field_def in self.workflow_schema.get('required_fields', []):
            field_name = field_def['name']
            field_type = field_def.get('type', 'string')
            
            if field_type == 'string':
                self.fields[field_name] = serializers.CharField(required=True)
            elif field_type == 'number':
                self.fields[field_name] = serializers.FloatField(required=True)
            elif field_type == 'integer':
                self.fields[field_name] = serializers.IntegerField(required=True)
            elif field_type == 'boolean':
                self.fields[field_name] = serializers.BooleanField(required=True)
            elif field_type == 'datetime':
                self.fields[field_name] = serializers.DateTimeField(required=True)
            elif field_type == 'choice':
                choices = field_def.get('choices', [])
                self.fields[field_name] = serializers.ChoiceField(choices=choices, required=True)
        
        # Add optional fields
        for field_def in self.workflow_schema.get('optional_fields', []):
            field_name = field_def['name']
            field_type = field_def.get('type', 'string')
            
            if field_type == 'string':
                self.fields[field_name] = serializers.CharField(required=False, allow_blank=True)
            elif field_type == 'number':
                self.fields[field_name] = serializers.FloatField(required=False, allow_null=True)
            # ... add other types as needed
    
    def validate(self, attrs):
        """Apply workflow-defined validation rules."""
        if not self.workflow_schema:
            return attrs
        
        # Apply custom validation rules from workflow
        for rule in self.workflow_schema.get('validation_rules', []):
            rule_type = rule.get('type')
            
            if rule_type == 'conditional_required':
                # Field required if another field has specific value
                condition_field = rule.get('condition_field')
                condition_value = rule.get('condition_value')
                required_field = rule.get('required_field')
                
                if (condition_field in attrs and 
                    attrs[condition_field] == condition_value and
                    not attrs.get(required_field)):
                    raise serializers.ValidationError(
                        f"{required_field} is required when {condition_field} is {condition_value}"
                    )
            
            elif rule_type == 'range':
                # Numeric range validation
                field_name = rule.get('field')
                min_val = rule.get('min')
                max_val = rule.get('max')
                
                if field_name in attrs:
                    value = attrs[field_name]
                    if min_val is not None and value < min_val:
                        raise serializers.ValidationError(f"{field_name} must be >= {min_val}")
                    if max_val is not None and value > max_val:
                        raise serializers.ValidationError(f"{field_name} must be <= {max_val}")
        
        return attrs


class SemanticAPIResponseSerializer(serializers.Serializer):
    """
    Wrapper serializer that presents any data in MovieLabs-compliant format
    with proper semantic structure and metadata.
    """
    
    context = serializers.SerializerMethodField()
    data = serializers.SerializerMethodField()
    metadata = serializers.SerializerMethodField()
    
    def __init__(self, data, *args, **kwargs):
        self.response_data = data
        super().__init__(*args, **kwargs)
    
    def get_context(self, obj):
        return {
            "@context": {
                "omc": "https://movielabs.com/ontology/omc/v2.6/",
                "nexus8": "https://nexus8.movielabs.com/ontology/",
                "dc": "http://purl.org/dc/terms/",
                "xsd": "http://www.w3.org/2001/XMLSchema#"
            }
        }
    
    def get_data(self, obj):
        return self.response_data
    
    def get_metadata(self, obj):
        return {
            '@type': 'omc:ResponseMetadata',
            'generated_at': datetime.now().isoformat(),
            'generated_by': 'nexus8-semantic-api',
            'version': '1.0',
            'compliance': 'omc:v2.6'
        }


# Example usage functions
def get_semantic_task_data(entity_code):
    """
    Example function showing how to retrieve and present task data semantically.
    """
    try:
        entity = VersionedEntity.objects.get(code=entity_code)
        serializer = SemanticTaskSerializer(entity)
        
        # Wrap in semantic response format
        response_serializer = SemanticAPIResponseSerializer(serializer.data)
        return response_serializer.data
        
    except VersionedEntity.DoesNotExist:
        return None


def get_workflow_driven_task_data(entity_code, workflow_schema):
    """
    Example function showing workflow-driven schema validation and presentation.
    """
    try:
        entity = VersionedEntity.objects.get(code=entity_code)
        latest_version = entity.versions.first()
        
        if latest_version:
            # Create dynamic serializer based on workflow schema
            serializer = WorkflowDrivenSchemaSerializer(
                data=latest_version.data,
                workflow_schema=workflow_schema
            )
            
            if serializer.is_valid():
                return {
                    'valid': True,
                    'data': serializer.validated_data,
                    'workflow': workflow_schema.get('name', 'Unknown'),
                    'compliance': 'MovieLabs workflow-driven'
                }
            else:
                return {
                    'valid': False,
                    'errors': serializer.errors,
                    'workflow': workflow_schema.get('name', 'Unknown')
                }
        
        return None
        
    except VersionedEntity.DoesNotExist:
        return None


# Sample workflow schema for testing
SAMPLE_WORKFLOW_SCHEMA = {
    "name": "Character Animation Task",
    "version": "1.0",
    "required_fields": [
        {"name": "character_name", "type": "string"},
        {"name": "scene_number", "type": "integer"},
        {"name": "frame_range", "type": "string"},
        {"name": "animation_type", "type": "choice", "choices": ["keyframe", "mocap", "procedural"]}
    ],
    "optional_fields": [
        {"name": "reference_video", "type": "string"},
        {"name": "notes", "type": "string"},
        {"name": "priority", "type": "integer"}
    ],
    "validation_rules": [
        {
            "type": "conditional_required",
            "condition_field": "animation_type",
            "condition_value": "mocap",
            "required_field": "reference_video"
        },
        {
            "type": "range",
            "field": "priority",
            "min": 1,
            "max": 10
        }
    ]
}
