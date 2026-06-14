"""Operational utilities for the container hierarchy. Run from a shell or
management command — not part of the request path."""

from .entities import Container


def initialize_materialized_paths():
    """(Re)build all container paths. Use after bulk imports."""
    return Container.objects.rebuild_materialized_paths()


def validate_materialized_paths(fix=True):
    """
    Verify every container's path/depth against its parent chain.

    Returns a summary dict; with fix=True (default) incorrect rows are
    repaired in place.
    """
    issues = []
    fixed = 0
    containers = {
        c.pk: c
        for c in Container.objects.select_related("parent_container").all()
    }

    for container in containers.values():
        parent = containers.get(container.parent_container_id)
        expected_path = (
            f"{parent.path}{container.code}/" if parent else f"/{container.code}/"
        )
        expected_depth = parent.depth + 1 if parent else 0

        if container.path != expected_path or container.depth != expected_depth:
            issues.append(
                f"Container {container.code}: expected path={expected_path} "
                f"depth={expected_depth}, got path={container.path} depth={container.depth}"
            )
            if fix:
                container.path = expected_path
                container.depth = expected_depth
                container.save(update_fields=["path", "depth"])
                fixed += 1

    return {
        "total_containers": len(containers),
        "issues_found": len(issues),
        "containers_fixed": fixed,
        "validation_passed": not issues,
        "issues": issues,
    }
