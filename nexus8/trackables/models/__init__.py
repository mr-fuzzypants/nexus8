"""
Trackables models.

Single-table entity design: every entity row lives in
``trackables_versionedentity`` with an ``entity_type`` discriminator and a
``type_data`` JSONB payload; ``MediaAsset`` and ``Container`` are proxies.
Versions live in ``trackables_version``; container versions are versions of
container entities (``ContainerVersion`` proxy).

To add a new entity type: subclass ``VersionedEntity`` with ``Meta.proxy``,
decorate with ``@register_entity_type("your_key")``, give it an
``EntityTypeManager("your_key")``, and expose payload attributes with
``json_property``. No migration needed.
"""

from .base import (
    DEFAULT_ENTITY_TYPE,
    ENTITY_TYPE_REGISTRY,
    TYPE_DATA_VALIDATORS,
    VERSION_PAYLOAD_VALIDATORS,
    EntityTypeManager,
    Trackable,
    json_property,
    register_entity_type,
    require_keys,
)
from .entities import (
    AI_STATUS_CHOICES,
    EMBEDDING_DIMENSIONS,
    Container,
    ContainerManager,
    MediaAsset,
    VersionedEntity,
)
from .versions import (
    ContainerReference,
    ContainerVersion,
    ContainerVersionManager,
    Symlink,
    SymlinkEvent,
    Version,
    VersionLink,
    VersionQueryManager,
    resolve_symlink_at,
    bulk_create_entities,
    bulk_create_versions,
    create_container_hierarchy,
    create_container_version,
    create_container_version_with_hierarchy,
    create_hierarchical_container_versions,
    resolve_container_references,
    update_symlink,
)
from .boards import (
    Board,
)
from .annotations import (
    ImageAnnotation,
)
from .collections import (
    SmartCollection,
)
from .projects import (
    PROJECT_STATUSES,
    Project,
)
from .relations import (
    EntityRelation,
)
from .tasks import (
    Task,
    TaskManager,
    bulk_update_task_status,
    create_task_hierarchy,
)
from .generation import (
    GENERATED_FROM_BATCH,
    GenerationRecipe,
    LoraAdapter,
    ModelCheckpoint,
    PromptTemplate,
    reproduction_manifest,
)
from .maintenance import (
    initialize_materialized_paths,
    validate_materialized_paths,
)
from .container_links import (
    DependencyLink,
)

__all__ = [
    "AI_STATUS_CHOICES",
    "DEFAULT_ENTITY_TYPE",
    "EMBEDDING_DIMENSIONS",
    "ENTITY_TYPE_REGISTRY",
    "GENERATED_FROM_BATCH",
    "TYPE_DATA_VALIDATORS",
    "VERSION_PAYLOAD_VALIDATORS",
    "Board",
    "Container",
    "ContainerManager",
    "ContainerReference",
    "ContainerVersion",
    "ContainerVersionManager",
    "DependencyLink",
    "EntityRelation",
    "EntityTypeManager",
    "GenerationRecipe",
    "ImageAnnotation",
    "LoraAdapter",
    "MediaAsset",
    "ModelCheckpoint",
    "PROJECT_STATUSES",
    "Project",
    "PromptTemplate",
    "SmartCollection",
    "Symlink",
    "SymlinkEvent",
    "Task",
    "TaskManager",
    "Trackable",
    "Version",
    "VersionLink",
    "VersionQueryManager",
    "VersionedEntity",
    "bulk_create_entities",
    "bulk_create_versions",
    "bulk_update_task_status",
    "create_container_hierarchy",
    "create_container_version",
    "create_container_version_with_hierarchy",
    "create_hierarchical_container_versions",
    "create_task_hierarchy",
    "initialize_materialized_paths",
    "json_property",
    "register_entity_type",
    "reproduction_manifest",
    "require_keys",
    "resolve_container_references",
    "resolve_symlink_at",
    "update_symlink",
    "validate_materialized_paths",
]
