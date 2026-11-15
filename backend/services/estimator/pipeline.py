"""One inquiry: review → checks (one retry) → compute → save.

Streams `stage` events while it works, then one `result` (the saved inquiry's
id) or `error`. Nothing is saved unless every step succeeds. The request's
database session is gone once the stream starts, so the save opens its own.
"""

import logging
import uuid
from collections.abc import AsyncIterator
from datetime import date
from decimal import Decimal

from database import SessionLocal
from models import WealthInquiry
from services.estimator.compute import check, compute
from services.estimator.review import review
from services.screenshot.openrouter import LLMError, OpenRouter

log = logging.getLogger("estimator")


async def run(
    llm: OpenRouter,
    snapshot: dict,
    workspace_id: uuid.UUID,
    monthly_expenses: Decimal,
    excluded_ids: list[uuid.UUID],
    dob: date | None,
) -> AsyncIterator[dict]:
    yield {"type": "stage", "stage": "snapshot", "status": "done"}
    yield {"type": "stage", "stage": "review", "status": "running"}
    try:
        reply = await review(llm, snapshot)
        cost = reply.cost
        yield {"type": "stage", "stage": "review", "status": "done"}
        yield {"type": "stage", "stage": "checks", "status": "running"}
        problems = check(reply.args, snapshot)
        if problems:
            log.info("estimator: answer failed %d checks, asking again", len(problems))
            yield {"type": "stage", "stage": "checks", "status": "retry", "problems": problems}
            reply = await review(llm, snapshot, problems, reply.args)
            cost += reply.cost
            problems = check(reply.args, snapshot)
            if problems:
                log.warning("estimator: answer still failing checks: %s", problems)
                yield {
                    "type": "error",
                    "message": "The model's answer didn't pass the checks twice: " + "; ".join(problems[:3]),
                    "problems": problems,
                }
                return
        yield {"type": "stage", "stage": "checks", "status": "done"}
    except LLMError as exc:
        yield {"type": "error", "message": str(exc)}
        return

    yield {"type": "stage", "stage": "compute", "status": "running"}
    try:
        result = compute(reply.args, snapshot, dob)
    except (KeyError, ValueError, ZeroDivisionError, OverflowError) as exc:
        log.exception("estimator: compute failed")
        yield {"type": "error", "message": f"Couldn't compute the projection ({type(exc).__name__})."}
        return
    yield {"type": "stage", "stage": "compute", "status": "done"}

    with SessionLocal() as db:
        inquiry = WealthInquiry(
            workspace_id=workspace_id,
            monthly_expenses=monthly_expenses,
            currency=snapshot["expenses"]["currency"],
            excluded_account_ids=[str(x) for x in excluded_ids],
            snapshot=snapshot,
            answer=reply.args,
            result=result,
            model=reply.model,
            cost=Decimal(str(round(cost, 6))),
        )
        db.add(inquiry)
        db.commit()
        inquiry_id = str(inquiry.id)
    yield {"type": "result", "id": inquiry_id, "cost": round(cost, 4)}
