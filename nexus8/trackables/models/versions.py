"""
Versions, symlinks, and container references.

A ``Version`` is an immutable-by-convention snapshot of an entity's payload.
"Container versions" are plain ``Version`` rows whose entity is a container;
the ``ContainerVersion`` proxy scopes querysets and adds hierarchy behavior.
``Symlink`` is a named mutable pointer (latest/approved); ``ContainerReference``
pins the version a symlink resolved to when a container version was created —
that pinning is what makes a container version reproducible later.
"""

from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models, transaction
from django.db.models import Avg, Count, FloatField, Max, Min, Q
from django.db.models.fields.json import KT
from django.db.models.functions import Cast
from django.contrib.postgres.indexes import GinIndex
from django.utils import timezone

from .base import Trackable
from .entities import Container, VersionedEntity


class VersionQueryManager(models.Manager):
    """Manager with JSON-payload query helpers."""

    def by_status(self, status):
        return self.filter(data__status=status)

    def by_author(self, author):
        return self.filter(data__metadata__author=author)

    def with_tags(self, tags):
        """Versions whose data.tags contains any of the given tags."""
        if isinstance(tags, str):
            tags = [tags]
        query = Q()
        for tag in tags:
            query |= Q(data__tags__contains=[tag])
        return self.filter(query)

    def file_size_range(self, min_size=None, max_size=None):
        queryset = self.all()
        if min_size is not None:
            queryset = queryset.filter(data__file_size__gte=min_size)
        if max_size is not None:
            queryset = queryset.filter(data__file_size__lte=max_size)
        return queryset

    def created_by_user(self, user_id):
        return self.filter(data__created_by=user_id)

    def with_quality_score(self, min_score=None):
        queryset = self.all()
        if min_score is not None:
            queryset = queryset.filter(data__quality_score__gte=min_score)
        return queryset

    def search_description(self, search_term):
        return self.filter(data__description__icontains=search_term)

    def aggregate_json_stats(self):
        status_counts = (
            self.values("data__status").annotate(count=Count("id")).order_by("-count")
        )
        size_stats = self.exclude(data__file_size__isnull=True).aggregate(
            avg_size=Avg(Cast(KT("data__file_size"), FloatField())),
            min_size=Min(Cast(KT("data__file_size"), FloatField())),
            max_size=Max(Cast(KT("data__file_size"), FloatField())),
        )
        return {
            "status_distribution": list(status_counts),
            "file_size_stats": size_stats,
            "total_versions": self.count(),
        }


class Version(Trackable):
    entity = models.ForeignKey(
        VersionedEntity, on_delete=models.CASCADE, related_name="versions"
    )
    version_number = models.PositiveIntegerField()
    data = models.JSONField(default=dict, blank=True)

    # Hash of the published content (e.g. file sha256). Makes reproduction
    # verifiable and byte-identical republications detectable.
    content_hash = models.CharField(max_length=128, blank=True, default="", db_index=True)

    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="created_versions",
    )

    # Used only by container versions: the containing (parent) container's
    # version this one was published under.
    parent_container_version = models.ForeignKey(
        "self",
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="child_container_versions",
    )

    objects = VersionQueryManager()

    class Meta:
        ordering = ["-version_number"]
        constraints = [
            models.UniqueConstraint(
                fields=["entity", "version_number"], name="unique_version_per_entity"
            ),
        ]
        indexes = [
            models.Index(fields=["created_at"], name="version_created_idx"),
            GinIndex(fields=["data"], name="version_data_gin"),
        ]

    def __str__(self):
        return f"{self.entity.code} v{self.version_number}"

    @classmethod
    def get_by_json_field(cls, field_path, value, entity=None):
        json_lookup = f"data__{field_path.replace('.', '__')}"
        queryset = cls.objects.filter(**{json_lookup: value})
        if entity:
            queryset = queryset.filter(entity=entity)
        return queryset

    def get_json_field(self, field_path, default=None):
        try:
            current = self.data
            for part in field_path.split("."):
                current = current[part]
            return current
        except (KeyError, TypeError):
            return default

    def set_json_field(self, field_path, value):
        if not isinstance(self.data, dict):
            self.data = {}
        current = self.data
        parts = field_path.split(".")
        for part in parts[:-1]:
            current = current.setdefault(part, {})
        current[parts[-1]] = value
        self.save(update_fields=["data", "updated_at"])

    def has_json_field(self, field_path):
        sentinel = object()
        return self.get_json_field(field_path, sentinel) is not sentinel

    def update_json_field(self, field_path, update_func):
        self.set_json_field(field_path, update_func(self.get_json_field(field_path)))

    def add_to_json_list(self, field_path, item):
        current = self.get_json_field(field_path, [])
        if not isinstance(current, list):
            current = []
        if item not in current:
            current.append(item)
            self.set_json_field(field_path, current)

    def remove_from_json_list(self, field_path, item):
        current = self.get_json_field(field_path, [])
        if isinstance(current, list) and item in current:
            current.remove(item)
            self.set_json_field(field_path, current)


class ContainerVersionManager(VersionQueryManager):
    """Scopes to versions of container entities."""

    def get_queryset(self):
        return super().get_queryset().filter(entity__entity_type="container")

    def root_container_versions(self):
        return self.filter(parent_container_version__isnull=True)

    def for_container_hierarchy(self, container):
        return self.filter(
            entity__path__startswith=container.path,
            entity__entity_type="container",
        )

    def get_version_descendants(self, container_version, include_self=False):
        descendants = [container_version] if include_self else []
        children = list(self.filter(parent_container_version=container_version))
        for child in children:
            descendants.extend(self.get_version_descendants(child, include_self=True))
        return descendants

    def get_dependency_chain_cte(self, version, direction="up", max_depth=10):
        """
        Walk the parent_container_version chain via recursive CTE.

        Returns rows of (version_id, container_code, version_number, depth,
        dependency_path, created_at).
        """
        from django.db import connection

        if direction == "up":
            join_condition = "vd.parent_container_version_id = v.id"
        else:
            join_condition = "v.parent_container_version_id = vd.id"

        with connection.cursor() as cursor:
            cursor.execute(
                f"""
                WITH RECURSIVE version_deps AS (
                    SELECT v.id, v.version_number, v.entity_id,
                           v.parent_container_version_id,
                           0 AS depth, e.code AS container_code,
                           e.code || '_v' || v.version_number::text AS dependency_path,
                           v.created_at
                    FROM trackables_version v
                    JOIN trackables_versionedentity e ON v.entity_id = e.id
                    WHERE v.id = %s

                    UNION ALL

                    SELECT v.id, v.version_number, v.entity_id,
                           v.parent_container_version_id,
                           vd.depth + 1, e.code,
                           vd.dependency_path || ' -> ' || e.code || '_v' || v.version_number::text,
                           v.created_at
                    FROM trackables_version v
                    JOIN trackables_versionedentity e ON v.entity_id = e.id
                    INNER JOIN version_deps vd ON {join_condition}
                    WHERE vd.depth < %s
                )
                SELECT id, container_code, version_number, depth, dependency_path, created_at
                FROM version_deps
                WHERE depth > 0
                ORDER BY depth, created_at
                """,
                [version.pk, max_depth],
            )
            return cursor.fetchall()

    def get_version_tree_cte(self, root_version, include_references=False):
        """Version hierarchy tree rows, optionally with reference counts."""
        from django.db import connection

        reference_sql = ""
        reference_select = ""
        if include_references:
            reference_sql = """
                , (SELECT COUNT(*) FROM trackables_containerreference cr
                   WHERE cr.container_version_id = v.id) AS reference_count
            """
            reference_select = ", reference_count"

        with connection.cursor() as cursor:
            cursor.execute(
                f"""
                WITH RECURSIVE version_tree AS (
                    SELECT v.id, v.version_number, v.entity_id,
                           v.parent_container_version_id, 0 AS level,
                           e.code AS container_code,
                           e.code || '_v' || v.version_number::text AS version_path,
                           v.created_at
                           {reference_sql}
                    FROM trackables_version v
                    JOIN trackables_versionedentity e ON v.entity_id = e.id
                    WHERE v.id = %s

                    UNION ALL

                    SELECT v.id, v.version_number, v.entity_id,
                           v.parent_container_version_id, vt.level + 1,
                           e.code,
                           vt.version_path || ' -> ' || e.code || '_v' || v.version_number::text,
                           v.created_at
                           {reference_sql}
                    FROM trackables_version v
                    JOIN trackables_versionedentity e ON v.entity_id = e.id
                    INNER JOIN version_tree vt ON v.parent_container_version_id = vt.id
                    WHERE vt.level < 10
                )
                SELECT id, version_number, container_code, level, version_path,
                       created_at {reference_select}
                FROM version_tree
                ORDER BY level, created_at
                """,
                [root_version.pk],
            )
            return cursor.fetchall()


class ContainerVersion(Version):
    """A version of a container. Proxy over Version (entity must be a container)."""

    objects = ContainerVersionManager()

    class Meta:
        proxy = True

    def get_container(self):
        entity = self.entity
        if not isinstance(entity, Container):
            raise TypeError(f"Version {self.pk} does not belong to a container.")
        return entity

    def get_version_hierarchy_path(self):
        path = []
        current = self
        while current:
            path.insert(0, f"{current.entity.code} v{current.version_number}")
            current = current.parent_container_version
        return path

    def get_version_hierarchy_level(self):
        level = 0
        current = self.parent_container_version
        while current:
            level += 1
            current = current.parent_container_version
        return level

    def get_all_sub_versions(self):
        return ContainerVersion.objects.get_version_descendants(self, include_self=False)

    def inherits_container_hierarchy(self):
        container = self.get_container()
        if not container.parent_container_id:
            return self.parent_container_version_id is None
        if self.parent_container_version:
            return (
                self.parent_container_version.entity_id
                == container.parent_container_id
            )
        return False

    def get_container_hierarchy_path(self):
        return self.get_container().get_hierarchy_path()

    def clean(self):
        if self.parent_container_version_id:
            seen = set()
            current = self.parent_container_version
            while current:
                if current.pk == self.pk or current.pk in seen:
                    raise ValidationError(
                        "Circular reference detected in container version hierarchy."
                    )
                seen.add(current.pk)
                current = current.parent_container_version
            if self.parent_container_version.entity_id == self.entity_id:
                raise ValidationError(
                    "Container version cannot have a parent version from the same container."
                )

    def save(self, *args, **kwargs):
        self.clean()
        super().save(*args, **kwargs)


class Symlink(models.Model):
    """Named mutable pointer to a specific version of an entity."""

    entity = models.ForeignKey(
        VersionedEntity, on_delete=models.CASCADE, related_name="symlinks"
    )
    name = models.CharField(max_length=64)  # e.g. "latest", "approved"
    # RESTRICT: a version a symlink points at cannot be deleted directly —
    # move the symlink first. Deleting the whole entity still works (the
    # symlink is cascaded by the same operation).
    version = models.ForeignKey(
        Version, on_delete=models.RESTRICT, related_name="symlinks"
    )

    class Meta:
        ordering = ["name"]
        constraints = [
            models.UniqueConstraint(
                fields=["entity", "name"], name="unique_symlink_per_entity"
            ),
        ]

    def __str__(self):
        return f"{self.entity.code}:{self.name} -> v{self.version.version_number}"


class ContainerReference(Trackable):
    """
    Pin of a symlink resolution inside a container version (the snapshot).

    Pins are the reproducibility guarantee, so the pinned entity and version
    use RESTRICT: they cannot be deleted while any container version still
    references them — unless the referencing container version is itself
    deleted in the same operation. Archive entities instead of deleting.
    """

    container_version = models.ForeignKey(
        Version, on_delete=models.CASCADE, related_name="references"
    )
    reference_name = models.CharField(max_length=64)  # e.g. "character", "environment"
    referenced_entity = models.ForeignKey(
        VersionedEntity, on_delete=models.RESTRICT, related_name="container_references"
    )
    symlink_name = models.CharField(max_length=64)
    symlink_version = models.ForeignKey(
        Version,
        on_delete=models.RESTRICT,
        related_name="referenced_in_containers",
        help_text="Version the symlink pointed to when this container version was created",
    )
    resolved_version = models.ForeignKey(
        Version,
        on_delete=models.SET_NULL,
        related_name="currently_referenced_in_containers",
        null=True,
        blank=True,
        help_text="Current symlink target (refreshed on demand; cache only)",
    )

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["container_version", "reference_name"],
                name="unique_reference_per_container_version",
            ),
        ]
        indexes = [
            models.Index(fields=["referenced_entity", "symlink_name"]),
        ]

    def __str__(self):
        return (
            f"{self.container_version} -> {self.reference_name}: "
            f"{self.referenced_entity.code}:{self.symlink_name}"
        )


class VersionLink(models.Model):
    """
    Directed lineage edge between versions: ``from_version`` (upstream input)
    -> ``to_version`` (downstream derived output).

    Examples: a generated take points at the batch container version it was
    produced by (role="generated_from_batch"); an img2img output points at
    its init-image version (role="init_image").

    RESTRICT on the upstream side: an input version cannot be deleted while
    derived outputs still exist. CASCADE on the downstream side: deleting an
    output removes its lineage edges.
    """

    from_version = models.ForeignKey(
        Version, on_delete=models.RESTRICT, related_name="downstream_links"
    )
    to_version = models.ForeignKey(
        Version, on_delete=models.CASCADE, related_name="upstream_links"
    )
    role = models.CharField(max_length=64)
    created_at = models.DateTimeField(default=timezone.now, editable=False)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["from_version", "to_version", "role"],
                name="unique_version_link",
            ),
        ]
        indexes = [
            models.Index(fields=["from_version", "role"]),
            models.Index(fields=["to_version", "role"]),
        ]

    def __str__(self):
        return f"{self.to_version} --[{self.role}]--> {self.from_version}"


class SymlinkEvent(models.Model):
    """
    Append-only audit record of a symlink move (written by update_symlink).

    Version references use SET_NULL so the audit row outlives any version
    that is eventually deleted.
    """

    entity = models.ForeignKey(
        VersionedEntity, on_delete=models.CASCADE, related_name="symlink_events"
    )
    name = models.CharField(max_length=64)
    old_version = models.ForeignKey(
        Version, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    new_version = models.ForeignKey(
        Version, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="+",
    )
    created_at = models.DateTimeField(default=timezone.now, editable=False, db_index=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["entity", "name", "created_at"]),
        ]

    def __str__(self):
        old = f"v{self.old_version.version_number}" if self.old_version else "(none)"
        new = f"v{self.new_version.version_number}" if self.new_version else "(deleted)"
        return f"{self.entity.code}:{self.name} {old} -> {new}"


# ---------------------------------------------------------------------------
# Publishing / resolution helpers
# ---------------------------------------------------------------------------


def update_symlink(entity, name, version, actor=None):
    """Point ``entity:name`` at ``version``, recording an audit event."""
    with transaction.atomic():
        previous_id = (
            Symlink.objects.filter(entity=entity, name=name)
            .values_list("version_id", flat=True)
            .first()
        )
        symlink, _ = Symlink.objects.update_or_create(
            entity=entity, name=name, defaults={"version": version}
        )
        if previous_id != version.pk:
            SymlinkEvent.objects.create(
                entity=entity,
                name=name,
                old_version_id=previous_id,
                new_version=version,
                actor=actor,
            )
    return symlink


def resolve_symlink_at(entity, name, timestamp):
    """
    What did ``entity:name`` point at as of ``timestamp``? (Time-travel
    resolution from the audit trail; None if the symlink didn't exist yet
    or its target was since deleted.)
    """
    event = (
        SymlinkEvent.objects.filter(entity=entity, name=name, created_at__lte=timestamp)
        .order_by("-created_at")
        .select_related("new_version")
        .first()
    )
    return event.new_version if event else None


def _next_version_number(entity):
    """
    Allocate the next version number for an entity.

    Locks the entity row so concurrent publishers serialize instead of
    colliding on the (entity, version_number) unique constraint. Must be
    called inside a transaction.
    """
    VersionedEntity.objects.select_for_update().get(pk=entity.pk)
    current = Version.objects.filter(entity=entity).aggregate(
        max_num=Max("version_number")
    )["max_num"]
    return (current or 0) + 1


def _resolve_symlinks_bulk(pairs):
    """
    Resolve many (entity, symlink_name) pairs in one query.

    Returns {(entity_id, name): version}. Raises ValueError for any pair
    without a matching symlink.
    """
    if not pairs:
        return {}
    query = Q()
    for entity, name in pairs:
        query |= Q(entity_id=entity.pk, name=name)
    resolved = {
        (s.entity_id, s.name): s.version
        for s in Symlink.objects.filter(query).select_related("version")
    }
    missing = [
        f"{entity.code}:{name}"
        for entity, name in pairs
        if (entity.pk, name) not in resolved
    ]
    if missing:
        raise ValueError(f"Symlinks do not exist: {', '.join(missing)}")
    return resolved


def create_container_version(container, references, parent_container_version=None,
                             symlinks=None, created_by=None):
    """
    Publish a new container version pinning the current resolution of each
    referenced symlink.

    Args:
        container: the Container entity
        references: {reference_name: (entity, symlink_name)}
        parent_container_version: optional parent ContainerVersion
        symlinks: optional symlink names to point at the new version
        created_by: User publishing the version
    """
    with transaction.atomic():
        version_number = _next_version_number(container)
        container_version = ContainerVersion.objects.create(
            entity=container,
            version_number=version_number,
            data={"reference_count": len(references)},
            parent_container_version=parent_container_version,
            created_by=created_by,
        )

        resolved = _resolve_symlinks_bulk(list(references.values()))
        ContainerReference.objects.bulk_create(
            [
                ContainerReference(
                    container_version=container_version,
                    reference_name=ref_name,
                    referenced_entity=entity,
                    symlink_name=symlink_name,
                    symlink_version=resolved[(entity.pk, symlink_name)],
                    resolved_version=resolved[(entity.pk, symlink_name)],
                )
                for ref_name, (entity, symlink_name) in references.items()
            ]
        )

        for symlink_name in symlinks or []:
            update_symlink(container, symlink_name, container_version, actor=created_by)

        return container_version


def create_container_version_with_hierarchy(container, references, parent_container_version=None, symlinks=None):
    """Alias kept for API compatibility; create_container_version handles hierarchy."""
    return create_container_version(
        container, references, parent_container_version, symlinks
    )


def resolve_container_references(container_version):
    """
    Resolve all references of a container version against current symlinks.

    Returns {reference_name: {...}} including whether each pin is still
    current. Uses two queries total regardless of reference count.
    """
    references = list(
        container_version.references.select_related("referenced_entity", "symlink_version")
    )
    current = {}
    if references:
        query = Q()
        for ref in references:
            query |= Q(entity_id=ref.referenced_entity_id, name=ref.symlink_name)
        current = {
            (s.entity_id, s.name): s.version
            for s in Symlink.objects.filter(query).select_related("version")
        }

    resolved = {}
    for ref in references:
        current_version = current.get((ref.referenced_entity_id, ref.symlink_name))
        entry = {
            "entity": ref.referenced_entity,
            "symlink_name": ref.symlink_name,
            "version_at_creation": ref.symlink_version,
            "current_version": current_version,
            "is_current": (
                current_version is not None
                and current_version.pk == ref.symlink_version_id
            ),
        }
        if current_version is None:
            entry["error"] = f"Symlink {ref.symlink_name} no longer exists"
        resolved[ref.reference_name] = entry
    return resolved


def bulk_create_versions(entity, versions_data, batch_size=100):
    """Create many versions for one entity with a single number allocation."""
    with transaction.atomic():
        start = _next_version_number(entity)
        versions = [
            Version(entity=entity, version_number=start + i, data=data)
            for i, data in enumerate(versions_data)
        ]
        return Version.objects.bulk_create(versions, batch_size=batch_size)


def bulk_create_entities(entities_data, entity_class=VersionedEntity, batch_size=100):
    entities = [
        entity_class(
            code=data["code"],
            name=data["name"],
            entity_type=entity_class.entity_type_key,
        )
        for data in entities_data
    ]
    with transaction.atomic():
        return entity_class._base_manager.bulk_create(entities, batch_size=batch_size)


def create_container_hierarchy(container_tree, parent_container=None):
    """Create a container tree from nested {'code', 'name', 'subcontainers'} dicts."""

    def _create(node, parent):
        container = Container.objects.create(
            code=node["code"], name=node["name"], parent_container=parent
        )
        created = [container]
        for child in node.get("subcontainers", []):
            created.extend(_create(child, container))
        return created

    if isinstance(container_tree, list):
        created = []
        for tree in container_tree:
            created.extend(_create(tree, parent_container))
        return created
    return _create(container_tree, parent_container)


def create_hierarchical_container_versions(container_hierarchy_data):
    """Publish container versions following a nested hierarchy description."""

    def _create(node, parent_version=None):
        container = Container.objects.get(code=node["container_code"])
        container_version = create_container_version(
            container=container,
            references=node.get("references", {}),
            parent_container_version=parent_version,
            symlinks=node.get("symlinks"),
        )
        created = [container_version]
        for child in node.get("child_versions", []):
            created.extend(_create(child, container_version))
        return created

    return _create(container_hierarchy_data)
