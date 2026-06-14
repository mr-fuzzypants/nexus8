"""Serializers for dependency links."""

from rest_framework import serializers
from .models import DependencyLink


class VersionEntityInfoSerializer(serializers.Serializer):
    """Minimal version + entity info (replaces SerializerMethodField for performance)."""

    version_id = serializers.SerializerMethodField()
    entity_id = serializers.SerializerMethodField()
    entity_name = serializers.SerializerMethodField()
    entity_type = serializers.SerializerMethodField()
    version_number = serializers.SerializerMethodField()

    def get_version_id(self, obj):
        return obj.id

    def get_entity_id(self, obj):
        return obj.entity_id

    def get_entity_name(self, obj):
        return obj.entity.name

    def get_entity_type(self, obj):
        return obj.entity.entity_type

    def get_version_number(self, obj):
        return obj.version_number


class DependencyLinkSerializer(serializers.ModelSerializer):
    """Serialize dependency links with nested source/target entity info."""

    source_entity = VersionEntityInfoSerializer(source='source_version', read_only=True)
    target_entity = VersionEntityInfoSerializer(source='target_version', read_only=True)

    class Meta:
        model = DependencyLink
        fields = [
            "id",
            "source_version_id",
            "target_version_id",
            "relationship_type",
            "role",
            "source_entity",
            "target_entity",
            "created_at",
        ]
        read_only_fields = ["id", "created_at"]


class DependencyLinkMinimalSerializer(serializers.ModelSerializer):
    """Minimal serializer for list views (IDs only, faster for large datasets)."""

    class Meta:
        model = DependencyLink
        fields = [
            "id",
            "source_version_id",
            "target_version_id",
            "relationship_type",
            "role",
            "created_at",
        ]
        read_only_fields = ["id", "created_at"]
