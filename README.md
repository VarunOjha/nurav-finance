# Nurav Finance

Personal finance tracker for everything you (and the people whose money you
look after) hold: bank accounts, deposits and brokerage portfolios across
currencies, with month-over-month history and analytics.

Everything is organised by **financial workspace**: one per person or household whose money you track
(you, your parents, a joint household…). Pick a workspace in the bar under the header and every page
(dashboard, accounts, portfolios, analytics, metrics) shows that workspace only. Money is labelled by **bucket**
(what it is for: Growth, Emergency fund…), **Metrics** tracks bucket targets in dated **milestones**, and the
**Dashboard** keeps everything pointed at the next milestone.

Local-only app. FastAPI + Postgres (Neon) + React, styled after Nurav Docs.

## Concepts

| Concept | What it means |
|---|---|
| **User** | You — sign in with email + password. |
| **Workspace** | A financial workspace: whose money it is (`Personal`, Parents, Household…). Every account and portfolio belongs to exactly one workspace, and nothing is shared or totalled across workspaces except your bucket names. The workspace bar under the header picks it and every page follows it. Workspaces are created, renamed and deleted in **Profile → Workspaces**; one that still has accounts or portfolios can't be deleted. `Personal` is created at sign-up; it can be renamed but not deleted. |
| **Account** | Checking, savings, fixed deposit, brokerage cash… A planner keeps only what planning needs: name, bank, type, currency, country, balances, optional links (under "More details") and a bucket split. **No account numbers, identifiers (IFSC, SWIFT…), holder names, opening dates, cities or notes are stored** (migration `0006` dropped them). **Close account** on its page closes it as of today (it keeps its history up to that day and stops counting after it); **Reopen** undoes it. Portfolios close and reopen the same way. Types: checking, savings, fixed deposit, brokerage, investment (robo-advisors and managed accounts such as Wealthfront), retirement, **asset** (something you own and value by hand: a house, a car, gold…; shown with a house icon and counted as Property & assets in Analytics), other. |
| **Balance entry** | Append-only. Each entry has an **as-of date** (may be in the past) and a recorded time. The balance on any day is the entry with the latest as-of date on or before it; on the same date, the last one recorded wins. Mistakes are deleted and re-entered, never edited. |
| **Portfolio** | What a **Brokerage** account holds, at its provider (Fidelity, Zerodha…), as dated snapshots. **One portfolio per account**: an account's holdings are its portfolio, and new holdings are recorded on it as a new snapshot (the database enforces it). Every path works the same way: adding a brokerage account offers to add its portfolio, the account's page has **Add portfolio** (or **Record holdings** once it exists), and **Add portfolio** on the Portfolios page starts by choosing the account (one that already has its portfolio says so and records the holdings on it). The window has two tabs: **Manual entry** (an as-of date and a holdings table: symbol, name, class, quantity, buy price, current price) and **From screenshots** (up to 4 holdings screenshots, read on the next page). **A portfolio is only created together with its first holdings**: typed holdings save both in one request; otherwise the next page (`/accounts/:id/portfolio/new`) records the first holdings and creates the portfolio when you save them, so leaving half-way adds nothing. The API rejects a portfolio without a brokerage account, under another account type, or on an account that already has one; a brokerage account with a portfolio can't change type. Deleting an account deletes its portfolio and snapshots too. |
| **Snapshot** | Immutable, dated list of holdings (symbol, name, asset class, quantity, buy price, current price). One per portfolio per date; backdated snapshots slot in by date, and comparisons use the previous snapshot by date. **Record holdings** starts from the previous snapshot before its "as of" date (with **Reload from … snapshot** to start over), counts new · changed · sold holdings as you edit, and lets you undo a sold one. To fix a snapshot, delete it and record it again. |
| **Bucket** | What money is for: Growth, Emergency fund, Extra cash, a Rivian, a GPU rack… Bucket names are yours and shared by every workspace (**Profile → Buckets**: add, rename, describe, recolour, reorder, archive and unarchive). New users get Growth, Emergency fund and Extra cash; **Seed defaults** adds back any that are missing. A bucket with history (splits or milestones) can only be archived: it leaves new splits and Metrics but stays in past timelines. A bucket can only be archived once no account's current split uses it (the refusal names those accounts). A never-used bucket can be deleted. |
| **Split** | How an account's money is shared across buckets, in percent (exactly 100%). Set with the **Buckets** button on the account's page, or by clicking the Buckets column on the Accounts list (not in Edit). A change is a new dated version (backdating allowed), so earlier months keep the old split. The account's **first** split covers all of its history. Saving on a date that already has a change replaces it. The window lists every version, and any one can be removed (removing the only one makes the account Unassigned again). An account with no split counts as **Unassigned**; the Accounts list can filter by bucket, Unassigned included. A portfolio uses its brokerage account's split. |
| **Milestone** | A named checkpoint with one date ("2030", "2035"…), set per workspace in **Metrics**. It holds bucket targets; leave out any bucket you don't want to track. Each has a "measure from" date (default: the day you create it) where every bucket's needed path starts. Names are unique per workspace, and so are dates: **one milestone per date** (the database enforces it; saving on a taken date names the milestone already there), so "the next milestone" is never ambiguous. Typing a year as the name fills in Dec 31 of that year. **+ Milestone** opens the editor (name, date, measure from, one row per bucket target, note); the pencil on a milestone reopens it, and **Delete milestone** is at its bottom. The copy button next to the pencil starts a **new** milestone prefilled from that one (same buckets, amounts, returns, date and note; measured from today; named "… copy"; renaming a year-named copy to another year moves its date to Dec 31 of that year), so you can tweak it and save it as the next milestone. A milestone needs at least one bucket target. |
| **Target** | One line of a milestone: the **balance** a bucket should hold by the milestone's date, in one currency (e.g. 2030: Growth $1,000,000 USD), above 0. Optional expected annual return per line (−50 to 100 %). A bucket + currency appears at most once per milestone; the editor shows each bucket's value today next to it. Targets on an archived bucket stay in the milestone but leave the numbers. |
| **Tag** *(retired)* | Replaced by buckets on 2026-11-07. Migration `0002` left the tag tables and rows untouched; the app no longer reads them. |

**Consolidated holdings.** The Portfolios page lists every portfolio (value, change, 12-month sparkline, **Record holdings**), then merges the latest snapshot of every open portfolio, per currency, into four collapsible sections:
- **How the money was invested:** invested by portfolio and by asset class, and a table per holding: class, quantity, average buy price (quantity-weighted across portfolios), invested, **share of invested**, and which portfolios hold it.
- **How it looks now:** value by portfolio and by asset class, and a table per holding: price, value, **share of value**, held in.
- **Invested → now · which bets paid off:** each holding's share of invested against its share of value, and the top winners and losers (invested, now, gain, gain %, weight).
- **Over time:** value by portfolio at each month-end for the last 12 months, the change month over month, and the largest holdings.

Click a column heading to sort. Holdings without a buy price in every portfolio show no invested figures, sort last, and are left out of the share of invested.

**Bank logos.** 67 banks, brokers and investment platforms (India, US, UK/Europe, UAE, Singapore and global) are listed in `frontend/src/lib/banks.ts`. Their logos ship with the app in `frontend/public/banks/`, and the app never fetches them. An account's bank and a portfolio's provider show the logo in lists, page headers and pickers; a name that isn't listed gets its initials. To add a bank, add a line to `banks.ts` and run `python scripts/fetch_bank_logos.py` (needs Pillow). It tries the bank's own site icons, then Google's and DuckDuckGo's favicon services, or a named Wikimedia Commons file for sites that block downloads. Federal Bank has no usable logo yet.

**Pages.** Dashboard (the landing page after sign-in and the logo link), Accounts (one table per currency with its total, largest balance first, and each account's **share** of that currency's active balances; bucket, type and currency filters; each account's page has its balance history, chart, portfolio and bucket split), Portfolios, Analytics, Metrics, Wealth estimator (in the drawer; see below). Breadcrumbs sit under the header next to the workspace switcher, and **Profile** (details, password, workspaces, buckets, theme) opens from the header.

**Dashboard** always looks at the **next milestone**: the earliest one whose date hasn't passed. It moves on by itself when that date passes, even if every target was hit early (the passed one shows as Achieved/Missed in Metrics). Top to bottom:
- **Check-in** (button by the title): a folded list of everything a monthly check-in updates, oldest first: a balance per account and holdings per portfolio (a brokerage account is updated through its holdings). Each links to its account or to **Record holdings**.
- **Tiles:** net worth per currency, accounts (split by currency), time left to the next milestone and the monthly saving it needs per currency (with each target's expected return where set).
- **Net worth by year:** one bar chart per currency, a bar per year (the value on Dec 31, this year's as of today), up to the next milestone's year.
- **Buckets toward the next milestone,** per currency: now / target, progress with a target tick, the gap (or how much over), and **Save X / mo**, **✓ On track** (its expected return gets there alone) or **✓ Funded**. Not clickable.
- **Needs attention,** plain rules, shown only when they fire: **Rebalance** (in one currency, the bucket furthest over its target next to the one furthest behind it), **Intent vs reality** (a target expecting 6 %+ a year whose bucket is at least half in fixed deposits and cash), **Concentration** (one holding is 25 %+ of a bucket).
- **Top 5** per currency: accounts as they are, except that an account with a portfolio is replaced by its holdings (a symbol held in several portfolios counts once); bucket, value, share of the currency's net worth.
- **Top 5 stocks** per currency (stocks only, merged by symbol): value, gain against the buy price (none when any lot lacks one) and share of that currency's stocks.
- **Life map:** one lane per bucket + currency from this year to at least 34 years out; every upcoming milestone is a vertical line, each target a dot with its amount (the next one with progress).
- **Accounts × buckets:** per currency, each account's money in each bucket today, shaded by size, with bucket totals. Click a row to edit that account's split.

**Analytics** covers a range (6M, 1Y, 3Y, All) and accounts, portfolios or both: month-end totals per currency, growth velocity, allocation today (by account type and by asset class), the top assets today, closed events, and the bucket views described below.

Rules that hold everywhere:

- **No currency conversion.** Totals, charts and analytics are per currency, side by side.
- **Soft deletes.** Deleting anything sets `deleted_at`; deleted rows are filtered out of every query
  centrally (`backend/database.py`) and are fully ignored — lists, totals, analytics, name/date uniqueness.
- **Closed ≠ deleted.** A closed account keeps its history up to the closing date; a deleted one disappears.
- **Analytics are computed on read**, so backdated data reflows automatically.
- **Buckets in analytics.** On any day, each account's value is shared out by the split in force that day. Analytics → Buckets shows, per currency: today's donut (Unassigned in grey), month-end lines or stacked columns per bucket, and a velocity table (MoM change, average change per month over 3/6/12 months, growth over the range). Click a bucket in the table to see the accounts feeding it.
- **Metrics** lists one accordion per milestone, upcoming ones by date (the nearest open), past ones in a collapsed "Past" group. The header shows only the time left ("3 years 5 months left", or "passed <date>") and, per currency, the total of the targets (up to 3 decimals), a bar split by bucket in each bucket's colour (each capped at its own target) and the percent done ("USD $1.145M ▰▰▱ 59.5%"). Each bucket row shows progress (the tick is where the needed path says it should be today), now / target with the percent done (in the bucket's colour, red once missed), the gap (or "+$X over" above the target, "short $X" for a missed one), need per month and its status: Ahead, On track, Behind, Not started (its measure-from date hasn't come), Achieved or Missed. Click a row for its details, pace check and chart.
- **The maths, per target.** The flat need is the gap ÷ months left. With an expected return, a second figure allows for today's value compounding at that rate. **Standing** compares today's value with the needed path, which runs from the bucket's value on the milestone's measure-from date to the target on its date (a straight line, or compounding with a level monthly addition when a return is set); within 1% of the target counts as on track. **Pace** is the actual average change per month over 3, 6 and 12 months; an account only counts when its value at the start of that window is known (record a 0 balance to mark when a new account started). Projected dates use the 6-month pace (else 3, else 12) and growth alone at the expected return. Past targets are Achieved or Missed by the bucket's value on the date.
- **A portfolio's account isn't counted twice.** While the portfolio is open, analytics count that account's money through the portfolio's holdings and leave the account out. Once the portfolio is closed, the account counts again.

## Run it

Prerequisites: Docker Desktop, and a `nurav-finance` app in the nurav-creds vault.

1. Populate the vault (see `.env.reference`, Section 3):
   - `DATABASE_URL` — Neon connection string. The database in the URL must already exist
     (the app creates tables, not the database); in use: `nurav-finance-dev`.
   - `JWT_SECRET` — `python -c "import secrets; print(secrets.token_urlsafe(48))"`
2. `cp .env.reference .env` and fill in `NURAV_CREDS_ENDPOINT` + `NURAV_CREDS_TOKEN`. No secrets go in `.env`; it may
   also hold the optional settings in Section 2 (port, bind address, session length…).
3. `docker compose up --build -d`
4. Open http://localhost:8020 and register.

Migrations run automatically on start (`alembic upgrade head`). API docs: http://localhost:8020/api/docs.
`GET /health` checks the database too; the Docker healthcheck uses it.
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

The app refuses to start if any vault key is missing or `JWT_SECRET` is shorter than 32 characters.
Error messages name the key but never print values. (`ACCOUNT_NUMBER_KEY` is no longer used and can be
removed from the vault.)

| Symptom (`docker logs nurav-finance`) | Fix |
|---|---|
| `nurav-creds is missing required keys: …` | Add the named keys to the `nurav-finance` vault app, then `docker compose up -d --force-recreate`. |
| `database "…" does not exist` | Create that database in Neon (see `.env.reference`), then restart. |
| Screenshot import says the OpenRouter key is missing | Add `OPENROUTER_API_KEY` to the `nurav-finance` vault app, then `docker compose up -d --force-recreate`. |
| Missing tables or columns, or `Can't locate revision identified by '…'`, on a database created before 2026-11-05 | That database predates the reset, when tenants became workspaces and migrations were squashed into one `0001`. Today's `0002`–`0007` reuse the old numbers but are different migrations, so a pre-reset database can look up to date while its tables don't match. Start over with an empty database (above). |

## Forms and validation

The same rules are checked in the browser (`frontend/src/lib/validate.ts`) and enforced by the API
(`backend/schemas/`), so a bad value never reaches the database.

| Field | Rule |
|---|---|
| Email | `name@domain.tld`. It's the login, so each email can register once. |
| Password | At least 6 characters (bcrypt's 72-byte limit applies). Every password field has a show/hide toggle. |
| Date of birth | Optional. 1900-01-01 through today. (No phone number is asked for or stored.) |
| Amounts (balances, prices, quantities) | Commas are added as you type, in the currency's style: INR in lakhs and crores (`12,34,567.89`), every other currency and all quantities in thousands (`1,234,567.89`). Letters are ignored. Balances allow a minus sign and 4 decimal places, prices 6 and quantities 8. Values are sent without the commas (`components/ui/AmountInput.tsx`, `lib/amount.ts`). |
| As-of dates (balances, snapshots) | Not in the future (the browser stops at today; the API allows one day of slack for time zones). Backdating is fine. |

Dates use one picker everywhere (`components/ui/DateField.tsx`): type `YYYY-MM-DD` (lenient: `1990-5-7`,
`1990/05/07`) or open the calendar. It has month and year dropdowns, previous/next arrows, Today and Clear,
and is driven by keyboard: arrows move by day or week, PageUp/PageDown by month, Shift+PageUp/PageDown by
year, Esc closes. Days outside the allowed range are disabled. Field errors appear when you leave a field
or submit, not while typing.

### Holdings CSV

On **Record holdings** (and a new portfolio's **Add portfolio** page), **Paste CSV** opens a box where you
paste holdings, press **Validate**, then **Accept**. Accept only works once the exact text in the box has
validated with no problems. It replaces the rows in the table, and you still review them and press
**Save snapshot** (**Save portfolio & holdings** for a new portfolio). The snapshot date comes from
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

On **Record holdings** (and a new portfolio's page), **From screenshots** reads your holdings from up to 4 screenshots of a broker's or
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

**Use holdings** fills the snapshot table, and you still review it and press **Save snapshot** (or **Save portfolio & holdings**).

**Privacy**:
- Images are handled in memory for one request only. They're never written to disk, the database or the
  logs, and photo metadata (EXIF, location) is stripped before sending.
- The reading steps are told not to copy account numbers, names, emails or phone numbers.

**Setup**: needs `OPENROUTER_API_KEY` in the `nurav-finance` vault app. The model is `SCREENSHOT_MODEL`
(default `anthropic/claude-sonnet-5.5`), and an import costs about $0.03–0.05. The code is in
`backend/services/screenshot/` and the route is `POST /api/portfolios/{id}/snapshots/screenshot` (`POST /api/portfolios/screenshot` with a `currency` for a portfolio not created yet). It streams
its progress, then returns a proposal and saves nothing.

## Wealth estimator

**Wealth estimator** (in the drawer) asks an AI model to review the whole workspace: how well the money is
structured, what to keep and what to change, when you reach financial independence (FI), the risks to it,
how to rebalance and which milestones to aim for. Every review is saved as an **inquiry**, so you can see
how the advice changes over time. Delete the ones you don't want.

**New inquiry** asks for your monthly expenses, in one currency, and your **withdrawal rate** (3%, 3.5%,
4% or your own, 1–10%). Every account with money in it is ticked, and you can untick any of them.
Accounts of type `asset`, such as the house, are fixed assets: they're kept, and never counted in the
pool. A brokerage account counts through its portfolio's holdings. The pool is assumed to grow with
nothing added to it.

**How the retire year works** (all in code, exact):
- **Target** = a year's expenses ÷ your withdrawal rate, in today's money ($96K ÷ 3.5% = $2.74M).
- **Retire year** = the first year your withdrawal rate of the pool pays that year's expenses. The pool
  grows at r and expenses at inflation i, so it's t years away, where pool·(1+r)ᵗ = target·(1+i)ᵗ.
  The page also shows the target in that year's money ($5.64M in 2056 = $197.5K a year at 3.5%).
- **After retiring**, you take your expenses (rising with inflation) and the pool keeps growing. If real
  growth (1+r)/(1+i) − 1 is at least your rate, it **never runs out**. Otherwise it **runs out** after
  ln(w ÷ (w − g)) ÷ ln(1 + g) years.
- **Retire earlier** shows:
  - the gap to the target, in today's money
  - the retire year for a monthly saving you type in (in today's money, so it rises with inflation)
  - the monthly saving needed to retire by a year you pick
  - a table at ¼, ½ and 1× your expenses
  These are calculated in the browser.
- Each change and risk shows how many years it moves the retire year. Retire years more than 60 years
  away show as "60+ yrs".

**Who does what**: the model supplies the assumptions and the judgement:
- 30-year average inflation per currency, naming the period and the index
- exchange rates and currency drift
- the return per scenario, as the pool is and if rebalanced
- structure scores, what to keep, changes, risks (each with the shock that tests it), rebalance
  targets and milestone themes

It never sets the withdrawal rate or does the arithmetic; code does all of that.

**Checks**: inflation 0–15%, returns −5–20%, returns rising from conservative to balanced to aggressive,
rebalance targets summing to 100% and naming only known classes, milestone years in order. If the
answer fails a check, it's sent back once with the problems. If it fails again, nothing is saved.

**Setup**: uses the same `OPENROUTER_API_KEY` as screenshot import. The model is `ESTIMATOR_MODEL`
(default `anthropic/claude-sonnet-5.5`). An inquiry takes about 30–40 s and costs about $0.06. The model
sees account names, institutions, types, countries, balances, bucket splits, holdings by class, the top
positions, milestones and your age, but never your name or email. The code is in
`backend/services/estimator/`. The route is `POST /api/estimator/inquiries`, which streams its progress;
`GET /api/estimator/pool` lists the accounts.

## API

Everything is under `/api` (interactive docs at `/api/docs`). Every route except register and login needs the
JWT, and workspace-scoped routes also need `X-Workspace-Id`.

| Area | Routes |
|---|---|
| Auth | `POST /auth/register`, `/auth/login`, `/auth/token` (OAuth form, for the docs page); `GET`/`PATCH /auth/me`; `POST /auth/change-password` |
| Workspaces | `GET`/`POST /workspaces`; `PATCH`/`DELETE /workspaces/{id}` |
| Buckets (per user) | `GET`/`POST /buckets`; `POST /buckets/seed`; `PUT /buckets/order`; `PATCH`/`DELETE /buckets/{id}`; `POST /buckets/{id}/archive`, `/unarchive` |
| Accounts | `GET`/`POST /accounts`; `GET`/`PATCH`/`DELETE /accounts/{id}`; `GET`/`POST /accounts/{id}/balances`; `DELETE /accounts/{id}/balances/{entry}` |
| Bucket splits | `GET`/`POST /accounts/{id}/splits`; `DELETE /accounts/{id}/splits/{split}` |
| Portfolios | `GET`/`POST /portfolios`; `GET /portfolios/consolidated`; `GET`/`PATCH`/`DELETE /portfolios/{id}`; `GET`/`POST /portfolios/{id}/snapshots`; `GET /portfolios/{id}/snapshots/prefill`; `GET`/`DELETE /portfolios/{id}/snapshots/{snapshot}` |
| Screenshot import | `POST /portfolios/{id}/snapshots/screenshot`, `POST /portfolios/screenshot` (streamed; saves nothing) |
| Analytics | `GET /analytics/overview` |
| Milestones & metrics | `GET`/`POST /milestones`; `PUT`/`DELETE /milestones/{id}`; `GET /metrics` (milestones with their rows and totals, plus each bucket across milestones, which the Dashboard's Life map uses) |
| Dashboard | `GET /dashboard` |
| Wealth estimator | `GET /estimator/pool`; `GET`/`POST /estimator/inquiries` (POST streams); `GET`/`DELETE /estimator/inquiries/{id}` |

## Develop

```bash
# Backend tests (throwaway Postgres on :55439, never the vault or Neon)
docker compose -f docker-compose.test.yml up -d        # stop with: docker compose -f docker-compose.test.yml down
cd backend
python -m venv .venv && .venv/Scripts/pip install -r requirements-dev.txt   # once
.venv/Scripts/python -m pytest                                 # workspaces, accounts, backdating, soft deletes, portfolios + snapshots, analytics, buckets + splits, milestones + metrics (one per date), dashboard, migrations (up and down), screenshot import (scripted model), wealth estimator (scripted model), config, validation
.venv/Scripts/ruff check . && .venv/Scripts/ruff format --check .

# Frontend
cd frontend
npm install                      # once
npm run dev                      # http://localhost:5180, proxies /api to :8020
npm test                         # Vitest (validators, amounts, formatting, CSV, screenshot import, date picker, password toggle, workspace switcher,
                                 #   breadcrumbs, theme, Ref mode, account/portfolio forms, snapshot page, holdings tables, analytics,
                                 #   bucket splits + analytics, milestones/metrics, dashboard, wealth estimator)
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
  models/            users, workspaces, accounts (+ links, balance entries),
                     portfolios (+ snapshots, holdings), bucket (buckets, account splits, milestones + targets),
                     estimator (wealth inquiries), legacy_tags (unused)
  routers/           /api/auth, workspaces, buckets, accounts (+ /splits), portfolios (+ screenshot import), analytics,
                     milestones + metrics, dashboard, estimator (inquiries, pool)
  schemas/           request/response models and input validation (auth.py: birth date)
  dependencies.py    current user (JWT) and current workspace (X-Workspace-Id header)
  services/          ledger (point-in-time maths), holdings (diffs), analytics, splits (split in force on a day),
                     metrics (goal maths), dashboard (tiles, yearly totals, top 5s, grid, attention rules, check-in),
                     estimator/ (pool: accounts and the snapshot the model sees, review: prompt + answer schema,
                     compute: checks + every number shown, pipeline: review → checks → compute → save, streamed), access (workspace ownership),
                     soft_delete (cascades), security (bcrypt + JWT),
                     screenshot/ (image prep, OpenRouter client, read/organise/re-read steps, checks)
  alembic/           migrations: squashed 0001 (2026-11-05 reset), 0002 buckets (additive, keeps tags),
                     0003 milestones (targets move into milestones; old date columns kept),
                     0004 one portfolio per account (empty duplicates soft-deleted),
                     0005 one milestone per date (stops if two already share one),
                     0006 drops personal and reference details (account numbers, identifiers, holder,
                     opened date, city, notes; portfolio opened date + notes; user phone) — destructive,
                     0007 wealth inquiries (one new table)
  tests/             pytest against real Postgres
frontend/src/
  api/               axios client (JWT + X-Workspace-Id headers) and endpoint wrappers
  context/           auth and selected-workspace state
  hooks/queries.ts   TanStack Query hooks; cache keys are scoped by workspace
  components/        AppLayout (header, drawer, footer), WorkspaceSwitcher, Breadcrumbs, ProfileModal (profile, workspaces),
                     BucketsSection, ThemePicker, Logo, RefMode (in-app feedback: tags elements with their source line),
                     account/portfolio form modals, BankPicker + BankLogo, HoldingsCsvModal,
                     ScreenshotImportModal, HoldingsTables, BucketSplitModal + BucketBar, BucketAnalytics, charts/,
                     metrics/ (MilestoneModal editor, GoalParts: badges, progress, pace check, trajectory chart),
                     dashboard/ (LifeMap, BucketGrid), estimator/ (NewInquiryModal)
  components/ui/     Button, Modal, Field (Input, PasswordInput, Select…), DateField, AmountInput, Accordion, table/chip primitives
  lib/               formatting, amounts (amount.ts), validators (validate.ts), holdings CSV parser, screenshot upload stream,
                     holdingRows (editable holdings rows + checks), pendingScreenshots (Add portfolio → snapshot hand-off),
                     banks + bankLogos.json, buckets (colours, Unassigned), estimator (inquiry stream + formatters), growth velocity, theme,
                     class helper
  types/api.ts       TypeScript shapes of every API request and response
  pages/             Login, Dashboard, Accounts, Account detail, Portfolios, Portfolio detail,
                     Record holdings (also a new portfolio's first holdings), Analytics, Metrics,
                     Wealth estimator (inquiry list) + Inquiry
frontend/public/banks/  bundled bank and broker logos (PNG)
frontend/ref-attributes.ts  build plugin behind the Ref tool (data-ref source locations)
scripts/fetch_bank_logos.py  one-off: downloads the logos and writes bankLogos.json
```
