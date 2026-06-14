from rest_framework import serializers
from .models import Container, Version, ContainerVersion, ContainerReference, VersionedEntity, Symlink, MediaAsset


class ContainerHierarchySerializer(serializers.ModelSerializer):
    """Lightweight serializer for hierarchy display."""
    class Meta:
        model = Container
        fields = ['id', 'code', 'name', 'depth']


class ContainerBasicSerializer(serializers.ModelSerializer):
    """Basic container serializer without nested relationships."""
    hierarchy_level = serializers.SerializerMethodField()
    is_root = serializers.SerializerMethodField()
    child_count = serializers.SerializerMethodField()
    
    class Meta:
        model = Container
        fields = [
            'id', 'code', 'name', 'description', 'created_at', 'updated_at',
            'parent_container', 'path', 'depth',
            'hierarchy_level', 'is_root', 'child_count'
        ]
        read_only_fields = ['path', 'depth', 'created_at', 'updated_at']
    
    def get_hierarchy_level(self, obj):
        """Get the hierarchy level (same as depth)."""
        return obj.depth
    
    def get_is_root(self, obj):
        """Check if this is a root container."""
        return obj.parent_container is None
    
    def get_child_count(self, obj):
        """Get the number of direct children."""
        return obj.child_containers.count()


class ContainerDetailSerializer(serializers.ModelSerializer):
    """Detailed container serializer with hierarchy and statistics."""
    parent_container = ContainerHierarchySerializer(read_only=True)
    parent_container_id = serializers.IntegerField(write_only=True, required=False, allow_null=True)
    
    # Hierarchy information
    hierarchy_path = serializers.SerializerMethodField()
    hierarchy_level = serializers.SerializerMethodField()
    ancestors = serializers.SerializerMethodField()
    direct_children = ContainerHierarchySerializer(source='child_containers', many=True, read_only=True)
    
    # Statistics
    descendant_count = serializers.SerializerMethodField()
    version_count = serializers.SerializerMethodField()
    latest_version = serializers.SerializerMethodField()
    hierarchy_statistics = serializers.SerializerMethodField()
    
    class Meta:
        model = Container
        fields = [
            'id', 'code', 'name', 'description', 'created_at', 'updated_at',
            'parent_container', 'parent_container_id',
            'path', 'depth',
            'hierarchy_path', 'hierarchy_level', 'ancestors', 'direct_children',
            'descendant_count', 'version_count', 'latest_version', 'hierarchy_statistics'
        ]
        read_only_fields = ['path', 'depth', 'created_at', 'updated_at']
    
    def get_hierarchy_path(self, obj):
        """Get the full hierarchy path as a list of container codes."""
        return obj.get_hierarchy_path()
    
    def get_hierarchy_level(self, obj):
        """Get the hierarchy level."""
        return obj.depth
    
    def get_ancestors(self, obj):
        """Get all ancestor containers."""
        if hasattr(obj, 'path') and obj.path:
            ancestors = obj.get_ancestors_by_path()
        else:
            ancestors = Container.objects.get_ancestors(obj)
        return ContainerHierarchySerializer(ancestors, many=True).data
    
    def get_descendant_count(self, obj):
        """Get the total number of descendants."""
        if hasattr(obj, 'path') and obj.path:
            return obj.get_descendants_by_path().count()
        else:
            return len(Container.objects.get_descendants(obj))
    
    def get_version_count(self, obj):
        """Get the number of versions for this container."""
        return obj.versions.count()
    
    def get_latest_version(self, obj):
        """Get the latest version information."""
        latest = obj.versions.first()  # Ordered by -version_number
        if latest:
            return {
                'id': latest.id,
                'version_number': latest.version_number,
                'created_at': latest.created_at
            }
        return None
    
    def get_hierarchy_statistics(self, obj):
        """Get hierarchy statistics if materialized path is available."""
        if hasattr(obj, 'path') and obj.path:
            return obj.get_hierarchy_statistics_by_path()
        else:
            # Basic statistics without materialized path
            descendants = Container.objects.get_descendants(obj, include_self=True)
            return {
                'total_descendants': len(descendants) - 1,
                'max_descendant_depth': max([c.get_hierarchy_level() for c in descendants]) if descendants else obj.depth,
                'leaf_containers': len([c for c in descendants if not c.child_containers.exists()])
            }
    
    def validate_parent_container_id(self, value):
        """Validate parent container assignment."""
        if value is None:
            return value
        
        try:
            parent = Container.objects.get(id=value)
        except Container.DoesNotExist:
            raise serializers.ValidationError("Parent container does not exist.")
        
        # Check for circular reference (if updating existing container)
        if self.instance:
            if value == self.instance.id:
                raise serializers.ValidationError("Container cannot be its own parent.")
            
            # Check if proposed parent is a descendant
            if hasattr(self.instance, 'path') and self.instance.path:
                if self.instance.is_ancestor_of_by_path(parent):
                    raise serializers.ValidationError("Cannot move container to its own descendant.")
            else:
                descendants = Container.objects.get_descendants(self.instance)
                if parent in descendants:
                    raise serializers.ValidationError("Cannot move container to its own descendant.")
        
        return value
    
    def update(self, instance, validated_data):
        """Custom update to handle parent changes."""
        parent_container_id = validated_data.pop('parent_container_id', None)
        
        if parent_container_id is not None:
            if parent_container_id:
                validated_data['parent_container'] = Container.objects.get(id=parent_container_id)
            else:
                validated_data['parent_container'] = None
        
        return super().update(instance, validated_data)
    
    def create(self, validated_data):
        """Custom create to handle parent assignment."""
        parent_container_id = validated_data.pop('parent_container_id', None)
        
        if parent_container_id:
            validated_data['parent_container'] = Container.objects.get(id=parent_container_id)
        
        return super().create(validated_data)


class ContainerTreeSerializer(serializers.ModelSerializer):
    """Serializer for tree view with nested children."""
    children = serializers.SerializerMethodField()
    version_count = serializers.SerializerMethodField()
    
    class Meta:
        model = Container
        fields = [
            'id', 'code', 'name', 'depth', 'path',
            'children', 'version_count'
        ]
    
    def get_children(self, obj):
        """Get direct children for tree display."""
        # Limit depth to prevent infinite recursion
        max_depth = self.context.get('max_depth', 3)
        if obj.depth >= max_depth:
            return []
        
        children = obj.child_containers.all()
        return ContainerTreeSerializer(
            children, 
            many=True, 
            context={'max_depth': max_depth}
        ).data
    
    def get_version_count(self, obj):
        """Get version count for this container."""
        return obj.versions.count()


class ContainerMoveSerializer(serializers.Serializer):
    """Serializer for moving containers."""
    container_id = serializers.IntegerField()
    new_parent_id = serializers.IntegerField(required=False, allow_null=True)
    method = serializers.ChoiceField(
        choices=['auto', 'optimized', 'cte', 'simple'],
        default='auto'
    )
    
    def validate_container_id(self, value):
        """Validate container exists."""
        try:
            return Container.objects.get(id=value)
        except Container.DoesNotExist:
            raise serializers.ValidationError("Container does not exist.")
    
    def validate_new_parent_id(self, value):
        """Validate new parent if provided."""
        if value is None:
            return None
        
        try:
            return Container.objects.get(id=value)
        except Container.DoesNotExist:
            raise serializers.ValidationError("New parent container does not exist.")
    
    def validate(self, data):
        """Cross-field validation."""
        container = data['container_id']
        new_parent = data.get('new_parent_id')
        
        if new_parent:
            # Check if move is valid
            can_move, reason = container.can_move_to(new_parent)
            if not can_move:
                raise serializers.ValidationError(f"Cannot move container: {reason}")
        
        return data


class ContainerBulkMoveSerializer(serializers.Serializer):
    """Serializer for bulk container moves."""
    moves = serializers.ListField(
        child=serializers.DictField(child=serializers.IntegerField()),
        min_length=1
    )
    batch_size = serializers.IntegerField(default=100, min_value=1, max_value=1000)
    
    def validate_moves(self, value):
        """Validate move operations."""
        validated_moves = []
        
        for move_data in value:
            container_id = move_data.get('container_id')
            new_parent_id = move_data.get('new_parent_id')
            
            if not container_id:
                raise serializers.ValidationError("Each move must specify container_id.")
            
            try:
                container = Container.objects.get(id=container_id)
            except Container.DoesNotExist:
                raise serializers.ValidationError(f"Container {container_id} does not exist.")
            
            new_parent = None
            if new_parent_id:
                try:
                    new_parent = Container.objects.get(id=new_parent_id)
                except Container.DoesNotExist:
                    raise serializers.ValidationError(f"Parent container {new_parent_id} does not exist.")
                
                # Check if move is valid
                can_move, reason = container.can_move_to(new_parent)
                if not can_move:
                    raise serializers.ValidationError(f"Cannot move container {container_id}: {reason}")
            
            validated_moves.append((container, new_parent))
        
        return validated_moves


class ContainerReferenceSerializer(serializers.ModelSerializer):
    """
    Optimized serializer for container references.
    
    Uses prefetched data to avoid N+1 queries in the is_current check.
    """
    referenced_entity_code = serializers.CharField(source='referenced_entity.code', read_only=True)
    referenced_entity_name = serializers.CharField(source='referenced_entity.name', read_only=True)
    symlink_version_number = serializers.IntegerField(source='symlink_version.version_number', read_only=True)
    is_current = serializers.SerializerMethodField()
    
    class Meta:
        model = ContainerReference
        fields = [
            'id', 'reference_name', 'symlink_name',
            'referenced_entity_code', 'referenced_entity_name',
            'symlink_version_number', 'is_current', 'created_at'
        ]
    
    def get_is_current(self, obj):
        """
        Check if the symlink version is still current using prefetched data.
        
        This avoids calling resolve_symlink() which causes database queries,
        instead using the prefetched symlinks data.
        """
        try:
            # Use prefetched symlinks to avoid database queries
            if hasattr(obj.referenced_entity, '_prefetched_objects_cache') and 'symlinks' in obj.referenced_entity._prefetched_objects_cache:
                symlinks = obj.referenced_entity._prefetched_objects_cache['symlinks']
                
                # Find the symlink with matching name
                for symlink in symlinks:
                    if symlink.name == obj.symlink_name:
                        return symlink.version_id == obj.symlink_version.id
                
                # If symlink not found in prefetched data, it's not current
                return False
            else:
                # Fallback to resolve_symlink if prefetch not available
                current_version = obj.referenced_entity.resolve_symlink(obj.symlink_name)
                return current_version.id == obj.symlink_version.id
        except:
            return False


class ContainerWithReferencesSerializer(ContainerDetailSerializer):
    """Container serializer that includes references."""
    references = serializers.SerializerMethodField()
    
    class Meta(ContainerDetailSerializer.Meta):
        fields = ContainerDetailSerializer.Meta.fields + ['references']
    
    def get_references(self, obj):
        """Get all references for the latest version of this container."""
        latest_version = obj.versions.first()
        if latest_version:
            references = latest_version.references.all()
            return ContainerReferenceSerializer(references, many=True).data
        return []


class ContainerVersionSerializer(serializers.ModelSerializer):
    """
    Optimized serializer for ContainerVersion with related field access.
    
    Uses prefetch_related() and select_related() optimizations to avoid N+1 queries.
    """
    container_code = serializers.CharField(source='entity.code', read_only=True)
    container_name = serializers.CharField(source='entity.name', read_only=True)
    parent_version_display = serializers.SerializerMethodField()
    reference_count = serializers.SerializerMethodField()
    
    class Meta:
        model = ContainerVersion
        fields = [
            'id', 'entity', 'container_code', 'container_name', 'version_number', 
            'parent_container_version', 'parent_version_display', 'reference_count',
            'data', 'created_at', 'updated_at'
        ]
        read_only_fields = ['created_at', 'updated_at']
    
    def get_parent_version_display(self, obj):
        """Get parent version display using prefetched data."""
        if obj.parent_container_version:
            # Use select_related data to avoid additional queries
            container = obj.parent_container_version.entity
            return f"{container.code} v{obj.parent_container_version.version_number}"
        return None
    
    def get_reference_count(self, obj):
        """Get reference count using prefetched data to avoid N+1 queries."""
        # Use prefetched references to avoid additional COUNT queries
        if hasattr(obj, '_prefetched_objects_cache') and 'references' in obj._prefetched_objects_cache:
            return len(obj._prefetched_objects_cache['references'])
        return obj.references.count()


class VersionedEntitySerializer(serializers.ModelSerializer):
    """
    Optimized serializer for VersionedEntity with prefetched data usage.
    
    Uses prefetch_related() optimization to avoid N+1 queries for counts and latest version.
    """
    version_count = serializers.SerializerMethodField()
    symlink_count = serializers.SerializerMethodField()
    latest_version = serializers.SerializerMethodField()
    
    class Meta:
        model = VersionedEntity
        fields = [
            'id', 'code', 'name', 'description', 'created_at', 'updated_at',
            'version_count', 'symlink_count', 'latest_version'
        ]
        read_only_fields = ['created_at', 'updated_at']
    
    def get_version_count(self, obj):
        """Get version count using prefetched data to avoid additional queries."""
        if hasattr(obj, '_prefetched_objects_cache') and 'versions' in obj._prefetched_objects_cache:
            return len(obj._prefetched_objects_cache['versions'])
        return obj.versions.count()
    
    def get_symlink_count(self, obj):
        """Get symlink count using prefetched data to avoid N+1 queries."""
        if hasattr(obj, '_prefetched_objects_cache') and 'symlinks' in obj._prefetched_objects_cache:
            return len(obj._prefetched_objects_cache['symlinks'])
        return obj.symlinks.count()
    
    def get_latest_version(self, obj):
        """Get latest version using prefetched data to avoid additional queries."""
        if hasattr(obj, '_prefetched_objects_cache') and 'versions' in obj._prefetched_objects_cache:
            versions = obj._prefetched_objects_cache['versions']
            if versions:
                # Assuming versions are ordered by version_number descending
                latest = versions[0]
                return {
                    'id': latest.id,
                    'version_number': latest.version_number,
                    'created_at': latest.created_at
                }
        else:
            latest = obj.versions.first()
            if latest:
                return {
                    'id': latest.id,
                    'version_number': latest.version_number,
                    'created_at': latest.created_at
                }
        return None


class UnifiedVersionSerializer(serializers.ModelSerializer):
    """
    Unified serializer for Version and all its derived models.
    
    Handles polymorphic serialization to show both base Version fields
    and model-specific fields for derived types like ContainerVersion.
    """
    # Common fields from Version
    entity_code = serializers.CharField(source='entity.code', read_only=True)
    entity_name = serializers.CharField(source='entity.name', read_only=True)
    
    # Metadata fields
    model_name = serializers.SerializerMethodField()
    model_type = serializers.SerializerMethodField()
    
    class Meta:
        model = Version
        fields = [
            'id', 'entity', 'entity_code', 'entity_name',
            'version_number', 'data', 'created_at', 'updated_at',
            'model_name', 'model_type'
        ]
        read_only_fields = ['created_at', 'updated_at', 'entity_code', 'entity_name']
    
    def get_model_name(self, obj):
        """Get the actual model class name."""
        return obj.__class__.__name__
    
    def get_model_type(self, obj):
        """Get a user-friendly model type."""
        model_types = {
            'Version': 'version',
            'ContainerVersion': 'container_version',
        }
        return model_types.get(obj.__class__.__name__, 'unknown')
    
    def to_representation(self, instance):
        """Add model-specific fields to the representation."""
        data = super().to_representation(instance)

        # Versions of container entities are container versions regardless of
        # which queryset produced them; upgrade to the proxy for its methods.
        if instance.entity.entity_type == 'container' and not isinstance(instance, ContainerVersion):
            instance.__class__ = ContainerVersion

        if isinstance(instance, ContainerVersion):
            data.update({
                'parent_container_version': instance.parent_container_version_id,
                'version_hierarchy_level': instance.get_version_hierarchy_level(),
                'version_hierarchy_path': instance.get_version_hierarchy_path(),
                'container_code': instance.entity.code,
            })

        return data


class SymlinkSerializer(serializers.ModelSerializer):
    """
    Optimized serializer for Symlink with related field access.
    
    Uses source paths to access related fields efficiently when combined
    with proper select_related() queries.
    """
    entity_code = serializers.CharField(source='entity.code', read_only=True)
    entity_name = serializers.CharField(source='entity.name', read_only=True)
    version_number = serializers.IntegerField(source='version.version_number', read_only=True)
    
    class Meta:
        model = Symlink
        fields = [
            'id', 'entity', 'entity_code', 'entity_name', 
            'name', 'version', 'version_number'
        ]
        read_only_fields = ['entity_code', 'entity_name', 'version_number']


class UnifiedVersionedEntitySerializer(serializers.ModelSerializer):
    """
    Unified serializer for VersionedEntity and all its derived models.
    
    Handles polymorphic serialization to show both base VersionedEntity fields
    and model-specific fields for derived types like Container and MediaAsset.
    """
    # Common fields from VersionedEntity
    version_count = serializers.SerializerMethodField()
    symlink_count = serializers.SerializerMethodField()
    latest_version = serializers.SerializerMethodField()
    
    # Metadata fields
    model_name = serializers.SerializerMethodField()
    model_type = serializers.SerializerMethodField()
    
    class Meta:
        model = VersionedEntity
        fields = [
            'id', 'code', 'name', 'description', 'created_at', 'updated_at',
            'version_count', 'symlink_count', 'latest_version',
            'model_name', 'model_type'
        ]
        read_only_fields = ['created_at', 'updated_at']
    
    def get_model_name(self, obj):
        """Get the actual model class name."""
        return obj.__class__.__name__

    def get_model_type(self, obj):
        """Get a user-friendly model type from the entity_type discriminator."""
        return obj.entity_type if obj.entity_type != 'entity' else 'versioned_entity'

    def get_version_count(self, obj):
        """Get version count using prefetched data to avoid additional queries."""
        if hasattr(obj, '_prefetched_objects_cache') and 'versions' in obj._prefetched_objects_cache:
            return len(obj._prefetched_objects_cache['versions'])
        return obj.versions.count()
    
    def get_symlink_count(self, obj):
        """Get symlink count using prefetched data to avoid N+1 queries."""
        if hasattr(obj, '_prefetched_objects_cache') and 'symlinks' in obj._prefetched_objects_cache:
            return len(obj._prefetched_objects_cache['symlinks'])
        return obj.symlinks.count()
    
    def get_latest_version(self, obj):
        """Get latest version using prefetched data to avoid additional queries."""
        if hasattr(obj, '_prefetched_objects_cache') and 'versions' in obj._prefetched_objects_cache:
            versions = obj._prefetched_objects_cache['versions']
            if versions:
                # Assuming versions are ordered by version_number descending
                latest = versions[0]
                return {
                    'id': latest.id,
                    'version_number': latest.version_number,
                    'created_at': latest.created_at
                }
        else:
            latest = obj.versions.first()
            if latest:
                return {
                    'id': latest.id,
                    'version_number': latest.version_number,
                    'created_at': latest.created_at
                }
        return None
    
    def to_representation(self, instance):
        """Add model-specific fields to the representation."""
        data = super().to_representation(instance)
        
        # Add model-specific fields based on type
        if isinstance(instance, Container):
            data.update({
                'parent_container': instance.parent_container_id,
                'path': instance.path,
                'depth': instance.depth,
                'child_count': getattr(instance, '_child_count', None),
            })
        elif isinstance(instance, MediaAsset):
            # Add AI intelligence and OMC compliance fields
            data.update({
                'file_path': instance.file_path,
                'media_type': instance.media_type,
                'ai_generated_description': instance.ai_generated_description,
                'ai_suggested_tags': instance.ai_suggested_tags,
                'ai_confidence_score': instance.ai_confidence_score,
                'ai_quality_score': instance.ai_quality_score,
                'ai_analysis_status': instance.ai_analysis_status,
                'ai_analysis_date': instance.ai_analysis_date,
                'asset_functional_type': instance.asset_functional_type,
                'asset_structural_type': instance.asset_structural_type,
                'production_stage': instance.production_stage,
                'technical_metadata': instance.technical_metadata,
                'creative_metadata': instance.creative_metadata,
                'has_embedding': instance.semantic_embedding is not None,
            })

        return data


class MediaAssetSerializer(serializers.ModelSerializer):
    """
    AI-Enhanced MediaAsset serializer with comprehensive asset intelligence fields.
    
    Provides serialization for:
    - Basic asset information (inherited from VersionedEntity)
    - AI analysis results and metadata
    - OMC compliance fields
    - Technical and creative metadata
    - Semantic search capabilities
    """
    
    # type_data payload attributes — declared explicitly because they are
    # json_property attributes on the proxy, not model fields. DRF reads and
    # writes them via getattr/setattr, which routes through type_data.
    file_path = serializers.CharField(required=False, allow_blank=True)
    media_type = serializers.CharField(required=False, allow_blank=True)
    ai_generated_description = serializers.CharField(read_only=True)
    ai_suggested_tags = serializers.JSONField(read_only=True)
    ai_confidence_score = serializers.FloatField(required=False)
    ai_quality_score = serializers.FloatField(required=False, allow_null=True)
    asset_functional_type = serializers.CharField(required=False, allow_blank=True)
    asset_structural_type = serializers.CharField(required=False, allow_blank=True)
    technical_metadata = serializers.JSONField(required=False)
    creative_metadata = serializers.JSONField(required=False)
    production_stage = serializers.CharField(required=False, allow_blank=True)

    # Read-only computed fields
    ai_analysis_results = serializers.SerializerMethodField()
    is_analyzed = serializers.SerializerMethodField()
    can_analyze = serializers.SerializerMethodField()
    asset_type_category = serializers.SerializerMethodField()
    project_context = serializers.SerializerMethodField()
    has_embedding = serializers.SerializerMethodField()

    # Version information (inherited)
    latest_version = serializers.SerializerMethodField()
    version_count = serializers.SerializerMethodField()

    class Meta:
        model = MediaAsset
        fields = [
            # Base VersionedEntity fields
            'id', 'code', 'name', 'created_at', 'updated_at',

            # MediaAsset specific fields
            'file_path', 'media_type',

            # AI Intelligence fields
            'ai_generated_description', 'ai_suggested_tags',
            'ai_confidence_score', 'ai_quality_score',
            'ai_analysis_status', 'ai_analysis_date',
            'has_embedding',

            # OMC Compliance fields
            'asset_functional_type', 'asset_structural_type',
            'technical_metadata', 'creative_metadata',
            'production_stage',

            # Computed fields
            'ai_analysis_results', 'is_analyzed', 'can_analyze',
            'asset_type_category', 'project_context',
            'latest_version', 'version_count'
        ]
        read_only_fields = [
            'id', 'created_at', 'updated_at',
            'ai_analysis_status', 'ai_analysis_date',
        ]

    def get_has_embedding(self, obj):
        """Whether a semantic embedding exists (the vector itself is not exposed)."""
        return obj.semantic_embedding is not None
    
    def get_ai_analysis_results(self, obj):
        """Get structured AI analysis results."""
        if obj.ai_analysis_status == 'completed':
            return obj.get_ai_analysis_results()
        return None
    
    def get_is_analyzed(self, obj):
        """Check if asset has been AI analyzed."""
        return obj.ai_analysis_status == 'completed'
    
    def get_can_analyze(self, obj):
        """Check if asset can be analyzed (has file_path)."""
        return bool(obj.file_path)
    
    def get_asset_type_category(self, obj):
        """Get asset type category for UI grouping."""
        if obj.is_image():
            return 'image'
        elif obj.is_3d_model():
            return '3d_model'
        elif obj.is_video():
            return 'video'
        else:
            return 'other'
    
    def get_project_context(self, obj):
        """Get project context information."""
        return obj.get_project_context()
    
    def get_latest_version(self, obj):
        """Get the latest version information."""
        try:
            latest_version = obj.versions.latest('version_number')
            return {
                'version_number': latest_version.version_number,
                'created_at': latest_version.created_at,
                'data_preview': str(latest_version.data)[:100] + '...' if len(str(latest_version.data)) > 100 else str(latest_version.data)
            }
        except:
            return None
    
    def get_version_count(self, obj):
        """Get total number of versions."""
        return obj.versions.count()
    
    def validate_file_path(self, value):
        """Validate file path format."""
        if value and not isinstance(value, str):
            raise serializers.ValidationError("File path must be a string")
        return value
    
    def validate_media_type(self, value):
        """Validate media type."""
        valid_media_types = [
            'image', 'video', '3d_model', 'texture', 'animation',
            'concept_art', 'reference', 'audio', 'document', 'other'
        ]
        
        if value and value.lower() not in valid_media_types:
            raise serializers.ValidationError(
                f"Media type must be one of: {', '.join(valid_media_types)}"
            )
        return value.lower() if value else value
    
    def validate_ai_confidence_score(self, value):
        """Validate AI confidence score range."""
        if value is not None and (value < 0.0 or value > 1.0):
            raise serializers.ValidationError("AI confidence score must be between 0.0 and 1.0")
        return value
    
    def validate_ai_quality_score(self, value):
        """Validate AI quality score range."""
        if value is not None and (value < 0.0 or value > 1.0):
            raise serializers.ValidationError("AI quality score must be between 0.0 and 1.0")
        return value


class MediaAssetBasicSerializer(serializers.ModelSerializer):
    """
    Basic MediaAsset serializer for list views and performance-sensitive operations.
    """
    
    file_path = serializers.CharField(read_only=True)
    media_type = serializers.CharField(read_only=True)
    ai_confidence_score = serializers.FloatField(read_only=True)
    ai_quality_score = serializers.FloatField(read_only=True, allow_null=True)
    asset_functional_type = serializers.CharField(read_only=True)
    production_stage = serializers.CharField(read_only=True)
    is_analyzed = serializers.SerializerMethodField()
    asset_type_category = serializers.SerializerMethodField()

    class Meta:
        model = MediaAsset
        fields = [
            'id', 'code', 'name', 'media_type', 'file_path',
            'ai_analysis_status', 'ai_confidence_score', 'ai_quality_score',
            'asset_functional_type', 'production_stage',
            'created_at', 'updated_at',
            'is_analyzed', 'asset_type_category'
        ]
    
    def get_is_analyzed(self, obj):
        """Check if asset has been AI analyzed."""
        return obj.ai_analysis_status == 'completed'
    
    def get_asset_type_category(self, obj):
        """Get asset type category for UI grouping."""
        if obj.is_image():
            return 'image'
        elif obj.is_3d_model():
            return '3d_model'
        elif obj.is_video():
            return 'video'
        else:
            return 'other'


class MediaAssetAnalysisSerializer(serializers.ModelSerializer):
    """
    Specialized serializer for AI analysis results and metadata.
    """
    
    ai_generated_description = serializers.CharField(read_only=True)
    ai_suggested_tags = serializers.JSONField(read_only=True)
    ai_confidence_score = serializers.FloatField(read_only=True)
    ai_quality_score = serializers.FloatField(read_only=True, allow_null=True)
    technical_metadata = serializers.JSONField(read_only=True)
    creative_metadata = serializers.JSONField(read_only=True)
    ai_analysis_results = serializers.SerializerMethodField()

    class Meta:
        model = MediaAsset
        fields = [
            'id', 'code', 'name',
            'ai_generated_description', 'ai_suggested_tags',
            'ai_confidence_score', 'ai_quality_score',
            'ai_analysis_status', 'ai_analysis_date',
            'technical_metadata', 'creative_metadata',
            'ai_analysis_results'
        ]
    
    def get_ai_analysis_results(self, obj):
        """Get complete AI analysis results."""
        return obj.get_ai_analysis_results()
