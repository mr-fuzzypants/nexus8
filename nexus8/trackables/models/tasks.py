"""Hierarchical tasks attachable to entities, versions, or containers."""

from django.core.exceptions import ValidationError
from django.db import models, transaction
from django.contrib.postgres.indexes import GinIndex
from django.utils import timezone

from .base import Trackable
from .entities import Container, VersionedEntity
from .versions import Version


class TaskManager(models.Manager):
    def for_entity(self, entity):
        return self.filter(versioned_entity=entity)

    def for_version(self, version):
        return self.filter(version=version)

    def for_container(self, container):
        return self.filter(container=container)

    def for_object(self, obj):
        if isinstance(obj, Container):
            return self.for_container(obj)
        if isinstance(obj, VersionedEntity):
            return self.for_entity(obj)
        if isinstance(obj, Version):
            return self.for_version(obj)
        return self.none()

    def root_tasks(self):
        return self.filter(parent_task__isnull=True)

    def by_status(self, status):
        return self.filter(status=status)

    def by_priority(self, priority):
        return self.filter(priority=priority)

    def assigned_to(self, assignee):
        return self.filter(assigned_to=assignee)

    def active_tasks(self):
        return self.exclude(status__in=["completed", "cancelled"])

    def overdue_tasks(self):
        return self.filter(
            due_date__isnull=False,
            due_date__lt=timezone.now(),
            status__in=["pending", "in_progress"],
        )

    def bulk_create_optimized(self, tasks_data, batch_size=100):
        """Validated bulk creation; referenced objects are checked in bulk."""

        def _id(data, key):
            obj = data.get(key)
            if obj is not None:
                return obj.pk
            return data.get(f"{key}_id")

        def _validate(model, ids, label):
            ids = {i for i in ids if i is not None}
            if not ids:
                return
            existing = set(
                model._base_manager.filter(pk__in=ids).values_list("pk", flat=True)
            )
            invalid = ids - existing
            if invalid:
                raise ValueError(f"Referenced {label} IDs do not exist: {invalid}")

        _validate(VersionedEntity, [_id(d, "versioned_entity") for d in tasks_data], "VersionedEntity")
        _validate(Version, [_id(d, "version") for d in tasks_data], "Version")
        _validate(VersionedEntity, [_id(d, "container") for d in tasks_data], "Container")
        _validate(Task, [_id(d, "parent_task") for d in tasks_data], "parent Task")

        tasks = [
            Task(
                versioned_entity_id=_id(data, "versioned_entity"),
                version_id=_id(data, "version"),
                container_id=_id(data, "container"),
                parent_task_id=_id(data, "parent_task"),
                title=data["title"],
                description=data.get("description", ""),
                task_type=data.get("task_type", "general"),
                priority=data.get("priority", "normal"),
                status=data.get("status", "pending"),
                assigned_to=data.get("assigned_to", ""),
                estimated_hours=data.get("estimated_hours"),
                actual_hours=data.get("actual_hours"),
                due_date=data.get("due_date"),
                start_date=data.get("start_date"),
                completion_date=data.get("completion_date"),
                tags=data.get("tags", []),
                metadata=data.get("metadata", {}),
            )
            for data in tasks_data
        ]
        with transaction.atomic():
            return self.bulk_create(tasks, batch_size=batch_size)


class Task(Trackable):
    PRIORITY_CHOICES = [
        ("low", "Low"),
        ("normal", "Normal"),
        ("high", "High"),
        ("urgent", "Urgent"),
        ("critical", "Critical"),
    ]

    STATUS_CHOICES = [
        ("pending", "Pending"),
        ("in_progress", "In Progress"),
        ("on_hold", "On Hold"),
        ("review", "In Review"),
        ("completed", "Completed"),
        ("cancelled", "Cancelled"),
    ]

    TASK_TYPE_CHOICES = [
        ("general", "General Task"),
        ("review", "Review Task"),
        ("approval", "Approval Required"),
        ("development", "Development"),
        ("testing", "Testing"),
        ("documentation", "Documentation"),
        ("bug_fix", "Bug Fix"),
        ("feature", "Feature Implementation"),
        ("maintenance", "Maintenance"),
        ("deployment", "Deployment"),
    ]

    parent_task = models.ForeignKey(
        "self", on_delete=models.CASCADE, null=True, blank=True, related_name="subtasks"
    )

    # Exactly one of these is set per task (validated in clean()).
    versioned_entity = models.ForeignKey(
        VersionedEntity,
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="entity_tasks",
    )
    version = models.ForeignKey(
        Version,
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="version_tasks",
    )
    container = models.ForeignKey(
        Container,
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="container_tasks",
    )

    title = models.CharField(max_length=255)
    description = models.TextField(blank=True)
    task_type = models.CharField(max_length=20, choices=TASK_TYPE_CHOICES, default="general")
    priority = models.CharField(max_length=10, choices=PRIORITY_CHOICES, default="normal")
    status = models.CharField(max_length=15, choices=STATUS_CHOICES, default="pending")

    assigned_to = models.CharField(
        max_length=100, blank=True, help_text="User ID or email of assignee"
    )
    estimated_hours = models.DecimalField(max_digits=6, decimal_places=2, null=True, blank=True)
    actual_hours = models.DecimalField(max_digits=6, decimal_places=2, null=True, blank=True)

    due_date = models.DateTimeField(null=True, blank=True)
    start_date = models.DateTimeField(null=True, blank=True)
    completion_date = models.DateTimeField(null=True, blank=True)

    tags = models.JSONField(default=list, blank=True)
    metadata = models.JSONField(default=dict, blank=True)

    objects = TaskManager()

    class Meta:
        ordering = ["-priority", "due_date", "created_at"]
        indexes = [
            models.Index(fields=["status", "assigned_to"]),
            models.Index(fields=["due_date", "status"]),
            models.Index(fields=["parent_task", "status"]),
            models.Index(fields=["versioned_entity", "status"]),
            models.Index(fields=["version", "status"]),
            models.Index(fields=["container", "status"]),
            models.Index(fields=["priority", "due_date"]),
            models.Index(fields=["created_at"]),
            GinIndex(fields=["tags"], name="task_tags_gin"),
        ]

    def __str__(self):
        assigned = f" ({self.assigned_to})" if self.assigned_to else ""
        parent = f" (subtask of {self.parent_task.title})" if self.parent_task else ""
        return f"{self.title}{assigned}{parent}"

    def get_attached_object(self):
        return self.versioned_entity or self.version or self.container

    def get_attached_object_type(self):
        if self.versioned_entity_id:
            return "versioned_entity"
        if self.version_id:
            return "version"
        if self.container_id:
            return "container"
        return None

    def get_hierarchy_path(self):
        path = []
        current = self
        while current:
            path.insert(0, current.title)
            current = current.parent_task
        return path

    def get_hierarchy_level(self):
        level = 0
        current = self.parent_task
        while current:
            level += 1
            current = current.parent_task
        return level

    def get_all_subtasks(self, include_completed=True):
        queryset = self.subtasks.all()
        if not include_completed:
            queryset = queryset.exclude(status="completed")
        subtasks = list(queryset)
        for subtask in subtasks[:]:
            subtasks.extend(subtask.get_all_subtasks(include_completed))
        return subtasks

    def get_completion_percentage(self):
        counts = self.subtasks.aggregate(
            total=models.Count("id"),
            completed=models.Count("id", filter=models.Q(status="completed")),
        )
        if not counts["total"]:
            return 100 if self.status == "completed" else 0
        return (counts["completed"] / counts["total"]) * 100

    def can_be_completed(self):
        return not self.subtasks.exclude(status__in=["completed", "cancelled"]).exists()

    def mark_completed(self, completion_date=None):
        if not self.can_be_completed():
            raise ValueError("Cannot complete task: some subtasks are not completed")
        self.status = "completed"
        self.completion_date = completion_date or timezone.now()
        self.save(update_fields=["status", "completion_date", "updated_at"])

    def assign_to(self, assignee):
        self.assigned_to = assignee
        self.save(update_fields=["assigned_to", "updated_at"])

    def add_tag(self, tag):
        if tag not in self.tags:
            self.tags.append(tag)
            self.save(update_fields=["tags", "updated_at"])

    def remove_tag(self, tag):
        if tag in self.tags:
            self.tags.remove(tag)
            self.save(update_fields=["tags", "updated_at"])

    def update_metadata(self, key, value):
        self.metadata[key] = value
        self.save(update_fields=["metadata", "updated_at"])

    def clean(self):
        attached = [self.versioned_entity_id, self.version_id, self.container_id]
        set_count = sum(1 for pk in attached if pk is not None)
        if set_count == 0:
            raise ValidationError(
                "Task must be attached to exactly one object "
                "(VersionedEntity, Version, or Container)."
            )
        if set_count > 1:
            raise ValidationError("Task can only be attached to one object at a time.")

        if self.parent_task_id:
            seen = set()
            current = self.parent_task
            while current:
                if current.pk == self.pk or current.pk in seen:
                    raise ValidationError("Circular reference detected in task hierarchy.")
                seen.add(current.pk)
                current = current.parent_task

    def save(self, *args, **kwargs):
        self.clean()
        super().save(*args, **kwargs)


def create_task_hierarchy(parent_obj, task_tree, assigned_to=None):
    """Create a task tree from nested {'title', ..., 'subtasks'} dicts."""

    def _create(task_data, parent_task=None):
        kwargs = {
            "title": task_data["title"],
            "description": task_data.get("description", ""),
            "task_type": task_data.get("task_type", "general"),
            "priority": task_data.get("priority", "normal"),
            "status": task_data.get("status", "pending"),
            "assigned_to": task_data.get("assigned_to", assigned_to or ""),
            "estimated_hours": task_data.get("estimated_hours"),
            "due_date": task_data.get("due_date"),
            "parent_task": parent_task,
            "tags": task_data.get("tags", []),
            "metadata": task_data.get("metadata", {}),
        }
        if isinstance(parent_obj, Container):
            kwargs["container"] = parent_obj
        elif isinstance(parent_obj, VersionedEntity):
            kwargs["versioned_entity"] = parent_obj
        elif isinstance(parent_obj, Version):
            kwargs["version"] = parent_obj
        else:
            raise ValueError(f"Unsupported parent object type: {type(parent_obj)}")

        task = Task.objects.create(**kwargs)
        for subtask_data in task_data.get("subtasks", []):
            _create(subtask_data, parent_task=task)
        return task

    if isinstance(task_tree, list):
        return [_create(data) for data in task_tree]
    return [_create(task_tree)]


def bulk_update_task_status(task_ids, new_status, assignee=None):
    update_fields = {"status": new_status}
    if assignee:
        update_fields["assigned_to"] = assignee
    if new_status == "completed":
        update_fields["completion_date"] = timezone.now()
    with transaction.atomic():
        return Task.objects.filter(pk__in=task_ids).update(**update_fields)
