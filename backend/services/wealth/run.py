"""Run an approved draft: the only place a plan becomes numbers.

Each pot runs on its own, in its own currency. The main answer is the pot's
unknown (time, amount, return or contribution) at the person's return. Around
it, the possibilities: the same plan at three returns (the rate options, or
every segment's return 2 points down and up), each with the amount it reaches
and when it crosses the target; what the contribution changes; for a solved
return, the return needed over a shorter and a longer horizon; for a solved
contribution, the amount needed at each return. Segments are checked against
their own final targets, with the extra a month each needs if it falls short.

`figures` are the formatted numbers the agent may quote, by token
({fi_date:USD}); the agent never types a number into the report.
"""

import math
from datetime import date

from services.agent.snapshot import Snapshot, age_on
from services.wealth import fmt
from services.wealth.engine import ITERATIONS, project, required_contribution, required_rate
from services.wealth.params import OPTION_STEP, SOLVE_LABELS
from services.wealth.risk import for_model, risk_read

ENGINE_VERSION = "3"
LONG = 60  # how far "when do I get there" looks
SEGMENT_SHIFTS = (-OPTION_STEP, 0.0, OPTION_STEP)


# ── building engine plans ────────────────────────────────────────────────────


def _phases(rate: float, contrib: dict | None, H: int, amount: float | None = None) -> list[dict]:
    c = contrib or {"amount": 0.0, "per": "month", "years": None, "step_up": 0.0}
    amt = float(c["amount"] if amount is None else amount)
    one = {"rate": rate, "amount": amt, "per": c["per"], "step_up": float(c["step_up"])}
    if amt and c["years"] and c["years"] < H:
        return [{**one, "years": c["years"]}, {"years": None, "rate": rate, "amount": 0.0, "per": "month", "step_up": 0.0}]
    return [{**one, "years": None}]


class Pot:
    """One pot's parameters and the plans the engine runs for it."""

    def __init__(self, draft: dict, i: int):
        p = draft["params"]
        self.p = p["pots"][i]
        self.d = draft["pots"][i]
        self.cur = self.p["currency"]
        self.solve = self.p["solve_for"]
        self.n = int(p["compounding"])
        self.inflation = float(p["inflation"])
        self.target = self.d["target"]
        self.fixed = self.p["target_basis"] == "nominal"
        self.H = self.d["horizon_years"]
        if self.p["segments"]:
            self.spec = [
                {"key": s["name"], "start": r["start"], "rate": s["rate"], "contribution": s["contribution"], "one_offs": [], "target": s["target"]}
                for s, r in zip(self.p["segments"], self.d["segments"], strict=True)
            ]
        else:
            self.spec = [
                {
                    "key": self.cur,
                    "start": self.d["start"],
                    "rate": self.p["rate"],
                    "contribution": self.p["contribution"],
                    "one_offs": self.p["one_offs"],
                    "target": self.target,
                }
            ]
        self.segmented = bool(self.p["segments"])
        # Filled by the solve: the return or contribution amounts the answer found.
        self.flat: float | None = None
        self.amounts: dict[str, float] = {}

    def target_end(self, years: int, target: float | None = None) -> float:
        t = self.target if target is None else target
        return t if self.fixed else t * (1 + self.inflation / 100) ** years  # type: ignore[operator]

    def plan(
        self,
        H: int,
        *,
        shift: float = 0.0,
        rate: float | None = None,
        amounts: dict[str, float] | None = None,
        no_contrib: bool = False,
        only: str | None = None,
        target: float | None = None,
    ) -> dict:
        """An engine plan over H years. `rate` replaces every return, `shift` moves them;
        `amounts` sets contribution amounts by key; `only` keeps one segment."""
        buckets = []
        for s in self.spec:
            if only is not None and s["key"] != only:
                continue
            r = rate if rate is not None else (s["rate"] if s["rate"] is not None else 0.0) + shift
            amt = 0.0 if no_contrib else (amounts or {}).get(s["key"])
            buckets.append(
                {
                    "key": s["key"],
                    "start": s["start"],
                    "phases": _phases(r, s["contribution"], H, amt),
                    "one_offs": []
                    if no_contrib
                    else [{"year": o["year"], "amount": float(o["amount"]), "note": o["note"]} for o in s["one_offs"] if o["year"] <= H],
                }
            )
        t = self.target if target is None else target
        return {
            "horizon_years": H,
            "compounding": self.n,
            "inflation": self.inflation,
            "target_today": t,
            "target_fixed": self.fixed,
            "contrib_bucket": None,
            "buckets": buckets,
        }

    def shown(self, H: int, **kw) -> dict:
        """The plan that answers the question: with the solved return or contribution in it."""
        kw.setdefault("amounts", self.amounts)
        if self.flat is not None and "rate" not in kw:
            kw["rate"] = self.flat + kw.pop("shift", 0.0)
        return self.plan(H, **kw)


def _end(plan: dict) -> float:
    return project(plan, solve=False)["total"][-1]


def solve_amount(make, target_end: float) -> dict:
    """The contribution amount x where make(x) ends at the target."""

    def f(x: float) -> float:
        return _end(make(x)) - target_end

    if f(0.0) >= 0:
        return {"status": "already", "value": 0.0}
    hi = 1000.0
    while f(hi) < 0:
        hi *= 2
        if hi > 1e13:
            return {"status": "unreachable", "value": None}
    lo = 0.0
    for _ in range(ITERATIONS):
        mid = (lo + hi) / 2
        if f(mid) >= 0:
            hi = mid
        else:
            lo = mid
    return {"status": "ok", "value": round(hi, 2)}


def _rate(plan: dict, target_end: float) -> dict:
    s = required_rate(plan, target_end)
    return {**s, "value": None if s["value"] is None else round(s["value"], 4)}


def _fi(plan: dict) -> int | None:
    return project(plan, solve=False)["fi_months"]


def _r2(xs):
    return None if xs is None else [round(x, 2) for x in xs]


def _checkpoints(H: int) -> list[int]:
    step = 10 if H > 40 else 5 if H >= 15 else 2 if H >= 6 else 1
    ys = list(range(step, H + 1, step))
    if not ys or ys[-1] != H:
        ys.append(H)
    return ys


# ── one pot ──────────────────────────────────────────────────────────────────


def _solve(pot: Pot) -> dict:
    """Fill pot.flat / pot.amounts and return the main answer."""
    H = pot.H
    if pot.solve == "rate":
        s = _rate(pot.plan(H), pot.target_end(H))
        if s["status"] == "ok":
            pot.flat = s["value"]
        return s
    if pot.solve == "contribution":
        if not pot.segmented:
            key = pot.spec[0]["key"]
            s = solve_amount(lambda x: pot.plan(H, amounts={key: x}), pot.target_end(H))
            if s["status"] == "ok":
                pot.amounts = {key: s["value"]}
            per = (pot.spec[0]["contribution"] or {}).get("per", "month")
            return {**s, "per": per}
        parts = {}
        for seg in pot.spec:
            k, t = seg["key"], seg["target"]
            s = solve_amount(lambda x, k=k, t=t: pot.plan(H, amounts={k: x}, only=k, target=t), pot.target_end(H, t))
            parts[seg["key"]] = s
            if s["status"] == "ok":
                pot.amounts[seg["key"]] = s["value"]
        statuses = {s["status"] for s in parts.values()}
        status = "unreachable" if "unreachable" in statuses else "ok" if "ok" in statuses else "already"
        total = None if status == "unreachable" else round(sum(s["value"] or 0 for s in parts.values()), 2)
        return {"status": status, "value": total, "per": "month", "by_segment": parts}
    if pot.solve == "time":
        fi = _fi(pot.plan(LONG))
        return {"status": "unreachable" if fi is None else "already" if fi == 0 else "ok", "months": fi}
    main = project(pot.plan(H), solve=False)
    return {"status": "ok", "value": round(main["total"][-1], 2), "real": round(main["total_real"][-1], 2)}


def _options(pot: Pot) -> list[dict]:
    """The three returns the possibilities compare: label, and how to build each plan."""
    if pot.segmented:
        return [{"label": "as set" if s == 0 else f"{s:+g} points".replace("-", "−"), "shift": s, "rate": None} for s in SEGMENT_SHIFTS]
    opts = pot.d["rate_options"]
    if opts is None and pot.flat is not None:
        mid = round(pot.flat * 2) / 2
        opts = [mid - OPTION_STEP, mid, mid + OPTION_STEP]
    return [{"label": fmt.pct(r), "shift": None, "rate": r} for r in opts or []]


def _line_plan(pot: Pot, opt: dict, H: int) -> dict:
    if opt["rate"] is not None:
        return pot.shown(H, rate=opt["rate"])
    return pot.shown(H, shift=opt["shift"])


def run_pot(pot: Pot) -> dict:
    answer = _solve(pot)
    has_target = pot.target is not None
    fi = _fi(pot.shown(LONG)) if has_target else None
    options = _options(pot)
    long_lines = [project(_line_plan(pot, o, LONG), solve=False) for o in options]

    if pot.H is not None:
        Hd = pot.H
    else:
        reach = [x["fi_months"] for x in long_lines if x["fi_months"] is not None]
        if fi is not None:
            reach.append(fi)
        if not reach:
            Hd = LONG
        else:
            Hd = math.ceil(max(reach) / 12)
            if fi is not None:
                Hd = min(Hd, 2 * math.ceil(fi / 12) + 5)
            Hd = max(5, min(LONG, Hd))

    main = project(pot.shown(Hd), solve=False)
    lines = [
        {
            "label": o["label"],
            "rate": o["rate"],
            "shift": o["shift"],
            "total": _r2(x["total"][: Hd + 1]),
            "end": round(x["total"][Hd], 2),
            "fi_months": x["fi_months"],
        }
        for o, x in zip(options, long_lines, strict=True)
    ]

    effect = None
    has_contrib = any(s["contribution"] and s["contribution"]["amount"] for s in pot.spec) or any(s["one_offs"] for s in pot.spec)
    # Nothing to compare when the target is already reached today.
    if has_contrib and pot.solve != "contribution" and fi != 0:
        if pot.solve == "time":
            effect = {"with": fi, "without": _fi(pot.shown(LONG, no_contrib=True))}
        elif pot.solve == "amount":
            effect = {"with": round(main["total"][-1], 2), "without": round(_end(pot.shown(Hd, no_contrib=True)), 2)}
        elif pot.solve == "rate":
            effect = {"with": answer, "without": _rate(pot.plan(Hd, no_contrib=True), pot.target_end(Hd))}
        if effect is not None:
            effect["kind"] = pot.solve

    by_horizon = None
    if pot.solve == "rate":
        hs = sorted({h for h in (pot.H - 5, pot.H, pot.H + 5) if 1 <= h <= LONG})
        by_horizon = [{"years": h, **_rate(pot.plan(h), pot.target_end(h))} for h in hs]

    by_rate = None
    if pot.solve == "contribution" and not pot.segmented:
        key = pot.spec[0]["key"]
        goal = pot.target_end(pot.H)
        by_rate = [
            {"label": o["label"], "rate": o["rate"], **solve_amount(lambda x, r=o["rate"]: pot.plan(pot.H, rate=r, amounts={key: x}), goal)}
            for o in options
        ]

    ref = pot.H if pot.H is not None else (None if fi is None else max(1, math.ceil(fi / 12)))
    segments = None
    if pot.segmented:
        segments = []
        spend = pot.p["monthly_spending"]
        for seg in pot.spec:
            k, t = seg["key"], seg["target"]
            alone = dict(only=k, target=t)
            row: dict = {"name": k, "start": seg["start"], "rate": seg["rate"], "target": t, "months": None, "end": None, "target_end": None}
            if pot.flat is not None:
                row["rate"] = pot.flat
            if t is not None:
                row["months"] = _fi(pot.shown(LONG, **alone))
            if ref is not None:
                row["end"] = round(_end(pot.shown(ref, **alone)), 2)
                if t is not None:
                    row["target_end"] = round(pot.target_end(ref, t), 2)
                    row["reaches"] = row["end"] >= row["target_end"] - 0.5
            if pot.solve == "contribution":
                row["required"] = {**answer["by_segment"][k], "per": "month"}
            elif t is not None and ref is not None and not row.get("reaches"):
                s = required_contribution(pot.shown(ref, **alone), pot.target_end(ref, t))
                value = None if s["value"] is None else round(s["value"], 2)
                row["required"] = {"status": s["status"], "value": value, "per": "month", "extra": True}
            if spend and t is not None:
                row["runway_months"] = round(t / spend, 1)
            segments.append(row)

    return {
        "currency": pot.cur,
        "solve_for": pot.solve,
        "start": pot.d["start"],
        "target": pot.target,
        "target_basis": pot.p["target_basis"],
        "plan_years": pot.H,
        "horizon_years": Hd,
        "ref_years": ref,
        "answer": answer,
        "fi_months": fi,
        "flat_rate": pot.flat,
        "amounts": pot.amounts,
        "main": {
            "buckets": [{"key": b["key"], "values": _r2(b["values"]), "added": _r2(b["added"])} for b in main["buckets"]],
            "total": _r2(main["total"]),
            "total_real": _r2(main["total_real"]),
            "target": _r2(main["target"]),
            "fi_months": main["fi_months"],
        },
        "lines": lines,
        "grid_years": _checkpoints(Hd),
        "contribution_effect": effect,
        "rate_by_horizon": by_horizon,
        "contribution_by_rate": by_rate,
        "segments": segments,
    }


def run_version(draft: dict, snap: Snapshot, n: int) -> dict:
    pots = [run_pot(Pot(draft, i)) for i in range(len(draft["pots"]))]
    risk = {p["currency"]: risk_read(snap, p["currency"], draft["params"]["pots"][i]["monthly_spending"]) for i, p in enumerate(pots)}
    version = {"n": n, "engine": ENGINE_VERSION, "draft": draft, "pots": pots, "risk": risk, "narrative": None}
    version["figures"] = figures(version)
    return version


# ── figures ──────────────────────────────────────────────────────────────────


def add_months(day: date, months: int) -> tuple[int, int]:
    m = day.month - 1 + months
    return day.year + m // 12, m % 12 + 1


def _years(months: int) -> str:
    y = months / 12
    return "1 year" if round(y, 1) == 1 else f"{y:.1f} years".replace(".0 years", " years")


def figures(v: dict) -> dict[str, str]:
    """Token -> display string. Every number the report may mention."""
    draft = v["draft"]
    p = draft["params"]
    as_of = date.fromisoformat(draft["as_of"])
    birth = date.fromisoformat(draft["birth_date"]) if draft["birth_date"] else None
    f: dict[str, str] = {"inflation": fmt.pct(p["inflation"]), "today_year": str(as_of.year)}

    def when(key: str, months: int) -> None:
        y, mo = add_months(as_of, months)
        f[f"{key}"] = fmt.month_label(y, mo)

    for i, r in enumerate(v["pots"]):
        c = r["currency"]
        pp = p["pots"][i]
        m = lambda x, c=c: fmt.money(x, c)  # noqa: E731
        Hd = r["horizon_years"]
        a = r["answer"]
        f[f"start:{c}"] = m(r["start"])
        if r["target"] is not None:
            f[f"target:{c}"] = m(r["target"])
        if r["plan_years"] is not None:
            f[f"horizon:{c}"] = f"{r['plan_years']} years"
            f[f"end_year:{c}"] = str(as_of.year + r["plan_years"])
            if birth:
                f[f"end_age:{c}"] = str(age_on(birth, as_of) + r["plan_years"])
        main = r["main"]
        added = sum(sum(b["added"]) for b in main["buckets"])
        if added:
            f[f"added:{c}"] = m(added)
        # A "when" pot's chart just runs long enough to show every crossing: its end isn't an answer.
        timed = r["solve_for"] == "time"
        if not timed:
            f[f"final:{c}"] = m(main["total"][Hd])
            if p["inflation"] > 0:
                f[f"final_real:{c}"] = m(main["total_real"][Hd])
            f[f"growth:{c}"] = m(main["total"][Hd] - main["total"][0] - added)

        fi = r["fi_months"]
        if r["target"] is not None and fi is not None:
            when(f"fi_date:{c}", fi)
            f[f"fi_years:{c}"] = _years(fi)
            if birth:
                y, mo = add_months(as_of, fi)
                f[f"fi_age:{c}"] = str(age_on(birth, date(y, mo, min(as_of.day, 28))))
            if not r["target_basis"] == "nominal" and p["inflation"] > 0:
                f[f"target_at_fi:{c}"] = m(r["target"] * (1 + p["inflation"] / 100) ** (fi / 12))
        if r["solve_for"] == "amount" and main["target"] is not None:
            gap = main["target"][Hd] - main["total"][Hd]
            f[f"target_at_end:{c}"] = m(main["target"][Hd])
            f[f"shortfall:{c}" if gap > 0 else f"surplus:{c}"] = m(abs(gap))
        if r["solve_for"] == "rate" and a["status"] == "ok":
            f[f"required_rate:{c}"] = fmt.pct(a["value"])
        if r["solve_for"] == "contribution" and a["value"] is not None:
            f[f"required_contribution:{c}"] = m(a["value"])

        contrib = pp["contribution"]
        if contrib and contrib["amount"]:
            f[f"contribution:{c}"] = m(abs(contrib["amount"]))
            if contrib["years"]:
                f[f"contribution_years:{c}"] = f"{contrib['years']} years"
            if contrib["step_up"]:
                f[f"step_up:{c}"] = fmt.pct(contrib["step_up"])
        for j, o in enumerate(pp["one_offs"], start=1):
            f[f"one_off:{c}:{j}"] = m(abs(o["amount"]))

        for j, line in enumerate(r["lines"], start=1):
            if line["rate"] is not None:
                f[f"rate:{c}:{j}"] = fmt.pct(line["rate"])
            else:
                f[f"shift:{c}:{j}"] = line["label"]
            if not timed:
                f[f"final:{c}:{j}"] = m(line["end"])
            if line["fi_months"] is not None and r["target"] is not None:
                f[f"time:{c}:{j}"] = _years(line["fi_months"])
                when(f"date:{c}:{j}", line["fi_months"])

        e = r["contribution_effect"]
        if e:
            if e["kind"] == "time" and e["with"] is not None and e["without"] is not None:
                f[f"without_contribution:{c}"] = _years(e["without"])
                f[f"contribution_saves:{c}"] = _years(e["without"] - e["with"])
            elif e["kind"] == "time" and e["with"] is not None:
                f[f"without_contribution:{c}"] = "not within 60 years"
            elif e["kind"] == "amount":
                f[f"without_contribution:{c}"] = m(e["without"])
                f[f"contribution_adds:{c}"] = m(e["with"] - e["without"])
            elif e["kind"] == "rate" and e["without"]["status"] == "ok":
                f[f"without_contribution:{c}"] = fmt.pct(e["without"]["value"])
                if e["with"]["status"] == "ok":
                    f[f"contribution_saves:{c}"] = f"{e['without']['value'] - e['with']['value']:.1f} points"
        for h in r["rate_by_horizon"] or []:
            if h["status"] == "ok":
                f[f"rate_needed:{c}:{h['years']}"] = fmt.pct(h["value"])
        for j, x in enumerate(r["contribution_by_rate"] or [], start=1):
            if x["value"] is not None:
                f[f"needed:{c}:{j}"] = m(x["value"])

        for s in r["segments"] or []:
            k = f"{c}:{s['name']}"
            f[f"seg_start:{k}"] = m(s["start"])
            if s["rate"] is not None:
                f[f"seg_rate:{k}"] = fmt.pct(s["rate"])
            if s["target"] is not None:
                f[f"seg_target:{k}"] = m(s["target"])
            if s["end"] is not None:
                f[f"seg_final:{k}"] = m(s["end"])
                if s["target_end"] is not None:
                    gap = s["target_end"] - s["end"]
                    f[f"seg_short:{k}" if gap > 0 else f"seg_surplus:{k}"] = m(abs(gap))
            if s["months"] is not None:
                f[f"seg_years:{k}"] = _years(s["months"])
                when(f"seg_date:{k}", s["months"])
            req = s.get("required")
            if req and req["value"]:
                f[f"seg_needs:{k}"] = m(req["value"])
            if s.get("runway_months") is not None:
                f[f"seg_runway:{k}"] = _years(int(round(s["runway_months"])))

        risk = v["risk"][c]
        if "holdings" in risk:
            f[f"largest_holding_share:{c}"] = fmt.share(risk["holdings"]["top"]["share"])
            f[f"top3_holdings_share:{c}"] = fmt.share(risk["holdings"]["top3_share"])
            for ac in risk["holdings"]["asset_classes"]:
                f[f"asset_share:{c}:{ac['asset_class']}"] = fmt.share(ac["share"])
        if risk.get("retirement_share") is not None:
            f[f"retirement_share:{c}"] = fmt.share(risk["retirement_share"])
        if risk.get("cash_share") is not None:
            f[f"cash_share:{c}"] = fmt.share(risk["cash_share"])
        if risk.get("cash_months") is not None:
            f[f"cash_months:{c}"] = f"{risk['cash_months']:.1f} months"
    return f


def _status_words(r: dict) -> str:
    a, s = r["answer"], r["solve_for"]
    if s == "time":
        return {"ok": "target reached", "already": "target already reached today", "unreachable": "target not reached within 60 years"}[a["status"]]
    if s == "rate":
        return {"ok": "return found", "already": "reached even at -20% a year", "unreachable": "no return up to 50% a year reaches it"}[a["status"]]
    if s == "contribution":
        return {"ok": f"contribution found (per {a['per']})", "already": "nothing extra needed", "unreachable": "out of reach"}[a["status"]]
    return "amount computed"


def results_brief(v: dict) -> dict:
    """What the model is told after approval: per pot, statuses and the figure names, aliases only."""
    pots = []
    for r in v["pots"]:
        c = r["currency"]
        pots.append(
            {
                "currency": c,
                "question": f"{r['solve_for']} ({SOLVE_LABELS[r['solve_for']]})",
                "answer": _status_words(r),
                "chart_years": r["horizon_years"],
                "chart_shows": "the plan with the solved return"
                if r["solve_for"] == "rate"
                else "the plan with the solved contribution"
                if r["solve_for"] == "contribution"
                else "the plan as approved",
                "possibilities": [
                    {"option": line["label"], "reaches_target": None if r["target"] is None else line["fi_months"] is not None} for line in r["lines"]
                ],
                "segments": [
                    {
                        "name": s["name"],
                        "reaches_its_target": s.get("reaches"),
                        "needs_extra_per_month": bool(s.get("required") and s["required"]["value"]),
                    }
                    for s in r["segments"] or []
                ]
                or None,
                "risk": for_model(v["risk"][c]),
            }
        )
    return {
        "version": f"v{v['n']}",
        "pots": pots,
        "figures": v["figures"],
        "warnings": v["draft"]["warnings"],
    }
