"""
Backfill filmstrip sprite sheets onto videos ingested before sprite generation.

The annotator's timeline draws slices of a precomputed tiled poster sheet for
instant thumbnails (see ``_build_video_sprite``). Videos ingested before that
existed carry no ``sprite`` manifest, so their strips fall back to slower
client-side seeking. This command renders the sheet for each such video and
merges the manifest into its live type_data.

    # Backfill every video asset missing a sprite
    python manage.py backfill_video_sprites

    # Preview without writing, or re-render everything (even assets with a sprite)
    python manage.py backfill_video_sprites --dry-run
    python manage.py backfill_video_sprites --force

Requires ffmpeg on PATH and width/height/duration in technical_metadata (run
backfill_video_metadata first if those are missing). Idempotent: assets that
already carry a sprite are skipped unless --force is given.
"""

import os

from django.conf import settings
from django.core.files.storage import default_storage
from django.core.management.base import BaseCommand

from trackables.models import MediaAsset
from trackables.services.ingest import _build_video_sprite


class Command(BaseCommand):
    help = "Render filmstrip sprite sheets for videos missing one."

    def add_arguments(self, parser):
        parser.add_argument(
            "--force",
            action="store_true",
            help="Re-render even assets that already have a sprite.",
        )
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Report what would change without writing.",
        )

    def handle(self, *args, **options):
        force = options["force"]
        dry_run = options["dry_run"]

        built = skipped = failed = updated = 0
        for asset in MediaAsset.objects.filter(archived_at__isnull=True).iterator(
            chunk_size=200
        ):
            if not asset.is_video():
                continue

            data = asset.type_data or {}
            technical = dict(data.get("technical_metadata") or {})
            if technical.get("sprite") and not force:
                skipped += 1
                continue

            file_path = data.get("file_path", "")
            local_path = self._local_path(file_path)
            if not local_path:
                self.stdout.write(
                    self.style.WARNING(f"  {asset.code}: original file not found, skipping")
                )
                failed += 1
                continue

            # The sprite filename is content-addressed like the original, whose
            # basename (sans extension) is the sha256 hash the ingest used.
            content_hash = os.path.splitext(os.path.basename(local_path))[0]
            if dry_run:
                self.stdout.write(f"  {asset.code}: would render sprite")
                built += 1
                continue

            sprite = _build_video_sprite(local_path, content_hash, technical)
            built += 1
            if not sprite:
                self.stdout.write(
                    self.style.WARNING(
                        f"  {asset.code}: sprite render failed "
                        "(missing ffmpeg or width/height/duration?)"
                    )
                )
                failed += 1
                continue

            self.stdout.write(
                f"  {asset.code}: {sprite['count']} tiles "
                f"({sprite['columns']}x{sprite['rows']}, every {sprite['interval']:.2f}s)"
            )
            technical["sprite"] = sprite
            new_data = dict(data)
            new_data["technical_metadata"] = technical
            asset.type_data = new_data
            asset.save(update_fields=["type_data", "updated_at"])
            updated += 1

        prefix = "[dry-run] " if dry_run else ""
        self.stdout.write(
            self.style.SUCCESS(
                f"{prefix}Rendered {built} sprite(s): {updated} updated, "
                f"{skipped} already had one, {failed} failed."
            )
        )

    def _local_path(self, file_path):
        """Map a stored file_path URL back to a local filesystem path, if any."""
        if not file_path:
            return None
        rel = file_path
        media_url = settings.MEDIA_URL or ""
        if media_url and rel.startswith(media_url):
            rel = rel[len(media_url):]
        rel = rel.lstrip("/")
        try:
            local_path = default_storage.path(rel)
        except (NotImplementedError, ValueError, AttributeError):
            return None
        return local_path if os.path.exists(local_path) else None
