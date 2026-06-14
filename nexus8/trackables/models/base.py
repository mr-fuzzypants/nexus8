"""
Core machinery for the single-table entity-type system.

Entities live in ONE physical table (trackables_versionedentity). Each row
carries an ``entity_type`` discriminator and a ``type_data`` JSONB payload for
type-specific attributes. Per-type Python behavior is provided by proxy models
registered via :func:`register_entity_type`; ``VersionedEntity.from_db`` swaps
fetched instances to their registered proxy class, so heterogeneous querysets
come back polymorphic with zero joins.

Adding a new entity type is a proxy class + registry entry — no migration.
Promote a JSON key to a real column only when it is filtered/sorted/joined
constantly or updated at high frequency.
"""

import copy

from django.core.exceptions import ValidationError
from django.db import models
from django.utils import timezone

# entity_type string -> proxy class. Filled by @register_entity_type.
ENTITY_TYPE_REGISTRY = {}

# entity_type string -> validator callable, run against type_data on save /
# against Version payloads on publish(). Optional per type.
TYPE_DATA_VALIDATORS = {}
VERSION_PAYLOAD_VALIDATORS = {}

# Discriminator value for plain/base entities.
DEFAULT_ENTITY_TYPE = "entity"


def register_entity_type(key, *, type_data=None, version_payload=None):
    """
    Class decorator registering a VersionedEntity proxy under an entity_type key.

        @register_entity_type("media_asset")
        class MediaAsset(VersionedEntity):
            class Meta:
                proxy = True

    Optional validators (callables taking the payload dict and raising
    ValidationError) guard the type_data payload on every save and the
    Version payload on every publish():

        @register_entity_type("recipe", version_payload=require_keys("sampler"))
    """

    def _wrap(cls):
        cls.entity_type_key = key
        ENTITY_TYPE_REGISTRY[key] = cls
        if type_data is not None:
            TYPE_DATA_VALIDATORS[key] = type_data
        if version_payload is not None:
            VERSION_PAYLOAD_VALIDATORS[key] = version_payload
        return cls

    return _wrap


def require_keys(*keys):
    """Validator factory: the payload must contain every named key."""

    def _validate(payload):
        missing = [key for key in keys if key not in (payload or {})]
        if missing:
            raise ValidationError(f"Payload is missing required keys: {', '.join(missing)}")

    return _validate


def json_property(key, default=None, doc=None):
    """
    Expose ``type_data[key]`` as a regular attribute on a proxy model.

    Implemented as a builtin ``property`` (not a custom descriptor) so that
    ``Model(**kwargs)`` accepts the name — Django's ``Model.__init__`` routes
    unknown kwargs to properties only.

    Mutable defaults are returned as copies: assign the modified value back
    rather than mutating the returned default in place.
    """

    def fget(self):
        data = self.type_data or {}
        if key in data:
            return data[key]
        if isinstance(default, (list, dict)):
            return copy.copy(default)
        return default

    def fset(self, value):
        if not isinstance(self.type_data, dict):
            self.type_data = {}
        self.type_data[key] = value

    def fdel(self):
        if isinstance(self.type_data, dict):
            self.type_data.pop(key, None)

    return property(fget, fset, fdel, doc or f"type_data[{key!r}]")


class EntityTypeManager(models.Manager):
    """
    Default manager for entity-type proxies: scopes querysets to one
    entity_type and stamps it on create().

    Django's automatic ``_base_manager`` stays unfiltered, so FK traversal
    and cascade deletion still see every row.
    """

    def __init__(self, entity_type=None):
        super().__init__()
        self.entity_type = entity_type

    def get_queryset(self):
        qs = super().get_queryset()
        if self.entity_type:
            qs = qs.filter(entity_type=self.entity_type)
        return qs

    def create(self, **kwargs):
        if self.entity_type:
            kwargs.setdefault("entity_type", self.entity_type)
        return super().create(**kwargs)

    def active(self):
        """Exclude archived entities."""
        return self.filter(archived_at__isnull=True)


class Trackable(models.Model):
    created_at = models.DateTimeField(default=timezone.now, editable=False)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        abstract = True
