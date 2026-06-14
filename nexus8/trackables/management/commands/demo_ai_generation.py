"""
Runnable walkthrough of a tracked AI image/video generation workflow.

    python manage.py demo_ai_generation

Demonstrates the new generation entity types (added as proxies — zero
migrations) and full output provenance: every generated frame traces back to
the exact checkpoint/LoRA/prompt/recipe versions used, even after the team
moves on to newer versions.

Idempotent: deletes and recreates everything under the AIGEN_ code prefix.
"""

import json
import random

from django.core.exceptions import ValidationError
from django.core.management.base import BaseCommand
from django.db.models import RestrictedError

from trackables.models import (
    GENERATED_FROM_BATCH,
    Container,
    GenerationRecipe,
    LoraAdapter,
    MediaAsset,
    ModelCheckpoint,
    PromptTemplate,
    SymlinkEvent,
    VersionedEntity,
    create_container_version,
    reproduction_manifest,
    resolve_container_references,
    update_symlink,
)

PREFIX = "AIGEN_"


class Command(BaseCommand):
    help = "Demonstrate reproducible AI generation tracking: ingredients, pinned batches, output provenance."

    def heading(self, text):
        self.stdout.write(self.style.MIGRATE_HEADING(f"\n=== {text} ==="))

    def handle(self, *args, **options):
        rng = random.Random(42)

        self.heading("0. Reset demo data")
        deleted, _ = VersionedEntity.objects.filter(code__startswith=PREFIX).delete()
        self.stdout.write(f"deleted {deleted} rows from previous runs")

        # ------------------------------------------------------------------
        self.heading("1. Register the ingredients (each a versioned entity)")

        checkpoint = ModelCheckpoint.objects.create(
            code=f"{PREFIX}WANX_T2V",
            name="WanX Text-to-Video",
            model_family="wanx",
            modality="video",
            parameter_count="14B",
            license="research",
        )
        # publish() = version-number allocation under lock + payload schema
        # validation + symlink moves + lineage, in one transaction.
        ckpt_v1 = checkpoint.publish(
            {"weights_file": "wanx_t2v_14b_fp16.safetensors"},
            symlinks=["latest", "approved"],
            content_hash="sha256:a3f1...9c",
        )
        ckpt_v2 = checkpoint.publish(
            {"weights_file": "wanx_t2v_14b_v2_fp8.safetensors"},
            symlinks=["latest"],  # approved stays on v1 until validated
            content_hash="sha256:77be...01",
        )

        lora = LoraAdapter.objects.create(
            code=f"{PREFIX}HOUSE_STYLE",
            name="Studio House Style LoRA",
            base_family="wanx",
            trigger_words=["hstyle"],
            strength_default=0.8,
        )
        lora.publish(
            {"file": "house_style_v1.safetensors", "trained_on": "moodboard-2026-05", "steps": 4000},
            content_hash="sha256:bb12...7d",
        )

        prompt = PromptTemplate.objects.create(
            code=f"{PREFIX}FOREST_FLYTHROUGH",
            name="Forest Flythrough Prompt",
            variables=["time_of_day", "mood"],
        )
        prompt_v1 = prompt.publish(
            {
                "template": (
                    "hstyle, cinematic drone flythrough of an ancient forest at "
                    "{time_of_day}, {mood} atmosphere, volumetric light, 24fps"
                )
            },
        )

        recipe = GenerationRecipe.objects.create(
            code=f"{PREFIX}VIDEO_HQ",
            name="High-Quality Video Recipe",
            engine="comfyui",
            engine_version="0.3.30",
        )
        recipe.publish(
            {
                "sampler": "euler_a",
                "steps": 30,
                "cfg": 6.5,
                "resolution": [1280, 720],
                "frames": 96,
                "fps": 24,
                "lora_strength": 0.8,
            },
        )

        for entity in (checkpoint, lora, prompt, recipe):
            self.stdout.write(f"{entity.entity_type:>17}  {entity.code} ({type(entity).__name__})")

        # ------------------------------------------------------------------
        self.heading("2. Publish a generation batch (pins every ingredient)")
        project = Container.objects.create(code=f"{PREFIX}PROJECT", name="Gen Project")
        batches = Container.objects.create(
            code=f"{PREFIX}BATCHES", name="Generation Batches", parent_container=project
        )
        batch = Container.objects.create(
            code=f"{PREFIX}BATCH_001", name="Forest Flythrough Batch 1", parent_container=batches
        )

        batch_v1 = create_container_version(
            batch,
            references={
                "checkpoint": (checkpoint, "approved"),
                "lora": (lora, "latest"),
                "prompt": (prompt, "latest"),
                "recipe": (recipe, "latest"),
            },
            symlinks=["latest"],
        )
        for name, ref in resolve_container_references(batch_v1).items():
            self.stdout.write(
                f"{batch.code} v1 pins {name:<10} = {ref['entity'].code} "
                f"v{ref['version_at_creation'].version_number} (via '{ref['symlink_name']}')"
            )

        # ------------------------------------------------------------------
        self.heading("3. Run the batch: 3 outputs, provenance recorded per output")
        prompt_vars = {"time_of_day": "dawn", "mood": "mysterious"}
        rendered = prompt.render(prompt_v1, **prompt_vars)
        self.stdout.write(f"rendered prompt: {rendered[:70]}...")

        outputs = []
        for i in range(1, 4):
            seed = rng.randrange(2**32)
            output = MediaAsset.objects.create(
                code=f"{PREFIX}OUT_{i:03d}",
                name=f"Forest Flythrough take {i}",
                media_type="video",
                file_path=f"/proj/gen/batch_001/take_{i:03d}.mp4",
                production_stage="generated",
            )
            # The lineage edge (not a JSON id) ties output -> batch version;
            # it also RESTRICT-protects the batch from deletion.
            output_version = output.publish(
                {
                    "file": output.file_path,
                    "generation": {
                        "seed": seed,
                        "prompt_variables": prompt_vars,
                        "rendered_prompt": rendered,
                    },
                },
                upstream={GENERATED_FROM_BATCH: batch_v1},
                content_hash=f"sha256:take{i:03d}fake",
            )
            outputs.append(output_version)
            self.stdout.write(f"generated {output.code} v1 (seed={seed})")

        # ------------------------------------------------------------------
        self.heading("4. Time passes: every symlink moves to newer versions")
        lora.publish(
            {"file": "house_style_v2.safetensors", "trained_on": "moodboard-2026-06", "steps": 6000},
            content_hash="sha256:cc89...3e",
        )
        update_symlink(checkpoint, "approved", ckpt_v2)
        prompt.publish(
            {"template": "hstyle, sweeping aerial of an ancient forest at {time_of_day}, {mood}, 24fps"},
        )
        self.stdout.write("moved: lora latest -> v2, checkpoint approved -> v2, prompt latest -> v2")

        outdated = [
            f"{name} (pinned v{ref['version_at_creation'].version_number}, "
            f"now v{ref['current_version'].version_number})"
            for name, ref in resolve_container_references(batch_v1).items()
            if not ref["is_current"]
        ]
        self.stdout.write(f"batch v1 pins now outdated for: {', '.join(outdated)}")

        # ------------------------------------------------------------------
        self.heading("5. Reproduce take 2 anyway — the manifest is frozen")
        manifest = reproduction_manifest(outputs[1])
        self.stdout.write(json.dumps(manifest, indent=2, default=str))

        # ------------------------------------------------------------------
        self.heading("6. Publish batch 2 to adopt the new ingredients")
        batch2 = Container.objects.create(
            code=f"{PREFIX}BATCH_002", name="Forest Flythrough Batch 2", parent_container=batches
        )
        batch_v2 = create_container_version(
            batch2,
            references={
                "checkpoint": (checkpoint, "approved"),
                "lora": (lora, "latest"),
                "prompt": (prompt, "latest"),
                "recipe": (recipe, "latest"),
            },
            symlinks=["latest"],
        )
        self.stdout.write("ingredient pin diff between batches:")
        pins1 = resolve_container_references(batch_v1)
        pins2 = resolve_container_references(batch_v2)
        for name in pins1:
            v_old = pins1[name]["version_at_creation"].version_number
            v_new = pins2[name]["version_at_creation"].version_number
            change = f"v{v_old} -> v{v_new}" if v_old != v_new else f"v{v_old} (unchanged)"
            self.stdout.write(f"  {name:<10} {change}")

        # ------------------------------------------------------------------
        self.heading("7. Guardrails: history is protected, payloads validated")
        try:
            lora.delete()
            self.stdout.write("ERROR: delete should have been blocked!")
        except RestrictedError:
            self.stdout.write(
                f"deleting {lora.code} blocked (its versions are pinned by batch history)"
            )
            lora.archive()
            self.stdout.write(
                f"archived instead: is_archived={lora.is_archived} "
                f"(active LoRAs now: {LoraAdapter.objects.active().count()})"
            )
        try:
            batch_v1.delete()
            self.stdout.write("ERROR: delete should have been blocked!")
        except RestrictedError:
            self.stdout.write(
                f"deleting {batch.code} v1 blocked (generated outputs link to it)"
            )
        try:
            recipe.publish({"steps": 30})  # missing sampler/cfg
            self.stdout.write("ERROR: invalid payload should have been rejected!")
        except ValidationError as exc:
            self.stdout.write(f"invalid recipe payload rejected: {exc.messages[0]}")

        # ------------------------------------------------------------------
        self.heading("8. Symlink audit trail (who moved what, when)")
        for event in SymlinkEvent.objects.filter(
            entity__in=[checkpoint, lora, prompt]
        ).order_by("created_at"):
            self.stdout.write(f"  {event.created_at:%H:%M:%S}  {event}")

        # ------------------------------------------------------------------
        self.heading("9. The whole workflow in one polymorphic query")
        for entity in VersionedEntity.objects.filter(code__startswith=PREFIX).order_by(
            "entity_type", "code"
        ):
            self.stdout.write(
                f"{entity.entity_type:>17}  {entity.code:<22} ({type(entity).__name__})"
            )

        self.stdout.write(self.style.SUCCESS("\nAI generation demo complete."))
