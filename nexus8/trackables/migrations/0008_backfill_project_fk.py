# Backfill the project FK from the legacy type_data.project_code, then drop the
# JSON key so there is a single source of truth.
#
# Only codes that resolve to an existing project row are migrated (the FK
# constraint would reject dangling codes); unresolved codes are left in
# type_data and logged, so nothing is silently lost.

from django.db import migrations


def forwards(apps, schema_editor):
    Entity = apps.get_model('trackables', 'VersionedEntity')

    valid_codes = set(
        Entity.objects.filter(entity_type='project').values_list('code', flat=True)
    )

    migrated = dangling = 0
    # Rows whose type_data carries a (non-null) project_code.
    rows = Entity.objects.exclude(type_data__project_code=None).iterator(chunk_size=500)
    for row in rows:
        data = dict(row.type_data or {})
        code = data.get('project_code')
        if not code:
            continue
        if code not in valid_codes:
            dangling += 1
            continue
        row.project_id = code
        data.pop('project_code', None)
        row.type_data = data
        row.save(update_fields=['project', 'type_data'])
        migrated += 1

    if dangling:
        print(
            f"  [0008] backfilled {migrated} row(s); left {dangling} row(s) with a "
            f"project_code pointing at no existing project."
        )


def backwards(apps, schema_editor):
    Entity = apps.get_model('trackables', 'VersionedEntity')
    for row in Entity.objects.exclude(project_id=None).iterator(chunk_size=500):
        data = dict(row.type_data or {})
        data['project_code'] = row.project_id
        row.type_data = data
        row.project_id = None
        row.save(update_fields=['project', 'type_data'])


class Migration(migrations.Migration):

    dependencies = [
        ('trackables', '0007_versionedentity_project'),
    ]

    operations = [
        migrations.RunPython(forwards, backwards),
    ]
