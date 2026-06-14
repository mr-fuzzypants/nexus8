"""
Image annotation documents: the persisted, versioned tier behind the
collaborative 2D tiled annotator.

Like ``Board``, an annotation document is an entity type, not a new table. The
mutable working state is a base64-encoded Yjs CRDT update stored in
``type_data["doc_state"]``; the live, churning copy is owned by the Yjs relay
(``room_snapshots`` table). ``snapshot()`` publishes the current ``doc_state``
as an immutable Version, giving annotations the same "always-new-version"
history as every other entity.

type_data shape:
    {
        "target_asset_id": 123,            # MediaAsset this document annotates
        "room_id": "image-annotation:45",  # Yjs relay room id
        "doc_state": "<base64 Y update>",  # last persisted CRDT state
    }
"""

from .base import EntityTypeManager, json_property, register_entity_type, require_keys
from .entities import VersionedEntity


@register_entity_type("image_annotation", version_payload=require_keys("doc_state"))
class ImageAnnotation(VersionedEntity):
    objects = EntityTypeManager("image_annotation")

    class Meta:
        proxy = True

    target_asset_id = json_property("target_asset_id")
    room_id = json_property("room_id", default="")
    doc_state = json_property("doc_state", default="")

    def snapshot(self, *, created_by=None):
        """Publish the current CRDT state as an immutable version."""
        return self.publish(
            data={"doc_state": self.doc_state, "target_asset_id": self.target_asset_id},
            created_by=created_by,
        )
