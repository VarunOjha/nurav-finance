"""Check a drafted plan against the person's accounts and resolve it for the engine.

`check` turns the agent's WealthParams into a resolved draft (each pot's
starting value from today's balances in its currency, the horizon in years,
segment starts, what's left out) or a list of errors written for the model to
fix. Messages use aliases, never names: they go back to the model. The
resolved draft is what the person approves, what the engine runs and what a
saved plan freezes.

Each pot has one unknown (`solve_for`) and needs the other numbers:
- time: target and return (no horizon: that's the answer);
- amount: horizon and return (a target is optional, checked against);
- rate: target and horizon (no return: that's the answer);
- contribution: target, horizon and return (the amount is the answer).
"""

from decimal import Decimal

from pydantic import ValidationError

from schemas.wealth import MAX_HORIZON, RISK_BANDS, WealthParams
from services.agent.snapshot import Snapshot, age_on
from services.holdings import ZERO

DRAFT_VERSION = 2
OPTION_STEP = 2.0  # rate options default to the return 2 points down and up
SOLVE_LABELS = {
    "time": "When do I get there",
    "amount": "How much will I have",
    "rate": "What return do I need",
    "contribution": "How much should I add",
}
RISK_LABELS = {"cautious": "Cautious", "balanced": "Balanced", "growth": "Growth"}
NEEDS = {
    "time": ("target", "rate"),
    "amount": ("horizon", "rate"),
    "rate": ("target", "horizon"),
    "contribution": ("target", "horizon", "rate"),
}


def pydantic_errors(exc: ValidationError) -> list[str]:
    out = []
    for e in exc.errors()[:12]:
        where = ".".join(str(p) for p in e["loc"])
        out.append(f"{where}: {e['msg']}" if where else e["msg"])
    return out


def _horizon(pot, snap: Snapshot, where: str, errors: list[str]) -> int | None:
    if pot.horizon_years is not None and pot.horizon_age is not None:
        errors.append(f"{where}: give horizon_years or horizon_age, not both.")
        return None
    if pot.horizon_years is not None:
        return pot.horizon_years
    if pot.horizon_age is None:
        return None
    if snap.birth is None:
        errors.append(f"{where}: the person has no date of birth in Nurav, so plan in years (horizon_years) or ask them to add it in Profile.")
        return None
    years = pot.horizon_age - age_on(snap.birth, snap.as_of)
    if years < 1:
        errors.append(f"{where}: horizon_age {pot.horizon_age} is not after their current age ({age_on(snap.birth, snap.as_of)}).")
        return None
    if years > MAX_HORIZON:
        errors.append(f"{where}: plans run at most {MAX_HORIZON} years; age {pot.horizon_age} is {years} years away.")
        return None
    return years


def _band_warnings(p: WealthParams, cur: str, pot, warnings: list[str]) -> None:
    if not p.risk_appetite:
        return
    lo, hi = RISK_BANDS[p.risk_appetite]
    label = RISK_LABELS[p.risk_appetite]
    if pot.rate is not None and not lo <= pot.rate <= hi:
        side = "above" if pot.rate > hi else "below"
        warnings.append(f"{cur}: {pot.rate:g}% is {side} the {lo:g}–{hi:g}% range for {label}.")
    for s in pot.segments:
        # Cash and savings segments are meant to earn less: only a high return is worth a word.
        if s.rate is not None and s.rate > hi:
            warnings.append(f"{cur} · {s.name}: {s.rate:g}% is above the {lo:g}–{hi:g}% range for {label}.")


def _check_pot(p: WealthParams, i: int, snap: Snapshot, errors: list[str], warnings: list[str]) -> dict | None:
    pot = p.pots[i]
    cur = pot.currency
    where = f"pots[{i}] ({cur})"
    n_err = len(errors)
    H = _horizon(pot, snap, where, errors)
    segs = pot.segments
    has = {
        "target": pot.target is not None or (bool(segs) and all(s.target is not None for s in segs)),
        "horizon": H is not None,
        "rate": pot.rate is not None or (bool(segs) and all(s.rate is not None for s in segs)),
    }
    for need in NEEDS[pot.solve_for]:
        if not has[need]:
            what = {
                "target": "a target",
                "horizon": "a horizon (horizon_years or horizon_age)",
                "rate": "a return (rate, or a rate on every segment)",
            }[need]
            errors.append(f"{where}: solving for {pot.solve_for} needs {what}.")
    if pot.solve_for == "time" and (pot.horizon_years is not None or pot.horizon_age is not None):
        errors.append(f"{where}: solving for time, the horizon is the answer; leave horizon_years and horizon_age null.")
    if pot.solve_for == "rate" and (pot.rate is not None or any(s.rate is not None for s in segs)):
        errors.append(f"{where}: solving for the return, leave rate (and segment rates) null; it is the answer.")
    if pot.solve_for == "contribution" and pot.contribution is not None and pot.contribution.amount:
        errors.append(
            f"{where}: solving for the contribution, its amount is the answer; set contribution.amount to 0 (per, years and step_up still apply)."
        )

    plan_years = H if H is not None else MAX_HORIZON
    if pot.contribution and pot.contribution.years and H is not None and pot.contribution.years > H:
        errors.append(f"{where}: the contribution runs {pot.contribution.years} years but the plan is {H}.")
    for o in pot.one_offs:
        if o.year > plan_years:
            errors.append(f"{where}: a one-off in plan year {o.year} is after the plan ends (year {plan_years}).")

    # Starting money: everything held in this currency, less what's excluded.
    held = [e for e in snap.live() if e.item.currency == cur]
    for alias in pot.exclude:
        e = snap.entries.get(alias)
        if e is None:
            errors.append(f"{where}: there is no {alias}. Use aliases from the snapshot exactly.")
        elif e.item.currency != cur:
            errors.append(f"{where}: {alias} is in {e.item.currency}, not {cur}.")
        elif e.value is None:
            errors.append(f"{where}: {alias} has no value of its own today (closed, or counted inside a portfolio).")
    if not held and pot.start_override is None:
        errors.append(f"{where}: they hold nothing in {cur}. Use start_override for money they don't track yet, or another currency.")

    if segs:
        if pot.rate is not None or pot.rate_options is not None:
            errors.append(f"{where}: with segments, each segment has its own rate; leave the pot's rate and rate_options null.")
        if pot.contribution is not None or pot.one_offs:
            errors.append(
                f"{where}: with segments, put contributions on the segments (segment.contribution); leave the pot's contribution and one_offs empty."
            )
        names = [s.name.lower() for s in segs]
        if len(set(names)) != len(names):
            errors.append(f"{where}: segment names must be unique.")
        shares = [s.share is not None for s in segs]
        amounts = [s.amount is not None for s in segs]
        if not (all(shares) and not any(amounts)) and not (all(amounts) and not any(shares)):
            errors.append(f"{where}: give every segment a share (percent) or every segment an amount, not a mix.")
        for s in segs:
            if pot.solve_for != "rate" and s.rate is None:
                errors.append(f"{where}: segment {s.name} needs a rate.")
            if s.contribution and s.contribution.years and H is not None and s.contribution.years > H:
                errors.append(f"{where}: segment {s.name}'s contribution runs {s.contribution.years} years but the plan is {H}.")
        if pot.solve_for == "contribution" and not all(s.target is not None for s in segs):
            errors.append(f"{where}: solving for the contribution with segments needs a target on every segment.")
    elif pot.rate_options is not None and sorted(pot.rate_options) != list(pot.rate_options):
        errors.append(f"{where}: rate_options must be in ascending order (low, middle, high).")

    if len(errors) > n_err:
        return None

    excluded_aliases = set(pot.exclude)
    items = [
        {"alias": e.alias, "name": e.item.name, "kind": e.item.kind, "value": round(float(e.value), 2)}  # type: ignore[arg-type]
        for e in held
        if e.alias not in excluded_aliases
    ]
    excluded = [{"alias": e.alias, "name": e.item.name, "value": round(float(e.value), 2)} for e in held if e.alias in excluded_aliases]  # type: ignore[arg-type]
    actual = float(round(sum((Decimal(str(x["value"])) for x in items), ZERO), 2))
    start = round(float(pot.start_override), 2) if pot.start_override is not None else actual

    segments = []
    if segs:
        if all(s.share is not None for s in segs):
            total_share = sum(s.share for s in segs)  # type: ignore[misc]
            if abs(total_share - 100) > 0.5:
                errors.append(f"{where}: segment shares add up to {total_share:g}%, not 100%.")
                return None
            segments = [{"name": s.name, "start": round(start * s.share / total_share, 2)} for s in segs]  # type: ignore[operator]
        else:
            total_amount = sum(s.amount for s in segs)  # type: ignore[misc]
            if abs(total_amount - start) > max(1.0, start * 0.001):
                gap = start - total_amount
                errors.append(
                    f"{where}: segment amounts add up to {total_amount:,.2f} but the pot starts at {start:,.2f} "
                    f"({'unassigned' if gap > 0 else 'over by'} {abs(gap):,.2f}). Adjust them, use shares, or set start_override."
                )
                return None
            segments = [{"name": s.name, "start": round(float(s.amount), 2)} for s in segs]  # type: ignore[arg-type]

    target = pot.target
    if segs and all(s.target is not None for s in segs):
        seg_sum = float(sum(s.target for s in segs))  # type: ignore[misc]
        if target is None:
            target = seg_sum
        elif abs(seg_sum - target) > target * 0.001:
            warnings.append(
                f"{cur}: the segment targets add up to {seg_sum:,.0f}, not the pot's target of {target:,.0f}; the pot's target is used for the total."
            )

    options = None
    if not segs:
        if pot.rate_options is not None:
            options = [float(x) for x in pot.rate_options]
        elif pot.rate is not None:
            options = [pot.rate - OPTION_STEP, float(pot.rate), pot.rate + OPTION_STEP]
        if options and pot.rate is not None and pot.rate not in options:
            warnings.append(f"{cur}: the main answer uses {pot.rate:g}%, which isn't one of the rate options; the options are shown alongside it.")

    if excluded:
        warnings.append(f"{cur}: left out of the plan: {', '.join(x['alias'] for x in excluded)}.")
    if pot.start_override is not None and held:
        warnings.append(f"{cur}: starting from {start:,.0f} instead of the {actual:,.0f} your balances say.")
    _band_warnings(p, cur, pot, warnings)
    return {
        "currency": cur,
        "start": start,
        "actual_start": actual,
        "items": items,
        "excluded": excluded,
        "horizon_years": H,
        "target": None if target is None else float(target),
        "segments": segments,
        "rate_options": options,
    }


def check(raw: dict, snap: Snapshot) -> tuple[dict | None, list[str]]:
    """(resolved draft, []) or (None, errors). Warnings ride inside the draft."""
    try:
        p = WealthParams.model_validate(raw)
    except ValidationError as exc:
        return None, pydantic_errors(exc)

    errors: list[str] = []
    warnings: list[str] = []
    currencies = [pot.currency for pot in p.pots]
    if len(set(currencies)) != len(currencies):
        errors.append("One pot per currency: merge the pots that share a currency (use segments to split one).")
        return None, errors
    pots = [_check_pot(p, i, snap, errors, warnings) for i in range(len(p.pots))]
    if errors:
        return None, errors

    others: dict[str, int] = {}
    for e in snap.live():
        if e.item.currency not in currencies:
            others[e.item.currency] = others.get(e.item.currency, 0) + 1
    for cur, n in sorted(others.items()):
        warnings.append(f"Not in this plan: {n} item{'s' if n > 1 else ''} in {cur}. Add a {cur} pot to include them.")

    draft = {
        "v": DRAFT_VERSION,
        "params": p.model_dump(mode="json"),
        "as_of": snap.as_of.isoformat(),
        "birth_date": snap.birth.isoformat() if snap.birth else None,
        "pots": pots,
        "warnings": warnings,
    }
    return draft, []
