"""
Backfill ffprobe technical_metadata onto video assets ingested before probing.

Video assets stored before ingest learned to run ffprobe only carry file_size
(plus whatever width/height the original upload happened to record). The video
annotator needs fps + duration for frame-accurate seeking, so this command
re-probes each video original and merges the result into its live type_data.

    # Backfill every video asset missing fps
    python manage.py backfill_video_metadata

    # Preview without writing, or re-probe everything (even assets that have fps)
    python manage.py backfill_video_metadata --dry-run
    python manage.py backfill_video_metadata --force

Idempotent: assets that already carry fps are skipped unless --force is given.
"""

import os

from django.conf import settings
from django.core.files.storage import default_storage
from django.core.management.base import BaseCommand

from trackables.models import MediaAsset
from trackables.services.ingest import _probe_video_file


class Command(BaseCommand):
    help = "Re-probe video originals and backfill fps/duration/codec metadata."

    def add_arguments(self, parser):
        parser.add_argument(
            "--force",
            action="store_true",
            help="Re-probe even assets that already have fps.",
        )
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Report what would change without writing.",
        )

    def handle(self, *args, **options):
        force = options["force"]
        dry_run = options["dry_run"]

        probed = skipped = failed = updated = 0
        for asset in MediaAsset.objects.filter(archived_at__isnull=True).iterator(
            chunk_size=200
        ):
            if not asset.is_video():
                continue

            data = asset.type_data or {}
            technical = dict(data.get("technical_metadata") or {})
            if technical.get("fps") and not force:
                skipped += 1
                continue

            local_path = self._local_path(data.get("file_path", ""))
            if not local_path:
                self.stdout.write(
                    self.style.WARNING(f"  {asset.code}: original file not found, skipping")
                )
                failed += 1
                continue

            result = _probe_video_file(local_path)
            probed += 1
            if not result:
                self.stdout.write(
                    self.style.WARNING(f"  {asset.code}: ffprobe returned nothing")
                )
                failed += 1
                continue

            merged = {**technical, **result}
            self.stdout.write(
                f"  {asset.code}: fps={result.get('fps')} "
                f"duration={result.get('duration')} frames={result.get('nb_frames')}"
            )
            if dry_run:
                continue

            new_data = dict(data)
            new_data["technical_metadata"] = merged
            asset.type_data = new_data
            asset.save(update_fields=["type_data", "updated_at"])
            updated += 1

        prefix = "[dry-run] " if dry_run else ""
        self.stdout.write(
            self.style.SUCCESS(
                f"{prefix}Probed {probed} video(s): {updated} updated, "
                f"{skipped} already had fps, {failed} failed."
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
