"""
Workflow registration endpoints for external node-graph engines (e.g. nodegraph).

A workflow is registered as a versioned ``nodegraph_workflow`` entity whose
``version.data["graph"]`` holds the full saved-graph document. Versions are
content-addressed (sha256 of the canonical graph JSON), so re-registering an
identical graph dedups to the existing version instead of churning version
numbers — mirroring media ingest.

This is the keystone of Tier-3 reproducibility: a run's output links back to the
exact workflow version it executed, and that version is a complete snapshot of
the topology plus all inline values.

Endpoints
---------
    POST /trackables/api/workflows/            register/publish a workflow version
    GET  /trackables/api/workflows/<code>/     fetch a resolved workflow version
"""

import hashlib
import json
import re

from rest_framework import permissions, status
from rest_framework.response import Response
from rest_framework.views import APIView

from .graph_scanner import scan_graph
from .models import NodegraphWorkflow, update_symlink

_VERSION_REF = re.compile(r"^v(\d+)$")


def _canonical_hash(graph) -> str:
    """Stable sha256 of a graph document, independent of key ordering."""
    canonical = json.dumps(graph, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _symlink_names_for(entity, version):
    return list(
        entity.symlinks.filter(version=version).values_list("name", flat=True)
    )


class WorkflowRegisterView(APIView):
    """``POST /trackables/api/workflows/`` — publish a workflow version.

    Body: ``{code, graph, name?, symlinks?}`` where ``graph`` is the full
    saved-graph document. ``symlinks`` defaults to ``["latest"]``; ``latest`` is
    always moved to the new version regardless.
    """

    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        body = request.data
        code = (body.get("code") or "").strip()
        graph = body.get("graph")
        if not code or graph is None:
            return Response(
                {"error": "body requires 'code' and 'graph'"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        symlinks = list(body.get("symlinks") or ["latest"])
        if "latest" not in symlinks:
            symlinks.append("latest")

        schema_version = graph.get("schema_version") if isinstance(graph, dict) else None
        content_hash = _canonical_hash(graph)
        actor = request.user if request.user.is_authenticated else None

        entity = NodegraphWorkflow.objects.filter(code=code).first()
        if entity is None:
            entity = NodegraphWorkflow.objects.create(
                code=code,
                name=body.get("name") or code,
                type_data={"engine": "nodegraph", "schema_version": schema_version},
            )

        # Content-addressed dedup: identical graph → reuse the existing version,
        # just (re)point the requested symlinks at it.
        existing = entity.versions.filter(content_hash=content_hash).first()
        if existing is not None:
            for name in symlinks:
                update_symlink(entity, name, existing, actor=actor)
            return Response(
                {
                    "code": code,
                    "version_number": existing.version_number,
                    "content_hash": content_hash,
                    "symlinks": _symlink_names_for(entity, existing),
                    "created": False,
                },
                status=status.HTTP_200_OK,
            )

        scanned = scan_graph(graph)
        version = entity.publish(
            data={"graph": graph, "graph_interface": scanned},
            symlinks=tuple(symlinks),
            content_hash=content_hash,
            created_by=actor,
        )
        return Response(
            {
                "code": code,
                "version_number": version.version_number,
                "content_hash": content_hash,
                "symlinks": _symlink_names_for(entity, version),
                "graph_interface": scanned,
                "created": True,
            },
            status=status.HTTP_201_CREATED,
        )


class WorkflowDetailView(APIView):
    """``GET /trackables/api/workflows/<code>/?ref=<ref>`` — fetch a version.

    ``ref`` is a symlink name (default ``latest``) or ``v<N>``. Returns the full
    graph document so an engine can load and run it.
    """

    permission_classes = [permissions.IsAuthenticated]

    def get(self, request, code):
        ref = request.query_params.get("ref") or "latest"
        entity = NodegraphWorkflow.objects.filter(code=code).first()
        if entity is None:
            return Response(
                {"error": f"no workflow with code '{code}'"},
                status=status.HTTP_404_NOT_FOUND,
            )

        version_match = _VERSION_REF.match(ref)
        if version_match:
            version = entity.versions.filter(
                version_number=int(version_match.group(1))
            ).first()
            if version is None:
                return Response(
                    {"error": f"{code} has no version {ref}"},
                    status=status.HTTP_404_NOT_FOUND,
                )
        else:
            try:
                version = entity.resolve_symlink(ref)
            except Exception:
                return Response(
                    {"error": f"{code} has no symlink '{ref}'"},
                    status=status.HTTP_404_NOT_FOUND,
                )

        vdata = version.data or {}
        return Response(
            {
                "code": code,
                "ref": ref,
                "version_number": version.version_number,
                "content_hash": version.content_hash or "",
                "symlinks": _symlink_names_for(entity, version),
                "graph": vdata.get("graph"),
                "graph_interface": vdata.get("graph_interface") or {},
            }
        )
