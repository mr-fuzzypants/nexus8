"""
Unified relations graph: one hop of every relationship a node participates in.

Composes the three relationship stores (plus symlink pointers) into a single
{nodes, edges} payload for the SPA relations view (SRED_DEPENDENCYVIS_EXPERIMENT.md):

  - DependencyLink  — version-scoped compositional edges (kind="dependency")
  - VersionLink     — version-scoped generative lineage  (kind="lineage")
  - EntityRelation  — entity-scoped attachments          (kind="relation")
  - Symlink         — named mutable pointers             (kind="pointer")

Node ids are prefixed — "v{id}" for version nodes, "e{id}" for entity nodes,
"L{uuid}" for synthetic layer groups — because the stores disagree on
granularity (H1). Every edge carries a ``scope`` ("version" | "entity") so
the client can flag entity-level edges attached to a version node.

Edge direction convention: ``source`` uses / derives-from / attaches
``target``, so "downstream" uniformly means "what this is made of". Lineage
edges therefore point derived→input. Attachment edges ignore the direction
filter (H5) — they are always returned and gated client-side by kind.

Entry-point rule (F12): all queries enter through FK-indexed columns;
``type_data`` values are reported as context, never filtered on.

Query-plan rules (dependencyvis iteration 3): a hop's query count must be
bounded by the number of *stores*, never by the number of edges or nodes —
fetch raw rows per direction first, batch-resolve symlinks/stats/thumbs over
the collected id sets, then emit nodes and edges in pure Python.
"""

from rest_framework import permissions, status
from rest_framework.response import Response
from rest_framework.views import APIView

from django.db import connection
from django.db.models import Count, F, Window
from django.shortcuts import get_object_or_404

from .models import DependencyLink, EntityRelation, Version
from .models.entities import VersionedEntity
from .models.versions import Symlink, VersionLink

VERSION_PREFIX = "v"
ENTITY_PREFIX = "e"
LAYER_PREFIX = "L"

# Legacy interim-storage roles (inpaint experiment F11) — implementation
# plumbing, not discovery information. Hidden in the curated view.
PLUMBING_ROLES = {"inpaint_preview", "sketch_inpaint_preview", "scribble_preview"}
LAYER_ROLES = {"mask", "layer_render"}


def version_thumb(version):
    """Best small image proxy for a version, or None for non-media versions."""
    thumbs = version.data.get("thumbnails") or {}
    return thumbs.get("256") or thumbs.get("1024") or version.data.get("file_path")


def _vnode(version):
    return {
        "id": f"{VERSION_PREFIX}{version.pk}",
        "node_kind": "version",
        "entity_id": version.entity_id,
        "entity_name": version.entity.name,
        "entity_type": version.entity.entity_type,
        "version_id": version.pk,
        "version_number": version.version_number,
        "variation_number": version.variation_number,
        "thumb": version_thumb(version),
        "child_count": 0,
    }


def _enode(entity):
    return {
        "id": f"{ENTITY_PREFIX}{entity.pk}",
        "node_kind": "entity",
        "entity_id": entity.pk,
        "entity_name": entity.name,
        "entity_type": entity.entity_type,
        "version_id": None,
        "version_number": None,
        "variation_number": None,
        "thumb": None,
        "child_count": 0,
    }


def _lnode(layer_id, name, child_count):
    return {
        "id": f"{LAYER_PREFIX}{layer_id}",
        "node_kind": "layer",
        "entity_id": None,
        "entity_name": name,
        "entity_type": "layer",
        "version_id": None,
        "version_number": None,
        "variation_number": None,
        "thumb": None,
        "child_count": child_count,
    }


def _relation_layer_id(relation):
    """Layer key: relation type_data first, legacy mask-asset field as fallback
    (SRED dependencyvis F2). Context read only — never a query entry (F12)."""
    return relation.type_data.get("layer_id") or relation.entity.type_data.get(
        "mask_layer_id"
    )


def _layer_display_name(mask_asset, source_name):
    """Recover the layer name from the '{source}-{layer}' mask naming convention."""
    name = mask_asset.name
    if name.startswith(f"{source_name}-"):
        name = name[len(source_name) + 1 :]
    return name or "layer"


def _relation_context(relation):
    context = {"confidence": relation.confidence, "source": relation.source}
    layer_id = relation.type_data.get("layer_id")
    if layer_id:
        context["layer_id"] = layer_id
    return context


def _relation_edges(entity_id, from_node_id, nodes, edges, exclude_roles=None):
    """Attachment edges around one entity, entered via (asset, role) / (entity, role).

    Used by the raw and entity hops; the curated version hop partitions its
    own two relation fetches instead (see _curated_version_hop query plan).
    """
    qs_out = EntityRelation.objects.filter(asset_id=entity_id).select_related("entity")
    qs_in = EntityRelation.objects.filter(entity_id=entity_id).select_related("asset")
    if exclude_roles:
        qs_out = qs_out.exclude(role__in=exclude_roles)
        qs_in = qs_in.exclude(role__in=exclude_roles)
    for rel in qs_out:
        other = f"{ENTITY_PREFIX}{rel.entity_id}"
        nodes.setdefault(other, _enode(rel.entity))
        edges[f"{from_node_id}-{other}-rel-{rel.role}-{rel.pk}"] = {
            "source": from_node_id,
            "target": other,
            "kind": "relation",
            "role": rel.role,
            "scope": "entity",
            "context": _relation_context(rel),
        }
    for rel in qs_in:
        other = f"{ENTITY_PREFIX}{rel.asset_id}"
        nodes.setdefault(other, _enode(rel.asset))
        edges[f"{other}-{from_node_id}-rel-{rel.role}-{rel.pk}"] = {
            "source": other,
            "target": from_node_id,
            "kind": "relation",
            "role": rel.role,
            "scope": "entity",
            "context": _relation_context(rel),
        }


def _child_counts(nodes):
    """Direct-neighbor counts per node across all stores.

    OPTIMIZATION (dependencyvis iteration 3): these counts feed a purely
    cosmetic "expand +N" affordance, yet as seven separate grouped COUNTs
    they were a third of the hop's round trips. A single UNION ALL keeps
    them to one query; every branch is served by an existing FK index, so
    the plan is seven index scans stitched together server-side.
    """
    version_ids = [
        n["version_id"] for n in nodes.values() if n["node_kind"] == "version"
    ]
    entity_ids = list(
        {n["entity_id"] for n in nodes.values() if n["entity_id"] is not None}
    )

    branches, params = [], []

    def branch(label, table, column, ids):
        if ids:
            branches.append(
                f"SELECT '{label}' AS bucket, {column} AS obj_id, COUNT(*) "
                f"FROM {table} WHERE {column} = ANY(%s) GROUP BY {column}"
            )
            params.append(ids)

    dep_table = DependencyLink._meta.db_table
    lin_table = VersionLink._meta.db_table
    rel_table = EntityRelation._meta.db_table
    ptr_table = Symlink._meta.db_table
    branch("dep_out", dep_table, "source_version_id", version_ids)
    branch("dep_in", dep_table, "target_version_id", version_ids)
    branch("lin_in", lin_table, "to_version_id", version_ids)
    branch("lin_out", lin_table, "from_version_id", version_ids)
    branch("rel_a", rel_table, "asset_id", entity_ids)
    branch("rel_e", rel_table, "entity_id", entity_ids)
    branch("ptr", ptr_table, "entity_id", entity_ids)
    if not branches:
        return

    counts = {}
    with connection.cursor() as cursor:
        cursor.execute(" UNION ALL ".join(branches), params)
        for bucket, obj_id, count in cursor.fetchall():
            counts.setdefault(bucket, {})[obj_id] = count

    def bucket(label, obj_id):
        return counts.get(label, {}).get(obj_id, 0)

    for node in nodes.values():
        eid = node["entity_id"]
        if node["node_kind"] == "layer":
            continue  # preset by the curated builder
        if node["node_kind"] == "version":
            vid = node["version_id"]
            node["child_count"] = (
                bucket("dep_out", vid) + bucket("dep_in", vid)
                + bucket("lin_in", vid) + bucket("lin_out", vid)
                + bucket("rel_a", eid) + bucket("rel_e", eid)
            )
        else:
            node["child_count"] = (
                bucket("rel_a", eid) + bucket("rel_e", eid) + bucket("ptr", eid)
            )


def _entity_thumbs(nodes):
    """Fill entity-node thumbs from each entity's newest version, one query.

    The curated version hop prefills thumbs from its newest-version stats
    query, so this pass usually finds nothing to do there and costs zero
    queries; it remains the thumb source for the raw and entity hops.
    """
    entity_ids = [
        n["entity_id"] for n in nodes.values() if n["node_kind"] == "entity" and not n["thumb"]
    ]
    if not entity_ids:
        return
    newest = Version.objects.filter(entity_id__in=entity_ids).order_by(
        "entity_id", "-version_number", "-variation_number"
    ).distinct("entity_id")
    thumbs = {v.entity_id: version_thumb(v) for v in newest}
    for node in nodes.values():
        if node["node_kind"] == "entity" and not node["thumb"]:
            node["thumb"] = thumbs.get(node["entity_id"])


class RelationsGraphView(APIView):
    """
    GET /trackables/api/relations-graph/?node=v123&direction=downstream|upstream|both
                                        &view=curated|raw

    One hop of unified relationship edges around a version ("v{id}") or
    entity ("e{id}") node. Response: {root, direction, nodes, edges}.
    """

    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        node = request.query_params.get("node", "")
        direction = request.query_params.get("direction", "both")
        view = request.query_params.get("view", "curated")
        if view not in ("curated", "raw"):
            return Response(
                {"error": "view must be curated or raw"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if direction not in ("downstream", "upstream", "both"):
            return Response(
                {"error": "direction must be downstream, upstream, or both"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        prefix, raw_id = node[:1], node[1:]
        if prefix not in (VERSION_PREFIX, ENTITY_PREFIX) or not raw_id.isdigit():
            return Response(
                {"error": "node must look like v123 (version) or e45 (entity)"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        nodes, edges = {}, {}
        if prefix == VERSION_PREFIX:
            if view == "curated":
                self._curated_version_hop(int(raw_id), direction, nodes, edges)
            else:
                self._version_hop(int(raw_id), direction, nodes, edges)
        else:
            self._entity_hop(int(raw_id), nodes, edges, curated=view == "curated")

        _child_counts(nodes)
        _entity_thumbs(nodes)
        return Response(
            {
                "root": node,
                "direction": direction,
                "nodes": list(nodes.values()),
                "edges": [{"id": key, **edge} for key, edge in edges.items()],
            }
        )

    def _version_hop(self, version_id, direction, nodes, edges):
        version = get_object_or_404(
            Version.objects.select_related("entity"), pk=version_id
        )
        root = f"{VERSION_PREFIX}{version_id}"
        nodes[root] = _vnode(version)

        downstream = direction in ("downstream", "both")
        upstream = direction in ("upstream", "both")

        if downstream:
            for dl in DependencyLink.objects.filter(
                source_version_id=version_id
            ).select_related("target_version__entity"):
                other = f"{VERSION_PREFIX}{dl.target_version_id}"
                nodes.setdefault(other, _vnode(dl.target_version))
                edges[f"{root}-{other}-dep-{dl.relationship_type}"] = {
                    "source": root,
                    "target": other,
                    "kind": "dependency",
                    "role": dl.role or dl.relationship_type,
                    "scope": "version",
                    "context": {"relationship_type": dl.relationship_type},
                }
            # Inputs this version was generated from: derived→input, so the
            # root is the edge source ("made of" reads downstream).
            for vl in VersionLink.objects.filter(
                to_version_id=version_id
            ).select_related("from_version__entity"):
                other = f"{VERSION_PREFIX}{vl.from_version_id}"
                nodes.setdefault(other, _vnode(vl.from_version))
                edges[f"{root}-{other}-lin-{vl.role}"] = {
                    "source": root,
                    "target": other,
                    "kind": "lineage",
                    "role": vl.role,
                    "scope": "version",
                    "context": {},
                }
        if upstream:
            for dl in DependencyLink.objects.filter(
                target_version_id=version_id
            ).select_related("source_version__entity"):
                other = f"{VERSION_PREFIX}{dl.source_version_id}"
                nodes.setdefault(other, _vnode(dl.source_version))
                edges[f"{other}-{root}-dep-{dl.relationship_type}"] = {
                    "source": other,
                    "target": root,
                    "kind": "dependency",
                    "role": dl.role or dl.relationship_type,
                    "scope": "version",
                    "context": {"relationship_type": dl.relationship_type},
                }
            # Outputs derived from this version (e.g. renders it seeded).
            for vl in VersionLink.objects.filter(
                from_version_id=version_id
            ).select_related("to_version__entity"):
                other = f"{VERSION_PREFIX}{vl.to_version_id}"
                nodes.setdefault(other, _vnode(vl.to_version))
                edges[f"{other}-{root}-lin-{vl.role}"] = {
                    "source": other,
                    "target": root,
                    "kind": "lineage",
                    "role": vl.role,
                    "scope": "version",
                    "context": {},
                }

        # Attachments are entity-scoped and direction-agnostic (H5).
        _relation_edges(version.entity_id, root, nodes, edges)

    def _curated_version_hop(self, version_id, direction, nodes, edges):
        """
        Artist-level hop (dependencyvis F1): inputs / layers / outputs instead
        of raw store edges. Layers group each mask with its *selected* render;
        derived outputs collapse to one representative version per asset with
        a candidate count; legacy plumbing roles are hidden.

        Query plan (dependencyvis iteration 3): at most 9 index-served
        queries for direction=both, independent of edge/node counts —
          1     root version (+entity)
          2–3   all EntityRelation rows, one per direction, partitioned by
                role in memory (was: one query per role, 4 total)
          4–7   DependencyLink / VersionLink rows, per active direction
          8     every "selected" symlink — layer renders and derived outputs
                in one batch (was: two queries)
          9     newest version per neighbour entity via DISTINCT ON, whose
                window COUNT doubles as the render candidate count and whose
                row doubles as the entity-node thumbnail source (was: a
                run-count aggregate here plus a thumbnail pass in get())
        _child_counts() then adds one UNION ALL query in get().
        """
        version = get_object_or_404(
            Version.objects.select_related("entity"), pk=version_id
        )
        root = f"{VERSION_PREFIX}{version_id}"
        nodes[root] = _vnode(version)
        entity = version.entity

        downstream = direction in ("downstream", "both")
        upstream = direction in ("upstream", "both")

        # --- Phase 1: fetch raw rows; no queries depend on row contents ---

        outgoing = list(
            EntityRelation.objects.filter(asset=entity).select_related("entity")
        )
        incoming = list(
            EntityRelation.objects.filter(entity=entity)
            .exclude(role__in=LAYER_ROLES | PLUMBING_ROLES)
            .select_related("asset")
        )

        # Partition the outgoing relations by role: layers (mask +
        # layer_render share a layer_id), plain attachments, hidden plumbing.
        layers = {}
        unassigned_masks = []
        attachments = []
        for rel in outgoing:
            if rel.role == "mask":
                layer_id = _relation_layer_id(rel)
                if layer_id:
                    layers.setdefault(layer_id, {}).setdefault("mask", rel)
                else:
                    unassigned_masks.append(rel)
            elif rel.role == "layer_render":
                layer_id = rel.type_data.get("layer_id")
                if layer_id:
                    layers.setdefault(layer_id, {})["render"] = rel
            elif rel.role not in PLUMBING_ROLES:
                attachments.append(rel)

        render_asset_ids = {
            parts["render"].entity_id for parts in layers.values() if "render" in parts
        }

        dep_out = (
            list(
                DependencyLink.objects.filter(
                    source_version_id=version_id
                ).select_related("target_version__entity")
            )
            if downstream
            else []
        )
        lineage_in = (
            list(
                VersionLink.objects.filter(to_version_id=version_id).select_related(
                    "from_version__entity"
                )
            )
            if downstream
            else []
        )
        dep_in = (
            list(
                DependencyLink.objects.filter(
                    target_version_id=version_id
                ).select_related("source_version__entity")
            )
            if upstream
            else []
        )
        lineage_out = (
            list(
                VersionLink.objects.filter(from_version_id=version_id).select_related(
                    "to_version__entity"
                )
            )
            if upstream
            else []
        )

        # Derived outputs grouped per asset; render assets are excluded (they
        # are already presented inside their layer group).
        derived = {}
        for vl in lineage_out:
            target_entity_id = vl.to_version.entity_id
            if target_entity_id in render_asset_ids:
                continue
            entry = derived.setdefault(
                target_entity_id, {"role": vl.role, "count": 0, "latest": vl.to_version}
            )
            entry["count"] += 1
            candidate = vl.to_version
            latest = entry["latest"]
            if (candidate.version_number, candidate.variation_number) > (
                latest.version_number,
                latest.variation_number,
            ):
                entry["latest"] = candidate

        # --- Phase 2: batched resolution over the collected id sets ---

        pointer_ids = render_asset_ids | set(derived)
        selected = {}
        if pointer_ids:
            selected = {
                s.entity_id: s.version
                for s in Symlink.objects.filter(
                    entity_id__in=pointer_ids, name="selected"
                ).select_related("version__entity")
            }

        # One DISTINCT ON + window query per hop: newest version per
        # neighbour entity. candidates = COUNT(*) OVER (PARTITION BY entity);
        # runs = the newest version_number, which equals the run count by
        # construction (store_run_results allocates run numbers sequentially
        # from 1 under the entity lock).
        stats_ids = (
            render_asset_ids
            | {rel.entity_id for rel in outgoing if rel.role == "mask"}
            | {rel.entity_id for rel in attachments}
            | {rel.asset_id for rel in incoming}
        )
        newest = {}
        if stats_ids:
            newest = {
                v.entity_id: v
                for v in Version.objects.filter(entity_id__in=stats_ids)
                .annotate(candidates=Window(Count("id"), partition_by=[F("entity_id")]))
                .order_by("entity_id", "-version_number", "-variation_number")
                .distinct("entity_id")
            }

        def enode_with_thumb(rel_entity):
            node = _enode(rel_entity)
            rep = newest.get(rel_entity.pk)
            if rep is not None:
                node["thumb"] = version_thumb(rep)
            return node

        # --- Phase 3: emit nodes and edges (pure Python from here) ---

        for layer_id, parts in layers.items():
            mask_rel = parts.get("mask")
            render_rel = parts.get("render")
            name_source = (mask_rel or render_rel).entity
            name = _layer_display_name(name_source, entity.name)
            if not mask_rel:  # render-asset naming: "{source} — {layer} renders"
                name = name.replace("— ", "").removesuffix(" renders")
            layer_node = f"{LAYER_PREFIX}{layer_id}"
            nodes[layer_node] = _lnode(
                layer_id, name, (1 if mask_rel else 0) + (1 if render_rel else 0)
            )
            edges[f"{root}-{layer_node}"] = {
                "source": root,
                "target": layer_node,
                "kind": "layer",
                "role": "layer",
                "scope": "entity",
                "context": {"layer_id": layer_id},
            }
            if mask_rel:
                mask_node = f"{ENTITY_PREFIX}{mask_rel.entity_id}"
                nodes.setdefault(mask_node, enode_with_thumb(mask_rel.entity))
                edges[f"{layer_node}-{mask_node}-mask"] = {
                    "source": layer_node,
                    "target": mask_node,
                    "kind": "relation",
                    "role": "mask",
                    "scope": "entity",
                    "context": _relation_context(mask_rel),
                }
            if render_rel:
                chosen = selected.get(render_rel.entity_id)
                stats = newest.get(render_rel.entity_id)
                context = {}
                if stats is not None:
                    context = {
                        "candidates": stats.candidates,
                        "runs": stats.version_number,
                    }
                if chosen is not None:
                    render_node = f"{VERSION_PREFIX}{chosen.pk}"
                    nodes.setdefault(render_node, _vnode(chosen))
                else:  # no selection pinned yet — fall back to the asset
                    render_node = f"{ENTITY_PREFIX}{render_rel.entity_id}"
                    nodes.setdefault(render_node, enode_with_thumb(render_rel.entity))
                edges[f"{layer_node}-{render_node}-render"] = {
                    "source": layer_node,
                    "target": render_node,
                    "kind": "relation",
                    "role": "selected render",
                    "scope": "entity",
                    "context": context,
                }

        for rel in unassigned_masks:
            mask_node = f"{ENTITY_PREFIX}{rel.entity_id}"
            nodes.setdefault(mask_node, enode_with_thumb(rel.entity))
            edges[f"{root}-{mask_node}-mask"] = {
                "source": root,
                "target": mask_node,
                "kind": "relation",
                "role": "mask",
                "scope": "entity",
                "context": _relation_context(rel),
            }

        # Other attachments (characters, ...) minus layer + plumbing roles,
        # emitted from the phase-1 fetches (same edge ids as _relation_edges).
        for rel in attachments:
            other = f"{ENTITY_PREFIX}{rel.entity_id}"
            nodes.setdefault(other, enode_with_thumb(rel.entity))
            edges[f"{root}-{other}-rel-{rel.role}-{rel.pk}"] = {
                "source": root,
                "target": other,
                "kind": "relation",
                "role": rel.role,
                "scope": "entity",
                "context": _relation_context(rel),
            }
        for rel in incoming:
            other = f"{ENTITY_PREFIX}{rel.asset_id}"
            nodes.setdefault(other, enode_with_thumb(rel.asset))
            edges[f"{other}-{root}-rel-{rel.role}-{rel.pk}"] = {
                "source": other,
                "target": root,
                "kind": "relation",
                "role": rel.role,
                "scope": "entity",
                "context": _relation_context(rel),
            }

        # Inputs: what this version was made of.
        for dl in dep_out:
            other = f"{VERSION_PREFIX}{dl.target_version_id}"
            nodes.setdefault(other, _vnode(dl.target_version))
            edges[f"{root}-{other}-dep-{dl.relationship_type}"] = {
                "source": root,
                "target": other,
                "kind": "dependency",
                "role": dl.role or dl.relationship_type,
                "scope": "version",
                "context": {"relationship_type": dl.relationship_type},
            }
        for vl in lineage_in:
            other = f"{VERSION_PREFIX}{vl.from_version_id}"
            nodes.setdefault(other, _vnode(vl.from_version))
            edges[f"{root}-{other}-lin-{vl.role}"] = {
                "source": root,
                "target": other,
                "kind": "lineage",
                "role": vl.role,
                "scope": "version",
                "context": {},
            }

        # Outputs: derived work, one representative version per asset.
        for dl in dep_in:
            other = f"{VERSION_PREFIX}{dl.source_version_id}"
            nodes.setdefault(other, _vnode(dl.source_version))
            edges[f"{other}-{root}-dep-{dl.relationship_type}"] = {
                "source": other,
                "target": root,
                "kind": "dependency",
                "role": dl.role or dl.relationship_type,
                "scope": "version",
                "context": {"relationship_type": dl.relationship_type},
            }
        for target_entity_id, entry in derived.items():
            rep = selected.get(target_entity_id, entry["latest"])
            rep_node = f"{VERSION_PREFIX}{rep.pk}"
            nodes.setdefault(rep_node, _vnode(rep))
            context = {"candidates": entry["count"]} if entry["count"] > 1 else {}
            edges[f"{rep_node}-{root}-lin-{entry['role']}"] = {
                "source": rep_node,
                "target": root,
                "kind": "lineage",
                "role": entry["role"],
                "scope": "version",
                "context": context,
            }

    def _entity_hop(self, entity_id, nodes, edges, curated=False):
        entity = get_object_or_404(VersionedEntity, pk=entity_id)
        root = f"{ENTITY_PREFIX}{entity_id}"
        nodes[root] = _enode(entity)

        _relation_edges(
            entity_id, root, nodes, edges,
            exclude_roles=PLUMBING_ROLES if curated else None,
        )

        symlinks = Symlink.objects.filter(entity_id=entity_id)
        if curated:
            symlinks = symlinks.exclude(name="latest")
        for link in symlinks.select_related("version__entity"):
            other = f"{VERSION_PREFIX}{link.version_id}"
            nodes.setdefault(other, _vnode(link.version))
            edges[f"{root}-{other}-ptr-{link.name}"] = {
                "source": root,
                "target": other,
                "kind": "pointer",
                "role": link.name,
                "scope": "entity",
                "context": {},
            }
