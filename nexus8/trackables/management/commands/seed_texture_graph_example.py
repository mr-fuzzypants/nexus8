"""
Seed a texture-set → media-asset dependency graph example for the UI.

Builds a real "Brick Wall Material" container that groups a 4-texture PBR set
(albedo / normal / roughness / AO) and feeds into a "Castle Courtyard Render"
media asset. The grouping is modeled two ways:

  * a container VERSION that pins each texture — the system's native, reproducible
    collection mechanism (same as the shot packages in demo_cg_production)
  * DependencyLink edges, so the structure shows up in the dependency graph view

Note on the schema: media-asset textures cannot be tree children of a container
(the `parent_only_on_containers` check constraint allows parent_container only on
`container`/`entity` rows), and the Collections tree only renders sub-containers
and `entity`-type members. So the texture membership is expressed via the
container version pins + the graph edges, not via parent_container.

Idempotent: wipes everything under the TEXDEMO_ code prefix first.

    python manage.py seed_texture_graph_example
"""

from django.core.management.base import BaseCommand
from django.db import transaction

from trackables.models import (
    Container,
    DependencyLink,
    MediaAsset,
    VersionedEntity,
    create_container_version,
)

PREFIX = "TEXDEMO_"

# (code suffix, display name, role)
PBR_TEXTURES = [
    ("ALBEDO", "Brick Wall — Albedo", "albedo"),
    ("NORMAL", "Brick Wall — Normal", "normal"),
    ("ROUGH", "Brick Wall — Roughness", "roughness"),
    ("AO", "Brick Wall — Ambient Occlusion", "ambient_occlusion"),
]


class Command(BaseCommand):
    help = "Seed a texture-set → media-asset dependency graph example for the UI"

    @transaction.atomic
    def handle(self, *args, **options):
        deleted, _ = VersionedEntity.objects.filter(code__startswith=PREFIX).delete()
        if deleted:
            self.stdout.write(self.style.WARNING(f"Reset: deleted {deleted} prior TEXDEMO_ row(s)."))

        # Real collection: a container hung under the Collections-tree root so it
        # shows up as a browsable collection node.
        root, _ = Container.objects.get_or_create(
            code="container_entities_root",
            defaults={"name": "Entities", "parent_container": None},
        )
        material = Container.objects.create(
            code=f"{PREFIX}BRICKMAT", name="Brick Wall Material", parent_container=root
        )

        # The PBR texture set — each a media asset with a published "latest" version.
        textures = []
        for code, name, role in PBR_TEXTURES:
            tex = MediaAsset.objects.create(
                code=f"{PREFIX}{code}",
                name=name,
                media_type="image",
                file_path=f"/proj/textures/brick_{role}.png",
            )
            version = tex.publish({"file": f"brick_{role}.png", "role": role}, symlinks=["latest"])
            textures.append((tex, version, role))

        # The consuming media asset.
        render = MediaAsset.objects.create(
            code=f"{PREFIX}RENDER",
            name="Castle Courtyard Render",
            media_type="image",
            file_path="/proj/renders/castle_courtyard.png",
        )
        render_version = render.publish({"file": "castle_courtyard.png"}, symlinks=["latest"])

        # Real-collection grouping: a container version pinning the 4 textures.
        material_version = create_container_version(
            material,
            references={role: (tex, "latest") for tex, _v, role in textures},
            symlinks=["latest"],
        )

        # Dependency edges (what the graph view traverses):
        #   render   --depends_on(material)-->  material container version
        #   material --references(<role>)----->  each texture version
        DependencyLink.objects.create(
            source_version=render_version,
            target_version=material_version,
            relationship_type="depends_on",
            role="material",
        )
        for tex, version, role in textures:
            DependencyLink.objects.create(
                source_version=material_version,
                target_version=version,
                relationship_type="references",
                role=role,
            )

        self.stdout.write(
            self.style.SUCCESS(
                f"Created 'Castle Courtyard Render' → 'Brick Wall Material' → "
                f"{len(textures)} textures."
            )
        )
        self.stdout.write(f"Render version id: {render_version.id}")
        self.stdout.write(f"View graph:  /graph/{render_version.id}   (direction=downstream)")
        self.stdout.write(
            f"API:         /trackables/api/dependency-links/graph/?version_id={render_version.id}"
        )
