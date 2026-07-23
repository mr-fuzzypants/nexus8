from django.db import migrations


def backfill_entity_version(apps, schema_editor):
    EntityRelation = apps.get_model("trackables", "EntityRelation")
    Version = apps.get_model("trackables", "Version")

    qs = EntityRelation.objects.filter(entity_version__isnull=True).select_related("entity")
    for rel in qs.iterator():
        latest = (
            Version.objects
            .filter(entity=rel.entity)
            .order_by("-version_number")
            .first()
        )
        if latest is not None:
            rel.entity_version = latest
            rel.entity_version_number = latest.version_number
            rel.save(update_fields=["entity_version", "entity_version_number"])


class Migration(migrations.Migration):
    dependencies = [
        ("trackables", "0011_entityrelation_entity_version"),
    ]

    operations = [
        migrations.RunPython(backfill_entity_version, migrations.RunPython.noop),
    ]
