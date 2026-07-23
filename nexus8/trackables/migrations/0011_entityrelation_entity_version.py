from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [
        ("trackables", "0010_entityrelation_asset_version"),
    ]

    operations = [
        migrations.AddField(
            model_name="entityrelation",
            name="entity_version",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="entity_version_relations",
                to="trackables.version",
            ),
        ),
        migrations.AddField(
            model_name="entityrelation",
            name="entity_version_number",
            field=models.IntegerField(blank=True, db_index=True, null=True),
        ),
    ]
