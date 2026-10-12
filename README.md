# Nurav Finance

Personal finance tracker for everything you (and the people whose money you
look after) hold: bank accounts, deposits and brokerage portfolios across
currencies, with month-over-month history and analytics.

Local-only app. FastAPI + Postgres (Neon) + React, styled after Nurav Docs.

## Concepts

| Concept | What it means |
|---|---|
| **User** | You — sign in with email + password. |
| **Tenant** | Whose money it is (`DEFAULT_SELF`, Parents, Household…). Every account and portfolio belongs to one tenant; the header switcher picks the tenant and every page follows it. Tenants are created in **Profile**. `DEFAULT_SELF` is created at sign-up and can't be deleted. |
| **Account** | Checking, savings, fixed deposit, brokerage cash… Has a currency, location, free-form identifiers (IFSC, routing no., SWIFT…), links, tags. Account numbers are encrypted at rest and shown masked. |
| **Balance entry** | Append-only. Each entry has an **as-of date** (may be in the past) and a recorded time. The balance on any day is the entry with the latest as-of date on or before it; on the same date, the last one recorded wins. Mistakes are deleted and re-entered, never edited. |
| **Portfolio** | Holdings at a provider (Fidelity, Zerodha…), optionally linked to its cash account. |
| **Snapshot** | Immutable, dated list of holdings (symbol, quantity, price). One per portfolio per date; backdated snapshots slot in by date, and comparisons use the previous snapshot by date. |
| **Tag** | Your labels (savings, trading, emergency-fund…), shared across tenants. |

Rules that hold everywhere:

- **No currency conversion.** Totals, charts and analytics are per currency, side by side.
- **Soft deletes.** Deleting anything sets `deleted_at`; deleted rows are filtered out of every query
  centrally (`backend/database.py`) and are fully ignored — lists, totals, analytics, name/date uniqueness.
- **Closed ≠ deleted.** A closed account keeps its history up to the closing date; a deleted one disappears.
- **Analytics are computed on read**, so backdated data reflows automatically.

## Run it

Prerequisites: Docker Desktop, and a `nurav-finance` app in the nurav-creds vault.

1. Populate the vault (see `.env.reference`, Section 3):
   - `DATABASE_URL` — the new Neon project's connection string
   - `JWT_SECRET` — `python -c "import secrets; print(secrets.token_urlsafe(48))"`
   - `ACCOUNT_NUMBER_KEY` — `python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"`
     **Back this key up.** Without it, stored account numbers can't be decrypted.
2. `cp .env.reference .env` and fill in `NURAV_CREDS_ENDPOINT` + `NURAV_CREDS_TOKEN`. Nothing else goes in `.env`.
3. `docker compose up --build -d`
4. Open http://localhost:8020 and register.

Migrations run automatically on start (`alembic upgrade head`). API docs: http://localhost:8020/api/docs.

## Develop

```bash
# Backend tests (throwaway Postgres on :55439, never the vault or Neon)
docker compose -f docker-compose.test.yml up -d
cd backend
python -m venv .venv && .venv/Scripts/pip install -r requirements-dev.txt   # once
.venv/Scripts/python -m pytest
.venv/Scripts/ruff check . && .venv/Scripts/ruff format --check .

# Frontend
cd frontend
npm install                      # once
npm run dev                      # http://localhost:5180, proxies /api to :8020
npm test                         # Vitest
npm run build                    # type-check + production bundle
```

New migration after changing models (against the test database):

```bash
cd backend
DATABASE_URL=postgresql://postgres:postgres@localhost:55439/nurav_finance_test ENV_FILE=/dev/null \
  .venv/Scripts/alembic revision --autogenerate -m "describe change"
```

## Layout

```
backend/
  main.py            FastAPI app; serves the built SPA from static/ in the image
  config.py          settings: nurav-creds vault first, env second; fails fast on missing keys
  nurav_creds.py     vault client (copied from Nurav Docs)
  database.py        engine, session, global soft-delete filter
  models/            users, tenants, tags, accounts (+ identifiers, links, balance entries),
                     portfolios (+ snapshots, holdings)
  routers/           /api/auth, tenants, tags, accounts, portfolios, analytics
  services/          ledger (point-in-time maths), holdings (diffs), analytics,
                     soft_delete (cascades), crypto (Fernet), security (bcrypt + JWT)
  alembic/           migrations
  tests/             pytest against real Postgres
frontend/src/
  api/               axios client (JWT + X-Tenant-Id headers) and endpoint wrappers
  context/           auth and selected-tenant state
  hooks/queries.ts   TanStack Query hooks; cache keys are scoped by tenant
  components/        AppLayout (header, drawer, footer), TenantSwitcher, Logo, ui/
  pages/             Login, Accounts, Account detail, Portfolios, Portfolio detail,
                     Record snapshot, Analytics, Profile
```
