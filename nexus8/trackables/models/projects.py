"""
Projects: the top-level scope that owns entities and assets.

An entity type, not a table. Every entity/asset belongs to exactly one project
(hard partition) via ``type_data.project_code`` on the row; a project's own
``type_data`` carries presentation/state attributes for its landing page.

Membership is denormalized onto the row (not a join) so per-project listing is
a single ``filter(type_data__project_code=...)`` over the shared entity table.
"""

from .base import EntityTypeManager, json_property, register_entity_type
from .entities import VersionedEntity

# Lifecycle states surfaced on the project landing page / picker.
PROJECT_STATUSES = ["active", "wip", "archived"]


@register_entity_type("project")
class Project(VersionedEntity):
    objects = EntityTypeManager("project")

    class Meta:
        proxy = True

    # type_data payload
    status = json_property("status", default="active")
    cover_asset_code = json_property("cover_asset_code", default="")
    started_at = json_property("started_at", default="")
