"""
Workflow graph scanner — extracts the nexus8 asset-node interface from a
published nodegraph graph document.

The scanner reads a saved-graph JSON document and returns a ``graph_interface``
dict (``{nodes: [...], views: [...]}`` matching the TypeScript ``WorkflowGraphInterface``
type) that nexus8 stores on ``WorkflowAttachment.graph_interface``.

The graph document format mirrors nodegraph's internal representation.  The
scanner is deliberately kept simple: it walks the nodes array and filters by
``nexus8_kind`` metadata stored on the node config.  No graph execution, no
port type resolution — just a static scan.

Supported node types (by ``node_type`` string):
  Nexus8Self        → kind="self"
  Nexus8EntityRef   → kind="entity_ref"
  Nexus8AssetQuery  → kind="asset_query"
  Nexus8Output      → kind="output"
  Nexus8Pin         → kind="pin"

Views (Control Surface Views) are also extracted so the run form knows which
view exposes parameters.
"""
from __future__ import annotations

# Mapping from nodegraph node_type string to kind value used in graph_interface.
NEXUS8_NODE_TYPES: dict[str, str] = {
    "Nexus8Self": "self",
    "Nexus8EntityRef": "entity_ref",
    "Nexus8AssetQuery": "asset_query",
    "Nexus8Output": "output",
    "Nexus8Pin": "pin",
}


def scan_graph(graph_document: dict) -> dict:
    """
    Scan a nodegraph saved-graph document and return a ``graph_interface`` dict.

    Args:
        graph_document: The full ``graph`` JSON as stored in
            ``Version.data["graph"]`` of a ``NodegraphWorkflow`` entity.

    Returns::

        {
            "nodes": [
                {"id": "...", "kind": "self",       "label": "...", "accepts": "any"},
                {"id": "...", "kind": "entity_ref",  "label": "...", "role": "character",
                 "referenceSlot": "turnaround", "policy": "approved", "accepts": "image"},
                {"id": "...", "kind": "asset_query", "label": "...",
                 "criteria": {"process": "storyboard", "relatedTo": "n_char", "ref": "approved"},
                 "accepts": "image"},
                {"id": "...", "kind": "output", "slot": "board_frame"},
                {"id": "...", "kind": "pin",    "label": "latent@final", "dataType": "latent"},
            ],
            "views": [
                {"name": "artist_simple", "params": [{"name": "prompt", "label": "Prompt", ...}]}
            ],
            "errors": []   // publish-time validation warnings
        }
    """
    if not isinstance(graph_document, dict):
        return {"nodes": [], "views": [], "errors": ["graph is not a dict"]}

    nodes_out = []
    errors = []

    # nodegraph graph documents store networks; walk the primary network's nodes.
    # The exact schema varies by nodegraph version; we support both flat and
    # network-nested layouts.
    raw_nodes = _extract_raw_nodes(graph_document)

    for raw in raw_nodes:
        node_type = raw.get("type") or raw.get("node_type") or ""
        kind = NEXUS8_NODE_TYPES.get(node_type)
        if kind is None:
            continue

        node_id = raw.get("id") or raw.get("name") or ""
        if not node_id:
            errors.append(f"nexus8 node of type '{node_type}' has no id — skipped")
            continue

        port_values = _extract_port_values(raw)
        node_entry = _build_node_entry(kind, node_id, port_values, raw, errors)
        if node_entry:
            nodes_out.append(node_entry)

    # Validate precedence rule: no view control should target a nexus8 node's config.
    nexus8_node_ids = {n["id"] for n in nodes_out}
    views_out, view_errors = _extract_views(graph_document, nexus8_node_ids)
    errors.extend(view_errors)

    return {"nodes": nodes_out, "views": views_out, "errors": errors}


def _extract_raw_nodes(graph_document: dict) -> list:
    """Pull the flat node list from a nodegraph graph document."""
    # Layout 1: top-level "nodes" array.
    if "nodes" in graph_document and isinstance(graph_document["nodes"], list):
        return graph_document["nodes"]
    # Layout 2: "networks" → first network → "nodes".
    networks = graph_document.get("networks") or {}
    if isinstance(networks, dict):
        for net in networks.values():
            if isinstance(net, dict) and "nodes" in net:
                return net["nodes"] or []
    if isinstance(networks, list) and networks:
        first = networks[0]
        if isinstance(first, dict) and "nodes" in first:
            return first["nodes"] or []
    return []


def _extract_port_values(raw: dict) -> dict:
    """
    Extract port input values from a raw node dict.

    Handles two formats:
    - Dict format (stub graphs): ``{"inputs": {"port_name": {"value": ...}}}``
    - List format (nodegraph native): ``{"inputs": [{"name": "port", "value": ...}]}``
    Also checks ``parameters``/``params`` as a fallback.
    """
    values: dict = {}
    inputs = raw.get("inputs") or {}
    if isinstance(inputs, dict):
        for port_name, port_data in inputs.items():
            if isinstance(port_data, dict) and "value" in port_data:
                values[port_name] = port_data["value"]
            else:
                values[port_name] = port_data
    elif isinstance(inputs, list):
        # nodegraph native format: list of port objects with "name" + "value".
        for port in inputs:
            if isinstance(port, dict) and "name" in port:
                values[port["name"]] = port.get("value")
    # Flat parameters dict (alternative format).
    params = raw.get("parameters") or raw.get("params") or {}
    if isinstance(params, dict):
        for k, v in params.items():
            values.setdefault(k, v)
    return values


def _build_node_entry(
    kind: str, node_id: str, pv: dict, raw: dict, errors: list
) -> dict | None:
    """Build the graph_interface node entry for one nexus8 node."""
    label = pv.get("label") or raw.get("label") or raw.get("name") or node_id

    if kind == "self":
        return {
            "id": node_id,
            "kind": "self",
            "label": label,
            "accepts": pv.get("accepts") or "any",
        }

    if kind == "entity_ref":
        role = pv.get("role") or ""
        ref_slot = pv.get("reference_slot") or pv.get("referenceSlot") or ""
        if not role or not ref_slot:
            errors.append(
                f"Nexus8EntityRef '{node_id}' missing role or referenceSlot — "
                "it will not resolve correctly."
            )
        return {
            "id": node_id,
            "kind": "entity_ref",
            "label": label,
            "role": role,
            "referenceSlot": ref_slot,
            "policy": pv.get("policy") or "approved",
            "accepts": pv.get("accepts") or "image",
        }

    if kind == "asset_query":
        # The "related to" node is found by following the wired edge from the
        # 'entity' input port back to its source node.  We extract it from the
        # connection metadata if present; fall back to a param if not.
        related_to = _find_entity_source(raw) or pv.get("related_to") or ""
        return {
            "id": node_id,
            "kind": "asset_query",
            "label": label,
            "criteria": {
                "process": pv.get("process") or "storyboard",
                "relatedTo": related_to,
                "ref": pv.get("policy") or "approved",
            },
            "accepts": pv.get("accepts") or "image",
        }

    if kind == "output":
        slot = pv.get("slot") or raw.get("slot") or ""
        if not slot:
            errors.append(f"Nexus8Output '{node_id}' has no slot name.")
        return {"id": node_id, "kind": "output", "slot": slot}

    if kind == "pin":
        return {
            "id": node_id,
            "kind": "pin",
            "label": pv.get("label") or label,
            "dataType": pv.get("data_type") or pv.get("dataType") or "any",
        }

    return None


def _find_entity_source(raw: dict) -> str | None:
    """
    For an AssetQuery node, find the node id of its upstream 'entity' input.

    nodegraph stores edge connections in ``inputs.entity.connections`` or a
    top-level ``connections`` array.  Return the source node id, or None.
    """
    # Check per-port connections.
    inputs = raw.get("inputs") or {}
    entity_port = inputs.get("entity") or {}
    if isinstance(entity_port, dict):
        connections = entity_port.get("connections") or []
        if connections and isinstance(connections, list):
            conn = connections[0]
            if isinstance(conn, dict):
                return conn.get("sourceNodeId") or conn.get("from_node")
            if isinstance(conn, str):
                return conn
    return None


def _extract_views(graph_document: dict, nexus8_node_ids: set) -> tuple[list, list]:
    """
    Extract Control Surface View summaries.

    Returns ``(views_list, errors_list)``.  Flags any view control whose binding
    targets a nexus8 node's config input — that violates the precedence rule.
    """
    views_out = []
    errors = []
    raw_views = graph_document.get("views") or []
    if not isinstance(raw_views, list):
        return views_out, errors

    for view in raw_views:
        if not isinstance(view, dict):
            continue
        name = view.get("name") or view.get("id") or ""
        controls = view.get("controls") or []
        params_out = []
        for ctrl in controls:
            if not isinstance(ctrl, dict):
                continue
            binding = ctrl.get("binding") or {}
            bound_node = binding.get("nodeId") or ""
            if bound_node in nexus8_node_ids:
                errors.append(
                    f"View '{name}' control '{ctrl.get('label')}' targets nexus8 node "
                    f"'{bound_node}' — ignored (nexus8 nodes own their own config)."
                )
                continue
            params_out.append({
                "name": ctrl.get("id") or ctrl.get("label") or "",
                "label": ctrl.get("label") or "",
                "kind": ctrl.get("widget") or "text",
                "default": ctrl.get("default"),
                "min": (ctrl.get("validation") or {}).get("min"),
                "max": (ctrl.get("validation") or {}).get("max"),
            })
        if name:
            views_out.append({"name": name, "params": params_out})

    return views_out, errors
