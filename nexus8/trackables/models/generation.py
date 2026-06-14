"""
Entity types for AI image/video generation workflows.

All four types are proxies over VersionedEntity — adding them required no
migration. The reproducibility model mirrors CG publishing:

- Each ingredient (checkpoint, LoRA, prompt template, recipe) is a versioned
  entity with symlinks like ``latest``/``approved``.
- A *generation batch* is a plain ``Container``; publishing a batch creates a
  ContainerVersion whose references PIN the ingredient versions the symlinks
  resolved to at that moment.
- Each generated output is a ``MediaAsset`` whose Version.data records the
  batch version id and the seed — so any output can be traced back to the
  exact pinned ingredient set with :func:`reproduction_manifest`.
"""

from .base import EntityTypeManager, json_property, register_entity_type, require_keys
from .entities import VersionedEntity

# Lineage role linking a generated output version to the batch container
# version that produced it (see VersionLink).
GENERATED_FROM_BATCH = "generated_from_batch"


@register_entity_type("model_checkpoint", version_payload=require_keys("weights_file"))
class ModelCheckpoint(VersionedEntity):
    """A diffusion / video model checkpoint. Versions track weight releases."""

    objects = EntityTypeManager("model_checkpoint")

    class Meta:
        proxy = True

    model_family = json_property("model_family", default="")
    modality = json_property("modality", default="image")  # image | video
    parameter_count = json_property("parameter_count", default="")
    source_url = json_property("source_url", default="")
    license = json_property("license", default="")


@register_entity_type("lora_adapter", version_payload=require_keys("file"))
class LoraAdapter(VersionedEntity):
    """A LoRA / fine-tune adapter. Versions track training runs."""

    objects = EntityTypeManager("lora_adapter")

    class Meta:
        proxy = True

    base_family = json_property("base_family", default="")
    trigger_words = json_property("trigger_words", default=[])
    strength_default = json_property("strength_default", default=1.0)


@register_entity_type("prompt_template", version_payload=require_keys("template"))
class PromptTemplate(VersionedEntity):
    """A parameterized prompt. Versions track wording iterations."""

    objects = EntityTypeManager("prompt_template")

    class Meta:
        proxy = True

    variables = json_property("variables", default=[])

    def render(self, version, **variables):
        """Render a specific version's template text with variables."""
        template = version.data.get("template", "")
        return template.format(**variables)


@register_entity_type(
    "generation_recipe", version_payload=require_keys("sampler", "steps", "cfg")
)
class GenerationRecipe(VersionedEntity):
    """
    Engine + sampler settings. Versions hold the full parameter set
    (steps, cfg, sampler, resolution, fps, ...) in Version.data.
    """

    objects = EntityTypeManager("generation_recipe")

    class Meta:
        proxy = True

    engine = json_property("engine", default="")
    engine_version = json_property("engine_version", default="")


def reproduction_manifest(output_version):
    """
    Everything needed to regenerate an output, derived from its version row.

    Walks the lineage edge: output Version -> generation batch
    ContainerVersion -> pinned ingredient versions. The manifest is stable
    even after symlinks move, because container references pin versions at
    publish time, and the lineage edge is RESTRICT-protected against the
    batch version being deleted while outputs exist.
    """
    link = (
        output_version.upstream_links.filter(role=GENERATED_FROM_BATCH)
        .select_related("from_version__entity")
        .first()
    )
    if link is None:
        raise ValueError(
            f"Version {output_version.pk} has no '{GENERATED_FROM_BATCH}' lineage "
            "link; not an AI-generated output."
        )

    generation = output_version.data.get("generation", {})
    batch_version = link.from_version
    ingredients = {}
    for ref in batch_version.references.select_related(
        "referenced_entity", "symlink_version"
    ):
        entity = ref.referenced_entity
        pinned = ref.symlink_version
        ingredients[ref.reference_name] = {
            "code": entity.code,
            "entity_type": entity.entity_type,
            "symlink_used": ref.symlink_name,
            "pinned_version": pinned.version_number,
            "pinned_version_id": pinned.pk,
            "content_hash": pinned.content_hash,
            "version_data": pinned.data,
            "entity_payload": entity.type_data,
        }

    return {
        "output": {
            "code": output_version.entity.code,
            "version": output_version.version_number,
            "seed": generation.get("seed"),
            "prompt_variables": generation.get("prompt_variables", {}),
            "file": output_version.data.get("file"),
            "content_hash": output_version.content_hash,
        },
        "batch": {
            "code": batch_version.entity.code,
            "version": batch_version.version_number,
            "published_at": batch_version.created_at.isoformat(),
        },
        "ingredients": ingredients,
    }
