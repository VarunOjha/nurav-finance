# Nurav Finance

Personal finance tracker for everything you (and the people whose money you
look after) hold: bank accounts, deposits and brokerage portfolios across
currencies, with month-over-month history and analytics.

Local-only app. FastAPI + Postgres (Neon) + React, styled after Nurav Docs.

## Concepts

| Concept | What it means |
|---|---|
| **User** | You — sign in with email + password. |
| **Workspace** | Whose money it is (`Personal`, Parents, Household…). Every account and portfolio belongs to one workspace; the workspace bar under the header picks it and every page follows it. Workspaces are created in **Profile**. `Personal` is created at sign-up; it can be renamed but not deleted. |
| **Account** | Checking, savings, fixed deposit, brokerage cash… Has a currency, location, free-form identifiers (IFSC, routing no., SWIFT…), links, tags. Account numbers are encrypted at rest and shown masked. |
| **Balance entry** | Append-only. Each entry has an **as-of date** (may be in the past) and a recorded time. The balance on any day is the entry with the latest as-of date on or before it; on the same date, the last one recorded wins. Mistakes are deleted and re-entered, never edited. |
| **Portfolio** | Holdings at a provider (Fidelity, Zerodha…), optionally linked to its cash account. |
| **Snapshot** | Immutable, dated list of holdings (symbol, quantity, price). One per portfolio per date; backdated snapshots slot in by date, and comparisons use the previous snapshot by date. |
| **Tag** | Your labels (savings, trading, emergency-fund…), shared across workspaces. |

Rules that hold everywhere:

- **No currency conversion.** Totals, charts and analytics are per currency, side by side.
- **Soft deletes.** Deleting anything sets `deleted_at`; deleted rows are filtered out of every query
  centrally (`backend/database.py`) and are fully ignored — lists, totals, analytics, name/date uniqueness.
- **Closed ≠ deleted.** A closed account keeps its history up to the closing date; a deleted one disappears.
- **Analytics are computed on read**, so backdated data reflows automatically.
- **A portfolio's linked account isn't counted twice.** While the portfolio is open, analytics count that account's money through the portfolio's holdings and leave the account out. Once the portfolio is closed, the account counts again.

## Run it

Prerequisites: Docker Desktop, and a `nurav-finance` app in the nurav-creds vault.

1. Populate the vault (see `.env.reference`, Section 3):
   - `DATABASE_URL` — Neon connection string. The database in the URL must already exist
     (the app creates tables, not the database); in use: `nurav-finance-dev`.
   - `JWT_SECRET` — `python -c "import secrets; print(secrets.token_urlsafe(48))"`
   - `ACCOUNT_NUMBER_KEY` — `python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"`
     **Back this key up.** Without it, stored account numbers can't be decrypted.
2. `cp .env.reference .env` and fill in `NURAV_CREDS_ENDPOINT` + `NURAV_CREDS_TOKEN`. Nothing else goes in `.env`.
3. `docker compose up --build -d`
4. Open http://localhost:8020 and register.

Migrations run automatically on start (`alembic upgrade head`). API docs: http://localhost:8020/api/docs.

The app refuses to start if any vault key is missing, `JWT_SECRET` is shorter than 32 characters, or
`ACCOUNT_NUMBER_KEY` isn't a valid Fernet key. Error messages name the key but never print values.

| Symptom (`docker logs nurav-finance`) | Fix |
|---|---|
| `nurav-creds is missing required keys: …` | Add the named keys to the `nurav-finance` vault app, then `docker compose up -d --force-recreate`. |
| `database "…" does not exist` | Create that database in Neon (see `.env.reference`), then restart. |
| `ACCOUNT_NUMBER_KEY is not a valid Fernet key` | Regenerate it with the command above, but only if no account numbers are stored yet. |

## Forms and validation

The same rules are checked in the browser (`frontend/src/lib/validate.ts`) and enforced by the API
(`backend/schemas/`), so a bad value never reaches the database.

| Field | Rule |
|---|---|
| Email | `name@domain.tld`. It's the login, so each email can register once. |
| Password | At least 6 characters (bcrypt's 72-byte limit applies). Every password field has a show/hide toggle. |
| Phone | Optional. 7–15 digits; a leading `+`, spaces, dashes, dots and brackets are allowed (`+1 (415) 555-0123`). Stored as entered, trimmed. |
| Date of birth | Optional. 1900-01-01 through today. |
| Amounts (balances, prices, quantities) | Commas are added as you type, in the currency's style: INR in lakhs and crores (`12,34,567.89`), every other currency and all quantities in thousands (`1,234,567.89`). Letters are ignored. Balances allow a minus sign and 4 decimal places, prices 6 and quantities 8. Values are sent without the commas (`components/ui/AmountInput.tsx`, `lib/amount.ts`). |
| As-of dates (balances, snapshots) | Not in the future (one day of slack for time zones). Backdating is fine. |

Dates use one picker everywhere (`components/ui/DateField.tsx`): type `YYYY-MM-DD` (lenient: `1990-5-7`,
`1990/05/07`) or open the calendar. It has month and year dropdowns, previous/next arrows, Today and Clear,
and is driven by keyboard: arrows move by day or week, PageUp/PageDown by month, Shift+PageUp/PageDown by
year, Esc closes. Days outside the allowed range are disabled. Field errors appear when you leave a field
or submit, not while typing.

### Holdings CSV

On **Record snapshot**, **Paste CSV** opens a box where you paste holdings, press **Validate**, then
**Accept**. Accept only works once the exact text in the box has validated with no problems. It replaces
the rows in the table, and you still review them and press **Save snapshot**. The snapshot date comes from
the page's "As of" field, not from the file. The parser is `frontend/src/lib/holdingsCsv.ts`.

```csv
symbol,name,asset_class,quantity,buy_price,current_price
AAPL,Apple Inc.,stock,10,150.25,227.52
VTSAX,"Vanguard Total Stock Market Index Fund, Admiral",mutual_fund,"1,204.337",118.40,142.05
BTC,Bitcoin,crypto,0.0425,,61250
```

Both prices are per unit, in the portfolio's currency.

| Column | Rule |
|---|---|
| `symbol` | Required, up to 24 characters, upper-cased. Each symbol once per file. Also read from a `ticker` column. |
| `name` | Optional, up to 160 characters. Also read from a `description` column. |
| `asset_class` | Optional: `stock`, `etf`, `mutual_fund`, `bond`, `cash`, `crypto`, `other` (case-insensitive, `Mutual fund` works). Blank means `stock`. Also read from a `class` or `type` column. |
| `quantity` | Required, greater than 0, up to 8 decimal places. Also read from a `qty`, `shares` or `units` column. |
| `buy_price` | Optional: your average cost per unit, 0 or more, up to 6 decimal places. Blank means unknown, so no gain is shown. Also read from a `buy`, `purchase_price`, `avg_cost` or `average_cost` column. |
| `current_price` | Required: today's price per unit, 0 or more, up to 6 decimal places. The holding's value is quantity × current price. Also read from a `price`, `last_price` or `market_price` column. |

The header row is required, and columns can come in any order. Values can be separated by commas or tabs,
so a range copied from a spreadsheet pastes as-is. Quote any value that contains a comma. Numbers can't
include currency symbols or signs, but thousands separators are fine. Blank lines and lines starting with
`#` are skipped. Each problem is reported with its line number.

## Develop

```bash
# Backend tests (throwaway Postgres on :55439, never the vault or Neon)
docker compose -f docker-compose.test.yml up -d        # stop with: docker compose -f docker-compose.test.yml down
cd backend
python -m venv .venv && .venv/Scripts/pip install -r requirements-dev.txt   # once
.venv/Scripts/python -m pytest                                 # workspaces, backdating, soft deletes, snapshots, analytics, config, validation
.venv/Scripts/ruff check . && .venv/Scripts/ruff format --check .

# Frontend
cd frontend
npm install                      # once
npm run dev                      # http://localhost:5180, proxies /api to :8020
npm test                         # Vitest (validators, date picker, password toggle, workspace switcher)
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
  models/            users, workspaces, tags, accounts (+ identifiers, links, balance entries),
                     portfolios (+ snapshots, holdings)
  routers/           /api/auth, workspaces, tags, accounts, portfolios, analytics
  schemas/           request/response models and input validation (auth.py: phone, birth date)
  dependencies.py    current user (JWT) and current workspace (X-Workspace-Id header)
  services/          ledger (point-in-time maths), holdings (diffs), analytics,
                     soft_delete (cascades), crypto (Fernet), security (bcrypt + JWT)
  alembic/           migrations
  tests/             pytest against real Postgres
frontend/src/
  api/               axios client (JWT + X-Workspace-Id headers) and endpoint wrappers
  context/           auth and selected-workspace state
  hooks/queries.ts   TanStack Query hooks; cache keys are scoped by workspace
  components/        AppLayout (header, drawer, footer), WorkspaceSwitcher, Logo, account/portfolio form modals
  components/ui/     Button, Modal, Field (Input, PasswordInput, Select…), DateField, table/chip primitives
  lib/               formatting, validators (validate.ts), class helper
  pages/             Login, Accounts, Account detail, Portfolios, Portfolio detail,
                     Record snapshot, Analytics, Profile
```
