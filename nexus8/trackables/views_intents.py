"""
Intent-first orchestration endpoints.

The workflow run lifecycle from nexus8's perspective:

1. **Attachments** — a TD or lead attaches a workflow to a process/asset and
   declares output bindings. The graph_interface snapshot is written from the
   published workflow's scanned asset nodes.

2. **Resolve** (pure, no side effects) — given an attachment + target asset,
   scan each asset node and resolve it: Self → target, EntityRef → reference
   slot lookup + policy resolution, AssetQuery → materialised set. Returns a
   ResolutionProposal. Ambiguous entity refs surface as candidate lists; the
   artist picks, and the form re-resolves (query nodes re-materialise).

3. **Intents** — the artist confirms; nexus8 creates a RunIntent with every
   input version pinned (including the exact query-set versions). nodegraph
   reads the intent, injects, cooks, and calls PATCH /intents/{id}/status/.

4. **Reference slots** — curated per-entity named slots. CRUD here, displayed
   on entity pages, resolved by EntityRef nodes.

5. **Browse** — lightweight asset search endpoint for nodegraph's dev-mode
   pickers (the entity-ref / self picker inline in the graph editor).
"""

import random

from django.db import transaction
from django.shortcuts import get_object_or_404
from rest_framework import permissions, status
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import (
    EntityRelation,
    EntityReferenceSlot,
    MediaAsset,
    NodegraphWorkflow,
    RunIntent,
    Version,
    VersionedEntity,
    WorkflowAttachment,
    update_symlink,
)
from .models.versions import _next_version_number

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _thumb(entity):
    """Best thumbnail for an entity (placeholder if none)."""
    td = entity.type_data or {}
    thumbs = td.get("thumbnails") or {}
    return thumbs.get("small") or thumbs.get("medium") or td.get("placeholder") or ""


def _entity_to_candidate(entity, slot_name, version, policy):
    """Serialise a resolved entity + asset version as a ResolvedCandidate dict."""
    return {
        "entityCode": entity.code,
        "entityName": entity.name,
        "category": (entity.type_data or {}).get("category", ""),
        "assetCode": entity.code,
        "referenceSlot": slot_name,
        "version": version.version_number if version else None,
        "policy": policy,
        "thumb": _thumb(entity),
    }


def _resolve_symlink_safe(entity, symlink_name):
    """Resolve a symlink; fall back to latest version on miss."""
    try:
        return entity.resolve_symlink(symlink_name)
    except Exception:
        return entity.versions.order_by("-version_number").first()


def _slot_uri(asset, version):
    """Format a nexus8:// URI for a pinned version."""
    if asset is None or version is None:
        return None
    return f"nexus8://{asset.code}/v{version.version_number}"


def _scan_graph_for_asset_node(nodes, node_id):
    """Return the graph node dict for a given node_id, or None."""
    for node in nodes:
        if node.get("id") == node_id:
            return node
    return None


# ---------------------------------------------------------------------------
# Resolver — pure, no side effects
# ---------------------------------------------------------------------------

def _resolve_attachment(attachment, target_asset, context_asset=None, selections=None):
    """
    Core resolver.

    ``attachment.graph_interface`` carries the asset-node list.
    ``selections`` is ``{node_id: entity_code}`` from the artist's current form
    state — used to resolve ambiguous entity-ref nodes and to materialise
    query nodes that depend on them.

    Returns a ResolutionProposal-shaped dict.
    """
    selections = selections or {}
    graph = attachment.graph_interface or {}
    nodes = graph.get("nodes", [])
    views = graph.get("views", [])

    inputs = []
    pins = []

    # First pass: resolve non-query nodes so query nodes can reference them.
    resolved_entities = {}  # node_id → entity_code of chosen resolution

    for node in nodes:
        kind = node.get("kind")

        if kind == "self":
            ver = _resolve_symlink_safe(target_asset, "latest")
            inputs.append({
                "node": node,
                "status": "resolved",
                "chosen": [{
                    "entityCode": target_asset.code,
                    "entityName": target_asset.name,
                    "category": (target_asset.type_data or {}).get("category", ""),
                    "assetCode": target_asset.code,
                    "referenceSlot": None,
                    "version": ver.version_number if ver else None,
                    "policy": "latest",
                    "thumb": _thumb(target_asset),
                }],
            })
            resolved_entities[node["id"]] = target_asset.code

        elif kind == "entity_ref":
            role = node.get("role", "")
            slot_name = node.get("referenceSlot", "")
            policy = node.get("policy", "approved")

            # Find entities related to the target asset (or its context) by role.
            relation_qs = EntityRelation.objects.filter(
                asset=target_asset, role=role
            ).select_related("entity")
            # Also look in context_asset if target is a frame / child.
            if context_asset and context_asset.pk != target_asset.pk:
                from django.db.models import Q
                relation_qs = EntityRelation.objects.filter(
                    Q(asset=target_asset) | Q(asset=context_asset), role=role
                ).select_related("entity")

            candidates = []
            for rel in relation_qs:
                entity = rel.entity
                # Look up the named reference slot on this entity.
                slot = EntityReferenceSlot.objects.filter(
                    entity=entity, slot=slot_name
                ).select_related("asset", "pinned_version").first()
                if slot is None or slot.asset is None:
                    continue
                ver = slot.resolve()
                candidates.append(_entity_to_candidate(entity, slot_name, ver, policy))

            node_id = node["id"]

            if node_id in selections:
                chosen_code = selections[node_id]
                chosen = next(
                    (c for c in candidates if c["entityCode"] == chosen_code), None
                )
                if chosen:
                    inputs.append({"node": node, "status": "resolved", "chosen": [chosen]})
                    resolved_entities[node_id] = chosen_code
                    continue

            if len(candidates) == 0:
                inputs.append({"node": node, "status": "ambiguous", "candidates": []})
            elif len(candidates) == 1:
                inputs.append({"node": node, "status": "resolved", "chosen": candidates})
                resolved_entities[node_id] = candidates[0]["entityCode"]
            else:
                inputs.append({"node": node, "status": "ambiguous", "candidates": candidates})

        elif kind == "pin":
            pins.append(node)

        # output and asset_query handled separately below.

    # Second pass: resolve asset_query nodes (depend on entity_ref resolutions).
    for node in nodes:
        if node.get("kind") != "asset_query":
            continue

        criteria = node.get("criteria") or {}
        related_node_id = criteria.get("relatedTo", "")
        process = criteria.get("process", "")
        ref_policy = criteria.get("ref", "approved")
        node_id = node["id"]

        entity_code = resolved_entities.get(related_node_id) or selections.get(related_node_id)

        if not entity_code:
            inputs.append({"node": node, "status": "query", "summary": None, "set": []})
            continue

        entity = VersionedEntity.objects.filter(code=entity_code).first()
        if entity is None:
            inputs.append({"node": node, "status": "query", "summary": None, "set": []})
            continue

        # Find MediaAssets related to this entity and filtered by production_stage.
        asset_qs = (
            MediaAsset.objects.filter(
                entity_relations__entity=entity,
            )
            .filter(type_data__production_stage=process)
            .distinct()
        )

        query_set = []
        symlink_name = "approved" if ref_policy == "approved" else "latest"
        for asset in asset_qs[:200]:  # cap at 200 to keep the form snappy
            ver = _resolve_symlink_safe(asset, symlink_name)
            if ver is None:
                ver = asset.versions.order_by("-version_number").first()
            if ver is None:
                continue
            query_set.append({
                "assetCode": asset.code,
                "version": ver.version_number,
                "thumb": _thumb(asset),
            })

        entity_name = entity.name
        count = len(query_set)
        summary = f"{count} {process} image{'s' if count != 1 else ''} of {entity_name} · {ref_policy}" if count else None

        inputs.append({
            "node": node,
            "status": "query",
            "summary": summary,
            "set": query_set,
        })

    # Compute outcomes from output nodes + output_bindings.
    outcomes = []
    binding_map = {b["slot"]: b for b in (attachment.output_bindings or [])}
    for node in nodes:
        if node.get("kind") != "output":
            continue
        slot = node.get("slot", "")
        binding = binding_map.get(slot, {})
        target_type = binding.get("target", "new_version_of_self")
        if target_type == "new_version_of_self":
            next_ver = (
                target_asset.versions.order_by("-version_number")
                .values_list("version_number", flat=True)
                .first()
            )
            next_num = (next_ver or 0) + 1
            outcomes.append({
                "description": f"Will create v{next_num} of {target_asset.code}",
                "targetCode": target_asset.code,
                "targetVersion": next_num,
            })
        elif target_type == "new_asset":
            template = binding.get("nameTemplate", "{source}_{slot}")
            derived_code = template.format(source=target_asset.code, slot=slot)
            outcomes.append({
                "description": f"Will create new asset {derived_code}",
                "targetCode": derived_code,
                "targetVersion": None,
            })

    return {
        "attachmentId": attachment.id,
        "target": {"code": target_asset.code, "name": target_asset.name},
        "contextLabel": None,
        "inputs": inputs,
        "pins": pins,
        "outcomes": outcomes,
        "viewName": attachment.view_name,
    }


def _pin_inputs(attachment, target_asset, inputs, selections=None):
    """
    Convert a resolved input list into ``node_pins`` (the intent's immutable map).

    Returns ``{node_id: uri_or_list}`` where single-value nodes get a string and
    query-set nodes get a list of strings.  Raises ValueError for unresolved inputs
    when on_ambiguity='fail'.
    """
    pins = {}
    for inp in inputs:
        node = inp["node"]
        node_id = node["id"]
        kind = node.get("kind")

        if kind == "self":
            candidate = inp.get("chosen", [{}])[0]
            asset_code = candidate.get("assetCode")
            ver_num = candidate.get("version")
            pins[node_id] = f"nexus8://{asset_code}/v{ver_num}" if asset_code and ver_num else None

        elif kind == "entity_ref":
            if inp["status"] == "resolved":
                candidate = inp.get("chosen", [{}])[0]
                asset_code = candidate.get("assetCode")
                ver_num = candidate.get("version")
                pins[node_id] = f"nexus8://{asset_code}/v{ver_num}" if asset_code and ver_num else None
            else:
                raise ValueError(
                    f"Node '{node_id}' ({node.get('label')}) is ambiguous; "
                    "resolve ambiguity or set on_ambiguity=first."
                )

        elif kind == "asset_query":
            uri_list = [
                f"nexus8://{item['assetCode']}/v{item['version']}"
                for item in inp.get("set", [])
                if item.get("assetCode") and item.get("version")
            ]
            pins[node_id] = uri_list

    return pins


# ---------------------------------------------------------------------------
# Reference slot views
# ---------------------------------------------------------------------------

class EntityReferenceSlotsView(APIView):
    """
    GET  /api/intents/entities/<code>/reference-slots/
    POST /api/intents/entities/<code>/reference-slots/
    """

    permission_classes = [permissions.IsAuthenticated]

    def get(self, request, code):
        entity = get_object_or_404(VersionedEntity, code=code)
        slots = (
            EntityReferenceSlot.objects.filter(entity=entity)
            .select_related("asset", "pinned_version")
            .order_by("slot")
        )
        data = []
        for s in slots:
            ver = s.resolve()
            data.append({
                "slot": s.slot,
                "assetCode": s.asset.code if s.asset else None,
                "assetName": s.asset.name if s.asset else None,
                "version": ver.version_number if ver else None,
                "policy": s.policy,
                "thumb": _thumb(s.asset) if s.asset else "",
            })
        return Response(data)

    def post(self, request, code):
        entity = get_object_or_404(VersionedEntity, code=code)
        slot_name = (request.data.get("slot") or "").strip()
        asset_code = (request.data.get("assetCode") or "").strip()
        policy = request.data.get("policy", "approved")
        if not slot_name or not asset_code:
            return Response(
                {"error": "body requires 'slot' and 'assetCode'"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        asset = VersionedEntity.objects.filter(code=asset_code).first()
        if asset is None:
            return Response(
                {"error": f"no entity with code '{asset_code}'"},
                status=status.HTTP_404_NOT_FOUND,
            )
        slot, created = EntityReferenceSlot.objects.update_or_create(
            entity=entity,
            slot=slot_name,
            defaults={
                "asset": asset,
                "policy": policy,
                "updated_by": request.user if request.user.is_authenticated else None,
            },
        )
        ver = slot.resolve()
        return Response(
            {
                "slot": slot.slot,
                "assetCode": asset.code,
                "assetName": asset.name,
                "version": ver.version_number if ver else None,
                "policy": slot.policy,
                "thumb": _thumb(asset),
            },
            status=status.HTTP_201_CREATED if created else status.HTTP_200_OK,
        )


class EntityReferenceSlotDetailView(APIView):
    """
    PUT    /api/intents/entities/<code>/reference-slots/<slot>/
    DELETE /api/intents/entities/<code>/reference-slots/<slot>/
    """

    permission_classes = [permissions.IsAuthenticated]

    def put(self, request, code, slot):
        entity = get_object_or_404(VersionedEntity, code=code)
        slot_obj = get_object_or_404(EntityReferenceSlot, entity=entity, slot=slot)
        asset_code = (request.data.get("assetCode") or "").strip()
        policy = request.data.get("policy", slot_obj.policy)
        if asset_code:
            asset = VersionedEntity.objects.filter(code=asset_code).first()
            if asset is None:
                return Response(
                    {"error": f"no entity with code '{asset_code}'"},
                    status=status.HTTP_404_NOT_FOUND,
                )
            slot_obj.asset = asset
        slot_obj.policy = policy
        slot_obj.updated_by = request.user if request.user.is_authenticated else None
        slot_obj.save()
        ver = slot_obj.resolve()
        return Response({
            "slot": slot_obj.slot,
            "assetCode": slot_obj.asset.code if slot_obj.asset else None,
            "version": ver.version_number if ver else None,
            "policy": slot_obj.policy,
        })

    def delete(self, request, code, slot):
        entity = get_object_or_404(VersionedEntity, code=code)
        slot_obj = get_object_or_404(EntityReferenceSlot, entity=entity, slot=slot)
        slot_obj.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


# ---------------------------------------------------------------------------
# Attachment views
# ---------------------------------------------------------------------------

class WorkflowAttachmentListView(APIView):
    """
    GET  /api/intents/attachments/?target=<entity_code>&process=<stage>
    POST /api/intents/attachments/
    """

    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        target_code = request.query_params.get("target")
        process = request.query_params.get("process", "")
        qs = WorkflowAttachment.objects.select_related(
            "workflow", "workflow_version", "target_entity"
        )
        if target_code:
            entity = VersionedEntity.objects.filter(code=target_code).first()
            if entity:
                from django.db.models import Q
                # If process not explicitly given, derive it from the asset's type_data.
                asset_process = process or (entity.type_data or {}).get("production_stage", "")
                qs = qs.filter(
                    Q(target_entity=entity) | Q(target_process=asset_process)
                )
            else:
                qs = qs.none()
        elif process:
            qs = qs.filter(target_process=process)

        data = []
        for att in qs.order_by("-created_at"):
            wf = att.workflow
            wf_ver = att.workflow_version
            data.append({
                "id": att.id,
                "workflow": {
                    "code": wf.code,
                    "name": wf.name,
                    "version": wf_ver.version_number if wf_ver else None,
                    "ref": att.view_name or "latest",
                    "engine": wf.engine,
                    "processes": [att.target_process] if att.target_process else [],
                    "description": wf.description or "",
                },
                "level": att.level,
                "mode": att.mode,
                "viewName": att.view_name,
                "graph": att.graph_interface,
                "outputs": att.output_bindings,
            })
        return Response(data)

    def post(self, request):
        body = request.data
        workflow_code = (body.get("workflowCode") or "").strip()
        if not workflow_code:
            return Response(
                {"error": "body requires 'workflowCode'"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        workflow = NodegraphWorkflow.objects.filter(code=workflow_code).first()
        if workflow is None:
            return Response(
                {"error": f"no workflow with code '{workflow_code}'"},
                status=status.HTTP_404_NOT_FOUND,
            )

        target_entity = None
        if body.get("targetEntityCode"):
            target_entity = VersionedEntity.objects.filter(
                code=body["targetEntityCode"]
            ).first()

        # Resolve workflow version.
        version_ref = body.get("workflowVersion")
        wf_version = None
        if version_ref:
            try:
                if str(version_ref).startswith("v"):
                    wf_version = workflow.versions.filter(
                        version_number=int(version_ref[1:])
                    ).first()
                else:
                    wf_version = workflow.resolve_symlink(version_ref)
            except Exception:
                pass

        actor = request.user if request.user.is_authenticated else None
        att = WorkflowAttachment.objects.create(
            workflow=workflow,
            workflow_version=wf_version,
            target_entity=target_entity,
            target_process=body.get("targetProcess", ""),
            level=body.get("level", "process"),
            mode=body.get("mode", "iterate"),
            view_name=body.get("viewName", ""),
            graph_interface=body.get("graphInterface") or {},
            output_bindings=body.get("outputBindings") or [],
            created_by=actor,
        )
        return Response({"id": att.id}, status=status.HTTP_201_CREATED)


class WorkflowAttachmentDetailView(APIView):
    """GET /api/intents/attachments/<id>/"""

    permission_classes = [permissions.IsAuthenticated]

    def get(self, request, pk):
        att = get_object_or_404(WorkflowAttachment, pk=pk)
        wf = att.workflow
        wf_ver = att.workflow_version
        return Response({
            "id": att.id,
            "workflow": {
                "code": wf.code,
                "name": wf.name,
                "version": wf_ver.version_number if wf_ver else None,
                "engine": wf.engine,
            },
            "level": att.level,
            "mode": att.mode,
            "viewName": att.view_name,
            "targetProcess": att.target_process,
            "targetEntityCode": att.target_entity.code if att.target_entity else None,
            "graph": att.graph_interface,
            "outputs": att.output_bindings,
        })


# ---------------------------------------------------------------------------
# Resolve (pure) view
# ---------------------------------------------------------------------------

class ResolveView(APIView):
    """
    POST /api/intents/resolve/

    Pure resolution — no side effects, no rows created.

    Body::

        {
          "attachmentId": 42,
          "targetAssetCode": "sb_fr03",
          "selections": {"n_char": "rex"}   // optional: node_id → entity_code
        }

    Returns a ResolutionProposal.
    """

    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        attachment_id = request.data.get("attachmentId")
        target_code = (request.data.get("targetAssetCode") or "").strip()
        selections = request.data.get("selections") or {}

        if not attachment_id or not target_code:
            return Response(
                {"error": "body requires 'attachmentId' and 'targetAssetCode'"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        attachment = get_object_or_404(WorkflowAttachment, pk=attachment_id)
        target_asset = get_object_or_404(VersionedEntity, code=target_code)

        proposal = _resolve_attachment(attachment, target_asset, selections=selections)
        return Response(proposal)


# ---------------------------------------------------------------------------
# Intent CRUD views
# ---------------------------------------------------------------------------

class IntentListView(APIView):
    """
    POST /api/intents/
    GET  /api/intents/?targetAsset=<code>&status=<s>
    """

    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        qs = RunIntent.objects.select_related(
            "attachment__workflow", "target_asset"
        ).order_by("-created_at")
        if request.query_params.get("targetAsset"):
            qs = qs.filter(target_asset__code=request.query_params["targetAsset"])
        if request.query_params.get("status"):
            qs = qs.filter(status=request.query_params["status"])
        data = [_intent_dict(i) for i in qs[:100]]
        return Response(data)

    def post(self, request):
        """
        Confirm phase: create an immutable RunIntent.

        Body::

            {
              "attachmentId": 42,
              "targetAssetCode": "sb_fr03",
              "selections": {"n_char": "rex"},
              "params": {"prompt": "...", "denoise": 0.75},
              "seed": 12345,
              "armedPins": ["latent@final"],
              "onAmbiguity": "fail"
            }
        """
        body = request.data
        attachment_id = body.get("attachmentId")
        target_code = (body.get("targetAssetCode") or "").strip()
        if not attachment_id or not target_code:
            return Response(
                {"error": "body requires 'attachmentId' and 'targetAssetCode'"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        attachment = get_object_or_404(WorkflowAttachment, pk=attachment_id)
        target_asset = get_object_or_404(VersionedEntity, code=target_code)
        selections = body.get("selections") or {}
        on_ambiguity = body.get("onAmbiguity", "fail")

        # Re-resolve to get fresh pinnable data.
        proposal = _resolve_attachment(attachment, target_asset, selections=selections)

        # Handle ambiguity.
        ambiguous = [
            i for i in proposal["inputs"]
            if i["status"] == "ambiguous" and i["node"].get("kind") == "entity_ref"
        ]
        if ambiguous:
            if on_ambiguity == "fail":
                labels = [i["node"].get("label", i["node"]["id"]) for i in ambiguous]
                return Response(
                    {"error": f"Ambiguous inputs: {', '.join(labels)}. Provide selections or set onAmbiguity."},
                    status=status.HTTP_409_CONFLICT,
                )
            elif on_ambiguity == "first":
                for i in ambiguous:
                    if i["candidates"]:
                        i["status"] = "resolved"
                        i["chosen"] = [i["candidates"][0]]
                # Re-resolve queries that depend on the now-resolved nodes.
                proposal = _resolve_attachment(
                    attachment, target_asset,
                    selections={
                        **selections,
                        **{i["node"]["id"]: i["chosen"][0]["entityCode"]
                           for i in proposal["inputs"] if i["status"] == "resolved"
                           and i["node"].get("kind") == "entity_ref"},
                    },
                )

        try:
            node_pins = _pin_inputs(attachment, target_asset, proposal["inputs"], selections)
        except ValueError as exc:
            return Response({"error": str(exc)}, status=status.HTTP_409_CONFLICT)

        seed = body.get("seed") or random.randint(0, 2**31 - 1)
        actor = request.user if request.user.is_authenticated else None

        intent = RunIntent.objects.create(
            attachment=attachment,
            target_asset=target_asset,
            status="pending",
            node_pins=node_pins,
            params=body.get("params") or {},
            seed=seed,
            armed_pins=body.get("armedPins") or [],
            output_bindings=attachment.output_bindings,
            on_ambiguity=on_ambiguity,
            created_by=actor,
        )

        return Response(_intent_dict(intent), status=status.HTTP_201_CREATED)


class IntentDetailView(APIView):
    """
    GET   /api/intents/<id>/
    PATCH /api/intents/<id>/status/  (called by nodegraph on lifecycle events)
    """

    permission_classes = [permissions.IsAuthenticated]

    def get(self, request, pk):
        intent = get_object_or_404(RunIntent, pk=pk)
        return Response(_intent_dict(intent))


class CloneIntentView(APIView):
    """
    POST /api/intents/<id>/clone/

    Create an exact clone of an existing intent for deterministic reproduction.

    The clone is created with identical node_pins, params, seed, armed_pins,
    output_bindings, and on_ambiguity — guaranteeing the same inputs are used
    even if the library has changed since the original run.  The clone starts
    as 'pending'; dispatch it separately to execute.

    Optionally pass ``{"newSeed": 12345}`` in the body to vary only the seed
    (useful for re-running with a different random while keeping all inputs).
    """

    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, pk):
        source = get_object_or_404(RunIntent, pk=pk)
        actor = request.user if request.user.is_authenticated else None
        seed = request.data.get("newSeed", source.seed)
        clone = RunIntent.objects.create(
            attachment=source.attachment,
            target_asset=source.target_asset,
            status="pending",
            node_pins=source.node_pins,
            params=source.params,
            seed=seed,
            armed_pins=source.armed_pins,
            output_bindings=source.output_bindings,
            on_ambiguity=source.on_ambiguity,
            created_by=actor,
        )
        return Response(_intent_dict(clone), status=status.HTTP_201_CREATED)


class IntentStatusView(APIView):
    """
    PATCH /api/intents/<id>/status/

    Called by nodegraph to update run lifecycle.  Body::

        {
          "status": "running" | "succeeded" | "failed" | "cancelled",
          "engineRunId": "ng_run_abc",   // optional
          "errorMessage": "..."          // for failed
        }
    """

    permission_classes = [permissions.IsAuthenticated]

    def patch(self, request, pk):
        intent = get_object_or_404(RunIntent, pk=pk)
        new_status = request.data.get("status")
        if new_status not in {"queued", "running", "succeeded", "failed", "cancelled"}:
            return Response(
                {"error": "status must be queued|running|succeeded|failed|cancelled"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        intent.status = new_status
        if request.data.get("engineRunId"):
            intent.engine_run_id = request.data["engineRunId"]
        if request.data.get("errorMessage"):
            intent.error_message = request.data["errorMessage"]
        intent.save()

        if new_status == "succeeded":
            outputs = request.data.get("outputs") or {}
            if outputs:
                _deliver_intent_outputs(intent, outputs)

        return Response(_intent_dict(intent))


def _deliver_intent_outputs(intent, outputs: dict) -> None:
    """
    Create nexus8 versions from the output slot values delivered by nodegraph.

    Called when IntentStatusView receives status='succeeded' with an outputs dict.
    Each key is a slot name matching an output binding; the value is whatever
    the Nexus8Output node produced (a nexus8:// URI for the test pass-through
    graph, or a file path / URL for real generation pipelines).
    """
    import logging
    from django.db import transaction
    from .models.versions import _next_version_number, Version

    log = logging.getLogger(__name__)
    binding_map = {b["slot"]: b for b in (intent.output_bindings or [])}
    target_asset = intent.target_asset

    for slot, value in outputs.items():
        binding = binding_map.get(slot)
        if not binding:
            log.warning("[nexus8-intent] no binding for output slot %r — skipping", slot)
            continue
        target_mode = binding.get("target")
        if target_mode != "new_version_of_self":
            log.info("[nexus8-intent] slot %r target=%r — not yet handled", slot, target_mode)
            continue

        try:
            version_data = _version_data_from_output(value, intent, slot)
            with transaction.atomic():
                version_number = _next_version_number(target_asset)
                Version.objects.create(
                    entity=target_asset,
                    version_number=version_number,
                    data=version_data,
                )
            log.info(
                "[nexus8-intent] created v%d of %s from intent %s slot %r",
                version_number, target_asset.code, intent.id, slot,
            )
        except Exception:
            log.exception(
                "[nexus8-intent] failed to create version for intent %s slot %r",
                intent.id, slot,
            )


def _version_data_from_output(value, intent, slot: str) -> dict:
    """
    Build the Version.data dict from an output slot value.

    nexus8:// URI  → copy the referenced version's data (same file), add provenance.
    Anything else  → record as-is in provenance for now (real generation pipelines
                     will pass a file path or storage URI here).
    """
    from .models import Version, VersionedEntity

    provenance = {
        "intent_id": str(intent.id),
        "output_slot": slot,
        "source_value": str(value) if value is not None else None,
    }

    if isinstance(value, str) and value.startswith("nexus8://"):
        # Format: nexus8://<entity_code>/v<version_number>
        rest = value[len("nexus8://"):]
        parts = rest.split("/", 1)
        entity_code = parts[0]
        ver_part = parts[1] if len(parts) > 1 else ""
        version_num = None
        if ver_part.startswith("v") and ver_part[1:].isdigit():
            version_num = int(ver_part[1:])
        try:
            src_entity = VersionedEntity.objects.get(code=entity_code)
            src_qs = Version.objects.filter(entity=src_entity)
            src_version = (
                src_qs.get(version_number=version_num) if version_num is not None
                else src_qs.first()
            )
            if src_version:
                data = dict(src_version.data or {})
                data["provenance"] = provenance
                return data
        except Exception:
            pass

    return {"provenance": provenance}


def _intent_dict(intent):
    """Serialise a RunIntent for API responses."""
    return {
        "id": intent.id,
        "status": intent.status,
        "attachmentId": intent.attachment_id,
        "targetAssetCode": intent.target_asset.code,
        "nodePins": intent.node_pins,
        "params": intent.params,
        "seed": intent.seed,
        "armedPins": intent.armed_pins,
        "outputBindings": intent.output_bindings,
        "onAmbiguity": intent.on_ambiguity,
        "engineRunId": intent.engine_run_id,
        "errorMessage": intent.error_message,
        "batchVersionId": intent.batch_version_id,
        "createdAt": intent.created_at.isoformat(),
    }


# ---------------------------------------------------------------------------
# Dispatch helpers
# ---------------------------------------------------------------------------

def _find_nexus8_output_node(nodegraph_base: str, headers: dict, graph_id: str):
    """
    Query nodegraph for the first Nexus8Output node in the graph's root network.

    Returns (network_id, node_id) or (None, None) on failure.
    Used by dispatch to target a data-graph sink directly rather than firing
    the EntryNode (which has no outgoing edges in pure data graphs).
    """
    try:
        # Load graph into nodegraph if not already loaded.
        load_req = urllib.request.Request(
            f"{nodegraph_base}/api/graphs/{graph_id}/load",
            data=b"{}",
            headers=headers,
            method="POST",
        )
        with urllib.request.urlopen(load_req, timeout=10) as r:
            root_net = json.loads(r.read().decode())
        network_id = root_net.get("id")
        if not network_id:
            return None, None

        net_req = urllib.request.Request(
            f"{nodegraph_base}/api/graphs/{graph_id}/networks/{network_id}",
            headers={k: v for k, v in headers.items() if k != "Content-Type"},
            method="GET",
        )
        with urllib.request.urlopen(net_req, timeout=10) as r:
            net_data = json.loads(r.read().decode())

        for node in net_data.get("nodes", []):
            if node.get("type") == "Nexus8Output":
                return network_id, node["id"]
    except Exception:
        pass
    return None, None


# ---------------------------------------------------------------------------
# Dispatch endpoint — fire an intent to nodegraph
# ---------------------------------------------------------------------------

class DispatchIntentView(APIView):
    """
    POST /api/intents/<id>/dispatch/

    Dispatch a pending RunIntent to the nodegraph execution engine.

    Resolves the workflow graph (network + entry node) from the attachment's
    workflow, calls nodegraph's execute-graph endpoint with the intent_id
    injected into the run body, and updates the intent status to "queued".

    Body (optional)::

        {
          "networkId": "...",     // override the network to run (default: root)
          "nodeId": "..."         // override the entry node (default: auto-detect)
        }

    Reads ``NODEGRAPH_BASE_URL`` from the environment (default http://localhost:9000).
    """

    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, pk):
        import json
        import os
        import urllib.error
        import urllib.request

        intent = get_object_or_404(RunIntent, pk=pk)
        if intent.status not in ("pending", "failed"):
            return Response(
                {"error": f"intent is {intent.status}; only pending or failed intents can be dispatched"},
                status=status.HTTP_409_CONFLICT,
            )

        nodegraph_base = os.environ.get("NODEGRAPH_BASE_URL", "http://localhost:3001").rstrip("/")
        token = os.environ.get("NODEGRAPH_TOKEN", "")
        headers = {"Content-Type": "application/json"}
        if token:
            headers["Authorization"] = f"Token {token}"

        # Prefer the caller's explicit network/node; fall back to the
        # execute-graph endpoint (engine auto-detects the EntryNode).
        body_data = request.data or {}
        network_id = body_data.get("networkId")
        node_id = body_data.get("nodeId")

        # Build the request payload that nodegraph expects.
        # Only intent_id — nodegraph fetches the full intent from nexus8 if it
        # needs params.  Sending params here caused a 422 because nodegraph's
        # execute endpoint expects params as a list, not a dict.
        run_body = {"intent_id": str(intent.id)}

        if network_id and node_id:
            ng_url = f"{nodegraph_base}/api/networks/{network_id}/execute/{node_id}"
        else:
            graph_id = intent.attachment.workflow.code
            # Try to find a Nexus8Output node to execute directly (data graphs
            # don't have flow control wired through EntryNode, so execute-graph
            # fires the EntryNode and produces nothing). If we can find a
            # Nexus8Output sink, use execute/{node_id} which cooks data-recursively.
            found_network, found_node = _find_nexus8_output_node(
                nodegraph_base, headers, graph_id
            )
            if found_network and found_node:
                ng_url = f"{nodegraph_base}/api/graphs/{graph_id}/networks/{found_network}/execute/{found_node}"
            else:
                ng_url = f"{nodegraph_base}/api/graphs/{graph_id}/networks/root/execute-graph"

        payload = json.dumps(run_body).encode()
        req = urllib.request.Request(ng_url, data=payload, headers=headers, method="POST")
        try:
            with urllib.request.urlopen(req, timeout=15) as resp:
                ng_result = json.loads(resp.read().decode())
        except urllib.error.HTTPError as exc:
            try:
                detail = json.loads(exc.read().decode())
            except Exception:
                detail = str(exc)
            return Response(
                {"error": f"nodegraph returned {exc.code}", "detail": detail},
                status=status.HTTP_502_BAD_GATEWAY,
            )
        except Exception as exc:
            return Response(
                {"error": f"could not reach nodegraph: {exc}"},
                status=status.HTTP_502_BAD_GATEWAY,
            )

        engine_run_id = ng_result.get("runId", "")
        intent.status = "queued"
        intent.engine_run_id = engine_run_id
        intent.save(update_fields=["status", "engine_run_id"])

        return Response(
            {
                "intentId": intent.id,
                "status": "queued",
                "engineRunId": engine_run_id,
            },
            status=status.HTTP_202_ACCEPTED,
        )


# ---------------------------------------------------------------------------
# Browse endpoint — for nodegraph dev-mode pickers
# ---------------------------------------------------------------------------

class AssetBrowseView(APIView):
    """
    GET /api/intents/browse/?role=character&slot=turnaround&policy=approved&project=TOS_PROJ

    Returns a list of entities with the requested reference slot filled.
    Used by nodegraph's dev-mode asset picker on EntityRef and Self nodes.
    """

    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        role = request.query_params.get("role", "")
        slot = request.query_params.get("slot", "")
        policy = request.query_params.get("policy", "approved")
        project_code = request.query_params.get("project", "")
        q = request.query_params.get("q", "")

        qs = VersionedEntity.objects.all()
        if project_code:
            qs = qs.filter(project__code=project_code)
        if role:
            from django.db.models import Q
            qs = qs.filter(type_data__category=role)
        if q:
            qs = qs.filter(name__icontains=q)

        results = []
        for entity in qs[:50]:
            if slot:
                slot_obj = EntityReferenceSlot.objects.filter(
                    entity=entity, slot=slot
                ).select_related("asset", "pinned_version").first()
                if slot_obj is None or slot_obj.asset is None:
                    continue
                ver = slot_obj.resolve()
                results.append({
                    "entityCode": entity.code,
                    "entityName": entity.name,
                    "assetCode": slot_obj.asset.code,
                    "referenceSlot": slot,
                    "version": ver.version_number if ver else None,
                    "policy": policy,
                    "thumb": _thumb(slot_obj.asset),
                })
            else:
                # No slot filter — return the entity itself (for Self-node picker).
                ver = _resolve_symlink_safe(entity, "latest")
                results.append({
                    "entityCode": entity.code,
                    "entityName": entity.name,
                    "assetCode": entity.code,
                    "referenceSlot": None,
                    "version": ver.version_number if ver else None,
                    "policy": policy,
                    "thumb": _thumb(entity),
                })
        return Response(results)
