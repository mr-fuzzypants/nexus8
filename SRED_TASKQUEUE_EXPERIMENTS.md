# SR&ED Project Documentation & Technical Plan
# Background Task Execution & Operation Status Propagation — Queue-Substrate Experiments

**Project codename:** nexus8 backend — operation task queue (dispatch/poll/ingest offload, live status)
**Claim period:** FY2026 (research commenced August 2026, ongoing)
**Systems involved:** nexus8 Django backend (`OperationJob` envelope, video-op registry, dispatch/poll/ingest services), Postgres (queue broker candidate via LISTEN/NOTIFY), Modal.com GPU ops (SAM 2 segmentation, VACE/VOID/DiffuEraser removal), nexus8 SPA (op rows, run/poll UI)
**Prepared:** August 11 2026 — living document; update as experimental work proceeds

**Related documents:** `SRED_VIDEOOP_EXPERIMENTS.md` (op envelope; uncertainties referenced as VOP-U3/VOP-U8, findings VOP-F…), `SRED_OPGRAPH_EXPERIMENTS.md` (op-centric surface; OPG-F5's slow-ingest phase-label follow-up lands here), `FILESET_MODEL.md`. Findings herein referenced from other documents as **TQ-F1…**, uncertainties **TQ-U1…**.

---

# Part A — SR&ED Narrative

## A1. Project objective

The video-op pipeline runs on a batch envelope recorded on `OperationJob` (dispatch → poll → ingest, VOP-U8), but all Django-side execution currently happens **inside HTTP request workers**: dispatch (input staging, ffmpeg extraction, Modal spawn) runs in the dispatch request, and ingest (result download, compositing, version/render creation) runs inside whichever client poll request wins an "ingesting claim" — a `STATUS_INGESTING` row-level claim with an abandoned-claim timeout (`services/video_ops.py`) invented precisely because no worker process exists. Consequences: multi-second requests, job completion is hostage to a browser tab staying open to poll, a worker death mid-ingest is detected only by claim-timeout heuristics, and progress reporting is whatever the poll request can synthesize on the spot.

The objective is to move operation execution onto a **background task substrate** while keeping `OperationJob` as the sole status contract the SPA polls — the queue executes, the job row reports — such that:

1. Dispatch and ingest run in worker processes; HTTP endpoints reduce to *create job + enqueue* (202) and *read job row*.
2. The backend, not the browser, notices Modal completion — jobs finish with all tabs closed.
3. Running status (phase, elapsed, progress detail, worker liveness) is durable in the job row and survives worker crashes legibly.
4. The substrate is **replaceable under load without touching task code or the status contract** — achieved by writing tasks against Django's canonical `django.tasks` API (DEP 14, Django 6.0) with the executor as a settings-level backend.

The constraint that makes this experimental rather than routine: the op catalogue spans two latency families (VOP-U8) — interactive selection ops whose correction loop budgets sub-second overhead, and multi-minute generative ops — and the chosen substrate (Postgres-brokered, no Redis/RabbitMQ) must serve both from infrastructure the platform already runs.

## A2. Technological uncertainties

### TQ-U1 — Whether a Postgres-brokered queue sustains both op latency families

Huey 3.x's `PostgresHuey` dequeues via `LISTEN/NOTIFY` + `SELECT … FOR UPDATE SKIP LOCKED` (no poll interval), claiming Redis-comparable wakeup latency — but published claims are not measurements on this workload. Unknown: (a) actual enqueue→execute latency under the interactive family's correction loop, where added seconds directly degrade the VOP-F14/F18 loop; (b) worker-occupancy behaviour when long-running poll/ingest tasks (minutes) share a small worker pool with latency-sensitive dispatch tasks — whether priorities (SQL backends support them natively) suffice, or whether the families need separate queues/worker pools, reintroducing the very topology complexity the lightweight choice was meant to avoid; (c) connection behaviour: LISTEN/NOTIFY holds a connection per consumer — interaction with pgbouncer-style pooling and with Django's own connection management in long-lived workers is undocumented for this stack.

### TQ-U2 — Server-side completion detection: who watches Modal, and how status reaches the UI

Today the *client* poll drives everything: it queries Modal call state, synthesizes progress strings ("Segmenting… 12s"), and triggers ingest. Moving detection server-side has no single obvious shape: a blocking task that sleeps and re-checks (occupies a worker for the job's whole lifetime), a self-re-enqueueing task with delay (worker-efficient, but status granularity = re-enqueue period, and task-chain identity across hops must be reasoned about), or a single periodic reconciler sweeping all `queued/working` rows (simplest, but adds a scheduling dependency and a shared-fate failure mode). Unknown which shape (or hybrid) keeps status fresh enough for the UI's per-second progress display without either worker starvation (a) or thundering re-enqueue churn, and whether the SPA's existing poll cadence against the job row is then sufficient as the *only* transport (deferring SSE/WebSocket entirely) — the hypothesis is yes, since the row is now updated by workers at event time rather than computed on read.

### TQ-U3 — Crash and retry semantics vs. ingest idempotency

The claim-timeout hack exists because a poll request can die mid-ingest. Workers die too — the question is whether queue-native semantics (huey retries, task result states) can *replace* the claim machinery rather than layering on it. Unknown: (a) whether ingest is idempotent enough to be safely retried — it creates versions, render relations, and files; a retry after a partial ingest must not double-create (the two-axis version store appends; a crashed-then-retried ingest is a duplicate-take generator unless ingest is keyed by `modal_call_id`); (b) correct semantics per phase — dispatch retry re-spawns a Modal job (expensive duplicate GPU work) so likely retry-never + failed-fast, while ingest retry is desirable; per-task retry policy must encode this asymmetry; (c) liveness signalling — replacing claim-age heuristics with worker heartbeats on the job row, and what staleness threshold separates "slow native-res composite" (legitimately minutes, OPG-F5) from "dead worker."

### TQ-U4 — Whether the canonical `django.tasks` API is load-bearing yet

The swappability thesis rests on Django 6.0's DEP-14 tasks framework, but core ships **only the API plus immediate/dummy backends** — production execution is delegated to third-party backends, and huey's `django.tasks` backend is younger (added huey 3.0.3) than huey itself. Unknown: (a) whether the canonical API surface (enqueue, task results, no periodic-task story in core) covers this project's needs — the reconciler shape in TQ-U2 may need huey's native `periodic_task`, which lives *outside* the canonical API, partially breaking the abstraction; (b) whether the huey backend's semantics under the API (result states, retries, priorities) match huey-native behaviour or lose features in translation; (c) migration risk of the Django 5.2→6.x jump itself — dependency audit (August 11 2026) found no blockers (DRF 3.17.1 declares 6.0 support; psycopg 3.3.4 clears both Django 6 and PostgresHuey's ≥3.2 requirement), but 6.x is non-LTS, committing the project to a faster upgrade cadence than the 5.2 LTS line.

### TQ-U5 — Dev-environment parity for a two-process topology

The dev loop is currently one `runserver` with auto-reload and a mock-Modal fallback path (dispatch falls back to `call-mock-…` ids when the modal library is absent). Adding a worker process raises: whether task-code changes hot-reload in the worker (huey's consumer does not use Django's autoreloader), whether the mock path behaves under a worker that *does* have modal installed but no deployment, and whether the immediate/eager backend (run tasks inline, no worker) is a faithful enough dev/test mode — eager execution serializes what production parallelizes, which historically (Celery's `task_always_eager`) hides ordering and transaction-visibility bugs (a task enqueued inside an uncommitted transaction sees pre-commit state in eager mode, but post-commit state — or a missing row — under a real worker; `transaction.on_commit` enqueueing is the known mitigation, untested here).

## A3. Hypotheses

- **H1 (Substrate):** PostgresHuey behind the `django.tasks` API delivers ≤250 ms enqueue→execute latency at this volume (single-digit concurrent jobs), and priority levels suffice to keep interactive-family tasks ahead of long generative tasks in one worker pool — no Redis, no split queues.
- **H2 (Status via the job row):** Worker-side status writes (phase transitions + heartbeat + progress detail JSONB) at event time, read by the SPA's existing poll cadence, fully replace client-driven Modal polling with *better* fidelity — no push transport needed at this scale.
- **H3 (Claim machinery retires):** `STATUS_INGESTING` + claim-timeout is deleted, replaced by exactly-one-worker task ownership, `modal_call_id`-keyed ingest idempotency, and heartbeat-based staleness — with per-phase retry asymmetry (dispatch: no retry; ingest: retry-with-idempotency-guard).
- **H4 (Canonical API holds):** Task definitions written against `django.tasks` need at most one documented escape hatch (huey-native periodic task for the reconciler, if that shape wins TQ-U2); a later executor swap (Redis-backed huey, or another DEP-14 backend) is a settings change only.
- **H5 (Upgrade is separable):** The Django 5.2→6.1 upgrade lands as an isolated no-behaviour-change step (suite green, deprecation sweep only) before any queue code exists, so queue-phase failures are never confounded with upgrade fallout.

## A4. Work performed

**Substrate survey and selection (August 11 2026).** Queue-substrate landscape surveyed against the constraints (Postgres-only infra, status contract independent of executor, swap path under load): **Celery** (industrial ceiling; broker + beat + config surface unjustified at current volume, prefetch/ack hazards documented for long tasks — retained as the eventual swap-*to* candidate, not the start), **django-tasks package** (DEP-14 reference implementation; DB backend polls rather than LISTEN/NOTIFY; youngest feature set), **Procrastinate** (mature Postgres LISTEN/NOTIFY; library-specific API — swap later is a migration), **Django-Q2** (ORM broker, polling), **Huey 3.3.4** (survey correction of a stale Redis-era assessment: 3.1.0 promoted `PostgresHuey` to first-class with LISTEN/NOTIFY wakeup + `FOR UPDATE SKIP LOCKED` dequeue, psycopg ≥3.2; SQL backends carry native task priorities; 3.0.3 added a backend for Django's canonical tasks framework). **Decision:** Huey/`PostgresHuey` as executor, task code written against the `django.tasks` API (huey-native `djhuey` decorators held as the documented fallback if the young backend fails TQ-U4b), `OperationJob` retained as the sole SPA-facing status contract. Rationale recorded: this is the only surveyed combination scoring mature executor + zero new infrastructure + canonical swap API.

**Django 6 dependency audit (August 11 2026).** Full environment audit for H5: seven Django-adjacent packages, all current (DRF 3.17.1 — Django 6.0 support added March 2026; django-cors-headers 4.9, django-filter 25.2, django-model-utils 5.0, django-silk 5.5, drf-spectacular 0.29, pgvector 0.4.2); psycopg 3.3.4 satisfies Django 6 and PostgresHuey simultaneously. No blockers identified; 6.x non-LTS cadence accepted and recorded (TQ-U4c).

*(Findings TQ-F1… appended as work proceeds.)*

## A5. Technological advancement sought

- An empirically validated **Postgres-only task substrate profile for mixed-latency GPU-op workloads** — measured enqueue→execute latency and worker-occupancy behaviour of LISTEN/NOTIFY dequeue under interactive + batch families sharing one pool.
- A **worker-authored status contract** for long-running remote GPU jobs: phase/heartbeat/progress schema on the job row proven sufficient (or insufficient, with the boundary located) against a polling-only UI transport.
- **Crash-safe ingest semantics without claim heuristics** — idempotency keying and per-phase retry asymmetry replacing timeout-based claim recovery.
- Evidence on whether **Django's canonical tasks API is production-load-bearing at 6.0/6.1** with a third-party executor backend, including where the abstraction leaks (periodic scheduling, result semantics).

## A6. Personnel & records

| Role | Work |
|---|---|
| R. Pringle (developer/architect) | All survey, design, implementation, experimental verification |

Record-keeping: findings TQ-numbered in A4 as work proceeds; git history in `nexus8`; scope decisions dated.

---

# Part B — Technical Plan

**N8** = Django backend. **SPA** = React frontend.

## Phase 0 — Django 6.1 upgrade, isolated (N8, ~½–1 day) — tests H5, TQ-U4c

- **0.1** Upgrade Django 5.2.15 → 6.1.x in place (audit already green, A4); deprecation sweep (`python -Wd manage.py check`, release-notes pass over settings/URLs/ORM usage).
- **0.2** Full test suite + live smoke of the annotator round-trip (mask propagate → poll → ingest on the mock path) *before any queue code exists*.
- **0.3** Record any breakage as TQ-F findings; if the upgrade stalls >1 day, fall back to 5.2 + huey-native decorators (H4's fallback becomes the mainline, canonical-API adoption deferred to the 6.2 LTS).
- **Exit criteria:** suite green on 6.1; zero queue-related code in the diff.

## Phase 1 — Task substrate online (N8, ~1 day) — tests H1, TQ-U1, TQ-U5

- **1.1** `pip install huey`; configure the `django.tasks` backend with `PostgresHuey` (psycopg 3.3.4 in place); `create_tables=False` + explicit `create_huey_tables` management command so huey's tables don't fight Django migrations.
- **1.2** Worker process: `manage.py` consumer entry point; dev story documented (worker alongside `runserver`; note huey consumer's lack of autoreload — dev restart discipline or a watchfiles wrapper, decide and record).
- **1.3** Latency experiment (TQ-U1a): trivial echo task, measure enqueue→execute round-trip cold/warm, N=50; record against the 250 ms H1 threshold. Occupancy experiment (TQ-U1b): saturate workers with sleeping long tasks, measure queued interactive-task wait with and without priority levels.
- **1.4** Eager/immediate backend wired for tests; one deliberate transaction-visibility test (enqueue inside `atomic()` without `on_commit`) to document the TQ-U5 hazard concretely before it bites in production code.
- **Exit criteria:** worker executes tasks from Postgres with measured latency; H1 verdict (or split-queue escalation) recorded.

## Phase 2 — Op envelope migrates: dispatch + server-side completion (N8 + SPA, ~2–3 days) — tests H2, H3, TQ-U2, TQ-U3

- **2.1** `run_dispatch(job_id)` task: stage inputs, spawn Modal, `status=working`, `dispatched_at`; dispatch endpoint reduces to create-job + `transaction.on_commit(enqueue)` + 202. Retry policy: none (TQ-U3b — a dispatch retry duplicates GPU spend); failure → `status=failed` + `error`.
- **2.2** Completion detection (TQ-U2): implement the self-re-enqueueing watcher first (`watch_job(job_id)` — check Modal call state, write progress to the job row, re-enqueue with backoff-capped delay while running; hand off to ingest on completion). Reconciler sweep held as the fallback shape if per-job chains prove fragile; decision recorded as a finding either way.
- **2.3** `run_ingest(job_id)` task: idempotency guard keyed on `modal_call_id` (ingest that finds its result already recorded is a no-op — the H3 duplicate-take defence), retry-enabled; **delete** `STATUS_INGESTING`, the claim constant, and the abandoned-claim timeout once green.
- **2.4** Status schema on `OperationJob`: `progress` JSONB (phase verb, elapsed, op-specific detail — the OPG-F5 slow-ingest phase label lands here), `heartbeat_at` written by watcher/ingest tasks; staleness threshold (TQ-U3c) chosen from observed native-composite ingest durations, not guessed.
- **2.5** SPA: poll endpoint becomes a pure job-row read (no Modal client-side, no ingest trigger); op rows render phase/elapsed from `progress`. Closed-tab experiment: dispatch, close tab, verify job reaches `done` and the result hydrates on reload (the H2 headline demo).
- **Exit criteria:** no operation work executes in an HTTP request; claim machinery deleted; closed-tab completion verified live; H2/H3 verdicts recorded.

## Phase 3 — Status fidelity + failure drills (N8 + SPA, ~1–2 days) — tests H2, H3, TQ-U3

- **3.1** Kill-drill matrix, each verified live and recorded: worker killed mid-dispatch (job → failed, no orphan Modal spend beyond the spawned call), mid-watch (heartbeat staleness surfaces "stalled" in UI; watcher resumable), mid-ingest (retry completes; idempotency guard prevents duplicate takes — inspect version store).
- **3.2** Cancellation: `STATUS_CANCELLED` honoured by watcher (stop re-enqueueing, best-effort Modal cancel) and pre-execution dequeue (huey revoke semantics under the canonical API — TQ-U4b evidence).
- **3.3** UI staleness surface: distinguish "working (heartbeat fresh)" / "stalled (heartbeat stale)" / "failed" in the op row; no false "stalled" on legitimately slow native-res ingests (threshold from 2.4).
- **Exit criteria:** every drill row has a recorded outcome; no status displayed to the artist can silently lie about a dead worker.

## Phase 4 — Assessment + scale path (~½ day)

- **4.1** Consolidate H1–H5 verdicts with measurements; record where the canonical API leaked (TQ-U4 evidence — escape hatches used, if any).
- **4.2** Write the swap runbook: observed triggers that would force an executor change (sustained queue depth, worker-count ceiling, multi-host workers needing Redis's connection profile), and the settings-level swap procedure to validate the H4 claim concretely.
- **4.3** Fold results back: VOP-U3b (async job model — resolved here), OPG-F5 follow-up closed, FILESET migration notes updated if worker-side ingest changes file-write paths.

## Cross-cutting

- **Risk — TQ-U1b (starvation):** if priorities fail to protect the interactive loop, the pre-planned escalation is two named queues over one Postgres broker (still no new infra) before any executor swap is considered.
- **Risk — TQ-U4b (young backend):** every task is written so the decorator import is the only huey-coupled line; the `djhuey` fallback is a mechanical swap, validated once in a spike branch during Phase 1.
- **Out of scope:** push transports (SSE/WebSocket — revisit only if H2 fails), multi-host worker deployment, Celery migration (documented as trigger-gated in 4.2), non-video op families (still-image inpaint keeps its interactive path until this substrate is proven).

## Indicative timeline

| Phase | Duration |
|---|---|
| 0 — Django 6.1 upgrade | ~½–1 day |
| 1 — Substrate online + latency/occupancy experiments | ~1 day |
| 2 — Envelope migration + server-side completion | ~2–3 days |
| 3 — Status fidelity + failure drills | ~1–2 days |
| 4 — Assessment + swap runbook | ~½ day |
