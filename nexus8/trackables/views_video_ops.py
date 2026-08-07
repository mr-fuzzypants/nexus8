"""
Generic video operation endpoints.

One dispatch/poll/cancel surface for every registered op (segment, remove, …)
instead of a view triplet per op. Op behavior lives in services/video_ops.py;
these views only translate HTTP ⇄ job lifecycle.

The legacy /video-mask/<layer_id>/propagate|status|cancel endpoints delegate
to the same service (see views_video_masks) so existing clients keep working.
"""

import logging

from django.shortcuts import get_object_or_404
from rest_framework import permissions, status
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import MediaAsset, OperationJob
from .services import video_ops

logger = logging.getLogger(__name__)


def _job_or_404(asset_id: str, job_id: str) -> OperationJob:
    return get_object_or_404(OperationJob, id=job_id, asset_id=asset_id)


class VideoOpRegistryView(APIView):
    """List registered operations so the client can build its op menus."""

    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        """GET /api/library/video-ops/"""
        return Response({"ops": video_ops.describe_registry()})


class VideoOpDispatchView(APIView):
    """Dispatch a video operation job."""

    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, asset_id: str):
        """POST /api/library/assets/<id>/video-ops/

        Body:
            {
                "op": "segment",
                "layer_id": "layer-uuid",        # layer-scoped ops
                "inputs": {...},                 # op-specific inputs
                "params": {...}                  # op-specific knobs
            }

        Response (202):
            {"status": "working", "job_id": ..., "op": ..., "call_id": ...,
             "inputs": {...resolved at dispatch...}}
        """
        asset = get_object_or_404(MediaAsset, id=asset_id)
        op_name = request.data.get("op")
        if not op_name:
            return Response({"error": "op required"},
                            status=status.HTTP_400_BAD_REQUEST)
        try:
            job = video_ops.dispatch_job(
                asset=asset,
                op_name=op_name,
                layer_id=request.data.get("layer_id") or "",
                inputs=request.data.get("inputs") or {},
                params=request.data.get("params") or {},
                user=request.user,
            )
        except video_ops.OpError as exc:
            return Response({"error": str(exc)}, status=exc.http_status)

        return Response(
            {
                "status": "working",
                "job_id": str(job.id),
                "op": job.op,
                "call_id": job.modal_call_id,
                "dispatch_at_ms": int(job.dispatched_at.timestamp() * 1000),
                "inputs": job.inputs,
            },
            status=status.HTTP_202_ACCEPTED,
        )


class VideoOpJobView(APIView):
    """Poll a job; results are ingested on the poll that observes completion."""

    permission_classes = [permissions.IsAuthenticated]

    def get(self, request, asset_id: str, job_id: str):
        """GET /api/library/assets/<id>/video-ops/<job_id>/"""
        job = _job_or_404(asset_id, job_id)
        try:
            payload = video_ops.poll_job(job)
        except video_ops.OpError as exc:
            return Response({"error": str(exc)}, status=exc.http_status)
        payload["op"] = job.op
        return Response(payload)


class VideoOpCancelView(APIView):
    """Cancel an in-flight job."""

    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, asset_id: str, job_id: str):
        """POST /api/library/assets/<id>/video-ops/<job_id>/cancel/"""
        job = _job_or_404(asset_id, job_id)
        video_ops.cancel_job(job)
        return Response({"status": "cancelled", "job_id": str(job.id)})
