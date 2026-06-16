# Nexus8

A reference-intelligence platform: a Django REST backend (`nexus8/`) for
hierarchical trackable containers, versions, and references, paired with a
React + Vite single-page app (`web/`) for search, boards, and AI-assisted
asset analysis.

- **Product plan:** [REFERENCE_PLATFORM_PLAN.md](REFERENCE_PLATFORM_PLAN.md)
- **End-user guide:** [USER_GUIDE.md](USER_GUIDE.md)
- **Search internals & tuning:** [SEARCH.md](SEARCH.md)
- **API examples:** [API_EXAMPLES.md](API_EXAMPLES.md)
- **Frontend details:** [web/README.md](web/README.md)

## Stack

- **Backend** — Django 5.2 + Django REST Framework, PostgreSQL with
  [pgvector](https://github.com/pgvector/pgvector) (recursive CTEs, GIN
  indexes, and vector search are load-bearing — SQLite is not supported).
- **Frontend** — React 19, Vite, Mantine, TanStack Query, Konva.
- **AI (optional)** — OpenAI embeddings + GPT-4o vision for semantic search
  and asset tagging.

## Prerequisites

- Python 3.12+
- Node.js 20+
- PostgreSQL 14+ with the `vector` extension available

## Setup

### 1. Configure environment

```bash
cp .env.example .env
# Fill in NEXUS8_DB_USER / NEXUS8_DB_PASSWORD (and OPENAI_API_KEY if using AI),
# then export the values into your shell before running Django.
```

Settings read configuration from the process environment (see
[`.env.example`](.env.example) for every supported variable). A
`django-insecure-` development `SECRET_KEY` ships as the default so the app
runs out of the box; set `NEXUS8_SECRET_KEY` for any real deployment.

### 2. Backend

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r nexus8/requirements.txt

# Create the database and enable pgvector (one-time):
#   createdb nexus8
#   psql nexus8 -c 'CREATE EXTENSION IF NOT EXISTS vector;'

cd nexus8
python manage.py migrate
python manage.py runserver 8000
```

In `DEBUG` mode the API authenticates every request as a seeded `dev` user so
the SPA needs no login flow. Set `NEXUS8_DEV_OPEN=0` to exercise real auth.

### 3. Frontend

```bash
cd web
npm install
npm run dev          # http://localhost:5173
```

Vite proxies `/trackables`, `/discussions`, and `/media` to Django on
`:8000`, so the SPA and backend share an origin in development (no CORS).

## Project layout

```
nexus8/        Django project (trackables, discussions apps; settings, API)
web/           React + Vite single-page app
*.md           Product plan, user guide, and API documentation
```

## Notes

- `db.sqlite3`, `.venv/`, `node_modules/`, collected static, and uploaded
  `media/` are intentionally untracked — see [.gitignore](.gitignore).
  PostgreSQL is the supported backend; any local `db.sqlite3` is dev cruft.
