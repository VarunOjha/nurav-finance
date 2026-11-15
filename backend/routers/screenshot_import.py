"""POST /api/portfolios/{id}/snapshots/screenshot — read holdings from screenshots.
(POST /api/portfolios/screenshot does the same for a portfolio about to be created.)

Nothing is saved: the response is a proposal the person reviews, edits and
confirms in the browser, then saves as a normal snapshot. The images exist
only in this request's memory; they're never written to disk, the database
or the logs.

The response streams NDJSON: `stage` events while it works, then one
`result` or `error`.
"""

import json
import re
import uuid
from datetime import date, timedelta

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from database import get_db
from dependencies import get_current_workspace
from models import Snapshot, Workspace
from routers.portfolios import snapshot_timeline, snapshots_by_portfolio
from services.access import get_portfolio
from services.screenshot import pipeline
from services.screenshot.images import MAX_FILES, ImageError, prepare
from services.screenshot.numbers import plain
from services.screenshot.openrouter import OpenRouter, get_llm

router = APIRouter()


def _previous(db: Session, portfolio_id: uuid.UUID, as_of: date) -> list[dict]:
    """Holdings of the latest snapshot before `as_of` — for symbol matching and the comparison."""
    timeline = snapshot_timeline(snapshots_by_portfolio(db, [portfolio_id])[portfolio_id])
    base = timeline.at(as_of - timedelta(days=1))
    if base is None:
        return []
    s: Snapshot = base.ref
    return [{"symbol": h.symbol, "name": h.name, "asset_class": h.asset_class, "quantity": plain(h.quantity, 8)} for h in s.holdings]


async def _stream(files: list[UploadFile], currency: str, previous: list[dict], llm: OpenRouter) -> StreamingResponse:
    if not llm.enabled:
        raise HTTPException(
            status_code=503, detail="Screenshot import needs an OpenRouter key: add OPENROUTER_API_KEY to the nurav-finance vault app and restart."
        )
    if not files:
        raise HTTPException(status_code=422, detail="Add at least one screenshot")
    if len(files) > MAX_FILES:
        raise HTTPException(status_code=422, detail=f"At most {MAX_FILES} screenshots at a time")
    screenshots: list[list[str]] = []
    for i, f in enumerate(files, start=1):
        try:
            screenshots.append(prepare(await f.read(), f"Screenshot {i}"))
        except ImageError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        finally:
            await f.close()

    async def events():
        async for event in pipeline.run(llm, screenshots, currency, previous):
            yield json.dumps(event, ensure_ascii=False) + "\n"

    # X-Accel-Buffering: stop any proxy from holding the progress lines back.
    return StreamingResponse(events(), media_type="application/x-ndjson", headers={"Cache-Control": "no-store", "X-Accel-Buffering": "no"})


@router.post("/{portfolio_id}/snapshots/screenshot")
async def read_screenshots(
    portfolio_id: uuid.UUID,
    files: list[UploadFile] = File(..., description="1-4 PNG, JPEG or WebP screenshots of the holdings screen"),
    as_of: date = Form(..., description="The snapshot date being recorded (for the comparison with the previous snapshot)"),
    workspace: Workspace = Depends(get_current_workspace),
    db: Session = Depends(get_db),
    llm: OpenRouter = Depends(get_llm),
) -> StreamingResponse:
    p = get_portfolio(db, workspace, portfolio_id)
    return await _stream(files, p.currency, _previous(db, p.id, as_of), llm)


@router.post("/screenshot")
async def read_screenshots_for_new_portfolio(
    files: list[UploadFile] = File(..., description="1-4 PNG, JPEG or WebP screenshots of the holdings screen"),
    currency: str = Form(..., description="The new portfolio's currency (3-letter code)"),
    workspace: Workspace = Depends(get_current_workspace),
    llm: OpenRouter = Depends(get_llm),
) -> StreamingResponse:
    """The same read for a portfolio not created yet (it's created with these holdings)."""
    if not re.fullmatch(r"[A-Z]{3}", currency):
        raise HTTPException(status_code=422, detail="Currency must be a 3-letter code like USD")
    return await _stream(files, currency, [], llm)
