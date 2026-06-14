from rest_framework import serializers
from .models import Discussion, Comment, Note
from trackables.models import VersionedEntity, Version, Container, ContainerVersion


class CommentSerializer(serializers.ModelSerializer):
    """Serializer for Comment model with threading support."""
    author_display = serializers.CharField(source='author', read_only=True)
    reply_count = serializers.SerializerMethodField()
    reaction_summary = serializers.SerializerMethodField()
    is_reply = serializers.SerializerMethodField()
    
    class Meta:
        model = Comment
        fields = [
            'id', 'discussion', 'parent_comment', 'content', 'comment_type',
            'author', 'author_display', 'attachments', 'mentions', 'reactions',
            'created_at', 'updated_at', 'reply_count', 'reaction_summary', 'is_reply'
        ]
        read_only_fields = ['created_at', 'updated_at']
    
    def get_reply_count(self, obj):
        """Get number of replies to this comment."""
        return obj.replies.count()
    
    def get_reaction_summary(self, obj):
        """Get summary of reactions on this comment."""
        if not obj.reactions:
            return {}
        
        summary = {}
        for emoji, users in obj.reactions.items():
            summary[emoji] = len(users) if isinstance(users, list) else 0
        return summary
    
    def get_is_reply(self, obj):
        """Check if this comment is a reply to another comment."""
        return obj.parent_comment is not None


class CommentTreeSerializer(CommentSerializer):
    """Serializer for Comment with nested replies (tree structure)."""
    replies = serializers.SerializerMethodField()
    
    class Meta(CommentSerializer.Meta):
        fields = CommentSerializer.Meta.fields + ['replies']
    
    def get_replies(self, obj):
        """Get nested replies for this comment."""
        replies = obj.replies.order_by('created_at')[:10]  # Limit to prevent deep nesting
        return CommentSerializer(replies, many=True, context=self.context).data


class DiscussionListSerializer(serializers.ModelSerializer):
    """Lightweight serializer for discussion lists."""
    attached_object_type = serializers.SerializerMethodField()
    attached_object_display = serializers.SerializerMethodField()
    comment_count = serializers.SerializerMethodField()
    participant_count = serializers.SerializerMethodField()
    last_activity_display = serializers.SerializerMethodField()
    
    class Meta:
        model = Discussion
        fields = [
            'id', 'title', 'discussion_type', 'priority', 'status',
            'created_by', 'assigned_to', 'tags', 'last_activity',
            'created_at', 'updated_at', 'attached_object_type', 
            'attached_object_display', 'comment_count', 'participant_count',
            'last_activity_display'
        ]
        read_only_fields = ['created_at', 'updated_at', 'last_activity']
    
    def get_attached_object_type(self, obj):
        """Get the type of object this discussion is attached to."""
        return obj.get_attached_object_type()
    
    def get_attached_object_display(self, obj):
        """Get a display string for the attached object."""
        attached_obj = obj.get_attached_object()
        if attached_obj:
            if hasattr(attached_obj, 'code'):
                return f"{attached_obj.code} - {attached_obj.name}"
            return str(attached_obj)
        return None
    
    def get_comment_count(self, obj):
        """Get total number of comments in this discussion using prefetched data."""
        # Use prefetched comments to avoid additional COUNT queries
        if hasattr(obj, '_prefetched_objects_cache') and 'comments' in obj._prefetched_objects_cache:
            return len(obj._prefetched_objects_cache['comments'])
        return obj.get_comment_count()
    
    def get_participant_count(self, obj):
        """Get number of unique participants."""
        return len(obj.participants) if obj.participants else 0
    
    def get_last_activity_display(self, obj):
        """Get human-readable last activity time."""
        if obj.last_activity:
            return obj.last_activity.strftime('%Y-%m-%d %H:%M')
        return None


class DiscussionDetailSerializer(serializers.ModelSerializer):
    """Detailed serializer for discussion with comments and full metadata."""
    attached_object_type = serializers.SerializerMethodField()
    attached_object_display = serializers.SerializerMethodField()
    attached_object_id = serializers.SerializerMethodField()
    comments = CommentTreeSerializer(many=True, read_only=True)
    comment_count = serializers.SerializerMethodField()
    participant_count = serializers.SerializerMethodField()
    
    # Explicit foreign key fields for writing
    versioned_entity_id = serializers.IntegerField(write_only=True, required=False, allow_null=True)
    version_id = serializers.IntegerField(write_only=True, required=False, allow_null=True)
    container_id = serializers.IntegerField(write_only=True, required=False, allow_null=True)
    container_version_id = serializers.IntegerField(write_only=True, required=False, allow_null=True)
    
    class Meta:
        model = Discussion
        fields = [
            'id', 'title', 'description', 'discussion_type', 'priority', 'status',
            'created_by', 'assigned_to', 'participants', 'tags', 'metadata',
            'last_activity', 'created_at', 'updated_at',
            'versioned_entity', 'version', 'container', 'container_version',
            'versioned_entity_id', 'version_id', 'container_id', 'container_version_id',
            'attached_object_type', 'attached_object_display', 'attached_object_id',
            'comments', 'comment_count', 'participant_count'
        ]
        read_only_fields = [
            'created_at', 'updated_at', 'last_activity', 'participants',
            'versioned_entity', 'version', 'container', 'container_version'
        ]
    
    def get_attached_object_type(self, obj):
        """Get the type of object this discussion is attached to."""
        return obj.get_attached_object_type()
    
    def get_attached_object_display(self, obj):
        """Get a display string for the attached object."""
        attached_obj = obj.get_attached_object()
        if attached_obj:
            if hasattr(attached_obj, 'code'):
                return f"{attached_obj.code} - {attached_obj.name}"
            return str(attached_obj)
        return None
    
    def get_attached_object_id(self, obj):
        """Get the ID of the attached object."""
        attached_obj = obj.get_attached_object()
        return attached_obj.id if attached_obj else None
    
    def get_comment_count(self, obj):
        """Get total number of comments in this discussion."""
        return obj.get_comment_count()
    
    def get_participant_count(self, obj):
        """Get number of unique participants."""
        return len(obj.participants) if obj.participants else 0
    
    def validate(self, data):
        """Ensure exactly one foreign key is provided."""
        fk_fields = ['versioned_entity_id', 'version_id', 'container_id', 'container_version_id']
        provided_fks = [field for field in fk_fields if data.get(field) is not None]
        
        if len(provided_fks) == 0:
            raise serializers.ValidationError("Discussion must be attached to exactly one object.")
        elif len(provided_fks) > 1:
            raise serializers.ValidationError("Discussion can only be attached to one object at a time.")
        
        return data
    
    def create(self, validated_data):
        """Create discussion with proper foreign key assignment."""
        # Extract foreign key IDs
        versioned_entity_id = validated_data.pop('versioned_entity_id', None)
        version_id = validated_data.pop('version_id', None)
        container_id = validated_data.pop('container_id', None)
        container_version_id = validated_data.pop('container_version_id', None)
        
        # Create with the FK included up front — the DB check constraint
        # (exactly one parent) rejects an initial INSERT with all FKs null.
        return Discussion.objects.create(
            **validated_data,
            versioned_entity_id=versioned_entity_id,
            version_id=version_id,
            container_id=container_id,
            container_version_id=container_version_id,
        )


class NoteSerializer(serializers.ModelSerializer):
    """Serializer for Note model."""
    attached_object_type = serializers.SerializerMethodField()
    attached_object_display = serializers.SerializerMethodField()
    is_todo = serializers.SerializerMethodField()
    is_overdue = serializers.SerializerMethodField()
    
    # Explicit foreign key fields for writing
    versioned_entity_id = serializers.IntegerField(write_only=True, required=False, allow_null=True)
    version_id = serializers.IntegerField(write_only=True, required=False, allow_null=True)
    container_id = serializers.IntegerField(write_only=True, required=False, allow_null=True)
    container_version_id = serializers.IntegerField(write_only=True, required=False, allow_null=True)
    
    class Meta:
        model = Note
        fields = [
            'id', 'title', 'content', 'note_type', 'author', 'tags', 'color',
            'is_completed', 'reminder_at', 'metadata',
            'created_at', 'updated_at',
            'versioned_entity', 'version', 'container', 'container_version',
            'versioned_entity_id', 'version_id', 'container_id', 'container_version_id',
            'attached_object_type', 'attached_object_display', 'is_todo', 'is_overdue'
        ]
        read_only_fields = [
            'created_at', 'updated_at',
            'versioned_entity', 'version', 'container', 'container_version'
        ]
    
    def get_attached_object_type(self, obj):
        """Get the type of object this note is attached to."""
        return obj.get_attached_object_type()
    
    def get_attached_object_display(self, obj):
        """Get a display string for the attached object."""
        attached_obj = obj.get_attached_object()
        if attached_obj:
            if hasattr(attached_obj, 'code'):
                return f"{attached_obj.code} - {attached_obj.name}"
            return str(attached_obj)
        return None
    
    def get_is_todo(self, obj):
        """Check if this note is a todo item."""
        return obj.note_type == 'todo'
    
    def get_is_overdue(self, obj):
        """Check if this note/reminder is overdue."""
        return obj.is_overdue() if hasattr(obj, 'is_overdue') else False
    
    def validate(self, data):
        """Ensure exactly one foreign key is provided."""
        fk_fields = ['versioned_entity_id', 'version_id', 'container_id', 'container_version_id']
        provided_fks = [field for field in fk_fields if data.get(field) is not None]
        
        if len(provided_fks) == 0:
            raise serializers.ValidationError("Note must be attached to exactly one object.")
        elif len(provided_fks) > 1:
            raise serializers.ValidationError("Note can only be attached to one object at a time.")
        
        return data
    
    def create(self, validated_data):
        """Create note with proper foreign key assignment."""
        # Extract foreign key IDs
        versioned_entity_id = validated_data.pop('versioned_entity_id', None)
        version_id = validated_data.pop('version_id', None)
        container_id = validated_data.pop('container_id', None)
        container_version_id = validated_data.pop('container_version_id', None)
        
        # Create the note
        note = Note.objects.create(**validated_data)
        
        # Set the appropriate foreign key
        if versioned_entity_id:
            note.versioned_entity_id = versioned_entity_id
        elif version_id:
            note.version_id = version_id
        elif container_id:
            note.container_id = container_id
        elif container_version_id:
            note.container_version_id = container_version_id
        
        note.save()
        return note
