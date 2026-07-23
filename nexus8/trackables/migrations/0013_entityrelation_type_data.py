from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("trackables", "0012_backfill_entity_version"),
    ]

    operations = [
        migrations.AddField(
            model_name="entityrelation",
            name="type_data",
            field=models.JSONField(blank=True, default=dict),
        ),
    ]
