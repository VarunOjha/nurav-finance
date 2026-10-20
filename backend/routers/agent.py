import json
from collections.abc import AsyncIterator
from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from config import settings
from database import get_db
from dependencies import get_current_tenant, get_current_user
from models import Tenant, User
from schemas.wealth import ApproveBody, Prefs, TranscribeBody, TurnBody
from services.agent import loop, usage
from services.agent.openrouter import LLMError, OpenRouter
from services.agent.signing import BadSignature, verify
from services.agent.snapshot import Snapshot
from services.analytics import load_items

router = APIRouter()


def snapshot(db: Session, tenant: Tenant, user: User) -> Snapshot:
    return Snapshot(load_items(db, tenant), date.today(), user.date_of_birth)


def _sse(events: AsyncIterator[dict]) -> StreamingResponse:
    async def body():
        async for ev in events:
            yield f"data: {json.dumps(ev, ensure_ascii=False)}\n\n"

    # no-transform / X-Accel-Buffering: keep proxies from holding the stream back.
    return StreamingResponse(body(), media_type="text/event-stream", headers={"Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no"})


def _ctx(db: Session, tenant: Tenant, user: User, prefs: Prefs) -> loop.Ctx:
    return loop.Ctx(tenant.id, user.id, snapshot(db, tenant, user), prefs.model_dump(), date.today())


@router.get("/status")
def status(tenant: Tenant = Depends(get_current_tenant)) -> dict:
    """Whether the agent can run, and today's spend against the cap."""
    return {
        "enabled": OpenRouter().enabled,
        "fake": settings.agent_fake,
        "model": settings.agent_model,
        "stt_model": settings.agent_stt_model,
        "cap_usd": settings.agent_daily_cap_usd,
        "spent_today_usd": usage.spent_today(tenant.id),
    }


@router.get("/snapshot")
def preview(tenant: Tenant = Depends(get_current_tenant), user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> dict:
    """Exactly what the model is told about the person's money."""
    return snapshot(db, tenant, user).for_model()


@router.post("/turn")
def turn(
    body: TurnBody, tenant: Tenant = Depends(get_current_tenant), user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> StreamingResponse:
    ctx = _ctx(db, tenant, user, body.prefs)
    history = [m.model_dump(exclude_none=True) for m in body.messages]
    return _sse(loop.chat_turn(ctx, history, body.text))


@router.post("/approve")
def approve(
    body: ApproveBody, tenant: Tenant = Depends(get_current_tenant), user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> StreamingResponse:
    try:
        verify(body.draft, str(tenant.id))
    except BadSignature as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from None
    ctx = _ctx(db, tenant, user, body.prefs)
    history = [m.model_dump(exclude_none=True) for m in body.messages]
    # The version keeps the signed draft, so it can be saved later.
    return _sse(loop.approve_turn(ctx, history, body.draft))


@router.post("/transcribe")
async def transcribe(body: TranscribeBody, tenant: Tenant = Depends(get_current_tenant), user: User = Depends(get_current_user)) -> dict:
    if usage.over_cap(tenant.id):
        raise HTTPException(status_code=429, detail=usage.cap_message())
    try:
        text, used = await OpenRouter().transcribe(body.audio, body.format)
    except LLMError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from None
    usage.record(tenant.id, user.id, "transcribe", settings.agent_stt_model, used)
    return {"text": text}
