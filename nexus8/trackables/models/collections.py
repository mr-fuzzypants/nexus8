"""
Smart collections: saved searches that re-evaluate on every view.

An entity type, not a table. ``type_data.query`` stores the SPA's URL search
string (e.g. ``q=wanda&tag=battle``); opening the collection simply re-runs
the live search, so membership is always current.
"""

from .base import EntityTypeManager, json_property, register_entity_type
from .entities import VersionedEntity


@register_entity_type("smart_collection")
class SmartCollection(VersionedEntity):
    objects = EntityTypeManager("smart_collection")

    class Meta:
        proxy = True

    query = json_property("query", default="")
