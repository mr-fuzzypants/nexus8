"""
Seed a small dependency graph so the dependency/impact graph view has data.

Wires DependencyLink edges between existing entity versions, forming a 2-level
DAG with a shared leaf so the recursive graph endpoint returns something
interesting. Idempotent (uses get_or_create).

Usage:
    python manage.py seed_dependency_links
    python manage.py seed_dependency_links --count 6
    python manage.py seed_dependency_links --clear
"""

from django.core.management.base import BaseCommand
from django.db import transaction

from trackables.models import DependencyLink, Version, VersionedEntity


class Command(BaseCommand):
    help = "Seed DependencyLink edges between entity versions for the graph view"

    def add_arguments(self, parser):
        parser.add_argument(
            "--count",
            type=int,
            default=5,
            help="Number of entities to wire into the demo graph (min 4)",
        )
        parser.add_argument(
            "--clear",
            action="store_true",
            help="Delete all DependencyLink rows before seeding",
        )
        parser.add_argument(
            "--root-asset-id",
            type=int,
            default=None,
            help=(
                "Root the demo graph on this MediaAsset and wire it to other "
                "thumbnailed media assets (realistic, UI-visible demo)"
            ),
        )

    def _version_for(self, entity):
        """Return the entity's latest version, publishing v1 if it has none."""
        version = entity.versions.order_by("-version_number").first()
        if version is None:
            entity.publish()
            version = entity.versions.order_by("-version_number").first()
        return version

    def _media_asset_entities(self, root_asset_id, count):
        """Root asset first, then other media assets (thumbnailed ones preferred)."""
        from trackables.models import MediaAsset

        root = MediaAsset.objects.active().filter(pk=root_asset_id).first()
        if root is None:
            return []

        def has_thumb(asset):
            td = asset.type_data or {}
            return bool(td.get("thumbnails") or td.get("file_path"))

        others = [
            a
            for a in MediaAsset.objects.active().exclude(pk=root_asset_id).order_by("id")
            if has_thumb(a)
        ]
        return [root, *others[: max(0, count - 1)]]

    @transaction.atomic
    def handle(self, *args, **options):
        if options["clear"]:
            deleted, _ = DependencyLink.objects.all().delete()
            self.stdout.write(self.style.WARNING(f"Cleared {deleted} dependency link(s)."))

        count = max(4, options["count"])
        root_asset_id = options["root_asset_id"]
        if root_asset_id is not None:
            entities = self._media_asset_entities(root_asset_id, count)
        else:
            entities = list(
                VersionedEntity.objects.filter(archived_at__isnull=True).order_by("id")[:count]
            )
        if len(entities) < 4:
            self.stderr.write(
                self.style.ERROR(
                    f"Need at least 4 entities to seed a graph; found {len(entities)}. "
                    "Create some assets/entities first."
                )
            )
            return

        versions = [self._version_for(e) for e in entities]
        root = versions[0]
        a, b, c = versions[1], versions[2], versions[3]
        extras = versions[4:]

        # A small DAG: root uses A and B; A imports C; B references C (shared leaf).
        plan = [
            (root, a, "uses", "texture"),
            (root, b, "depends_on", "library"),
            (a, c, "imports", "module"),
            (b, c, "references", "template"),
        ]
        # Chain any extras off C so depth grows: C extends extra[0] extends extra[1]...
        prev = c
        for extra in extras:
            plan.append((prev, extra, "extends", "base"))
            prev = extra

        created = 0
        for source, target, rel_type, role in plan:
            if source.entity_id == target.entity_id:
                continue  # mirror the create_link self-reference guard
            _, was_created = DependencyLink.objects.get_or_create(
                source_version=source,
                target_version=target,
                relationship_type=rel_type,
                defaults={"role": role},
            )
            created += int(was_created)

        self.stdout.write(
            self.style.SUCCESS(
                f"Seeded {created} new link(s) across {len(versions)} versions."
            )
        )
        self.stdout.write(
            f"Root version id: {root.id}  ({root.entity.name} v{root.version_number})"
        )
        self.stdout.write(f"View: /graph/{root.id}   (direction=downstream)")
        self.stdout.write(
            f"API:  /trackables/api/dependency-links/graph/?version_id={root.id}"
        )
