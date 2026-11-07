# Nurav Finance

Personal finance tracker for everything you (and the people whose money you
look after) hold: bank accounts, deposits and brokerage portfolios across
currencies, with month-over-month history and analytics.

Everything is organised by **financial workspace**: one per person or household whose money you track
(you, your parents, a joint household…). Pick a workspace in the bar under the header and every page
(accounts, portfolios, analytics) shows that workspace only.

Local-only app. FastAPI + Postgres (Neon) + React, styled after Nurav Docs.

## Concepts

| Concept | What it means |
|---|---|
| **User** | You — sign in with email + password. |
| **Workspace** | A financial workspace: whose money it is (`Personal`, Parents, Household…). Every account and portfolio belongs to exactly one workspace, and nothing is shared or totalled across workspaces except your tags. The workspace bar under the header picks it and every page follows it. Workspaces are created, renamed and deleted in **Profile → Workspaces**; one that still has accounts or portfolios can't be deleted. `Personal` is created at sign-up; it can be renamed but not deleted. |
| **Account** | Checking, savings, fixed deposit, brokerage cash… Has a currency, location, free-form identifiers (IFSC, routing no., SWIFT…), links, tags. Account numbers are encrypted at rest and shown masked. Adding one asks only for the basics (bank, name, holder, type, balance, currency, country); the rest sits under "More details". Types: checking, savings, fixed deposit, brokerage, investment (robo-advisors and managed accounts such as Wealthfront), retirement, other. |
| **Balance entry** | Append-only. Each entry has an **as-of date** (may be in the past) and a recorded time. The balance on any day is the entry with the latest as-of date on or before it; on the same date, the last one recorded wins. Mistakes are deleted and re-entered, never edited. |
| **Portfolio** | Holdings at a provider (Fidelity, Zerodha…). Every portfolio belongs to one **Brokerage** account in the same workspace; the API rejects a portfolio without one, or under another account type, and a brokerage account with portfolios can't change type. A brokerage account's page lists its portfolios (value, change, last snapshot) with an **Add portfolio** button that prefills the account, provider and currency; adding a brokerage account also offers to add its portfolio straight away. **Add portfolio** on the Portfolios page starts by choosing the brokerage account. The window has two tabs: **Manual entry** (an as-of date and a holdings table: symbol, name, class, quantity, buy price, current price; saving stores the portfolio and those holdings as its first snapshot, or, left empty, opens the Record snapshot page) and **From screenshots** (pick up to 4 holdings screenshots; after saving, the first-snapshot page reads them straight away). Deleting an account deletes its portfolios and their snapshots too. |
| **Snapshot** | Immutable, dated list of holdings (symbol, quantity, price). One per portfolio per date; backdated snapshots slot in by date, and comparisons use the previous snapshot by date. |
| **Tag** | Your labels (savings, trading, emergency-fund…), shared across workspaces. |

**Consolidated holdings.** The Portfolios page merges the latest snapshot of every open portfolio per currency. For each symbol it shows quantity, average buy price (quantity-weighted across portfolios), current price, cost, **starting stake** (its share of total cost, from the buy prices), value, **current share** (its share of today's value), and gain in money and %. Click any column heading to sort; holdings without a buy price in every portfolio show no cost figures, sort last, and are left out of the starting stake.

**Bank logos.** 67 banks, brokers and investment platforms (India, US, UK/Europe, UAE, Singapore and global) are listed in `frontend/src/lib/banks.ts`. Their logos ship with the app in `frontend/public/banks/`, and the app never fetches them. An account's bank and a portfolio's provider show the logo in lists, page headers and pickers; a name that isn't listed gets its initials. To add a bank, add a line to `banks.ts` and run `python scripts/fetch_bank_logos.py` (needs Pillow). It tries the bank's own site icons, then Google's and DuckDuckGo's favicon services, or a named Wikimedia Commons file for sites that block downloads. Federal Bank has no usable logo yet.

Rules that hold everywhere:

- **No currency conversion.** Totals, charts and analytics are per currency, side by side.
- **Soft deletes.** Deleting anything sets `deleted_at`; deleted rows are filtered out of every query
  centrally (`backend/database.py`) and are fully ignored — lists, totals, analytics, name/date uniqueness.
- **Closed ≠ deleted.** A closed account keeps its history up to the closing date; a deleted one disappears.
- **Analytics are computed on read**, so backdated data reflows automatically.
- **A portfolio's account isn't counted twice.** While the portfolio is open, analytics count that account's money through the portfolio's holdings and leave the account out. Once the portfolio is closed, the account counts again.

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
All workspace-scoped API calls send the workspace in an `X-Workspace-Id` header.

**Start over with an empty database** (deletes every user, workspace, account and portfolio):

```bash
docker exec -i nurav-finance python - <<'EOF'
from sqlalchemy import create_engine, text
from config import settings
with create_engine(settings.database_url).begin() as c:
    c.execute(text("DROP SCHEMA public CASCADE; CREATE SCHEMA public;"))
EOF
docker restart nurav-finance      # recreates the tables; then register again
```

The app refuses to start if any vault key is missing, `JWT_SECRET` is shorter than 32 characters, or
`ACCOUNT_NUMBER_KEY` isn't a valid Fernet key. Error messages name the key but never print values.

| Symptom (`docker logs nurav-finance`) | Fix |
|---|---|
| `nurav-creds is missing required keys: …` | Add the named keys to the `nurav-finance` vault app, then `docker compose up -d --force-recreate`. |
| `database "…" does not exist` | Create that database in Neon (see `.env.reference`), then restart. |
| `ACCOUNT_NUMBER_KEY is not a valid Fernet key` | Regenerate it with the command above, but only if no account numbers are stored yet. |
| Screenshot import says the OpenRouter key is missing | Add `OPENROUTER_API_KEY` to the `nurav-finance` vault app, then `docker compose up -d --force-recreate`. |
| `Can't locate revision identified by '0002'` (or `'0005'`) | The database predates the 2026-11-05 reset, when tenants became workspaces and migrations were squashed into one `0001`. Start over with an empty database (above). |

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

### Holdings from screenshots

On **Record snapshot**, **From screenshots** reads your holdings from up to 4 screenshots of a broker's or
fund platform's holdings page, from the phone app or the website. Drop them in, choose them, or paste one
with Ctrl+V. For a long list, take one screenshot per screen: overlapping rows are merged.

It runs in steps, each with one job. The AI steps only copy and choose text; every number you see is
calculated by the app.

1. **Read** (AI, one call per screenshot, all at once): copies every row, column heading and total exactly
   as printed. Tall phone screenshots are cut into overlapping pieces first so small text stays readable.
2. **Organise** (AI): merges rows that appear in more than one screenshot, decides which text is quantity,
   average cost, current price, value and invested, and matches names to the symbols in your last snapshot
   (a cut-off fund name still finds its symbol). Otherwise it uses the printed ticker or proposes one.
3. **Check** (code): parses broker number formats (`₹1,23,456.70`, `1.2L`, `3.4 Cr`, `(450.20)`), fills in
   what wasn't printed (price = value ÷ quantity, buy price = invested ÷ quantity), and checks that
   quantity × price matches each printed value and that the rows add up to the screenshot's total. It also
   compares with the last snapshot: a quantity ×5 or ÷5 is flagged, and holdings that aren't in the
   screenshots are listed because they'll count as sold.
4. **Re-read** (AI, only when step 3 finds a mismatch): looks at the screenshots again for exactly the
   values in question, and for rows that were missed. Then step 3 runs again.

You then review everything in a table you can edit:

- Rows that can't be saved (no symbol, quantity or price, or a duplicate) must be fixed first.
- Warnings (marked `!`) must be acknowledged with a tick box.
- Cells the app calculated or the re-read corrected are shaded; hover over one to see the screenshot's
  text.
- If the screenshots show a date, you're offered it as the snapshot date.

**Use holdings** fills the snapshot table, and you still review it and press **Save snapshot**.

**Privacy**:
- Images are handled in memory for one request only. They're never written to disk, the database or the
  logs, and photo metadata (EXIF, location) is stripped before sending.
- The reading steps are told not to copy account numbers, names, emails or phone numbers.

**Setup**: needs `OPENROUTER_API_KEY` in the `nurav-finance` vault app. The model is `SCREENSHOT_MODEL`
(default `anthropic/claude-sonnet-5.5`), and an import costs about $0.03–0.05. The code is in
`backend/services/screenshot/` and the route is `POST /api/portfolios/{id}/snapshots/screenshot`. It streams
its progress, then returns a proposal and saves nothing.

## Develop

```bash
# Backend tests (throwaway Postgres on :55439, never the vault or Neon)
docker compose -f docker-compose.test.yml up -d        # stop with: docker compose -f docker-compose.test.yml down
cd backend
python -m venv .venv && .venv/Scripts/pip install -r requirements-dev.txt   # once
.venv/Scripts/python -m pytest                                 # workspaces, backdating, soft deletes, snapshots, analytics, screenshot import (scripted model), config, validation
.venv/Scripts/ruff check . && .venv/Scripts/ruff format --check .

# Frontend
cd frontend
npm install                      # once
npm run dev                      # http://localhost:5180, proxies /api to :8020
npm test                         # Vitest (validators, amounts, CSV, screenshot import, date picker, password toggle, workspace switcher, analytics)
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
  routers/           /api/auth, workspaces, tags, accounts, portfolios (+ screenshot import), analytics
  schemas/           request/response models and input validation (auth.py: phone, birth date)
  dependencies.py    current user (JWT) and current workspace (X-Workspace-Id header)
  services/          ledger (point-in-time maths), holdings (diffs), analytics, access (workspace ownership),
                     soft_delete (cascades), crypto (Fernet), security (bcrypt + JWT),
                     screenshot/ (image prep, OpenRouter client, read/organise/re-read steps, checks)
  alembic/           migrations (one squashed 0001 since the 2026-11-05 reset)
  tests/             pytest against real Postgres
frontend/src/
  api/               axios client (JWT + X-Workspace-Id headers) and endpoint wrappers
  context/           auth and selected-workspace state
  hooks/queries.ts   TanStack Query hooks; cache keys are scoped by workspace
  components/        AppLayout (header, drawer, footer), WorkspaceSwitcher, ProfileModal (profile, workspaces, tags),
                     ThemePicker, Logo, account/portfolio form modals, BankPicker + BankLogo, HoldingsCsvModal,
                     ScreenshotImportModal, ConsolidatedHoldingsTable, charts/
  components/ui/     Button, Modal, Field (Input, PasswordInput, Select…), DateField, table/chip primitives
  lib/               formatting, amounts (amount.ts), validators (validate.ts), holdings CSV parser, screenshot upload stream,
                     holdingRows (editable holdings rows + checks), pendingScreenshots (Add portfolio → snapshot hand-off),
                     banks + bankLogos.json, growth velocity, theme, class helper
  pages/             Login, Accounts, Account detail, Portfolios, Portfolio detail,
                     Record snapshot, Analytics, Profile
frontend/public/banks/  bundled bank and broker logos (PNG)
scripts/fetch_bank_logos.py  one-off: downloads the logos and writes bankLogos.json
```
