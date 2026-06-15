"""
Seed a large, deep dependency graph to stress-test the graph endpoint + UI.

Shape (a production-like DAG, rooted at one render):

    Master Render
      └─depends_on─▶ Material 0..M           (containers)
                       └─references─▶ Texture 0..T   (media assets, per material)
      Materials and some textures also ─references─▶ Shared Lib 0..S
                       Shared Lib k ─depends_on─▶ chain of `--depth` base nodes

Shared libs give the graph real DAG convergence (many paths to one node), which
exercises the CTE's de-duplication and the layout engine. Tune the knobs to push
node/edge counts up until the backend or the dagre/react-flow render strains.

Idempotent: wipes everything under the STRESS_ code prefix first.

    python manage.py seed_stress_dependency_graph
    python manage.py seed_stress_dependency_graph --materials 120 --textures 25 --shared 30 --depth 5
    python manage.py seed_stress_dependency_graph --clear-only
"""

import time

from django.core.management.base import BaseCommand
from django.db import transaction

from trackables.models import DependencyLink, Version, VersionedEntity
from trackables.views_container_links import _dependency_edges

PREFIX = "STRESS_"


class Command(BaseCommand):
    help = "Seed a large dependency graph for stress-testing the graph view"

    def add_arguments(self, parser):
        parser.add_argument("--materials", type=int, default=40, help="Material containers under the root")
        parser.add_argument("--textures", type=int, default=15, help="Textures per material")
        parser.add_argument("--shared", type=int, default=12, help="Shared library nodes referenced by many")
        parser.add_argument("--depth", type=int, default=3, help="Extra dependency-chain depth below each shared lib")
        parser.add_argument("--clear-only", action="store_true", help="Just delete the STRESS_ data and exit")

    @transaction.atomic
    def handle(self, *args, **opts):
        deleted, _ = VersionedEntity.objects.filter(code__startswith=PREFIX).delete()
        if deleted:
            self.stdout.write(self.style.WARNING(f"Reset: deleted {deleted} prior STRESS_ row(s)."))
        if opts["clear_only"]:
            self.stdout.write(self.style.SUCCESS("Cleared."))
            return

        M, T, S, D = opts["materials"], opts["textures"], opts["shared"], opts["depth"]

        # --- 1. Describe every node: (code, name, entity_type) ----------------
        nodes = [(f"{PREFIX}RENDER", "Master Render", "media_asset")]
        for m in range(M):
            nodes.append((f"{PREFIX}MAT_{m:04d}", f"Material {m:04d}", "container"))
            for t in range(T):
                nodes.append((f"{PREFIX}TEX_{m:04d}_{t:03d}", f"Mat {m:04d} · Texture {t:03d}", "media_asset"))
        for k in range(S):
            nodes.append((f"{PREFIX}LIB_{k:03d}", f"Shared Lib {k:03d}", "media_asset"))
            for d in range(D):
                nodes.append((f"{PREFIX}LIBCHAIN_{k:03d}_{d:02d}", f"Lib {k:03d} · Base {d:02d}", "media_asset"))

        # --- 2. Bulk-create entities, then one version each --------------------
        entities = VersionedEntity.objects.bulk_create(
            [VersionedEntity(code=c, name=n, entity_type=et) for c, n, et in nodes],
            batch_size=1000,
        )
        versions = Version.objects.bulk_create(
            [Version(entity=e, version_number=1, data={}) for e in entities],
            batch_size=1000,
        )
        vid = {e.code: v.id for e, v in zip(entities, versions)}  # code -> version id

        # --- 3. Build edges (source uses target) ------------------------------
        edges = []  # (source_code, target_code, relationship_type, role)
        for m in range(M):
            mat = f"{PREFIX}MAT_{m:04d}"
            edges.append((f"{PREFIX}RENDER", mat, "depends_on", "material"))
            for t in range(T):
                edges.append((mat, f"{PREFIX}TEX_{m:04d}_{t:03d}", "references", "texture"))
            if S:
                # Each material also pulls 3 shared libs (round-robin) -> convergence.
                for off in range(3):
                    edges.append((mat, f"{PREFIX}LIB_{(m + off) % S:03d}", "references", "shared_lib"))
        if S:
            # Every 5th texture also references a shared lib -> more cross-paths.
            i = 0
            for m in range(M):
                for t in range(T):
                    if i % 5 == 0:
                        edges.append((f"{PREFIX}TEX_{m:04d}_{t:03d}", f"{PREFIX}LIB_{i % S:03d}", "references", "shared_lib"))
                    i += 1
        for k in range(S):  # deepen each shared lib into a chain
            prev = f"{PREFIX}LIB_{k:03d}"
            for d in range(D):
                cur = f"{PREFIX}LIBCHAIN_{k:03d}_{d:02d}"
                edges.append((prev, cur, "depends_on", "base"))
                prev = cur

        DependencyLink.objects.bulk_create(
            [
                DependencyLink(
                    source_version_id=vid[s], target_version_id=vid[t],
                    relationship_type=rt, role=role,
                )
                for s, t, rt, role in edges
            ],
            batch_size=1000,
        )

        # --- 4. Report + measure the backend traversal ------------------------
        root = vid[f"{PREFIX}RENDER"]
        t0 = time.perf_counter()
        traversed = _dependency_edges(root, max_depth=25, direction="downstream")
        cte_ms = (time.perf_counter() - t0) * 1000
        reached = {root} | {e[0] for e in traversed} | {e[1] for e in traversed}

        self.stdout.write(self.style.SUCCESS(
            f"Created {len(nodes)} nodes and {len(edges)} edges "
            f"(M={M} T={T} S={S} D={D})."
        ))
        self.stdout.write(
            f"Graph from root (max_depth=25): {len(reached)} nodes, {len(traversed)} edges, "
            f"CTE {cte_ms:.0f} ms."
        )
        if len(reached) > 400:
            self.stdout.write(self.style.WARNING(
                "Heads up: >400 nodes — dagre layout + react-flow rendering will be the "
                "bottleneck, not the backend. Use the direction toggle / lower max_depth to scope it."
            ))
        self.stdout.write(f"Root version id: {root}")
        self.stdout.write(f"View graph:  /graph/{root}")
        self.stdout.write(f"API:         /trackables/api/dependency-links/graph/?version_id={root}&max_depth=25")
