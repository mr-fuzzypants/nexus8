"""
Library endpoints for the reference-platform frontend (web/).

Two surfaces, both intentionally lightweight:

  POST /trackables/api/library/upload/   multipart ingest (multiple files)
  GET  /trackables/api/library/search/   unified search: tokens + free text,
                                         faceted counts computed per result set

Search grammar (single `q` param, parsed server-side):
  free text              -> matched against name/description/AI description/tags
  type:image             -> type_data.media_type
  tag:rust               -> user tags or AI-suggested tags
  status:completed       -> ai_analysis_status
  anything:value         -> generic type_data key match

Facets are aggregated in Python over the filtered set (capped). Fine for the
current scale; move to SQL jsonb aggregation when libraries get large.
"""

import re
import uuid
from collections import Counter
from functools import lru_cache

from asgiref.sync import async_to_sync
from django.core.paginator import Paginator
from django.db.models import Count, Q
from django.shortcuts import get_object_or_404
from pgvector.django import CosineDistance
from rest_framework import permissions, status
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import Board, Container, EntityRelation, MediaAsset
from .services.ai_intelligence import ai_service
from .services.ingest import ingest_file

TOKEN_PATTERN = re.compile(r'(\w+):("[^"]*"|\S+)')
FACET_SCAN_CAP = 5000
MAX_TAG_FACETS = 30
MAX_ENTITY_FACETS = 20

# Hybrid ranking: reciprocal rank fusion over the keyword and semantic lists.
RRF_K = 60
KEYWORD_POOL = 200
SEMANTIC_POOL = 100
SEMANTIC_MAX_DISTANCE = 0.8


@lru_cache(maxsize=256)
def query_embedding(text):
    """Embed a search query (cached per process). Returns tuple or None."""
    try:
        embedding = async_to_sync(ai_service.generate_embedding)(text)
        return tuple(embedding) if embedding else None
    except Exception:
        return None


def asset_summary(asset):
    """Compact shape the grid renders from — one dict, no nested fetches."""
    data = asset.type_data or {}
    technical = data.get("technical_metadata") or {}
    tags = list(dict.fromkeys((data.get("tags") or []) + (data.get("ai_suggested_tags") or [])))
    return {
        "id": asset.id,
        "code": asset.code,
        "name": asset.name,
        "description": asset.description,
        "media_type": data.get("media_type", ""),
        "file_path": data.get("file_path", ""),
        "thumbnails": data.get("thumbnails") or {},
        "placeholder": data.get("placeholder", ""),
        "width": technical.get("width"),
        "height": technical.get("height"),
        "tags": tags,
        "ai_description": data.get("ai_generated_description", ""),
        "ai_analysis_status": asset.ai_analysis_status,
        "created_at": asset.created_at.isoformat(),
    }


class LibraryUploadView(APIView):
    permission_classes = [permissions.IsAuthenticated]
    parser_classes = [MultiPartParser, FormParser]

    def post(self, request):
        files = request.FILES.getlist("files")
        if not files:
            return Response(
                {"detail": "No files provided (use multipart field 'files')."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        created, duplicates = [], []
        for uploaded in files:
            asset, was_created = ingest_file(
                uploaded,
                created_by=request.user if request.user.is_authenticated else None,
            )
            (created if was_created else duplicates).append(asset_summary(asset))

        return Response(
            {"created": created, "duplicates": duplicates},
            status=status.HTTP_201_CREATED if created else status.HTTP_200_OK,
        )


def parse_query(q):
    """Split `q` into ({key: [values]}, free_text)."""
    tokens = {}
    for key, value in TOKEN_PATTERN.findall(q):
        tokens.setdefault(key.lower(), []).append(value.strip('"'))
    free_text = TOKEN_PATTERN.sub("", q).strip()
    return tokens, free_text


def tag_match(tag):
    return Q(type_data__tags__contains=[tag]) | Q(
        type_data__ai_suggested_tags__contains=[tag]
    )


class LibrarySearchView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        params = request.query_params
        q = params.get("q", "").strip()
        tokens, free_text = parse_query(q)

        # Facet selections arrive as dedicated repeatable params so the chips
        # round-trip cleanly through the URL.
        for tag in params.getlist("tag"):
            tokens.setdefault("tag", []).append(tag)
        if params.get("media_type"):
            tokens.setdefault("type", []).append(params["media_type"])

        queryset = MediaAsset.objects.active()

        for media_type in tokens.pop("type", []):
            queryset = queryset.filter(type_data__media_type=media_type)
        for tag in tokens.pop("tag", []):
            queryset = queryset.filter(tag_match(tag))
        for value in tokens.pop("status", []):
            queryset = queryset.filter(ai_analysis_status=value)

        # Remaining tokens: entity-relation roles (character:wanda) when the
        # role exists, otherwise a generic type_data key match.
        relation_roles = set(
            EntityRelation.objects.values_list("role", flat=True).distinct()
        )
        for key, values in tokens.items():
            for value in values:
                if key in relation_roles:
                    queryset = queryset.filter(
                        entity_relations__role=key,
                        entity_relations__entity__name__iexact=value,
                    )
                else:
                    queryset = queryset.filter(**{f"type_data__{key}": value})

        page_size = min(int(params.get("page_size", 50)), 200)
        page_number = int(params.get("page", 1) or 1)
        mode = params.get("mode", "hybrid")

        if free_text:
            ordered_ids, match_labels = self.rank_hybrid(queryset, free_text, mode)
            facet_qs = MediaAsset.objects.filter(pk__in=ordered_ids)
            facets = self.build_facets(facet_qs)
            facets["entities"] = self.build_entity_facets(ordered_ids)

            start = (page_number - 1) * page_size
            page_ids = ordered_ids[start : start + page_size]
            assets = {a.pk: a for a in MediaAsset.objects.filter(pk__in=page_ids)}
            results = []
            for pk in page_ids:
                asset = assets.get(pk)
                if asset:
                    summary = asset_summary(asset)
                    summary["match"] = match_labels.get(pk, "keyword")
                    results.append(summary)
            count = len(ordered_ids)
            num_pages = max(1, -(-count // page_size))
            return Response(
                {
                    "count": count,
                    "page": page_number,
                    "num_pages": num_pages,
                    "results": results,
                    "facets": facets,
                }
            )

        queryset = queryset.order_by("-created_at")
        facets = self.build_facets(queryset)
        paginator = Paginator(queryset, page_size)
        page = paginator.get_page(page_number)
        facets["entities"] = self.build_entity_facets(
            list(queryset.values_list("id", flat=True)[:FACET_SCAN_CAP])
        )
        return Response(
            {
                "count": paginator.count,
                "page": page.number,
                "num_pages": paginator.num_pages,
                "results": [asset_summary(a) for a in page.object_list],
                "facets": facets,
            }
        )

    def rank_hybrid(self, queryset, free_text, mode):
        """Fuse keyword and semantic rankings (RRF). Returns (ids, labels)."""
        text_q = (
            Q(name__icontains=free_text)
            | Q(description__icontains=free_text)
            | Q(type_data__ai_generated_description__icontains=free_text)
        )
        for word in free_text.split():
            text_q |= tag_match(word.lower())

        keyword_ids = list(
            queryset.filter(text_q)
            .order_by("-created_at")
            .values_list("id", flat=True)[:KEYWORD_POOL]
        )

        semantic_ids = []
        if mode != "keyword":
            embedding = query_embedding(free_text)
            if embedding:
                semantic_ids = list(
                    queryset.filter(semantic_embedding__isnull=False)
                    .annotate(
                        distance=CosineDistance("semantic_embedding", list(embedding))
                    )
                    .filter(distance__lte=SEMANTIC_MAX_DISTANCE)
                    .order_by("distance")
                    .values_list("id", flat=True)[:SEMANTIC_POOL]
                )

        scores = {}
        for rank, pk in enumerate(keyword_ids):
            scores[pk] = scores.get(pk, 0.0) + 1.0 / (RRF_K + rank + 1)
        for rank, pk in enumerate(semantic_ids):
            scores[pk] = scores.get(pk, 0.0) + 1.0 / (RRF_K + rank + 1)

        keyword_set, semantic_set = set(keyword_ids), set(semantic_ids)
        labels = {
            pk: "both"
            if pk in keyword_set and pk in semantic_set
            else ("semantic" if pk in semantic_set else "keyword")
            for pk in scores
        }
        ordered = sorted(scores, key=lambda pk: -scores[pk])
        return ordered, labels

    def build_entity_facets(self, asset_ids):
        rows = (
            EntityRelation.objects.filter(asset_id__in=asset_ids)
            .values("role", "entity__name")
            .annotate(count=Count("id"))
            .order_by("-count")[:MAX_ENTITY_FACETS]
        )
        return [
            {"role": row["role"], "value": row["entity__name"], "count": row["count"]}
            for row in rows
        ]

    def build_facets(self, queryset):
        rows = queryset.values_list("type_data", "ai_analysis_status")[:FACET_SCAN_CAP]
        tag_counts, type_counts, status_counts = Counter(), Counter(), Counter()
        for type_data, ai_status in rows:
            data = type_data or {}
            seen = set((data.get("tags") or []) + (data.get("ai_suggested_tags") or []))
            tag_counts.update(seen)
            if data.get("media_type"):
                type_counts[data["media_type"]] += 1
            if ai_status:
                status_counts[ai_status] += 1
        return {
            "tags": [
                {"value": value, "count": count}
                for value, count in tag_counts.most_common(MAX_TAG_FACETS)
            ],
            "media_type": [
                {"value": value, "count": count}
                for value, count in type_counts.most_common()
            ],
            "status": [
                {"value": value, "count": count}
                for value, count in status_counts.most_common()
            ],
        }


# ---------------------------------------------------------------------------
# Boards
# ---------------------------------------------------------------------------

def board_summary(board):
    items = (board.canvas or {}).get("items", [])
    return {
        "id": board.id,
        "code": board.code,
        "name": board.name,
        "item_count": len(items),
        "updated_at": board.updated_at.isoformat(),
        "created_at": board.created_at.isoformat(),
    }


def hydrate_assets(asset_ids):
    """Map asset_id -> grid summary for every referenced canvas item."""
    assets = MediaAsset.objects.filter(id__in=set(asset_ids))
    return {asset.id: asset_summary(asset) for asset in assets}


def board_detail(board):
    detail = board_summary(board)
    detail["canvas"] = board.canvas or {"items": []}
    detail["assets"] = hydrate_assets(board.asset_ids())
    latest = board.versions.order_by("-version_number").first()
    detail["snapshot_version"] = latest.version_number if latest else None
    return detail


def preview_thumbs(board, limit=4):
    assets = hydrate_assets(board.asset_ids()[:limit])
    thumbs = []
    for asset_id in board.asset_ids()[:limit]:
        asset = assets.get(asset_id)
        if asset:
            thumbs.append(asset["thumbnails"].get("256") or asset["file_path"])
    return thumbs


class BoardListView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        boards = Board.objects.active().order_by("-updated_at")
        return Response(
            [{**board_summary(b), "preview_thumbs": preview_thumbs(b)} for b in boards]
        )

    def post(self, request):
        name = (request.data.get("name") or "Untitled board").strip()
        canvas = request.data.get("canvas") or {"items": []}
        board = Board.objects.create(
            code=f"board_{uuid.uuid4().hex[:10]}",
            name=name,
            type_data={"canvas": canvas},
        )
        return Response(board_detail(board), status=status.HTTP_201_CREATED)


class BoardDetailView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get_board(self, pk):
        return get_object_or_404(Board.objects.active(), pk=pk)

    def get(self, request, pk):
        return Response(board_detail(self.get_board(pk)))

    def patch(self, request, pk):
        board = self.get_board(pk)
        update_fields = ["updated_at"]
        if "name" in request.data:
            board.name = (request.data["name"] or board.name).strip()
            update_fields.append("name")
        if "canvas" in request.data:
            board.canvas = request.data["canvas"] or {"items": []}
            update_fields.append("type_data")
        board.save(update_fields=update_fields)
        return Response(board_summary(board))

    def delete(self, request, pk):
        self.get_board(pk).archive()
        return Response(status=status.HTTP_204_NO_CONTENT)


class BoardSnapshotView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, pk):
        board = get_object_or_404(Board.objects.active(), pk=pk)
        version = board.snapshot(
            created_by=request.user if request.user.is_authenticated else None
        )
        return Response(
            {"version_number": version.version_number, "created_at": version.created_at},
            status=status.HTTP_201_CREATED,
        )


class CollectionCreateView(APIView):
    """Save a basket as a Container whose first version lists the member assets."""

    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        name = (request.data.get("name") or "").strip()
        asset_ids = request.data.get("asset_ids") or []
        if not name:
            return Response(
                {"detail": "name is required"}, status=status.HTTP_400_BAD_REQUEST
            )
        container = Container.objects.create(
            code=f"collection_{uuid.uuid4().hex[:10]}",
            name=name,
        )
        container.publish(
            data={"assets": asset_ids, "source": "basket"},
            created_by=request.user if request.user.is_authenticated else None,
        )
        return Response(
            {"id": container.id, "code": container.code, "name": container.name},
            status=status.HTTP_201_CREATED,
        )
