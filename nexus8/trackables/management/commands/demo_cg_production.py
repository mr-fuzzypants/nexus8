"""
Runnable walkthrough of a small CG production on the versioning system.

    python manage.py demo_cg_production

Idempotent: deletes and recreates everything under the DEMO_ code prefix.
"""

from django.core.management.base import BaseCommand
from django.db.models import RestrictedError

from trackables.models import (
    Container,
    MediaAsset,
    SymlinkEvent,
    VersionedEntity,
    bulk_create_versions,
    create_container_hierarchy,
    create_container_version,
    create_task_hierarchy,
    resolve_container_references,
    update_symlink,
)

PREFIX = "DEMO_"


class Command(BaseCommand):
    help = "Demonstrate CG production publishing: hierarchy, versions, symlinks, pinned shot packages."

    def heading(self, text):
        self.stdout.write(self.style.MIGRATE_HEADING(f"\n=== {text} ==="))

    def handle(self, *args, **options):
        self.heading("0. Reset demo data")
        deleted, _ = VersionedEntity.objects.filter(code__startswith=PREFIX).delete()
        self.stdout.write(f"deleted {deleted} rows from previous runs")

        # ------------------------------------------------------------------
        self.heading("1. Build the project hierarchy (one nested dict)")
        create_container_hierarchy(
            {
                "code": f"{PREFIX}FILM",
                "name": "Demo Film",
                "subcontainers": [
                    {
                        "code": f"{PREFIX}ASSETS",
                        "name": "Assets",
                        "subcontainers": [
                            {"code": f"{PREFIX}CHARS", "name": "Characters"},
                            {"code": f"{PREFIX}ENVS", "name": "Environments"},
                        ],
                    },
                    {
                        "code": f"{PREFIX}SEQ010",
                        "name": "Sequence 010",
                        "subcontainers": [
                            {"code": f"{PREFIX}SH0010", "name": "Shot 0010"},
                            {"code": f"{PREFIX}SH0020", "name": "Shot 0020"},
                        ],
                    },
                ],
            }
        )
        film = Container.objects.get(code=f"{PREFIX}FILM")
        for c in [film, *film.get_descendants_by_path()]:
            self.stdout.write(f"{'  ' * c.depth}{c.path}")

        # ------------------------------------------------------------------
        self.heading("2. Publish asset versions (artists working)")
        hero = MediaAsset.objects.create(
            code=f"{PREFIX}HERO",
            name="Hero Character",
            media_type="3d_model",
            file_path="/proj/demo/assets/chars/hero/hero.usd",
        )
        forest = MediaAsset.objects.create(
            code=f"{PREFIX}FOREST",
            name="Forest Environment",
            media_type="3d_model",
            file_path="/proj/demo/assets/envs/forest/forest.usd",
        )

        hero_versions = bulk_create_versions(
            hero,
            [
                {"artist": "mira", "dcc": "maya", "file": "hero_v001.usd", "status": "wip"},
                {"artist": "mira", "dcc": "maya", "file": "hero_v002.usd", "status": "review"},
                {"artist": "mira", "dcc": "maya", "file": "hero_v003.usd", "status": "wip"},
            ],
        )
        forest_versions = bulk_create_versions(
            forest,
            [{"artist": "jun", "dcc": "houdini", "file": "forest_v001.usd", "status": "review"}],
        )

        # Symlinks: mutable pointers the pipeline publishes against.
        update_symlink(hero, "latest", hero_versions[2])     # v3
        update_symlink(hero, "approved", hero_versions[1])   # v2 passed review
        update_symlink(forest, "latest", forest_versions[0])
        update_symlink(forest, "approved", forest_versions[0])
        self.stdout.write(f"{hero.code}: latest -> v3, approved -> v2")
        self.stdout.write(f"{forest.code}: latest -> v1, approved -> v1")

        # ------------------------------------------------------------------
        self.heading("3. Publish the shot package (pins symlink resolutions)")
        shot = Container.objects.get(code=f"{PREFIX}SH0010")
        shot_v1 = create_container_version(
            shot,
            references={
                "hero": (hero, "approved"),
                "environment": (forest, "latest"),
            },
            symlinks=["latest"],
        )
        for name, ref in resolve_container_references(shot_v1).items():
            self.stdout.write(
                f"{shot.code} v{shot_v1.version_number} pins {name} = "
                f"{ref['entity'].code} v{ref['version_at_creation'].version_number} "
                f"(via '{ref['symlink_name']}')"
            )

        # ------------------------------------------------------------------
        self.heading("4. Work continues: hero v4 lands via publish(), symlinks move")
        hero.publish(
            {"artist": "mira", "dcc": "maya", "file": "hero_v004.usd", "status": "review"},
            symlinks=["latest", "approved"],
            content_hash="sha256:hero4...aa",
        )
        self.stdout.write(f"{hero.code}: latest -> v4, approved -> v4")

        self.stdout.write("\nThe shot package is UNCHANGED (that's the reproducibility guarantee):")
        for name, ref in resolve_container_references(shot_v1).items():
            marker = "current" if ref["is_current"] else "OUTDATED"
            self.stdout.write(
                f"  {name}: pinned v{ref['version_at_creation'].version_number}, "
                f"symlink now points at v{ref['current_version'].version_number} [{marker}]"
            )

        # ------------------------------------------------------------------
        self.heading("5. Publish shot v2 to adopt the approved update")
        shot_v2 = create_container_version(
            shot,
            references={
                "hero": (hero, "approved"),
                "environment": (forest, "latest"),
            },
            symlinks=["latest"],
        )
        for version in (shot_v1, shot_v2):
            pins = {
                name: f"v{ref['version_at_creation'].version_number}"
                for name, ref in resolve_container_references(version).items()
            }
            self.stdout.write(f"{shot.code} v{version.version_number}: {pins}")
        self.stdout.write("Both package versions remain resolvable forever.")

        # ------------------------------------------------------------------
        self.heading("6. Attach a task tree to the shot")
        (anim_task,) = create_task_hierarchy(
            shot,
            {
                "title": "Shot 0010 animation",
                "task_type": "feature",
                "subtasks": [
                    {"title": "Blocking", "assigned_to": "mira"},
                    {"title": "Polish", "assigned_to": "mira"},
                ],
            },
            assigned_to="mira",
        )
        blocking = anim_task.subtasks.get(title="Blocking")
        blocking.mark_completed()
        self.stdout.write(
            f"'{anim_task.title}': {anim_task.get_completion_percentage():.0f}% complete "
            f"(can close: {anim_task.can_be_completed()})"
        )

        # ------------------------------------------------------------------
        self.heading("7. Reorganize: move SH0020 into a new sequence (one UPDATE)")
        seq020 = Container.objects.create(
            code=f"{PREFIX}SEQ020", name="Sequence 020", parent_container=film
        )
        sh0020 = Container.objects.get(code=f"{PREFIX}SH0020")
        sh0020.parent_container = seq020
        sh0020.save()
        sh0020.refresh_from_db()
        self.stdout.write(f"{sh0020.code} now at {sh0020.path} (depth {sh0020.depth})")

        # ------------------------------------------------------------------
        self.heading("8. One polymorphic query over everything")
        for entity in VersionedEntity.objects.filter(code__startswith=PREFIX).order_by(
            "entity_type", "code"
        ):
            self.stdout.write(
                f"{entity.entity_type:>12}  {entity.code:<14} ({type(entity).__name__})"
            )

        # ------------------------------------------------------------------
        self.heading("9. Guardrails: pinned history cannot be deleted")
        try:
            hero.delete()
            self.stdout.write("ERROR: delete should have been blocked!")
        except RestrictedError:
            self.stdout.write(
                f"deleting {hero.code} blocked — shot packages pin its versions; "
                "archive() is the supported way to retire it"
            )

        self.heading("10. Symlink audit trail for the hero asset")
        for event in SymlinkEvent.objects.filter(entity=hero).order_by("created_at"):
            self.stdout.write(f"  {event.created_at:%H:%M:%S}  {event}")

        self.stdout.write(self.style.SUCCESS("\nCG production demo complete."))
