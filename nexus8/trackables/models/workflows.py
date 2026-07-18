"""
Workflow attachment and intent models — the nexus8 side of the
intent-first provenance system.

Three new concrete (non-proxy) tables:

- ``EntityReferenceSlot``: curated named reference slots on entities
  (e.g. character.turnaround → rex_turnaround@approved). Entity Reference
  nodes in a workflow graph resolve through these at intent time.

- ``WorkflowAttachment``: binds a workflow (and which view renders params)
  to a target (process-level, specific asset, or container). Carries the
  scanned graph interface (asset nodes) and declared output bindings.

- ``RunIntent``: the immutable pre-execution declaration. Created by the
  resolve→confirm flow; pins every input version (including materialized
  query sets) before nodegraph is invoked. Status updated via callback.
"""

from django.contrib.auth import get_user_model
from django.db import models

from .base import Trackable
from .entities import VersionedEntity
from .versions import Version

User = get_user_model()

POLICY_CHOICES = [
    ("approved", "Approved"),
    ("latest", "Latest"),
    ("pinned", "Pinned to specific version"),
]

ATTACHMENT_LEVEL_CHOICES = [
    ("process", "Process-level (default for all assets in this process)"),
    ("asset", "Asset-level (pinned to one specific asset)"),
    ("container", "Container-level (pinned to a container)"),
]

ATTACHMENT_MODE_CHOICES = [
    ("iterate", "Iterate (new version of this asset)"),
    ("derive", "Derive (new linked asset)"),
    ("custom", "Custom bindings"),
]

INTENT_STATUS_CHOICES = [
    ("pending", "Pending"),
    ("queued", "Queued"),
    ("running", "Running"),
    ("succeeded", "Succeeded"),
    ("failed", "Failed"),
    ("cancelled", "Cancelled"),
]

ON_AMBIGUITY_CHOICES = [
    ("fail", "Fail — never guess"),
    ("first", "Use first candidate"),
    ("fan_out", "Fan out — one run per candidate"),
]


class EntityReferenceSlot(Trackable):
    """
    A curated named reference slot on an entity.

    Example: the 'turnaround' slot on character Rex points to
    rex_turnaround@approved. Workflow Entity Reference nodes resolve through
    these slots at intent time instead of requiring the artist to pick an
    asset manually on every run.
    """

    entity = models.ForeignKey(
        VersionedEntity,
        on_delete=models.CASCADE,
        related_name="reference_slots",
    )
    slot = models.CharField(
        max_length=64,
        help_text="Named slot, e.g. 'turnaround', 'ref_sheet', 'model'.",
    )
    asset = models.ForeignKey(
        VersionedEntity,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="+",
        help_text="The asset assigned to this slot.",
    )
    policy = models.CharField(
        max_length=16,
        choices=POLICY_CHOICES,
        default="approved",
    )
    pinned_version = models.ForeignKey(
        Version,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="+",
        help_text="Exact version for 'pinned' policy.",
    )
    updated_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="+",
    )

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["entity", "slot"], name="unique_entity_reference_slot"
            )
        ]
        indexes = [
            models.Index(fields=["entity"], name="refslot_entity_idx"),
        ]

    def __str__(self):
        return f"{self.entity.code}.{self.slot} → {self.asset.code if self.asset else '(empty)'}"

    def resolve(self):
        """Resolve to a concrete Version according to policy. Returns Version or None."""
        if self.asset is None:
            return None
        if self.policy == "pinned":
            return self.pinned_version
        symlink_name = "approved" if self.policy == "approved" else "latest"
        try:
            return self.asset.resolve_symlink(symlink_name)
        except Exception:
            # Fall back to latest version
            return self.asset.versions.order_by("-version_number").first()


class WorkflowAttachment(Trackable):
    """
    Binds a workflow to a target (process, asset, or container).

    Carries:
    - which workflow + version is used (null version = always latest)
    - which Control Surface View renders the parameter section
    - the scanned graph interface (asset nodes) as a JSON snapshot
    - the declared output bindings (slot → naming strategy)

    The graph_interface snapshot is written when the attachment is created
    from the published workflow's graph scan. It defines the run form
    structure — asset node rows + which view exposes parameters.
    """

    workflow = models.ForeignKey(
        "NodegraphWorkflow",
        on_delete=models.CASCADE,
        related_name="attachments",
    )
    workflow_version = models.ForeignKey(
        Version,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="+",
        help_text="Pinned workflow version; null means resolve 'latest' at run time.",
    )
    # Target — exactly one of target_entity / target_process should be set.
    target_entity = models.ForeignKey(
        VersionedEntity,
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="workflow_attachments",
        help_text="Set for asset- or container-level attachment.",
    )
    target_process = models.CharField(
        max_length=64,
        blank=True,
        help_text="Production stage value (e.g. 'storyboard') for process-level attachment.",
    )
    level = models.CharField(
        max_length=16,
        choices=ATTACHMENT_LEVEL_CHOICES,
        default="process",
    )
    mode = models.CharField(
        max_length=16,
        choices=ATTACHMENT_MODE_CHOICES,
        default="iterate",
    )
    view_name = models.CharField(
        max_length=128,
        blank=True,
        help_text="Name of the Control Surface View that exposes parameters.",
    )
    graph_interface = models.JSONField(
        default=dict,
        help_text=(
            "Snapshot of the workflow's scanned nexus8 interface: "
            "{nodes: [AssetNode...], views: [{name, params}...]}."
        ),
    )
    output_bindings = models.JSONField(
        default=list,
        help_text=(
            "Declared output bindings: [{slot, target, nameTemplate?, process?}]. "
            "target is 'new_version_of_self', 'new_asset', or 'discard'."
        ),
    )
    created_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="+",
    )

    class Meta:
        indexes = [
            models.Index(fields=["target_entity"], name="attachment_entity_idx"),
            models.Index(fields=["target_process"], name="attachment_process_idx"),
            models.Index(fields=["workflow"], name="attachment_workflow_idx"),
        ]

    def __str__(self):
        target = self.target_entity.code if self.target_entity else f"process:{self.target_process}"
        return f"{self.workflow.code} → {target}"


class RunIntent(Trackable):
    """
    Immutable pre-execution declaration for one workflow run.

    Created by the resolve→confirm flow: nexus8 resolves all inputs, the
    artist confirms (or the API confirms with on_ambiguity semantics), and
    this row is created with every input version already pinned. nodegraph
    reads the intent before cooking, injects pinned values, and reports
    completion back via PATCH /api/intents/{id}/status/.

    node_pins: {node_id: "nexus8://code@vN"} for single-value nodes,
               {node_id: ["nexus8://code@vN", ...]} for query-set nodes.
    """

    attachment = models.ForeignKey(
        WorkflowAttachment,
        on_delete=models.PROTECT,
        related_name="intents",
    )
    target_asset = models.ForeignKey(
        VersionedEntity,
        on_delete=models.PROTECT,
        related_name="run_intents",
        help_text="The asset this run targets (the 'Self' node resolves to this).",
    )
    status = models.CharField(
        max_length=16,
        choices=INTENT_STATUS_CHOICES,
        default="pending",
        db_index=True,
    )
    # Pinned inputs — set at confirm time, immutable thereafter.
    node_pins = models.JSONField(
        default=dict,
        help_text=(
            "Per-node pinned URI(s). Single: {node_id: 'nexus8://code@vN'}. "
            "Query set: {node_id: ['nexus8://code@vN', ...]}."
        ),
    )
    params = models.JSONField(
        default=dict,
        help_text="Parameter values from the chosen Control Surface View.",
    )
    seed = models.IntegerField(null=True, blank=True)
    armed_pins = models.JSONField(
        default=list,
        help_text="Labels of Pin nodes armed for this run (default empty = keep nothing).",
    )
    output_bindings = models.JSONField(
        default=list,
        help_text="Snapshot of attachment.output_bindings at intent creation time.",
    )
    on_ambiguity = models.CharField(
        max_length=16,
        choices=ON_AMBIGUITY_CHOICES,
        default="fail",
    )
    # Set during / after execution.
    batch_version = models.ForeignKey(
        Version,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="+",
        help_text="The run-batch ContainerVersion created when nodegraph executes this intent.",
    )
    engine_run_id = models.CharField(
        max_length=256,
        blank=True,
        help_text="nodegraph run_id, set when nodegraph accepts the intent.",
    )
    error_message = models.TextField(blank=True)
    created_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="+",
    )

    class Meta:
        indexes = [
            models.Index(fields=["target_asset", "status"], name="intent_asset_status_idx"),
            models.Index(fields=["attachment", "status"], name="intent_attachment_status_idx"),
            models.Index(fields=["status", "created_at"], name="intent_status_created_idx"),
        ]

    def __str__(self):
        return f"Intent({self.id}) {self.attachment.workflow.code} on {self.target_asset.code} [{self.status}]"

    def resolve_workflow_version(self):
        """Return the pinned workflow Version (falling back to 'latest' symlink)."""
        if self.attachment.workflow_version_id:
            return self.attachment.workflow_version
        try:
            return self.attachment.workflow.resolve_symlink("latest")
        except Exception:
            return self.attachment.workflow.versions.order_by("-version_number").first()
