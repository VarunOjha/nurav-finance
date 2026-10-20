# Nurav Finance

Personal finance tracker for everything you (and the people whose money you
look after) hold: bank accounts, deposits and brokerage portfolios across
currencies, with month-over-month history and analytics.

Local-only app. FastAPI + Postgres (Neon) + React, styled after Nurav Docs.

## Concepts

| Concept | What it means |
|---|---|
| **User** | You — sign in with email + password. |
| **Tenant** | Whose money it is (`DEFAULT_SELF`, Parents, Household…). Every account and portfolio belongs to one tenant; the tenant bar under the header picks it and every page follows it. Tenants are created in **Profile**. `DEFAULT_SELF` is created at sign-up and can't be deleted. |
| **Account** | Checking, savings, fixed deposit, brokerage cash… Has a currency, location, free-form identifiers (IFSC, routing no., SWIFT…), links, tags. Account numbers are encrypted at rest and shown masked. |
| **Balance entry** | Append-only. Each entry has an **as-of date** (may be in the past) and a recorded time. The balance on any day is the entry with the latest as-of date on or before it; on the same date, the last one recorded wins. Mistakes are deleted and re-entered, never edited. |
| **Portfolio** | Holdings at a provider (Fidelity, Zerodha…), optionally linked to its cash account. |
| **Snapshot** | Immutable, dated list of holdings (symbol, quantity, price). One per portfolio per date; backdated snapshots slot in by date, and comparisons use the previous snapshot by date. |
| **Tag** | Your labels (savings, trading, emergency-fund…), shared across tenants. |
| **Wealth plan** | A Wealth Agent version you approved and saved: one tenant, one pot per currency. Frozen: the approved parameters, the starting balances, the engine's results and the agent's report. |

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

## Wealth Agent

**Wealth Agent** in the drawer is a chat for working out where your money could get to, and what it would
take. Describe your goal in your own words, or tap the mic and say it. The agent confirms the details with
you, Nurav's projection engine does the maths, and the agent writes a report around the exact numbers. It
replaced the FIRE wizard; plans saved with the wizard were removed.

**Four numbers, one unknown.** A plan starts from what you already have and has four numbers: a
**target**, a **time**, a yearly **return** and, optionally, a regular **contribution** (per month or year,
for some years or the whole time, optionally rising each year), plus one-off deposits or withdrawals.
Exactly one is the unknown:

- **When do I get there**: target and return give the date you reach the target (looking up to 60 years).
- **How much will I have**: time and return give the end amount, checked against a target if you have one.
- **What return do I need**: target and time give the yearly return needed.
- **How much should I add**: target, time and return give the contribution needed, in the shape you set
  (for example "a year, for 10 years").

If you give a target, a time *and* a return, there is nothing left to find, so the agent asks which one is
flexible. In a follow-up version, each pot keeps its unknown unless you change it.

**Pots: one per currency.** There's no currency conversion, so each currency you hold is its own pot with
its own goal (say $5M and ₹5Cr), reported side by side. A pot starts from everything you hold in that
currency; you can leave items out or set a different starting amount. Tags play no part in planning.

**Segments (optional).** A pot's starting money can be split into parts with their own return and their
own final target, for example 80% equities at 9% aiming for $4M, and savings and cash at lower returns
aiming for $500K each. Each segment is checked against its target: when it gets there on its own, and if it
falls short, the extra a month it needs. With your monthly spending, the report also says how many years
each savings or cash target would cover.

**How a chat goes**

1. **Start**: a free-text goal, plus optional choices for what to solve for, horizon (10/20/30 years or
   "to age N") and risk appetite, or one of the starter prompts.
2. **Clarify**: the agent says what you hold in each currency, asks only what's missing, and pins down
   each pot's unknown.
3. **Parameters**: the agent drafts the plan. The server checks it against your accounts and shows it as a
   table, one block per pot. Warnings appear there, such as a return outside your risk appetite's band
   (Cautious 3–5%, Balanced 5–7%, Growth 7–9%), anything left out, or a currency with no pot.
4. **Approve & run**: only the button approves, and nothing is calculated before it. The engine runs every
   pot and its possibilities, and the agent writes the report.
5. **Iterate**: "what if I add $20,000 a year instead?" becomes a new draft, then v2, then v3. Each version
   is a tab on the report canvas, with **Side by side** to compare. **Approve & save** freezes a version.

**The report**, per pot:

- **The answer**, and if you have a contribution, the same answer without it.
- **Possibilities**: the plan at three returns (your return 2 points down and up by default, or the three
  you choose; with segments, every segment's return moves 2 points). For each return it shows when it
  reaches the target and how much it has at points in time, next to the target for that year.
- For a solved return, the return needed with 5 years less and 5 years more. For a solved contribution, the
  amount needed at each return.
- **A chart** (by segment or total, nominal or today's money) with the other two returns as dotted lines.
- **The segments check** and a **year-by-year table**.

Around the pots: the agent's insights, watch-outs and recommendations, and a risk read per currency
(largest holding, asset mix, share in retirement and cash accounts, cash cover). **Print** gives an A4 PDF.

**The agent never does the maths.** It has two tools: `draft_parameters`, which the server validates,
resolves against your balances and signs, and `write_report`, which is forced after approval. Running the
engine is not a tool: the server runs it when you press Approve. In the report, every money amount,
percentage and duration is a figure token such as `{fi_date:USD}` or `{time:INR:2}`, filled in from the
engine. A typed number is sent back to the model once to fix, then dropped, so it never reaches the report.

**What leaves Nurav**: accounts and portfolios as aliases (Account A, Portfolio B), with type, currency,
today's value, the totals per currency and each portfolio's asset-class mix, plus your age. Real names,
institutions, account numbers, tags, holding symbols, email and phone never do. Your screen swaps the
aliases back. **Preview exactly what's sent** shows the payload.

**Chats are not stored.** The browser keeps the conversation and sends it with each message; leaving the
page or **New chat** clears it. A saved plan keeps the approved parameters, the numbers and the agent's
words (with real names), and only the name can change later. Saved plans are listed under **All plans**.

**Voice**: tap the mic, talk (up to 2 minutes), tap again. OpenRouter transcribes it
(`openai/whisper-large-v3`) and the text lands in the box so you can fix a misheard number before sending.
The agent replies in text only.

**Cost**: the header shows what this chat and today have cost. Each tenant has a daily cap
(`AGENT_DAILY_CAP_USD`, default $5, UTC day), after which the agent stops calling the model until midnight.
A typical chat with two or three versions costs $0.25–0.45.

**Setup**: the agent calls OpenRouter with `anthropic/claude-sonnet-4.6`. Put `OPENROUTER_API_KEY` in the
`nurav-finance` vault app. It's optional: without it the app runs and the Wealth Agent page says what's
missing. Optional settings: `AGENT_MODEL`, `AGENT_STT_MODEL`, `AGENT_DAILY_CAP_USD`, and `AGENT_FAKE=1`
for a scripted stand-in model (no network, no cost; used by the tests).

The engine (`backend/services/wealth/engine.py`) follows these rules:

- Returns are effective yearly rates: each period grows by `(1 + r)^(1/n) − 1`, n = 12, 4 or 1. Compounding
  only changes when contributions start earning.
- Monthly contributions land at the end of each month. Under quarterly or annual compounding they land
  at the end of the period without interest. Yearly contributions and one-offs land at the end of the plan
  year. Step-up raises the amount each year. A contribution "for N years" stops after year N.
- A withdrawal never takes a pot or segment below 0: the rest is skipped.
- A target in today's money grows as `target × (1 + i)^t`; a target in future money stays fixed. Today's
  money = nominal ÷ `(1 + i)^t`.
- **Return needed** is one flat rate on everything (searched from −20% to 50%). **Contribution needed** is
  searched in the shape you set. Both aim at the target at the end of the plan, and the chart shows the plan
  with the solved return or amount. A segment's shortfall is the extra a month, for the whole period, that
  gets it to its own target.

The engine is checked against golden vectors (`backend/tests/data/engine_golden.json`, regenerated by
`backend/scripts/engine_golden.py` only after a deliberate engine change). The UI tests use a real engine
version generated by `backend/scripts/wealth_fixture.py`.

## Develop

```bash
# Backend tests (throwaway Postgres on :55439, never the vault or Neon)
docker compose -f docker-compose.test.yml up -d        # stop with: docker compose -f docker-compose.test.yml down
cd backend
python -m venv .venv && .venv/Scripts/pip install -r requirements-dev.txt   # once
.venv/Scripts/python -m pytest                                 # tenancy, backdating, soft deletes, snapshots, analytics, engine, Wealth Agent harness + plans, config, validation
.venv/Scripts/ruff check . && .venv/Scripts/ruff format --check .

# Frontend
cd frontend
npm install                      # once
npm run dev                      # http://localhost:5180, proxies /api to :8020
npm test                         # Vitest (validators, date picker, password toggle, tenant switcher, Wealth Agent chat + report)
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
                     portfolios (+ snapshots, holdings), wealth_plans, agent_usage
  routers/           /api/auth, tenants, tags, accounts, portfolios, analytics, agent, wealth
  schemas/           request/response models and input validation (auth.py: phone, birth date)
  dependencies.py    current user (JWT) and current tenant (X-Tenant-Id header)
  services/          ledger (point-in-time maths), holdings (diffs), analytics,
                     soft_delete (cascades), crypto (Fernet), security (bcrypt + JWT),
                     wealth/ (engine, draft checks, pot runs and possibilities, risk read),
                     agent/ (OpenRouter client, anonymised snapshot, prompt + tools, loop,
                     figure-token guard, signed drafts, spend ledger, scripted fake model)
  alembic/           migrations
  tests/             pytest against real Postgres
frontend/src/
  api/               axios client (JWT + X-Tenant-Id headers) and endpoint wrappers
  context/           auth and selected-tenant state
  hooks/queries.ts   TanStack Query hooks; cache keys are scoped by tenant
  components/        AppLayout (header, drawer, footer), TenantSwitcher, Logo, account/portfolio form modals
  components/ui/     Button, Modal, Field (Input, PasswordInput, Select…), DateField, table/chip primitives
  components/wealth/ Wealth Agent start screen, composer + mic, approval card, report, charts
  lib/               formatting, validators (validate.ts), class helper, agent chat state + stream,
                     figure tokens, recorder, wealth view
  pages/             Login, Accounts, Account detail, Portfolios, Portfolio detail,
                     Record snapshot, Analytics, Profile, Wealth Agent, saved plans, saved plan
```
