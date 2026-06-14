"""
Asset ↔ entity relations: the structured layer behind queries like
``character:wanda`` and entity-hub pages.

Explicit FK join table (per the project's no-GenericFK philosophy). ``asset``
is the media asset (or any versioned entity) being described; ``entity`` is
the describing entity (a ``VersionedEntity`` with entity_type="entity" whose
``type_data.category`` matches ``role``: character, costume, location, ...).
"""

from django.db import models

from .base import Trackable
from .entities import VersionedEntity

RELATION_SOURCES = [("user", "User"), ("ai", "AI suggested")]


class EntityRelation(Trackable):
    asset = models.ForeignKey(
        VersionedEntity, on_delete=models.CASCADE, related_name="entity_relations"
    )
    entity = models.ForeignKey(
        VersionedEntity, on_delete=models.CASCADE, related_name="asset_relations"
    )
    role = models.CharField(max_length=32, db_index=True)
    confidence = models.FloatField(default=1.0)
    source = models.CharField(max_length=8, choices=RELATION_SOURCES, default="user")

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["asset", "entity", "role"], name="unique_asset_entity_role"
            ),
        ]
        indexes = [
            models.Index(fields=["entity", "role"], name="relation_entity_role_idx"),
            models.Index(fields=["asset", "role"], name="relation_asset_role_idx"),
        ]

    def __str__(self):
        return f"{self.asset.code} —{self.role}→ {self.entity.code}"
