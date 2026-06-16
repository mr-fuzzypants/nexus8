"""
Assign existing entities/assets to a project (hard-partition backfill).

Rows created before projects existed have no ``type_data.project_code`` and so
appear in no project. This command stamps a project code onto every such row.

    # Move all unscoped entities + assets into a new "Unsorted" project
    python manage.py backfill_project

    # Target an existing project, and preview without writing
    python manage.py backfill_project --project project_crimson_ab12cd --dry-run

    # Limit which entity types get backfilled
    python manage.py backfill_project --types entity,media_asset,board

Idempotent: rows that already carry a project_code are left untouched.
"""

import uuid

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.db.models import Count

from trackables.models import Project, VersionedEntity
from trackables.views_intelligence import _slug

DEFAULT_TYPES = ["entity", "media_asset"]


class Command(BaseCommand):
    help = "Assign entities/assets with no project_code to a project."

    def add_arguments(self, parser):
        parser.add_argument(
            "--project",
            dest="project",
            help="Code of an existing project to assign rows to. "
            "If omitted, a project is created from --name.",
        )
        parser.add_argument(
            "--name",
            dest="name",
            default="Unsorted",
            help="Name for the project created when --project is omitted (default: Unsorted).",
        )
        parser.add_argument(
            "--types",
            dest="types",
            default=",".join(DEFAULT_TYPES),
            help=f"Comma-separated entity_types to backfill (default: {','.join(DEFAULT_TYPES)}).",
        )
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Report what would change without writing.",
        )

    def handle(self, *args, **options):
        entity_types = [t.strip() for t in options["types"].split(",") if t.strip()]
        if not entity_types:
            raise CommandError("--types must name at least one entity_type")
        dry_run = options["dry_run"]

        project = self._resolve_project(options, dry_run)
        project_code = project.code if project else f"<new:{_slug(options['name'])}>"

        # Unscoped = no project_code key, or an empty/blank value.
        candidates = (
            VersionedEntity.objects.filter(entity_type__in=entity_types)
            .filter(archived_at__isnull=True)
            .exclude(type_data__has_key="project_code")
        )

        total = candidates.count()
        by_type = {
            row["entity_type"]: row["n"]
            for row in candidates.values("entity_type").annotate(n=Count("id"))
        }

        self.stdout.write(
            f"{'[dry-run] ' if dry_run else ''}Backfilling {total} unscoped row(s) "
            f"into project '{project_code}':"
        )
        for etype in entity_types:
            self.stdout.write(f"  {etype}: {by_type.get(etype, 0)}")

        if dry_run or total == 0:
            if total == 0:
                self.stdout.write(self.style.SUCCESS("Nothing to backfill."))
            return

        updated = 0
        with transaction.atomic():
            for entity in candidates.iterator(chunk_size=500):
                data = dict(entity.type_data or {})
                data["project_code"] = project.code
                entity.type_data = data
                entity.save(update_fields=["type_data", "updated_at"])
                updated += 1

        self.stdout.write(
            self.style.SUCCESS(f"Assigned {updated} row(s) to project '{project.code}'.")
        )

    def _resolve_project(self, options, dry_run):
        code = options.get("project")
        if code:
            project = Project.objects.filter(code=code).first()
            if not project:
                raise CommandError(f"No project with code '{code}'")
            return project

        name = options["name"].strip() or "Unsorted"
        if dry_run:
            # Don't create anything on a dry run; reuse an existing match if present.
            return Project.objects.filter(name=name).first()

        project = Project.objects.create(
            code=f"project_{_slug(name)}_{uuid.uuid4().hex[:6]}",
            name=name,
            type_data={"status": "active"},
        )
        self.stdout.write(f"Created project '{project.name}' ({project.code})")
        return project
