"""The projection engine: hand-computed cases, then every golden vector."""

import json
import math
import pathlib

import pytest

from services.wealth.engine import project

GOLDEN = pathlib.Path(__file__).resolve().parent / "data" / "engine_golden.json"
VECTORS = {v["name"]: v for v in json.loads(GOLDEN.read_text(encoding="utf-8"))}


def run(name: str) -> dict:
    return project(VECTORS[name]["input"])


def approx_list(values, expected):
    assert values == pytest.approx(expected, rel=1e-9, abs=1e-6)


def test_annual_compounding_without_contributions():
    approx_list(run("annual_no_contrib")["total"], [1000, 1100, 1210])


def test_rates_are_effective_annual_under_monthly_compounding():
    approx_list(run("monthly_effective_rate")["total"], [1000, 1120])


def test_monthly_contributions_land_at_period_end_under_annual_compounding():
    # 1000 grows 10%, then 12 x 100 is credited at year end without interest.
    approx_list(run("annual_with_monthly_contrib")["total"], [1000, 2300])


def test_yearly_contribution_steps_up_each_year_of_the_phase():
    out = run("yearly_contrib_step_up")
    approx_list(out["total"], [0, 1000, 2100, 3310])
    approx_list(out["buckets"][0]["added"], [0, 1000, 1100, 1210])


def test_withdrawals_stop_at_zero_and_report_the_year():
    out = run("withdrawal_floor")
    approx_list(out["total"], [1000, 400, 0, 0])
    approx_list(out["buckets"][0]["added"], [0, -600, -400, 0])
    assert out["buckets"][0]["depleted_year"] == 2


def test_added_is_split_into_regular_and_one_offs():
    b = run("one_offs_and_lumps")["buckets"][0]
    approx_list([r + o for r, o in zip(b["regular"], b["one_off"], strict=True)], b["added"])
    assert b["one_off"][2] == pytest.approx(5000)
    assert b["regular"][1] == pytest.approx(2400)
    w = run("withdrawal_floor")["buckets"][0]
    approx_list(w["regular"], [0, -600, -400, 0])  # the floor caps what was actually withdrawn


def test_phases_run_back_to_back_and_the_last_runs_to_the_end():
    approx_list(run("phases_back_to_back")["total"], [100, 110, 110, 110])


def test_inflation_grows_the_target_and_deflates_real_values():
    out = run("inflation_target")
    approx_list(out["target"], [1000, 1030, 1060.9])
    approx_list(out["total_real"], [1000, 1000 / 1.03, 1000 / 1.03**2])


def test_fi_is_reported_in_months():
    assert run("fi_month")["fi_months"] == 12
    assert run("already_there")["fi_months"] == 0
    assert run("example_30y_monthly")["fi_months"] is not None


def test_required_rate_is_the_flat_return_that_hits_the_target():
    out = run("required_rate")
    assert out["required_rate"]["status"] == "ok"
    assert out["required_rate"]["value"] == pytest.approx((math.pow(2, 1 / 10) - 1) * 100, abs=1e-9)
    # 1000 extra spread over 120 months at 0%.
    assert out["required_contribution"]["value"] == pytest.approx(1000 / 120, abs=1e-9)


def test_required_contribution_and_unreachable_cases():
    out = run("required_contribution")
    assert out["required_contribution"] == {"status": "ok", "value": pytest.approx(100, abs=1e-9), "bucket": "total"}
    assert out["required_rate"]["status"] == "unreachable"  # nothing to grow
    assert run("unreachable_rate")["required_rate"] == {"status": "unreachable", "value": None}
    already = run("already_there")
    assert already["required_rate"]["status"] == "already"
    assert already["required_contribution"]["status"] == "already"


def test_required_contribution_goes_to_the_chosen_or_largest_bucket():
    assert run("contrib_bucket_chosen")["required_contribution"]["bucket"] == "small"
    assert run("example_30y_monthly")["required_contribution"]["bucket"] == "trading"


def test_no_target_means_no_answers():
    out = run("annual_no_contrib")
    assert out["target"] is None and out["fi_months"] is None
    assert out["required_rate"] is None and out["required_contribution"] is None


def test_compounding_changes_only_contribution_timing():
    # Without contributions every compounding mode gives the same year-end values.
    base = VECTORS["monthly_effective_rate"]["input"]
    ends = {n: project({**base, "compounding": n})["total"][-1] for n in (12, 4, 1)}
    assert ends[12] == pytest.approx(ends[4]) == pytest.approx(ends[1])


@pytest.mark.parametrize("name", sorted(VECTORS))
def test_golden_vector_unchanged(name):
    """Regression: the engine still produces the stored vector (regenerate with scripts/engine_golden.py)."""
    expected = VECTORS[name]["expected"]
    out = run(name)
    assert out["fi_months"] == expected["fi_months"]
    approx_list(out["total"], expected["total"])
    for got, want in zip(out["buckets"], expected["buckets"], strict=True):
        approx_list(got["values"], want["values"])
        approx_list(got["added"], want["added"])
        approx_list(got["regular"], want["regular"])
        approx_list(got["one_off"], want["one_off"])
        assert got["depleted_year"] == want["depleted_year"]
    for key in ("required_rate", "required_contribution"):
        if expected[key] is None:
            assert out[key] is None
        else:
            assert out[key]["status"] == expected[key]["status"]
            assert out[key]["value"] == pytest.approx(expected[key]["value"], rel=1e-9, abs=1e-6)


def test_a_fixed_target_does_not_grow_with_inflation():
    base = VECTORS["inflation_target"]["input"]
    out = project({**base, "target_fixed": True})
    approx_list(out["target"], [1000, 1000, 1000])
    assert out["fi_months"] == 0
    # Growing target: 1000 flat never catches 1000 x 1.03^t after the start.
    grown = project({**base, "target_today": 1001.0})
    assert grown["fi_months"] is None


def test_flat_rate_replaces_every_phase_rate():
    base = VECTORS["phases_back_to_back"]["input"]
    approx_list(project({**base, "flat_rate": 10})["total"], [100, 110, 121, 133.1])


def test_extra_adds_a_flat_monthly_amount_and_the_solves_ignore_it():
    base = VECTORS["required_contribution"]["input"]
    out = project({**base, "extra": {"bucket": "total", "monthly": 100}})
    approx_list(out["total"], [0, 1200])
    approx_list(out["buckets"][0]["regular"], [0, 1200])
    # Solves start from the plan without the extra: still 100 a month needed.
    assert out["required_contribution"]["value"] == pytest.approx(100, abs=1e-9)
    assert project({**base, "flat_rate": 50})["required_rate"]["status"] == "unreachable"


def test_solve_false_skips_the_searches():
    out = project(VECTORS["required_rate"]["input"], solve=False)
    assert out["required_rate"] is None and out["required_contribution"] is None
    assert out["target"] is not None
