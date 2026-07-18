from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ("trackables", "0009_workflow_intent_models"),
    ]

    operations = [
        migrations.AddField(
            model_name="entityrelation",
            name="asset_version",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="entity_relations",
                to="trackables.version",
            ),
        ),
    ]
