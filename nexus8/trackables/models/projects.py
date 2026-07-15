"""
Projects: the top-level scope that owns entities and assets.

An entity type, not a table. Every entity/asset belongs to at most one project
(hard partition) via the ``project`` self-FK on the row (db column
``project_code``, keyed by the project's ``code``); a project's own
``type_data`` carries presentation/state attributes for its landing page.

The FK column stores the project code directly, so per-project listing is a
single indexed ``filter(project_id=...)`` over the shared entity table.
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
