"""
Layer render storage: the versions × variations model (see LAYER_RENDER_SCHEMA.md).

One render asset per (source asset, mask layer), related to the source via
``EntityRelation(role="layer_render")`` whose ``type_data.layer_id`` scopes it
to the layer. Each generation run occupies one ``version_number``; each
parallel candidate the run returns is a ``variation_number`` under it
(``vN.M``). Every variation's ``Version.data`` carries a self-contained
``generation`` provenance record, and ``VersionLink`` edges pin the exact
source-image and guide-map versions that produced it. The artist's chosen
render is the ``selected`` symlink on the render asset.

Entry-point rule (SRED finding F12): lookups start from the FK-indexed
``EntityRelation (asset, role)`` edge and match ``layer_id`` over the per-layer
row set in memory — never from ``MediaAsset.type_data`` JSONB filters.
"""

from django.core.files.uploadedfile import SimpleUploadedFile
from django.db import transaction
from django.db.models import Max

from ..models import EntityRelation, MediaAsset
from ..models.entities import VersionedEntity
from ..models.versions import Symlink, Version, update_symlink
from .ingest import add_version

RENDER_ROLE = "layer_render"
INIT_IMAGE_ROLE = "init_image"
SELECTED_SYMLINK = "selected"


def find_layer_relation(source, layer_id, role=RENDER_ROLE):
    """The layer's relation of the given role, entered via (asset, role)."""
    for relation in EntityRelation.objects.filter(
        asset=source, role=role
    ).select_related("entity"):
        if relation.type_data.get("layer_id") == layer_id:
            return relation
    return None


def get_render_asset(source, layer_id):
    """The layer's render asset, or None if no run has been stored yet."""
    relation = find_layer_relation(source, layer_id)
    return relation.entity if relation else None


def _get_or_create_render_asset(source, layer_id, *, layer_name=None):
    relation = find_layer_relation(source, layer_id)
    if relation is not None:
        return relation.entity, relation

    # Deterministic code makes concurrent first-run stores converge on one
    # row. The full layer UUID is the distinguishing key — truncating it
    # would collide layers sharing a prefix (code is CharField(64): "render_"
    # + pk + "_" + 36-char uuid fits for any pk up to 10^19).
    asset, _ = MediaAsset.objects.get_or_create(
        code=f"render_{source.pk}_{layer_id}",
        defaults={
            "name": f"{source.name} — {layer_name or 'layer'} renders",
            "type_data": {
                "asset_functional_type": "layer_render",
                # Debuggability mirrors only — never query entry points (F12).
                "render_of_asset_id": source.pk,
                "layer_id": layer_id,
            },
        },
    )
    relation, _ = EntityRelation.objects.get_or_create(
        asset=source,
        entity=asset,
        role=RENDER_ROLE,
        defaults={
            "source": "ai",
            "confidence": 1.0,
            "type_data": {"layer_id": layer_id},
        },
    )
    return asset, relation


def store_run_results(
    source,
    layer_id,
    png_list,
    *,
    op,
    params=None,
    layer_name=None,
    base_seed=None,
    source_version=None,
    guide_version=None,
    guide_role="sketch_guide",
    created_by=None,
):
    """
    Store one generation run's outputs as variations vRun.0..vRun.N-1.

    Args:
        png_list: result bytes, one per variation
        op: generation operation (sketch_inpaint | scribble | erase | inpaint)
        params: run parameters recorded verbatim in each variation's
            ``generation`` record (prompt, scales, mask_dims, telemetry, ...)
        base_seed: run seed; variation i is recorded as base_seed + i,
            mirroring the Modal per-variant seed rule
        source_version: Version of the source image generated from
            (``init_image`` lineage edge)
        guide_version: Version of the guide map used (``guide_role`` edge)

    Returns (render_asset, run_number, [Version, ...]).
    """
    render_asset, relation = _get_or_create_render_asset(
        source, layer_id, layer_name=layer_name
    )

    with transaction.atomic():
        # Serialize run allocation across concurrent pollers of the same call.
        VersionedEntity.objects.select_for_update().get(pk=render_asset.pk)
        run = (
            render_asset.versions.aggregate(m=Max("version_number"))["m"] or 0
        ) + 1

        versions = []
        for index, png in enumerate(png_list):
            # mask_shapes (the input strokes JSON) can be large; the whole run
            # shares one input mask, so it lives only on variation 0.
            variation_params = (
                params
                if index == 0
                else {k: v for k, v in (params or {}).items() if k != "mask_shapes"}
            )
            generation = {
                "op": op,
                "run_seed": base_seed,
                "seed": base_seed + index if isinstance(base_seed, int) else None,
                **(variation_params or {}),
            }
            upstream = {}
            if source_version is not None:
                upstream[INIT_IMAGE_ROLE] = source_version
            if guide_version is not None:
                upstream[guide_role] = guide_version
            uploaded = SimpleUploadedFile(
                f"{render_asset.name}-v{run}.{index}.png",
                png,
                content_type="image/png",
            )
            version, _ = add_version(
                render_asset,
                uploaded,
                created_by=created_by,
                version_number=run,
                variation=index,
                extra_data={"generation": generation},
                upstream=upstream or None,
            )
            versions.append(version)

        relation.entity_version = versions[0]
        relation.entity_version_number = versions[0].version_number
        relation.save(update_fields=["entity_version", "entity_version_number", "updated_at"])

    return render_asset, run, versions


def select_render(source, layer_id, version_number, variation_number, *, actor=None):
    """
    Pin the artist's chosen render via the ``selected`` symlink (audited by
    SymlinkEvent, RESTRICT-protected against deletion).

    Returns the selected Version. Raises Version.DoesNotExist / ValueError.
    """
    relation = find_layer_relation(source, layer_id)
    if relation is None:
        raise ValueError("No renders stored for this layer.")
    version = Version.objects.get(
        entity=relation.entity,
        version_number=version_number,
        variation_number=variation_number,
    )
    update_symlink(relation.entity, SELECTED_SYMLINK, version, actor=actor)
    return version


def selected_render(render_asset):
    """The Version pinned by the ``selected`` symlink, or None."""
    link = Symlink.objects.filter(
        entity=render_asset, name=SELECTED_SYMLINK
    ).select_related("version").first()
    return link.version if link else None


def render_grid(render_asset):
    """
    The layer's contact sheet: runs (rows) × variations (columns), newest run
    first, each cell carrying its file and generation record.
    """
    runs = {}
    for version in render_asset.versions.order_by(
        "-version_number", "variation_number"
    ):
        runs.setdefault(version.version_number, []).append(
            {
                "version_number": version.version_number,
                "variation_number": version.variation_number,
                "file_path": version.data.get("file_path"),
                "thumbnails": version.data.get("thumbnails"),
                "generation": version.data.get("generation"),
                "created_at": version.created_at.isoformat(),
            }
        )
    return [
        {"run": run, "results": cells} for run, cells in runs.items()
    ]
