from django.contrib import admin

from .models import (
    Container,
    ContainerReference,
    ContainerVersion,
    DependencyLink,
    MediaAsset,
    Symlink,
    SymlinkEvent,
    Task,
    Version,
    VersionedEntity,
    VersionLink,
)


@admin.register(VersionedEntity)
class VersionedEntityAdmin(admin.ModelAdmin):
    list_display = ["code", "name", "entity_type", "created_at", "updated_at"]
    list_filter = ["entity_type", "created_at"]
    search_fields = ["code", "name", "description"]
    readonly_fields = ["entity_type", "path", "depth", "created_at", "updated_at"]


@admin.register(Container)
class ContainerAdmin(admin.ModelAdmin):
    list_display = ["code", "name", "parent_container", "depth", "path", "created_at"]
    list_filter = ["depth", "created_at"]
    search_fields = ["code", "name", "path"]
    readonly_fields = ["path", "depth", "created_at", "updated_at"]
    raw_id_fields = ["parent_container"]
    ordering = ["path"]
    fields = ["code", "name", "description", "parent_container", "path", "depth", "created_at", "updated_at"]


@admin.register(MediaAsset)
class MediaAssetAdmin(admin.ModelAdmin):
    list_display = [
        "code",
        "name",
        "asset_media_type",
        "ai_analysis_status",
        "ai_analysis_date",
        "created_at",
    ]
    list_filter = ["ai_analysis_status", "created_at"]
    search_fields = [
        "code",
        "name",
        "type_data__media_type",
        "type_data__file_path",
        "type_data__ai_generated_description",
    ]
    readonly_fields = ["ai_analysis_status", "ai_analysis_date", "created_at", "updated_at"]
    fieldsets = (
        (None, {"fields": ("code", "name", "description")}),
        ("Payload", {"fields": ("type_data",)}),
        ("AI Analysis", {"fields": ("ai_analysis_status", "ai_analysis_date")}),
        ("Timestamps", {"fields": ("created_at", "updated_at")}),
    )

    @admin.display(description="Media type")
    def asset_media_type(self, obj):
        return obj.media_type


@admin.register(Version)
class VersionAdmin(admin.ModelAdmin):
    list_display = ["__str__", "entity", "version_number", "created_at"]
    list_filter = ["created_at"]
    search_fields = ["entity__code", "entity__name"]
    raw_id_fields = ["entity", "parent_container_version"]
    readonly_fields = ["created_at", "updated_at"]


@admin.register(ContainerVersion)
class ContainerVersionAdmin(admin.ModelAdmin):
    list_display = ["__str__", "entity", "version_number", "parent_container_version", "created_at"]
    search_fields = ["entity__code", "entity__name"]
    raw_id_fields = ["entity", "parent_container_version"]
    readonly_fields = ["created_at", "updated_at"]


@admin.register(Symlink)
class SymlinkAdmin(admin.ModelAdmin):
    list_display = ["__str__", "entity", "name", "version"]
    list_filter = ["name"]
    search_fields = ["entity__code", "name"]
    raw_id_fields = ["entity", "version"]


@admin.register(ContainerReference)
class ContainerReferenceAdmin(admin.ModelAdmin):
    list_display = [
        "reference_name",
        "container_version",
        "referenced_entity",
        "symlink_name",
        "symlink_version",
    ]
    search_fields = ["reference_name", "referenced_entity__code", "symlink_name"]
    raw_id_fields = [
        "container_version",
        "referenced_entity",
        "symlink_version",
        "resolved_version",
    ]


@admin.register(SymlinkEvent)
class SymlinkEventAdmin(admin.ModelAdmin):
    list_display = ["__str__", "entity", "name", "actor", "created_at"]
    list_filter = ["name", "created_at"]
    search_fields = ["entity__code", "name"]
    raw_id_fields = ["entity", "old_version", "new_version", "actor"]
    readonly_fields = ["created_at"]

    def has_change_permission(self, request, obj=None):
        return False  # append-only audit trail


@admin.register(VersionLink)
class VersionLinkAdmin(admin.ModelAdmin):
    list_display = ["__str__", "role", "created_at"]
    list_filter = ["role"]
    raw_id_fields = ["from_version", "to_version"]
    readonly_fields = ["created_at"]


@admin.register(DependencyLink)
class DependencyLinkAdmin(admin.ModelAdmin):
    list_display = ["__str__", "relationship_type", "role", "created_at"]
    list_filter = ["relationship_type", "created_at"]
    raw_id_fields = ["source_version", "target_version"]
    readonly_fields = ["created_at"]


@admin.register(Task)
class TaskAdmin(admin.ModelAdmin):
    list_display = ["title", "status", "priority", "task_type", "assigned_to", "due_date"]
    list_filter = ["status", "priority", "task_type"]
    search_fields = ["title", "description", "assigned_to"]
    raw_id_fields = ["parent_task", "versioned_entity", "version", "container"]
    readonly_fields = ["created_at", "updated_at"]
