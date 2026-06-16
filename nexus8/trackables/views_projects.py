"""
Project endpoints for the reference-platform SPA (web/).

  GET/POST /library/projects/             list (with rollup counts) / create
  GET      /library/projects/<code>/      landing payload: header + stats +
                                          entities-by-category + recent assets
  POST     /library/projects/<code>/assign/  stamp project_code on entities/assets

Projects are the top-level scope. Membership is the denormalized
``type_data.project_code`` on each entity/asset row, so every query here is a
single filter over the shared entity table — no joins.
"""

import uuid

from django.db.models import Count, Q
from django.shortcuts import get_object_or_404
from rest_framework import permissions, status
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import MediaAsset, Project, VersionedEntity
from .models.projects import PROJECT_STATUSES
from .views_intelligence import ENTITY_CATEGORIES, _slug, entity_summary
from .views_library import asset_summary

# How many assets/thumbs to surface on the landing page.
RECENT_ASSETS = 12
CATEGORY_THUMBS = 4


def _scoped(queryset, code):
    """Restrict a VersionedEntity queryset to one project (hard partition)."""
    return queryset.filter(type_data__project_code=code)


def _thumb(asset):
    data = asset.type_data or {}
    return (data.get("thumbnails") or {}).get("256") or data.get("file_path", "")


def project_summary(project, *, asset_count=None, entity_count=None, cover_thumb=""):
    return {
        "id": project.id,
        "code": project.code,
        "name": project.name,
        "description": project.description,
        "status": project.status,
        "started_at": project.started_at,
        "cover_thumb": cover_thumb,
        "asset_count": asset_count,
        "entity_count": entity_count,
        "updated_at": project.updated_at.isoformat(),
    }


def _cover_thumb(project):
    """Pinned cover asset if set, else the project's most recent asset."""
    assets = _scoped(MediaAsset.objects.active(), project.code)
    if project.cover_asset_code:
        cover = assets.filter(code=project.cover_asset_code).first()
        if cover:
            return _thumb(cover)
    latest = assets.order_by("-created_at").first()
    return _thumb(latest) if latest else ""


class ProjectListView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        payload = []
        for project in Project.objects.active().order_by("name"):
            payload.append(
                project_summary(
                    project,
                    asset_count=_scoped(MediaAsset.objects.active(), project.code).count(),
                    entity_count=_scoped(
                        VersionedEntity.objects.filter(
                            entity_type="entity", archived_at__isnull=True
                        ),
                        project.code,
                    ).count(),
                    cover_thumb=_cover_thumb(project),
                )
            )
        return Response(payload)

    def post(self, request):
        name = (request.data.get("name") or "").strip()
        if not name:
            return Response({"detail": "name required"}, status=status.HTTP_400_BAD_REQUEST)
        status_value = (request.data.get("status") or "active").strip().lower()
        if status_value not in PROJECT_STATUSES:
            status_value = "active"
        project = Project.objects.create(
            code=f"project_{_slug(name)}_{uuid.uuid4().hex[:6]}",
            name=name,
            description=(request.data.get("description") or "").strip(),
            type_data={"status": status_value},
        )
        return Response(
            project_summary(project, asset_count=0, entity_count=0),
            status=status.HTTP_201_CREATED,
        )


class ProjectDetailView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request, code):
        project = get_object_or_404(Project.objects.active(), code=code)

        assets = _scoped(MediaAsset.objects.active(), code)
        entities = _scoped(
            VersionedEntity.objects.filter(
                entity_type="entity", archived_at__isnull=True
            ),
            code,
        ).annotate(n_assets=Count("asset_relations"))

        # AI-analysis rollup across the project's assets.
        ai_rows = assets.values("ai_analysis_status").annotate(n=Count("id"))
        ai = {row["ai_analysis_status"] or "pending": row["n"] for row in ai_rows}

        # Entities grouped by category, with a few thumbnails per group.
        by_category = []
        for category in ENTITY_CATEGORIES:
            members = list(entities.filter(type_data__category=category).order_by("name"))
            if not members:
                continue
            thumbs = []
            for entity in members[:CATEGORY_THUMBS]:
                rel = entity.asset_relations.select_related("asset").first()
                if rel and (thumb := _thumb(rel.asset)):
                    thumbs.append(thumb)
            by_category.append(
                {
                    "category": category,
                    "count": len(members),
                    "thumbs": thumbs,
                    "entities": [
                        entity_summary(e, asset_count=e.n_assets) for e in members[:12]
                    ],
                }
            )

        recent = [
            asset_summary(a) for a in assets.order_by("-created_at")[:RECENT_ASSETS]
        ]

        return Response(
            {
                **project_summary(
                    project,
                    asset_count=assets.count(),
                    entity_count=entities.count(),
                    cover_thumb=_cover_thumb(project),
                ),
                "stats": {
                    "total_assets": assets.count(),
                    "total_entities": entities.count(),
                    "ai": ai,
                },
                "entities_by_category": by_category,
                "recent_assets": recent,
            }
        )


class ProjectAssignView(APIView):
    """Stamp (or clear) project_code on a set of entities/assets."""

    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, code):
        project = None
        if code != "_none":
            project = get_object_or_404(Project.objects.active(), code=code)

        ids = request.data.get("entity_ids") or []
        if not isinstance(ids, list) or not ids:
            return Response(
                {"detail": "entity_ids (non-empty list) required"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        updated = 0
        for entity in VersionedEntity.objects.filter(pk__in=ids):
            data = dict(entity.type_data or {})
            if project is None:
                data.pop("project_code", None)
            else:
                data["project_code"] = project.code
            entity.type_data = data
            entity.save(update_fields=["type_data", "updated_at"])
            updated += 1

        return Response({"updated": updated, "project_code": project.code if project else None})
