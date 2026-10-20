import uuid
from collections import defaultdict
from datetime import date, timedelta
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from database import get_db, utcnow
from dependencies import get_current_tenant
from models import Holding, Portfolio, PortfolioTag, Snapshot, Tenant
from schemas.common import latest_allowed_date
from schemas.portfolio import (
    Consolidated,
    HoldingOut,
    PortfolioCreate,
    PortfolioSummary,
    PortfolioUpdate,
    SnapshotComparison,
    SnapshotCreate,
    SnapshotPrefill,
    SnapshotSummary,
)
from schemas.tenancy import TagRef
from services import soft_delete
from services.access import get_account, get_portfolio, get_snapshot, owned_tags
from services.holdings import ZERO, allocation, compare, holding_cost, holding_gain, holding_value, share, snapshot_cost, snapshot_total
from services.ledger import Point, Timeline, add_months, month_end, month_key, months_between

router = APIRouter()


# ── helpers ───────────────────────────────────────────────────────────────────


def snapshots_by_portfolio(db: Session, portfolio_ids: list[uuid.UUID]) -> dict[uuid.UUID, list[Snapshot]]:
    grouped: dict[uuid.UUID, list[Snapshot]] = defaultdict(list)
    if portfolio_ids:
        rows = db.scalars(select(Snapshot).where(Snapshot.portfolio_id.in_(portfolio_ids)).options(selectinload(Snapshot.holdings)))
        for s in rows:
            grouped[s.portfolio_id].append(s)
    return grouped


def snapshot_timeline(snapshots: list[Snapshot]) -> Timeline[Decimal]:
    # One live snapshot per date (unique index), so recording order never ties.
    return Timeline(Point(s.as_of, s.created_at, snapshot_total(s), s) for s in snapshots)


def _snapshot_summary(s: Snapshot) -> SnapshotSummary:
    cost, cost_holdings = snapshot_cost(s)
    return SnapshotSummary(
        cost=cost,
        cost_holdings=cost_holdings,
        id=s.id,
        as_of=s.as_of,
        note=s.note,
        recorded_at=s.created_at,
        total=snapshot_total(s),
        holdings_count=len(s.holdings),
    )


def _summary(p: Portfolio, snapshots: list[Snapshot]) -> PortfolioSummary:
    timeline = snapshot_timeline(snapshots)
    latest = timeline.latest()
    previous = timeline.before(latest) if latest else None
    return PortfolioSummary(
        id=p.id,
        name=p.name,
        provider=p.provider,
        currency=p.currency,
        account=p.account,
        opened_on=p.opened_on,
        closed_on=p.closed_on,
        status="closed" if p.closed_on else "active",
        notes=p.notes,
        tags=[TagRef.model_validate(link.tag) for link in p.tag_links],
        value=latest.value if latest else None,
        value_as_of=latest.as_of if latest else None,
        previous_value=previous.value if previous else None,
        delta=(latest.value - previous.value) if latest and previous else None,
        holdings_count=len(latest.ref.holdings) if latest else 0,
        snapshot_count=len(snapshots),
    )


def _with_relations(stmt):
    return stmt.options(
        selectinload(Portfolio.tag_links).selectinload(PortfolioTag.tag),
        selectinload(Portfolio.account),
    )


def _check_dates(opened_on: date | None, closed_on: date | None) -> None:
    if opened_on and closed_on and closed_on < opened_on:
        raise HTTPException(status_code=422, detail="Closed date can't be before the opened date")


def _replace_tags(db: Session, tenant: Tenant, p: Portfolio, tag_ids: list[uuid.UUID]) -> None:
    wanted = {t.id for t in owned_tags(db, tenant, tag_ids)}
    now = utcnow()
    current = {link.tag_id: link for link in p.tag_links}
    for tag_id, link in current.items():
        if tag_id not in wanted:
            link.deleted_at = now
    for tag_id in wanted - current.keys():
        db.add(PortfolioTag(portfolio_id=p.id, tag_id=tag_id))


def _one(db: Session, tenant: Tenant, portfolio_id: uuid.UUID) -> PortfolioSummary:
    db.expire_all()
    p = get_portfolio(db, tenant, portfolio_id)
    return _summary(p, snapshots_by_portfolio(db, [p.id])[p.id])


# ── portfolios ────────────────────────────────────────────────────────────────


@router.get("", response_model=list[PortfolioSummary])
def list_portfolios(tenant: Tenant = Depends(get_current_tenant), db: Session = Depends(get_db)) -> list[PortfolioSummary]:
    portfolios = db.scalars(
        _with_relations(select(Portfolio).where(Portfolio.tenant_id == tenant.id)).order_by(
            Portfolio.closed_on.is_not(None), Portfolio.currency, Portfolio.name
        )
    ).all()
    snaps = snapshots_by_portfolio(db, [p.id for p in portfolios])
    return [_summary(p, snaps.get(p.id, [])) for p in portfolios]


@router.get("/consolidated", response_model=Consolidated)
def consolidated(tenant: Tenant = Depends(get_current_tenant), db: Session = Depends(get_db)) -> Consolidated:
    """Latest snapshot of every active portfolio, merged per currency (no FX)."""
    portfolios = db.scalars(select(Portfolio).where(Portfolio.tenant_id == tenant.id, Portfolio.closed_on.is_(None))).all()
    snaps = snapshots_by_portfolio(db, [p.id for p in portfolios])
    today = date.today()
    last_month_end = month_end(add_months(today, -1))
    months = months_between(add_months(today, -11), today)
    days = [min(month_end(m), today) for m in months]  # same rule as analytics

    per_currency: dict[str, dict] = {}
    for p in sorted(portfolios, key=lambda p: p.name):
        timeline = snapshot_timeline(snaps.get(p.id, []))
        latest = timeline.latest()
        if latest is None:
            continue
        bucket = per_currency.setdefault(
            p.currency, {"total": ZERO, "previous": ZERO, "has_prev": False, "by_portfolio": [], "by_class": [], "holdings": {}, "history": []}
        )
        points = [timeline.at(d) for d in days]
        bucket["history"].append({"portfolio": p.name, "values": [pt.value if pt else None for pt in points]})
        bucket["total"] += latest.value
        prior = timeline.at(last_month_end)
        if prior is not None:
            bucket["previous"] += prior.value
            bucket["has_prev"] = True
        bucket["by_portfolio"].append((p.name, latest.value))
        for h in latest.ref.holdings:
            value = holding_value(h)
            bucket["by_class"].append((h.asset_class, value))
            merged = bucket["holdings"].setdefault(
                h.symbol,
                {
                    "symbol": h.symbol,
                    "name": h.name,
                    "asset_class": h.asset_class,
                    "quantity": ZERO,
                    "value": ZERO,
                    "portfolios": [],
                },
            )
            merged["quantity"] += h.quantity
            merged["value"] += value
            if p.name not in merged["portfolios"]:
                merged["portfolios"].append(p.name)

    currencies = []
    for currency, b in sorted(per_currency.items(), key=lambda kv: kv[1]["total"], reverse=True):
        holdings = sorted(b["holdings"].values(), key=lambda h: h["value"], reverse=True)
        for h in holdings:
            h["share"] = share(h["value"], b["total"])
        currencies.append(
            {
                "currency": currency,
                "total": b["total"],
                "previous_total": b["previous"] if b["has_prev"] else None,
                "by_portfolio": allocation(b["by_portfolio"]),
                "by_asset_class": allocation(b["by_class"]),
                "holdings": holdings,
                "months": [month_key(m) for m in months],
                "history": b["history"],  # portfolios were visited in name order
            }
        )
    return Consolidated(currencies=currencies)


@router.post("", response_model=PortfolioSummary, status_code=status.HTTP_201_CREATED)
def create_portfolio(body: PortfolioCreate, tenant: Tenant = Depends(get_current_tenant), db: Session = Depends(get_db)) -> PortfolioSummary:
    _check_dates(body.opened_on, body.closed_on)
    if body.account_id:
        get_account(db, tenant, body.account_id)  # same tenant, live
    p = Portfolio(tenant_id=tenant.id, **body.model_dump(exclude={"tag_ids"}))
    db.add(p)
    db.flush()
    _replace_tags(db, tenant, p, body.tag_ids)
    db.commit()
    return _one(db, tenant, p.id)


@router.get("/{portfolio_id}", response_model=PortfolioSummary)
def get_portfolio_detail(portfolio_id: uuid.UUID, tenant: Tenant = Depends(get_current_tenant), db: Session = Depends(get_db)) -> PortfolioSummary:
    return _one(db, tenant, portfolio_id)


@router.patch("/{portfolio_id}", response_model=PortfolioSummary)
def update_portfolio(
    portfolio_id: uuid.UUID, body: PortfolioUpdate, tenant: Tenant = Depends(get_current_tenant), db: Session = Depends(get_db)
) -> PortfolioSummary:
    p = get_portfolio(db, tenant, portfolio_id)
    data = body.model_dump(exclude_unset=True)
    opened_on = data.get("opened_on", p.opened_on)
    closed_on = data.get("closed_on", p.closed_on)
    _check_dates(opened_on, closed_on)
    snaps = snapshots_by_portfolio(db, [p.id])[p.id]
    if snaps:
        days = [s.as_of for s in snaps]
        if opened_on and min(days) < opened_on:
            raise HTTPException(status_code=422, detail="There are snapshots before that opened date")
        if closed_on and max(days) > closed_on:
            raise HTTPException(status_code=422, detail="There are snapshots after that closed date")
        if data.get("currency") and data["currency"] != p.currency:
            raise HTTPException(status_code=409, detail="Currency can't change once snapshots are recorded")
    if data.get("account_id"):
        get_account(db, tenant, data["account_id"])
    for field in ("name", "currency"):
        if field in data and data[field] is None:
            del data[field]
    for field in ("name", "provider", "currency", "account_id", "opened_on", "closed_on", "notes"):
        if field in data:
            setattr(p, field, data[field])
    if body.tag_ids is not None:
        _replace_tags(db, tenant, p, body.tag_ids)
    db.commit()
    return _one(db, tenant, p.id)


@router.delete("/{portfolio_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_portfolio(portfolio_id: uuid.UUID, tenant: Tenant = Depends(get_current_tenant), db: Session = Depends(get_db)) -> None:
    p = get_portfolio(db, tenant, portfolio_id)
    soft_delete.delete_portfolio(db, p.id)
    db.commit()


# ── snapshots (immutable) ─────────────────────────────────────────────────────


@router.get("/{portfolio_id}/snapshots", response_model=list[SnapshotSummary])
def list_snapshots(portfolio_id: uuid.UUID, tenant: Tenant = Depends(get_current_tenant), db: Session = Depends(get_db)) -> list[SnapshotSummary]:
    p = get_portfolio(db, tenant, portfolio_id)
    snaps = sorted(snapshots_by_portfolio(db, [p.id])[p.id], key=lambda s: s.as_of, reverse=True)
    return [_snapshot_summary(s) for s in snaps]


@router.get("/{portfolio_id}/snapshots/prefill", response_model=SnapshotPrefill)
def prefill(
    portfolio_id: uuid.UUID,
    as_of: date = Query(..., description="Date of the snapshot being recorded"),
    tenant: Tenant = Depends(get_current_tenant),
    db: Session = Depends(get_db),
) -> SnapshotPrefill:
    """Holdings of the latest snapshot dated before `as_of` (backdating-aware)."""
    p = get_portfolio(db, tenant, portfolio_id)
    timeline = snapshot_timeline(snapshots_by_portfolio(db, [p.id])[p.id])
    base = timeline.at(as_of - timedelta(days=1))
    if base is None:
        return SnapshotPrefill(based_on=None, holdings=[])
    s: Snapshot = base.ref
    return SnapshotPrefill(
        based_on=_snapshot_summary(s),
        holdings=[
            HoldingOut(
                symbol=h.symbol,
                name=h.name,
                asset_class=h.asset_class,
                quantity=h.quantity,
                buy_price=h.buy_price,
                current_price=h.current_price,
                value=holding_value(h),
                cost=holding_cost(h),
                gain=holding_gain(h),
            )
            for h in s.holdings
        ],
    )


@router.get("/{portfolio_id}/snapshots/{snapshot_id}", response_model=SnapshotComparison)
def snapshot_detail(
    portfolio_id: uuid.UUID,
    snapshot_id: uuid.UUID,
    compare_to: uuid.UUID | None = Query(None, description="Defaults to the previous snapshot by date"),
    tenant: Tenant = Depends(get_current_tenant),
    db: Session = Depends(get_db),
) -> SnapshotComparison:
    p = get_portfolio(db, tenant, portfolio_id)
    current = get_snapshot(db, p, snapshot_id)
    if compare_to is not None:
        previous = get_snapshot(db, p, compare_to)
    else:
        timeline = snapshot_timeline(snapshots_by_portfolio(db, [p.id])[p.id])
        point = next(pt for pt in timeline.points if pt.ref.id == current.id)
        prior = timeline.before(point)
        previous = prior.ref if prior else None
    total = snapshot_total(current)
    prev_total = snapshot_total(previous) if previous else None
    return SnapshotComparison(
        current=_snapshot_summary(current),
        previous=_snapshot_summary(previous) if previous else None,
        change=(total - prev_total) if prev_total is not None else None,
        change_pct=share(total - prev_total, prev_total) if prev_total else None,
        holdings=compare(current, previous),
        allocation=allocation([(h.asset_class, holding_value(h)) for h in current.holdings]),
    )


@router.post("/{portfolio_id}/snapshots", response_model=SnapshotSummary, status_code=status.HTTP_201_CREATED)
def create_snapshot(
    portfolio_id: uuid.UUID, body: SnapshotCreate, tenant: Tenant = Depends(get_current_tenant), db: Session = Depends(get_db)
) -> SnapshotSummary:
    p = get_portfolio(db, tenant, portfolio_id)
    if body.as_of > latest_allowed_date():
        raise HTTPException(status_code=422, detail="Date cannot be in the future")
    if p.opened_on and body.as_of < p.opened_on:
        raise HTTPException(status_code=422, detail="Date is before the portfolio was opened")
    if p.closed_on and body.as_of > p.closed_on:
        raise HTTPException(status_code=422, detail="Date is after the portfolio was closed")
    symbols = [h.symbol.strip().upper() for h in body.holdings]
    if len(set(symbols)) != len(symbols):
        raise HTTPException(status_code=422, detail="Each symbol can appear only once per snapshot")

    snapshot = Snapshot(portfolio_id=p.id, as_of=body.as_of, note=body.note)
    db.add(snapshot)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="There is already a snapshot on that date — delete it first to replace it") from None
    for h, symbol in zip(body.holdings, symbols, strict=False):
        db.add(
            Holding(
                snapshot_id=snapshot.id,
                symbol=symbol,
                name=(h.name or "").strip() or None,
                asset_class=h.asset_class,
                quantity=h.quantity,
                buy_price=h.buy_price,
                current_price=h.current_price,
            )
        )
    db.commit()
    db.expire_all()
    return _snapshot_summary(get_snapshot(db, p, snapshot.id))


@router.delete("/{portfolio_id}/snapshots/{snapshot_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_snapshot(
    portfolio_id: uuid.UUID, snapshot_id: uuid.UUID, tenant: Tenant = Depends(get_current_tenant), db: Session = Depends(get_db)
) -> None:
    p = get_portfolio(db, tenant, portfolio_id)
    s = get_snapshot(db, p, snapshot_id)
    soft_delete.delete_snapshot(db, s.id)
    db.commit()
