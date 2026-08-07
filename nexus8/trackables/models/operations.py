"""
Video operation jobs.

One row per dispatched video operation (segment, remove, …). The job record is
the durable envelope for the dispatch → poll → ingest lifecycle: it stores the
op name, resolved inputs and params at dispatch time, the Modal call id, and
the ingested result. This is operational state, not a trackable asset — the
*products* of ops (mask track versions, rendered videos) live in the entity /
version model; the job just points at them.
"""

from uuid import uuid4

from django.conf import settings
from django.db import models

from .base import Trackable


class OperationJob(Trackable):
    """A dispatched video operation and its lifecycle state."""

    STATUS_QUEUED = "queued"
    STATUS_WORKING = "working"
    STATUS_DONE = "done"
    STATUS_FAILED = "failed"
    STATUS_CANCELLED = "cancelled"
    STATUS_CHOICES = [
        (STATUS_QUEUED, "Queued"),
        (STATUS_WORKING, "Working"),
        (STATUS_DONE, "Done"),
        (STATUS_FAILED, "Failed"),
        (STATUS_CANCELLED, "Cancelled"),
    ]

    id = models.UUIDField(primary_key=True, default=uuid4, editable=False)
    asset = models.ForeignKey(
        "trackables.VersionedEntity",
        on_delete=models.CASCADE,
        related_name="video_op_jobs",
    )
    op = models.CharField(max_length=32, db_index=True)
    # Mask layer this op is bound to, when it is layer-scoped (segment, remove).
    # Asset-level ops (e.g. outpaint) leave it blank.
    layer_id = models.CharField(max_length=64, blank=True, default="")

    status = models.CharField(
        max_length=16, choices=STATUS_CHOICES, default=STATUS_QUEUED, db_index=True
    )

    # Resolved at dispatch time (span, prompt frames, track id, staging tier…)
    # so the poll/ingest side never has to reconstruct them from the client.
    inputs = models.JSONField(default=dict, blank=True)
    # Op-specific knobs as sent by the client (model params, prompts, presets).
    params = models.JSONField(default=dict, blank=True)

    modal_call_id = models.CharField(max_length=64, blank=True, default="", db_index=True)
    dispatched_at = models.DateTimeField(null=True, blank=True)
    result_at = models.DateTimeField(null=True, blank=True)
    error = models.TextField(blank=True, default="")
    # Ingested result pointers (track_id / version_id / frames_processed /
    # latency_s for selection ops; render asset refs for generative ops).
    result = models.JSONField(default=dict, blank=True)

    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="video_op_jobs",
    )

    class Meta:
        indexes = [
            models.Index(fields=["asset", "op", "layer_id"]),
        ]
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.op} job {self.id} [{self.status}]"
