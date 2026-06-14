"""
Reference boards: PureRef-style infinite canvases over media assets.

A board is an entity type, not a new table. The mutable working canvas lives
in ``type_data["canvas"]``; snapshots are published Versions whose payload
pins the canvas document, so board history rides the existing version system.

Canvas document shape (owned by the frontend, stored verbatim):

    {
        "items": [
            {"id": "<uuid>", "asset_id": 123,
             "x": 0, "y": 0, "width": 320, "height": 200, "rotation": 0},
            ...
        ]
    }
"""

from .base import EntityTypeManager, json_property, register_entity_type, require_keys
from .entities import VersionedEntity

EMPTY_CANVAS = {"items": []}


@register_entity_type("board", version_payload=require_keys("canvas"))
class Board(VersionedEntity):
    objects = EntityTypeManager("board")

    class Meta:
        proxy = True

    canvas = json_property("canvas", default=EMPTY_CANVAS)

    def asset_ids(self):
        return [
            item["asset_id"]
            for item in (self.canvas or {}).get("items", [])
            if item.get("asset_id")
        ]

    def snapshot(self, *, created_by=None):
        """Publish the current canvas as an immutable version."""
        return self.publish(data={"canvas": self.canvas}, created_by=created_by)
