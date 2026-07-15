"""
Run endpoints — publish a generation batch and inspect an output's provenance.

A *run* of an external node-graph engine is recorded as a nexus8 generation
batch: a ``Container`` version that pins the exact versions of the workflow and
every ingredient the run used. Outputs link back to that batch
(``generated_from_batch``), so ``reproduction_manifest()`` can later reconstruct
exactly what produced any image — even after symlinks move, because the pins are
frozen at publish time.

Endpoints
---------
    POST /trackables/api/runs/            publish a run batch (pins workflow + refs)
    GET  /trackables/api/runs/manifest/   reproduction manifest for an output asset
"""

import json
import os
import re
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from django.db import transaction
from django.shortcuts import get_object_or_404
from rest_framework import permissions, status
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import (
    Container,
    ContainerReference,
    GENERATED_FROM_BATCH,
    MediaAsset,
    Version,
    VersionedEntity,
    VersionLink,
    reproduction_manifest,
)
from .models.versions import _next_version_number

_VERSION_REF = re.compile(r"^v(\d+)$")


def _parse_ref(value):
    """Normalize a reference string to ``(code, ref)``.

    Accepts ``nexus8://<code>/<ref>``, ``<code>@<ref>``, ``<code>/<ref>`` or a
    bare ``<code>`` (defaulting ref to ``latest``) — so the values a run hook
    gets from ``stat()`` (``nexus8://sd15/v1``) drop straight in.
    """
    v = (value or "").strip()
    if v.startswith("nexus8://"):
        code, _, ref = v[len("nexus8://"):].partition("/")
    elif "@" in v:
        code, _, ref = v.partition("@")
    elif "/" in v:
        code, _, ref = v.partition("/")
    else:
        code, ref = v, ""
    return code, (ref or "latest")


def _resolve_version(code, ref):
    """``(code, ref)`` → ``(entity, version)``; raises LookupError if not found."""
    entity = VersionedEntity.objects.filter(code=code).first()
    if entity is None:
        raise LookupError(f"no entity with code '{code}'")
    match = _VERSION_REF.match(ref)
    if match:
        version = entity.versions.filter(version_number=int(match.group(1))).first()
        if version is None:
            raise LookupError(f"{code} has no version {ref}")
    else:
        try:
            version = entity.resolve_symlink(ref)
        except Exception:
            raise LookupError(f"{code} has no symlink '{ref}'")
    return entity, version


class RunPublishView(APIView):
    """``POST /trackables/api/runs/`` — publish a run as a pinned batch.

    Body::

        {
          "workflow":   "text2image_demos@approved",  # or nexus8://.../vN
          "references": {"checkpoint": "nexus8://sd15/v1", ...},
          "params":     {"seed": 12345, "steps": 12},   # optional run facts
          "batch_code": "text2image_demos__runs"        # optional
        }

    Pins the workflow version + every referenced ingredient version into a new
    ContainerVersion and returns its id (use it as ``batch_version_id`` when
    uploading outputs).
    """

    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        body = request.data
        workflow = body.get("workflow")
        if not workflow:
            return Response(
                {"error": "body requires 'workflow'"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        references = body.get("references") or {}
        params = body.get("params") or {}
        actor = request.user if request.user.is_authenticated else None

        # Resolve the workflow + every ingredient to exact versions.
        pins = []  # (reference_name, entity, ref_label, version)
        try:
            wcode, wref = _parse_ref(workflow)
            wentity, wversion = _resolve_version(wcode, wref)
            pins.append(("workflow", wentity, wref, wversion))
            for name, value in references.items():
                rcode, rref = _parse_ref(value)
                rentity, rversion = _resolve_version(rcode, rref)
                pins.append((name, rentity, rref, rversion))
        except LookupError as exc:
            return Response({"error": str(exc)}, status=status.HTTP_404_NOT_FOUND)

        batch_code = body.get("batch_code") or f"{wcode}__runs"

        with transaction.atomic():
            container = Container.objects.filter(code=batch_code).first()
            if container is None:
                container = Container.objects.create(
                    code=batch_code, name=f"runs: {wcode}"
                )
            batch_version = Version.objects.create(
                entity=container,
                version_number=_next_version_number(container),
                data={"params": params, "reference_count": len(pins)},
                created_by=actor,
            )
            ContainerReference.objects.bulk_create(
                [
                    ContainerReference(
                        container_version=batch_version,
                        reference_name=name,
                        referenced_entity=entity,
                        symlink_name=ref_label,   # what the run asked for ("approved"/"v1")
                        symlink_version=version,   # the exact version it resolved to
                        resolved_version=version,
                    )
                    for (name, entity, ref_label, version) in pins
                ]
            )

        return Response(
            {
                "batch_code": batch_code,
                "batch_version_id": batch_version.id,
                "batch_version_number": batch_version.version_number,
                "pinned": {
                    name: {"code": entity.code, "version": version.version_number}
                    for (name, entity, _ref, version) in pins
                },
            },
            status=status.HTTP_201_CREATED,
        )


class RunManifestView(APIView):
    """``GET /trackables/api/runs/manifest/?code=<output>&ref=<ref>``

    Returns the full reproduction manifest for a generated output: the workflow
    version, every pinned ingredient version + content hash, and the seed.
    """

    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        code = request.query_params.get("code")
        ref = request.query_params.get("ref") or "latest"
        if not code:
            return Response(
                {"error": "missing required query param 'code'"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        try:
            _entity, version = _resolve_version(code, ref)
        except LookupError as exc:
            return Response({"error": str(exc)}, status=status.HTTP_404_NOT_FOUND)

        try:
            return Response(reproduction_manifest(version))
        except ValueError as exc:
            return Response({"error": str(exc)}, status=status.HTTP_409_CONFLICT)


class ReproduceView(APIView):
    """``POST /trackables/api/runs/reproduce/`` — proxy a reproduce to nodegraph.

    Same-origin for the SPA (avoids cross-origin POSTs to the engine). Forwards
    ``{asset_code, ref?}`` to the nodegraph server's ``/api/reproduce``, which
    reconstructs the pinned workflow + inputs and launches a (re-governed) run.
    """

    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        code = request.data.get("asset_code") or request.data.get("code")
        if not code:
            return Response(
                {"error": "body requires 'asset_code'"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        ref = request.data.get("ref") or "latest"
        base = os.environ.get("NODEGRAPH_BASE_URL", "http://localhost:3001").rstrip("/")
        payload = json.dumps({"asset_code": code, "ref": ref}).encode("utf-8")
        req = Request(
            f"{base}/api/reproduce",
            data=payload,
            headers={"Content-Type": "application/json", "Accept": "application/json"},
            method="POST",
        )
        try:
            with urlopen(req, timeout=30) as response:
                return Response(json.loads(response.read().decode("utf-8")))
        except HTTPError as exc:
            try:
                detail = json.loads(exc.read().decode("utf-8"))
            except Exception:
                detail = str(exc)
            code_out = exc.code if 400 <= exc.code < 600 else status.HTTP_502_BAD_GATEWAY
            return Response({"error": "nodegraph rejected reproduce", "detail": detail}, status=code_out)
        except URLError as exc:
            return Response(
                {"error": f"nodegraph unreachable at {base}: {exc.reason}"},
                status=status.HTTP_502_BAD_GATEWAY,
            )


class AssetProvenanceView(APIView):
    """``GET /trackables/api/library/assets/<pk>/provenance/``

    SPA-friendly forward lineage for a library asset: "what produced this?".
    Returns ``{"provenance": null}`` (200) for assets that weren't generated,
    so the UI can render a plain "no provenance" state without handling errors.
    """

    permission_classes = [permissions.IsAuthenticated]

    def get(self, request, pk):
        asset = get_object_or_404(MediaAsset, pk=pk)
        try:
            version = asset.resolve_symlink("latest")
        except Exception:
            version = asset.versions.first()
        if version is None:
            return Response({"provenance": None})
        try:
            return Response(reproduction_manifest(version))
        except ValueError:
            return Response({"provenance": None})


class EntityConsumersView(APIView):
    """``GET /trackables/api/library/entities/<code>/consumers/``

    Reverse lineage / impact view: every output generated by a run that pinned
    this entity. Answers "which images used checkpoint sd15?" — the blast-radius
    you'd check before archiving an ingredient.
    """

    permission_classes = [permissions.IsAuthenticated]

    def get(self, request, code):
        entity = get_object_or_404(VersionedEntity, code=code)
        batch_version_ids = (
            ContainerReference.objects.filter(referenced_entity=entity)
            .values_list("container_version_id", flat=True)
            .distinct()
        )
        links = (
            VersionLink.objects.filter(
                role=GENERATED_FROM_BATCH, from_version_id__in=list(batch_version_ids)
            )
            .select_related("to_version__entity")
            .order_by("-created_at")
        )

        consumers, seen = [], set()
        for link in links:
            output = link.to_version
            ent = output.entity
            if ent.id in seen:
                continue
            seen.add(ent.id)
            consumers.append(
                {
                    "id": ent.id,
                    "code": ent.code,
                    "name": ent.name,
                    "version": output.version_number,
                    "thumbnails": (ent.type_data or {}).get("thumbnails") or {},
                }
            )

        return Response(
            {"entity": code, "consumer_count": len(consumers), "consumers": consumers}
        )
