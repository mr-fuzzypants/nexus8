"""
Versioned entities: one physical table, typed via proxies.

``VersionedEntity`` is the single concrete model. ``MediaAsset`` and
``Container`` are registered proxies over it; type-specific payload lives in
``type_data`` (JSONB), hierarchy fields are real columns used only by
containers (enforced by a check constraint).
"""

from django.core.exceptions import ValidationError
from django.db import models, transaction
from django.db.models import F, Q, Value
from django.db.models.fields.json import KT
from django.db.models.functions import Concat, Substr
from django.contrib.postgres.indexes import GinIndex
from django.utils import timezone
from pgvector.django import VectorField, HnswIndex, CosineDistance

from .base import (
    DEFAULT_ENTITY_TYPE,
    ENTITY_TYPE_REGISTRY,
    TYPE_DATA_VALIDATORS,
    VERSION_PAYLOAD_VALIDATORS,
    EntityTypeManager,
    Trackable,
    json_property,
    register_entity_type,
)

EMBEDDING_DIMENSIONS = 1536

AI_STATUS_CHOICES = [
    ("", "Not Applicable"),
    ("pending", "Pending Analysis"),
    ("processing", "Processing"),
    ("completed", "Analysis Complete"),
    ("failed", "Analysis Failed"),
    ("skipped", "Analysis Skipped"),
]


class VersionedEntity(Trackable):
    """
    Base row for every trackable, versionable thing in the system.

    All entity types share this table. ``entity_type`` selects the proxy
    class used for behavior; ``type_data`` holds type-specific attributes.
    """

    entity_type = models.CharField(max_length=32, blank=True, db_index=True)
    code = models.CharField(max_length=64, unique=True)
    name = models.CharField(max_length=255)
    description = models.TextField(blank=True)
    type_data = models.JSONField(default=dict, blank=True)

    # Retire instead of delete: pinned history is protected from deletion, so
    # archiving is the supported way to take an entity out of circulation.
    archived_at = models.DateTimeField(null=True, blank=True)

    # AI analysis state. Real columns (not JSON) because the worker queue
    # scans status and the value churns through the state machine.
    ai_analysis_status = models.CharField(
        max_length=20, blank=True, default="", choices=AI_STATUS_CHOICES
    )
    ai_analysis_date = models.DateTimeField(null=True, blank=True)
    semantic_embedding = VectorField(dimensions=EMBEDDING_DIMENSIONS, null=True, blank=True)

    # Hierarchy columns — populated only for containers (see check constraint).
    parent_container = models.ForeignKey(
        "self",
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="child_containers",
    )
    path = models.CharField(max_length=1000, blank=True, default="")
    depth = models.PositiveIntegerField(default=0)

    objects = models.Manager()

    entity_type_key = DEFAULT_ENTITY_TYPE

    class Meta:
        verbose_name_plural = "versioned entities"
        constraints = [
            models.CheckConstraint(
                condition=Q(entity_type="container") | Q(parent_container__isnull=True),
                name="parent_only_on_containers",
            ),
        ]
        indexes = [
            models.Index(
                fields=["path"],
                name="entity_path_idx",
                condition=Q(entity_type="container"),
            ),
            models.Index(
                fields=["path", "depth"],
                name="entity_path_depth_idx",
                condition=Q(entity_type="container"),
            ),
            models.Index(
                fields=["ai_analysis_status"],
                name="entity_ai_pending_idx",
                condition=Q(ai_analysis_status="pending"),
            ),
            models.Index(
                KT("type_data__media_type"),
                name="entity_media_type_idx",
                condition=Q(entity_type="media_asset"),
            ),
            GinIndex(fields=["type_data"], name="entity_type_data_gin"),
            HnswIndex(
                name="entity_embedding_hnsw",
                fields=["semantic_embedding"],
                m=16,
                ef_construction=64,
                opclasses=["vector_cosine_ops"],
            ),
        ]

    def __str__(self):
        return f"{self.code} ({self.name})"

    @classmethod
    def from_db(cls, db, field_names, values):
        instance = super().from_db(db, field_names, values)
        # __dict__ access avoids triggering a deferred-field fetch.
        entity_type = instance.__dict__.get("entity_type")
        proxy = ENTITY_TYPE_REGISTRY.get(entity_type)
        if proxy is not None and proxy is not instance.__class__:
            instance.__class__ = proxy
        return instance

    def save(self, *args, **kwargs):
        if not self.entity_type:
            self.entity_type = type(self).entity_type_key

        validator = TYPE_DATA_VALIDATORS.get(self.entity_type)
        if validator is not None:
            validator(self.type_data)

        old_path = old_depth = None
        if self.entity_type == "container":
            self.clean()
            if self.pk:
                old = (
                    VersionedEntity.objects.filter(pk=self.pk)
                    .values_list("path", "depth")
                    .first()
                )
                if old:
                    old_path, old_depth = old
            self._update_materialized_path()
            update_fields = kwargs.get("update_fields")
            if update_fields is not None:
                kwargs["update_fields"] = set(update_fields) | {
                    "entity_type",
                    "path",
                    "depth",
                }

        super().save(*args, **kwargs)

        if old_path and old_path != self.path:
            self._relabel_descendants(old_path, old_depth)

    def clean(self):
        if self.entity_type != "container" and self.parent_container_id:
            raise ValidationError("Only containers can have a parent container.")
        if self.parent_container_id and self.pk:
            parent = self.parent_container
            if parent.pk == self.pk:
                raise ValidationError("Container cannot be its own parent.")
            if self.path and parent.path.startswith(self.path):
                raise ValidationError(
                    "Circular reference detected in container hierarchy."
                )

    # -- materialized path maintenance ------------------------------------

    def _update_materialized_path(self):
        if self.parent_container_id:
            parent = self.parent_container
            self.path = f"{parent.path}{self.code}/"
            self.depth = parent.depth + 1
        else:
            self.path = f"/{self.code}/"
            self.depth = 0

    def _relabel_descendants(self, old_path, old_depth):
        """Re-prefix the whole subtree in a single UPDATE after a move/rename."""
        depth_delta = self.depth - old_depth
        (
            VersionedEntity.objects.filter(path__startswith=old_path)
            .exclude(pk=self.pk)
            .update(
                path=Concat(
                    Value(self.path),
                    Substr("path", len(old_path) + 1),
                    output_field=models.CharField(max_length=1000),
                ),
                depth=F("depth") + depth_delta,
                updated_at=timezone.now(),
            )
        )

    # -- shared API --------------------------------------------------------

    def resolve_symlink(self, name: str):
        return self.symlinks.select_related("version").get(name=name).version

    def publish(self, data=None, *, symlinks=("latest",), upstream=None,
                content_hash="", created_by=None):
        """
        The blessed way to create a version: allocates the version number
        under the entity lock, validates the payload against the type's
        registered schema, moves symlinks, and records lineage — atomically.

        Args:
            data: version payload dict
            symlinks: names to point at the new version (default: latest)
            upstream: {role: Version} lineage edges, e.g.
                      {"generated_from_batch": batch_version}
            content_hash: hash of the published content, for verification/dedup
            created_by: User who published

        Returns the created Version.
        """
        from .versions import Version, VersionLink, _next_version_number, update_symlink

        payload = data or {}
        validator = VERSION_PAYLOAD_VALIDATORS.get(self.entity_type)
        if validator is not None:
            validator(payload)

        with transaction.atomic():
            version = Version.objects.create(
                entity=self,
                version_number=_next_version_number(self),
                data=payload,
                content_hash=content_hash,
                created_by=created_by,
            )
            for name in symlinks or ():
                update_symlink(self, name, version, actor=created_by)
            for role, upstream_version in (upstream or {}).items():
                VersionLink.objects.create(
                    from_version=upstream_version, to_version=version, role=role
                )
        return version

    def archive(self):
        """Take the entity out of circulation without touching history."""
        self.archived_at = timezone.now()
        self.save(update_fields=["archived_at", "updated_at"])

    def unarchive(self):
        self.archived_at = None
        self.save(update_fields=["archived_at", "updated_at"])

    @property
    def is_archived(self):
        return self.archived_at is not None


class ContainerManager(EntityTypeManager):
    """Manager for containers with hierarchy helpers (materialized path first)."""

    def __init__(self):
        super().__init__("container")

    def root_containers(self):
        return self.filter(parent_container__isnull=True)

    def get_descendants(self, container, include_self=False):
        qs = self.filter(path__startswith=container.path).order_by("path")
        if not include_self:
            qs = qs.exclude(pk=container.pk)
        return list(qs)

    def get_ancestors(self, container, include_self=False):
        ancestors = list(container.get_ancestors_by_path())
        if include_self:
            ancestors.append(container)
        return ancestors

    def get_descendants_optimized(self, container, max_depth=20, include_self=False, force_method=None):
        if force_method == "cte":
            return self.get_descendants_cte(container, max_depth, include_self)
        return self.get_descendants(container, include_self=include_self)

    def get_descendants_cte(self, container, max_depth=20, include_self=False):
        """Descendants via recursive CTE (parent pointers, not paths)."""
        from django.db import connection

        with connection.cursor() as cursor:
            cursor.execute(
                """
                WITH RECURSIVE container_tree AS (
                    SELECT e.id, e.code, e.name, e.parent_container_id,
                           0 AS level, e.path
                    FROM trackables_versionedentity e
                    WHERE e.id = %s

                    UNION ALL

                    SELECT e.id, e.code, e.name, e.parent_container_id,
                           ct.level + 1, e.path
                    FROM trackables_versionedentity e
                    INNER JOIN container_tree ct ON e.parent_container_id = ct.id
                    WHERE ct.level < %s
                )
                SELECT id, level, path FROM container_tree
                WHERE level > 0 OR %s
                ORDER BY path
                """,
                [container.pk, max_depth, include_self],
            )
            rows = cursor.fetchall()

        containers = {c.pk: c for c in self.filter(pk__in=[r[0] for r in rows])}
        ordered = []
        for pk, level, path in rows:
            obj = containers.get(pk)
            if obj is not None:
                obj._hierarchy_level = level
                obj._hierarchy_path = path
                ordered.append(obj)
        return ordered

    def get_ancestors_cte(self, container, include_self=False):
        ancestors = self.get_ancestors(container, include_self=include_self)
        for level, obj in enumerate(reversed(ancestors)):
            obj._hierarchy_level = level
        return ancestors

    def get_hierarchy_statistics_cte(self, root_container):
        return root_container.get_hierarchy_statistics_by_path()

    def get_tree_with_stats_cte(self, root_container, include_related_counts=True):
        """Tree rows with per-container version/task counts, one round trip."""
        from django.db import connection

        stats_sql = ""
        stats_select = ""
        if include_related_counts:
            stats_sql = """
                , (SELECT COUNT(*) FROM trackables_version v WHERE v.entity_id = e.id) AS version_count
                , (SELECT COUNT(*) FROM trackables_task t WHERE t.container_id = e.id) AS task_count
            """
            stats_select = ", version_count, task_count"

        with connection.cursor() as cursor:
            cursor.execute(
                f"""
                SELECT e.id, e.code, e.name, e.depth, e.path
                       {stats_sql}
                FROM trackables_versionedentity e
                WHERE e.entity_type = 'container'
                  AND e.path LIKE %s || '%%'
                ORDER BY e.path
                """,
                [root_container.path],
            )
            return cursor.fetchall()

    def get_descendants_by_path_bulk(self, containers):
        """Map container.id -> list of descendants, in one query."""
        roots = [c for c in containers if c.path]
        if not roots:
            return {}

        query = Q()
        for c in roots:
            query |= Q(path__startswith=c.path, depth__gt=c.depth)

        result = {c.pk: [] for c in containers}
        for descendant in self.filter(query).order_by("path"):
            for c in roots:
                if descendant.path.startswith(c.path) and descendant.depth > c.depth:
                    result[c.pk].append(descendant)
        return result

    def get_hierarchy_roots_with_stats(self):
        return [
            {"container": root, "stats": root.get_hierarchy_statistics_by_path()}
            for root in self.root_containers()
        ]

    def rebuild_materialized_paths(self, batch_size=500):
        """Recompute every container's path/depth breadth-first."""
        with transaction.atomic():
            processed = 0
            level = list(self.root_containers())
            while level:
                for container in level:
                    container._update_materialized_path()
                self.model.objects.bulk_update(
                    level, ["path", "depth"], batch_size=batch_size
                )
                processed += len(level)
                level = list(
                    self.filter(parent_container__in=level).select_related(
                        "parent_container"
                    )
                )
        return processed


@register_entity_type("container")
class Container(VersionedEntity):
    """Hierarchical grouping of entities; versions pin referenced symlink versions."""

    objects = ContainerManager()

    class Meta:
        proxy = True

    # -- hierarchy (all served by the materialized path) -------------------

    def get_hierarchy_path(self):
        return [p for p in self.path.strip("/").split("/") if p]

    def get_hierarchy_level(self):
        return self.depth

    def _ancestor_paths(self):
        codes = self.get_hierarchy_path()[:-1]
        paths, acc = [], "/"
        for code in codes:
            acc += code + "/"
            paths.append(acc)
        return paths

    def get_ancestors_by_path(self):
        paths = self._ancestor_paths()
        if not paths:
            return Container.objects.none()
        return Container.objects.filter(path__in=paths).order_by("depth")

    def get_descendants_by_path(self):
        return Container.objects.filter(
            path__startswith=self.path, depth__gt=self.depth
        ).order_by("path")

    def get_children_by_path(self):
        return Container.objects.filter(
            path__startswith=self.path, depth=self.depth + 1
        ).order_by("path")

    def get_siblings_by_path(self):
        return Container.objects.filter(
            parent_container=self.parent_container_id
        ).exclude(pk=self.pk).order_by("path")

    def get_all_subcontainers(self):
        return list(self.get_descendants_by_path())

    def get_root_container(self):
        if not self.parent_container_id:
            return self
        return Container.objects.get(path=self._ancestor_paths()[0])

    def is_ancestor_of(self, other):
        return self.is_ancestor_of_by_path(other)

    def is_descendant_of(self, other):
        return self.is_descendant_of_by_path(other)

    def is_ancestor_of_by_path(self, other):
        return (
            other.path.startswith(self.path)
            and other.depth > self.depth
            and other.pk != self.pk
        )

    def is_descendant_of_by_path(self, other):
        return (
            self.path.startswith(other.path)
            and self.depth > other.depth
            and self.pk != other.pk
        )

    def can_move_to(self, new_parent):
        if new_parent is None:
            return True, "Move is valid"
        if new_parent.pk == self.pk:
            return False, "Cannot move container to itself"
        if new_parent.parent_container_id and new_parent.pk == self.parent_container_id:
            pass  # re-parenting to current parent is a no-op but not invalid
        if self.path and new_parent.path.startswith(self.path):
            return False, "Cannot move container to its own descendant"
        return True, "Move is valid"

    def get_hierarchy_statistics_by_path(self):
        descendants = self.get_descendants_by_path()
        return {
            "total_descendants": descendants.count(),
            "max_descendant_depth": descendants.aggregate(
                max_depth=models.Max("depth")
            )["max_depth"]
            or self.depth,
            "depth_distribution": list(
                descendants.values("depth")
                .annotate(count=models.Count("id"))
                .order_by("depth")
            ),
            "leaf_containers": descendants.filter(
                child_containers__isnull=True
            ).count(),
        }


@register_entity_type("media_asset")
class MediaAsset(VersionedEntity):
    """
    Media asset with AI-assisted metadata.

    Descriptive/typed attributes live in ``type_data``; the analysis state
    machine (status/date) and the embedding are real columns.
    """

    objects = EntityTypeManager("media_asset")

    class Meta:
        proxy = True

    # type_data payload
    file_path = json_property("file_path", default="")
    media_type = json_property("media_type", default="")
    ai_generated_description = json_property("ai_generated_description", default="")
    ai_suggested_tags = json_property("ai_suggested_tags", default=[])
    ai_confidence_score = json_property("ai_confidence_score", default=0.0)
    ai_quality_score = json_property("ai_quality_score")
    asset_functional_type = json_property("asset_functional_type", default="")
    asset_structural_type = json_property(
        "asset_structural_type", default="digital.movingImage"
    )
    technical_metadata = json_property("technical_metadata", default={})
    creative_metadata = json_property("creative_metadata", default={})
    production_stage = json_property("production_stage", default="")
    omc_identifiers = json_property("omc_identifiers", default=[])

    def __str__(self):
        return f"{self.code} - {self.name} ({self.media_type})"

    def save(self, *args, **kwargs):
        if not self.ai_analysis_status:
            self.ai_analysis_status = "pending"
        super().save(*args, **kwargs)

    # -- AI analysis --------------------------------------------------------

    async def perform_ai_analysis(self, force_reanalysis=False):
        if not force_reanalysis and self.ai_analysis_status == "completed":
            return self.get_ai_analysis_results()

        if not self.file_path:
            self.ai_analysis_status = "skipped"
            await self.asave()
            return None

        self.ai_analysis_status = "processing"
        await self.asave()

        try:
            from ..services.ai_intelligence import AIAssetIntelligenceService

            ai_service = AIAssetIntelligenceService()
            results = await ai_service.analyze_asset_comprehensive(self)

            self.ai_generated_description = results.get("description", "")
            self.ai_suggested_tags = results.get("tags", [])
            self.ai_confidence_score = results.get("confidence_score", 0.0)
            self.semantic_embedding = results.get("embedding")
            self.asset_functional_type = results.get("suggested_omc_type", "")
            self.technical_metadata = results.get("technical_metadata", {})
            self.creative_metadata = results.get("creative_metadata", {})
            self.production_stage = results.get("production_stage", "")
            self.ai_quality_score = results.get("quality_score")
            self.ai_analysis_date = timezone.now()
            self.ai_analysis_status = "completed"
            await self.asave()
            return results
        except Exception:
            self.ai_analysis_status = "failed"
            await self.asave()
            raise

    def get_ai_analysis_results(self):
        return {
            "description": self.ai_generated_description,
            "tags": self.ai_suggested_tags,
            "confidence_score": self.ai_confidence_score,
            "omc_type": self.asset_functional_type,
            "technical_metadata": self.technical_metadata,
            "creative_metadata": self.creative_metadata,
            "production_stage": self.production_stage,
            "quality_score": self.ai_quality_score,
            "analysis_date": self.ai_analysis_date,
            "status": self.ai_analysis_status,
        }

    @classmethod
    async def semantic_search(cls, query, project_code=None, limit=20, similarity_threshold=0.7):
        """Vector search over analyzed assets, most similar first."""
        from ..services.ai_intelligence import AIAssetIntelligenceService

        ai_service = AIAssetIntelligenceService()
        search_embedding = await ai_service.generate_embedding(query)
        if search_embedding is None:
            return []

        queryset = cls.objects.filter(
            semantic_embedding__isnull=False, ai_analysis_status="completed"
        )
        if project_code:
            queryset = queryset.filter(versions__data__project_code=project_code)

        queryset = (
            queryset.annotate(
                distance=CosineDistance("semantic_embedding", search_embedding)
            )
            .filter(distance__lte=1.0 - similarity_threshold)
            .order_by("distance")[:limit]
        )

        results = [asset async for asset in queryset]
        for asset in results:
            asset.similarity = 1.0 - asset.distance
        return results

    @classmethod
    async def get_recommendations(cls, asset_id, recommendation_type="similar_content", limit=10):
        try:
            current_asset = await cls.objects.aget(pk=asset_id)
        except cls.DoesNotExist:
            return []

        if recommendation_type == "similar_content":
            return await current_asset._get_similar_content_recommendations(limit)
        if recommendation_type == "version_lineage":
            return await current_asset._get_version_lineage_recommendations(limit)
        return []

    async def _get_similar_content_recommendations(self, limit):
        if self.semantic_embedding is None:
            return []
        queryset = (
            MediaAsset.objects.filter(
                semantic_embedding__isnull=False, ai_analysis_status="completed"
            )
            .exclude(pk=self.pk)
            .annotate(
                distance=CosineDistance("semantic_embedding", self.semantic_embedding)
            )
            .order_by("distance")[:limit]
        )
        return [asset async for asset in queryset]

    async def _get_version_lineage_recommendations(self, limit):
        queryset = self.versions.order_by("-version_number")[:limit]
        return [version async for version in queryset]

    async def update_omc_metadata_from_ai(self):
        if self.ai_analysis_status != "completed":
            await self.perform_ai_analysis()

        if self.ai_suggested_tags:
            identifiers = self.omc_identifiers
            identifiers.append(
                {
                    "identifierScope": "ai_generated",
                    "identifierValue": f"ai_{self.code}",
                    "tags": self.ai_suggested_tags[:5],
                }
            )
            self.omc_identifiers = identifiers
        await self.asave()

    # -- type helpers --------------------------------------------------------

    def is_image(self):
        image_types = ["image", "texture", "concept_art", "reference"]
        return (self.media_type or "").lower() in image_types or (
            "artwork" in (self.asset_functional_type or "")
        )

    def is_3d_model(self):
        model_types = ["3d_model", "geometry", "mesh"]
        return (self.media_type or "").lower() in model_types or (
            self.file_path or ""
        ).lower().endswith((".fbx", ".obj", ".glb", ".gltf", ".blend"))

    def is_video(self):
        video_types = ["video", "animation", "sequence", "shot"]
        return (self.media_type or "").lower() in video_types or (
            self.file_path or ""
        ).lower().endswith((".mp4", ".mov", ".avi", ".exr"))

    def get_project_context(self):
        return {
            "project_code": (self.type_data or {}).get("project_code", "unknown"),
            "department": (self.type_data or {}).get("department", "unknown"),
            "production_stage": self.production_stage or "unknown",
        }
