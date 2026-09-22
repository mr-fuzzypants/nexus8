# Design & Implementation Plan: Identity & Access Control


> Status: for review. Scope: backend-first + minimal frontend. Later phases (watermarking, audit, secure delivery, external accept-flow, admin UI) are out of scope here, but the model is built forward-compatible with them. No Django `GenericForeignKey`/contenttypes anywhere — the schema is intended to port cleanly to Prisma.

---

## 1. Context & Motivation

nexus8 was built as an internal CG tool on the assumption that **every authenticated user can see and edit everything**:
- DRF default is `IsAuthenticated` only ([settings.py:176](nexus8/nexus8/settings.py#L176)); no row-level filtering anywhere.
- Authentication in dev is `DevAutoAuthentication`, which auto-logs-in a single shared `dev` user ([dev_auth.py](nexus8/nexus8/dev_auth.py)).
- There is no real login, no `/me`, no users/teams/roles concept, and no notion of an asset being visible to some people and not others.

core value is **secure, scoped distribution**: content is shown to specific people at specific access levels, with an audit trail. Every other security pillar (watermarking, audit, secure delivery) presupposes an identity + access-control foundation. This document specifies that foundation.

### Decisions locked with the user
- **Granularity:** Project-level roles + a durable, curated **Collection** of assets as the shareable sub-project unit (plus single-asset sharing — §3).
- **Auth:** Real internal login (session for the SPA, JWT issuance for API/future external); authz enforcement now; external-invite **data model only** (accept-flow deferred).
- **Build scope:** Backend-first, plus minimal frontend (login screen + auth context + httpService wiring).
- **Portability:** Avoid `GenericForeignKey`; use explicit typed FK columns so the schema maps to Prisma relations.

---

## 2. Goals & Non-Goals

**Goals**
1. Users, Teams, and Roles as first-class concepts.
2. Row-level access control on assets/entities, enforced at the **queryset** layer (not just per-object), so unauthorized rows never appear in lists/search.
3. A durable, curated **Collection** as the share unit — which also repairs the broken basket→collection flow.
4. Real internal login (session + JWT), `/me`, and grant-management endpoints.
5. A model general enough that finer granularities (per-container subtree, per-version) are additive later, not rewrites.

**Non-Goals (this phase)** — see §13 for the roadmap.
- External-collaborator accept/register flow & scoped external accounts (modeled, not wired).
- Full team/share admin UI (minimal grant endpoints only).
- Watermarking, audit log, secure/expiring delivery (Pillars 2–3).
- Per-version and per-container-subtree *resolution* (added as columns/branches in their phases).
- Field-level redaction (hiding individual metadata fields).

---

## 3. Granularity Model

Access is the product of **three independent axes**. Keeping them orthogonal is what keeps the model small.

```
  WHO (principal)   ×   WHAT (scope)   ×   HOW MUCH (capability/role)
  user / team /         project /           viewer / commenter /
  external              collection /        editor / admin
                        asset / …
```

### 3.1 Scope axis — *what a grant covers*

`AccessGrant` carries **one explicit, typed nullable FK per scope kind** (`scope_project`, `scope_collection`, `scope_asset`, …), with a check constraint that exactly one is set — the same idiom the codebase already uses for `Discussion`/`Task` (multiple nullable FKs + `CheckConstraint`). **No `GenericForeignKey`/contenttypes and no discriminator branching**, so each maps to a plain optional relation in Prisma. Adding a finer scope later = one new nullable column, not a rewrite. (All scope columns happen to reference the single `VersionedEntity` table via distinct, named relations — a normal FK, not a generic one.)

| Level | Scope column | Representative use case | How it resolves to assets | Phase |
|---|---|---|---|---|
| **Project** | `scope_project` | "Alice is an *editor* on the WANDA project." | `type_data.project_code == project.code` (every asset/entity in the partition) | **In scope** |
| **Collection** | `scope_collection` | "Share the *EP3 Hero Looks* collection with an external grading vendor as *viewer*." | `CollectionMembership.asset` where `collection ∈ granted` | **In scope** |
| **Single asset** | `scope_asset` | "Send *one* final render to the client for sign-off, nothing else." | `Q(id == scope_asset_id)` — direct | **In scope** (one extra column) |
| **Container subtree (entities)** | `scope_container` *(added that phase)* | "The Costume dept sees the whole *Costume* entity subtree." | materialized `path` prefix on entities (`entities.py` `path/depth`), then their assets | **Deferred** |
| **Per-version** | `scope_version` (FK→`Version`) *(added that phase)* | "Client sees the *approved* v3, not WIP versions." | filter `Version` queryset to the pinned version(s) | **Deferred** (also needs version-queryset enforcement) |
| **Board** | `scope_board` *(added that phase)* | "Share a moodboard read-only." | `board.canvas.items[].asset_id` (`boards.py` `asset_ids()`) | **Deferred** |

> Why per-asset is in scope: one nullable column + a direct `Q(id=...)`, and it unlocks the common "approve this one thing" flow. The deferred scopes each add one nullable column + a resolution branch (per-version also needs version/symlink queryset filtering), so they slot in without reshaping the table.

### 3.2 Principal axis — *who holds a grant*

| Principal | Use case | Resolution |
|---|---|---|
| **User** | Individual grant. | `AccessGrant.principal_user = user`. |
| **Team** | "The whole *Lighting* team gets *editor* on the project." | `AccessGrant.principal_team = team`; `effective_grants(user)` unions grants of every team the user belongs to (`TeamMembership`). |
| **External invite** | "Invite `vendor@studio.com` as viewer on a collection." | `ExternalInvite` row now; on accept (deferred) it materializes a `User` + `AccessGrant`. |
| **Public/link** *(future)* | "Anyone with the link can view." | Token-scoped grant; not modeled this phase. |

`AccessGrant` has a `CheckConstraint` that exactly one of `principal_user` / `principal_team` is set.

### 3.3 Capability axis — *how much a grant allows*

Roles are ranked; the **highest applicable** grant wins. Each role maps to a capability set; HTTP methods map to a required capability.

| Role (rank) | Capabilities | Can do |
|---|---|---|
| **viewer** (1) | `view` | See/list/search, view detail, download per delivery rules. |
| **commenter** (2) | `view`, `comment` | + create discussions/comments/annotations (review without changing the asset). |
| **editor** (3) | `view`, `comment`, `edit` | + edit metadata/tags, publish versions, add/remove collection membership. |
| **admin** (4) | `view`, `comment`, `edit`, `manage` | + grant/revoke access on the scope, delete, transfer ownership. |

| HTTP method / action | Required capability |
|---|---|
| `GET`/`HEAD`/`OPTIONS` | `view` |
| create comment/discussion/annotation | `comment` |
| `POST`/`PUT`/`PATCH` on entities; membership add/remove | `edit` |
| `DELETE`; grant create/revoke; ownership change | `manage` |

**Owner & superuser shortcuts:** the row `owner` always has `admin`; `is_superuser`/`is_staff` (incl. the dev user) bypass entirely.

---

## 4. Model Changes (what changes, and why)

### 4.1 New: curated **Collection** + membership — `nexus8/trackables/models/collections.py`
Distinct from the existing query-based `smart_collection`. This is the durable share unit and the fix for basket→collection.

```python
@register_entity_type("collection")
class Collection(VersionedEntity):
    # type_data: {project_code?: str, description?: str}
    # curated, durable membership (below); optional publish() snapshot kept for reproducibility
    ...

class CollectionMembership(Trackable):
    collection = FK(VersionedEntity, on_delete=CASCADE, related_name="collection_memberships")  # entity_type='collection'
    asset      = FK(VersionedEntity, on_delete=CASCADE, related_name="memberships")              # entity_type='media_asset'
    added_by   = FK(User, null=True, on_delete=SET_NULL)
    added_at   = DateTimeField(auto_now_add=True)
    class Meta:
        constraints = [UniqueConstraint(fields=["collection", "asset"], name="uniq_collection_asset")]
        indexes = [Index(fields=["collection"]), Index(fields=["asset"])]
```
**Rationale:** there is *no* durable curated asset set today — containers hold *entities* not assets; basket "Save as collection" pins assets into `Version.data` and can't be edited afterward ([views_library.py:425](nexus8/trackables/views_library.py#L425)). A live membership table fixes both the ACL share-unit need and the editing limitation, and finally answers "what assets are in this folder?" (no such query exists today). Plain explicit FKs — no generic relations.

### 4.2 New: identity & authz tables — `nexus8/access/models.py` (new app, mirrors `discussions`)
```python
class Team(Trackable):            # slug, name, description, created_by(FK User)
class TeamMembership(Trackable):  # team(FK), user(FK User), role in {member, lead}; unique(team, user)

ROLE_CHOICES = [("viewer", 1), ("commenter", 2), ("editor", 3), ("admin", 4)]  # ranked

class AccessGrant(Trackable):
    # Principal — exactly one set (explicit columns, no polymorphism)
    principal_user = FK(User, null=True, on_delete=CASCADE, related_name="access_grants")
    principal_team = FK(Team, null=True, on_delete=CASCADE, related_name="access_grants")
    # Scope — exactly one set. Explicit typed nullable FKs (Discussion/Task idiom, NOT GenericForeignKey).
    # All reference VersionedEntity (one physical table) via distinct named relations → clean Prisma relations.
    scope_project    = FK(VersionedEntity, null=True, on_delete=CASCADE, related_name="project_grants")     # entity_type='project'
    scope_collection = FK(VersionedEntity, null=True, on_delete=CASCADE, related_name="collection_grants")  # entity_type='collection'
    scope_asset      = FK(VersionedEntity, null=True, on_delete=CASCADE, related_name="asset_grants")       # entity_type='media_asset'
    role           = CharField(choices=[(k, k) for k, _ in ROLE_CHOICES])
    granted_by     = FK(User, null=True, on_delete=SET_NULL)
    expires_at     = DateTimeField(null=True)
    created_at     = DateTimeField(auto_now_add=True)
    class Meta:
        constraints = [
            CheckConstraint(  # exactly one principal
                condition=(Q(principal_user__isnull=False) ^ Q(principal_team__isnull=False)),
                name="grant_exactly_one_principal"),
            CheckConstraint(  # exactly one scope (count of non-null scope cols == 1; same approach as Discussion)
                condition=<exactly one of scope_project / scope_collection / scope_asset non-null>,
                name="grant_exactly_one_scope"),
        ]
        indexes = [Index(fields=["principal_user"]), Index(fields=["principal_team"]),
                   Index(fields=["scope_project"]), Index(fields=["scope_collection"]),
                   Index(fields=["scope_asset"])]

class ExternalInvite(Trackable):  # email, role, token(unique), expires_at, accepted_at,
                                  # accepted_by(FK User null), created_by(FK User null)
                                  # + same explicit scope_project / scope_collection / scope_asset nullable FKs
```
**Rationale:** explicit typed scope columns mirror the existing `Discussion`/`Task` multi-FK + `CheckConstraint` pattern ([discussions/models.py:138](nexus8/discussions/models.py#L138)) and avoid any Django-specific `GenericForeignKey`, so the schema ports to Prisma as plain optional relations. Finer scopes (`scope_container`, `scope_version`→`Version`, `scope_board`) are added as their own nullable columns in their phases — additive migrations, no reshape.

### 4.3 Modified: `owner` on the base entity — `nexus8/trackables/models/entities.py`
```python
owner = FK(User, null=True, blank=True, on_delete=SET_NULL, related_name="owned_entities")  # + db_index
```
Stamp `owner=request.user` in ingest ([ingest.py:253](nexus8/trackables/services/ingest.py#L253)) and on entity create in viewsets. **Rationale:** "you can always access what you created" without an explicit self-grant; the natural default `manage` holder.

### 4.4 Settings — `nexus8/nexus8/settings.py`
- `INSTALLED_APPS += ['access']`.
- `DEFAULT_AUTHENTICATION_CLASSES = [SessionAuthentication, JWTAuthentication]` (drop `BasicAuthentication`); keep the `NEXUS8_DEV_OPEN` override that swaps in `DevAutoAuthentication`.
- Add `djangorestframework-simplejwt`.

### 4.5 Dev auth — `nexus8/nexus8/dev_auth.py`
Seed the `dev` user with `is_superuser=True` so the local workflow bypasses ACL (no regression while developing).

---

## 5. Resolution Algorithm — `nexus8/access/resolution.py`
Single source of truth, reused by every queryset filter and object permission.

```python
def effective_grants(user):
    """All non-expired grants for the user, directly or via team membership."""
    team_ids = TeamMembership.objects.filter(user=user).values("team_id")
    return AccessGrant.objects.filter(
        Q(principal_user=user) | Q(principal_team__in=team_ids)
    ).exclude(expires_at__lt=now())

def accessible_entities_q(user) -> Q:
    if not user.is_authenticated:           return Q(pk__in=[])      # nothing
    if user.is_superuser or user.is_staff:  return Q()               # everything (incl. dev user) — zero filter cost

    grants = list(effective_grants(user).select_related("scope_project"))
    project_codes  = {g.scope_project.code for g in grants if g.scope_project_id}   # read explicit column
    collection_ids = [g.scope_collection_id for g in grants if g.scope_collection_id]
    direct_ids     = [g.scope_asset_id      for g in grants if g.scope_asset_id]
    # DEFERRED branches (documented, not built): scope_container subtree, scope_version

    q = Q(owner=user)                                                # always
    if project_codes:                                               # build dynamically — skip empty branches
        q |= Q(type_data__project_code__in=project_codes)
        q |= Q(entity_type="project", code__in=project_codes)       # the project rows themselves
    if collection_ids:
        member_ids = CollectionMembership.objects.filter(
            collection_id__in=collection_ids).values("asset_id")
        q |= Q(id__in=collection_ids) | Q(id__in=member_ids)
    if direct_ids:
        q |= Q(id__in=direct_ids)
    return q

def role_for(user, entity) -> str | None:   # highest-ranked applicable role ('admin' if owner/staff)
def can(user, entity, capability) -> bool:  # capability ∈ {view,comment,edit,manage}; compares role rank
```
**Note:** the `Q` is built dynamically so a project-only user gets a lean `owner=user OR project_code IN (...)` predicate rather than a wide OR with empty `IN ()` branches. See §11 for the performance analysis behind this.

---

## 6. Enforcement Layer — `nexus8/access/permissions.py`
- **`AccessControlledQuerysetMixin`** — `get_queryset()` → `super().get_queryset().filter(accessible_entities_q(self.request.user))`. Mix into the entity viewsets in [trackables/views.py](nexus8/trackables/views.py) (`ContainerViewSet`, `VersionedEntityViewSet`, `MediaAssetViewSet`, `UnifiedVersionedEntityViewSet`) and apply the same `Q` inside `LibrarySearchView` ([views_library.py:154](nexus8/trackables/views_library.py#L154), beside the existing `project` partition) and the collection asset-list endpoints.
- **Version / Discussion / Task querysets** — filter by parent-entity access: `…filter(entity__in=VersionedEntity.objects.filter(accessible_entities_q(user)))`. Apply in `VersionViewSet`, `UnifiedVersionViewSet`, and the discussions/tasks viewsets.
- **`HasEntityCapability`** (DRF object-level permission) — maps method→capability (§3.3) and calls `can()`, so a `viewer` lists but `403`s on write.
- **Grant-management API** — `nexus8/access/views.py` + router under `/trackables/api/access/`: `teams/`, `grants/` (CRUD, `manage`-gated on the scope entity), `invites/` (create + revoke; **accept-flow stubbed → 501**).

---

## 7. Authentication / Login — `nexus8/access/auth_views.py`
- `/trackables/api/auth/`: `POST login/` (`django.contrib.auth.login`, session), `POST logout/`, `GET me/` (user + teams + coarse capability summary), `GET csrf/` (sets the CSRF cookie).
- SimpleJWT: `POST token/` + `token/refresh/` for API / future external use.
- `DevAutoAuthentication` retained behind `NEXUS8_DEV_OPEN=1` (now a superuser → bypass).

---

## 8. Curated-Collection API (membership) — extend `trackables/views_library.py` + `urls.py`
- `GET  /trackables/api/library/collections/<code>/assets/` — list members (the missing "what's in this folder" query).
- `POST /trackables/api/library/collections/<code>/assets/` — add (`{asset_ids:[…]}`) → `CollectionMembership` rows (`edit`).
- `DELETE /trackables/api/library/collections/<code>/assets/<id>/` — remove (`edit`).
- **Repoint** `CollectionCreateView` to create a `Collection` entity + insert membership rows (keep an optional `publish()` snapshot for reproducibility). Frontend `createCollection` already sends `asset_ids` ([web/src/api/boards.ts:73](web/src/api/boards.ts#L73)) — only the backend target changes.

---

## 9. Minimal Frontend — `web/src/features/auth/`
- **`authStore.ts`** (Zustand, like the basket store): `user`, `login()`, `logout()`, `fetchMe()`.
- **httpService** ([web/src/api/library.ts:1](web/src/api/library.ts#L1)): `withCredentials: true`; request interceptor injects `X-CSRFToken` from cookie; response interceptor on `401` → clear store → route to login.
- **`LoginPage.tsx`** (Mantine form) + shell guard: if `fetchMe()` 401s (and not dev-open), render login instead of the app shell; show current user + logout in the nav rail.
- *(Optional, deferrable)* surface `effective_role` per asset in the grid serializer so the UI hides edit affordances for viewers.

---

## 10. Migration & Rollout
1. `access` app migration `0001` (Team, TeamMembership, AccessGrant, ExternalInvite).
2. `trackables` migration: add `owner` to `VersionedEntity`; register `Collection` proxy (no DDL) + create `CollectionMembership`; **add the project-code expression index** (§11).
3. **Backfill:** `owner` stays null on existing rows (safe — superuser/dev bypass keeps everything visible during transition). Optional management command to seed an `admin` `AccessGrant` per existing project for real users once login is on.
4. **Cutover:** ACL filters are inert while `NEXUS8_DEV_OPEN=1` (dev user is superuser). Flip `NEXUS8_DEV_OPEN=0` to exercise enforcement. Feature lands without breaking the dev loop.

---

## 11. Performance Impact & Concerns

Every list/search/detail query now ANDs in `accessible_entities_q(user)`. Analysis by path:

### 11.1 Per-request grant resolution
- `effective_grants(user)` is **one** indexed query on a small `AccessGrant` table (filtered by `principal_user` / team-membership subquery). Negligible.
- **Recommendation:** memoize the resolved `(project_codes, collection_ids, direct_ids)` on the `request` object — a single request touches several querysets (entities, versions, discussions, tasks) and should not recompute grants for each.

### 11.2 The access predicate, branch by branch
- `Q(owner=user)` — indexed FK. Fast.
- `Q(type_data__project_code__in=…)` — **the main concern.** This JSONB text lookup (`type_data->>'project_code'`) is now on the hot path for *every* query. A GIN `jsonb_ops` index does **not** accelerate `->>` equality/IN. **Recommendation (load-bearing):** add a B-tree **expression index** `CREATE INDEX … ON trackables_versionedentity ((type_data->>'project_code'))`. The existing project partition ([views_library.py:154](nexus8/trackables/views_library.py#L154)) already relies on this lookup, so this index helps current code too. Build with `CONCURRENTLY` in prod.
- `Q(entity_type="project", code__in=…)` — `entity_type` is indexed; `code` is unique. Fast, small.
- `Q(id__in=collection_ids)` / `Q(id__in=direct_ids)` — small PK `IN` lists. Fast.
- `Q(id__in=member_ids)` — semi-join over `CollectionMembership` on the indexed `collection_id` FK; Postgres executes as a hash/semi-join. Bounded by collection sizes; fine even for large collections.

### 11.3 OR-composition & dynamic query building
A wide `OR` can produce `BitmapOr` plans and, with empty `IN ()` branches, wasted predicates. **Mitigation already in the design (§5):** build the `Q` dynamically, adding only non-empty branches. A typical internal user with one project grant gets `owner=user OR project_code IN (...)` — two index scans, not six. EXPLAIN-verify the BitmapOr plan on the grid query.

### 11.4 Superuser/staff bypass = zero overhead
`accessible_entities_q` returns an empty `Q()` for superuser/staff (and the dev user), so the **hottest internal path and the entire dev loop carry no filtering cost**. The overhead is paid only for genuinely scoped (e.g., external/vendor) users.

### 11.5 Semantic search (pgvector HNSW) — the subtle one
`LibrarySearchView` ranks via pgvector HNSW (`semantic_embedding`, `SEMANTIC_POOL=100`). Combining a **restrictive** ACL `WHERE` with HNSW triggers the known **filtered-kNN** problem: when a user's accessible set is a tiny fraction of the corpus, HNSW may return few/no in-set neighbors without over-fetching, hurting recall/latency.
- **Internal users** (bypass or broad project scope): negligible — the filter is permissive.
- **Narrowly-scoped users** (vendor with one small collection): **recommendation** — for these, pre-resolve the accessible `id` set and either (a) rank within it directly when it's small, or (b) raise the over-fetch pool and post-filter. Monitor recall. This only matters once external scoped users exist (the accept-flow is deferred anyway), so it can be tuned in the external-collaborator phase; flag it now so it isn't a surprise.

### 11.6 Secondary querysets (Version / Discussion / Task)
Each becomes `entity__in=(VersionedEntity.objects.filter(accessible_entities_q))` — a semi-join on an indexed FK. Acceptable; reuse the memoized predicate (§11.1) so the subquery is built once.

### 11.7 Writes & migration cost
- Owner stamping = one extra column write on ingest/create. Negligible.
- Adding the nullable `owner` column is a **metadata-only** change in Postgres (no full table rewrite), fast even on the large `VersionedEntity` table. New indexes are a one-time build (use `CONCURRENTLY`).
- `CollectionMembership` growth is O(asset × collection-memberships), indexed both directions — fine at the stated 10M-asset target provided collections stay bounded sets (not whole-library).

### 11.8 Ranked concerns
1. **JSONB `project_code` on the hot path** → add the B-tree expression index (§11.2). *Highest impact, easy.*
2. **pgvector filtered-kNN recall** for narrowly-scoped users (§11.5). *Defer-tunable; flagged.*
3. **OR plan quality** → dynamic `Q` + EXPLAIN (§11.3).
4. **Repeated grant resolution per request** → memoize on `request` (§11.1).

---

## 12. Verification
**Unit tests** (`nexus8/access/tests/`):
- Resolution: project grant exposes its assets + project row; collection grant exposes the collection + its `CollectionMembership` assets but **not** non-members; single-asset grant exposes exactly that asset; removing a membership row revokes access; expired grant excluded; team grant via membership; owner always has access; superuser/staff bypass; no-grant user → empty queryset.
- Permissions: `viewer` lists but 403s on PATCH/DELETE; `commenter` can comment, not edit; `editor` edits but can't manage grants; `admin` can grant/revoke.
- Collection: add/remove membership reflects in `collections/<code>/assets/`; basket promotion creates a `Collection` with member rows.
- Auth: login/logout/me happy path + bad-password 401; JWT issue/refresh.

**Performance checks:**
- `EXPLAIN ANALYZE` the grid/search query for (a) superuser (expect no ACL predicate), (b) project-scoped internal user (expect index scan on the project-code expression index), (c) collection-only scoped user (expect semi-join on `CollectionMembership`). Confirm the project-code expression index is used and no seq-scan on `VersionedEntity`.

**Manual E2E** (Django :8000 with `NEXUS8_DEV_OPEN=0`, Vite dev server):
- Create users A/B; a Project with assets; a Collection (via basket "Save as collection") holding a subset; one single asset; an unrelated project.
- Grant A `viewer` on the project, B `viewer` on the collection, B `viewer` on the single asset.
- Log in via the new SPA login as each: A sees the whole project; B sees only the collection members + the one shared asset; neither sees the other's; viewer edit controls 403.
- Add an asset to the collection → B sees it; remove → B loses it.
- Set `NEXUS8_DEV_OPEN=1` → dev user sees everything (no regression).

**Regression:** existing library search/grid returns results for an authorized user; `project` partition still composes with the new filter; existing `smart_collection` listing untouched.

---

## 13. Roadmap / Future Phases (forward-compatibility notes)
- **Per-container-subtree grants:** add a `scope_container` nullable FK + a resolution branch using the materialized `path` prefix over entities (additive migration).
- **Per-version grants:** add a `scope_version` nullable FK (→`Version`) + version/symlink queryset filtering (client sees only the `approved` symlink target).
- **External accept-flow:** wire `ExternalInvite` → email send → accept → create scoped `User` + `AccessGrant`; scoped external users see no project list, only granted collections/assets. (Tune pgvector filtered-kNN here — §11.5.)
- **Board sharing & public links:** add a `scope_board` branch (`canvas` asset_ids) and a token-based public-link grant.
- **Admin/share UI:** full team management + per-asset/collection "Share…" dialog with role pickers and expiry.
- **Pillars 2–3 build on this:** forensic watermarking keyed to the resolved `(user, grant)`; audit log of `view`/`download` events per grant; secure/expiring delivery URLs gated by `can(user, asset, 'view')`.
- **Field-level redaction:** hide individual metadata fields by role (not modeled here).
