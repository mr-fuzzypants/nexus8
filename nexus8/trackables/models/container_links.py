"""Generic dependency links between versioned entities."""

from django.db import models
from .base import Trackable
from .versions import Version


class DependencyLink(Trackable):
    """
    Generic dependency tracking between any two versions (assets, containers, etc.).

    Models "uses" relationships: Version A uses Version B (e.g., 3D model uses texture,
    board uses scene template). Unlike VersionLink (generative/lineage), this tracks
    compositional/structural dependencies.

    Performance optimized with indexes on common query patterns:
    - Finding what a version uses (source_version_id + relationship_type)
    - Finding what uses a version (target_version_id)
    """

    source_version = models.ForeignKey(
        Version,
        on_delete=models.CASCADE,
        related_name="uses",
        help_text="Version that has the dependency (e.g., the model using a texture)",
    )
    target_version = models.ForeignKey(
        Version,
        on_delete=models.RESTRICT,
        related_name="used_by",
        help_text="Version being used/referenced (pinned for reproducibility)",
    )
    relationship_type = models.CharField(
        max_length=32,
        choices=[
            ("uses", "Uses"),
            ("depends_on", "Depends On"),
            ("imports", "Imports"),
            ("references", "References"),
            ("extends", "Extends"),
        ],
        default="uses",
        db_index=True,
    )
    role = models.CharField(
        max_length=64,
        blank=True,
        help_text='Contextual role: "material", "texture", "library", "template", etc.',
    )

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["source_version", "target_version", "relationship_type"],
                name="unique_dependency_link",
            ),
        ]
        indexes = [
            # Query: "what does version X use?" - most common
            models.Index(fields=["source_version", "relationship_type"]),
            # Query: "what uses version X?" - impact analysis
            models.Index(fields=["target_version"]),
            # Query: "all links of type X" - filtering by type
            models.Index(fields=["relationship_type"]),
        ]

    def __str__(self):
        source = f"{self.source_version.entity.name}_v{self.source_version.version_number}"
        target = f"{self.target_version.entity.name}_v{self.target_version.version_number}"
        return f"{source} {self.relationship_type} {target}"

    def get_all_dependencies_recursive(self, max_depth=10):
        """Get all versions this one depends on (transitively via CTE).

        Args:
            max_depth: Maximum traversal depth (prevents exponential blowup)

        Returns:
            List of tuples: (target_version_id, version_number, entity_code, entity_name,
                           relationship_type, role, depth, dependency_path)
        """
        from django.db import connection

        with connection.cursor() as cursor:
            cursor.execute(
                """
                WITH RECURSIVE dependency_tree AS (
                    SELECT dl.target_version_id, v.version_number,
                           e.code, e.name, e.entity_type,
                           dl.relationship_type, dl.role,
                           0 AS depth,
                           ARRAY[e.code || '_v' || v.version_number::text] AS dependency_path
                    FROM trackables_dependencylink dl
                    JOIN trackables_version v ON dl.target_version_id = v.id
                    JOIN trackables_versionedentity e ON v.entity_id = e.id
                    WHERE dl.source_version_id = %s

                    UNION ALL

                    SELECT dl.target_version_id, v.version_number,
                           e.code, e.name, e.entity_type,
                           dl.relationship_type, dl.role,
                           dt.depth + 1,
                           dt.dependency_path || (e.code || '_v' || v.version_number::text)
                    FROM trackables_dependencylink dl
                    JOIN trackables_version v ON dl.target_version_id = v.id
                    JOIN trackables_versionedentity e ON v.entity_id = e.id
                    INNER JOIN dependency_tree dt ON dl.source_version_id = dt.target_version_id
                    WHERE dt.depth < %s
                )
                SELECT DISTINCT target_version_id, version_number, code, name, entity_type,
                       relationship_type, role, depth, dependency_path
                FROM dependency_tree
                ORDER BY depth, code
                """,
                [self.source_version_id, max_depth],
            )
            return cursor.fetchall()
