"""Signed drafts: the chat is stateless, so a validated draft travels with its proof.

The server validates a draft, resolves it (starting balances, horizon) and
signs it for the tenant. Approving or saving sends the draft back; a valid
signature means the numbers that run are exactly the ones the person saw in
the approval table, with no server-side chat storage.
"""

import hashlib
import hmac
import json

from config import settings


class BadSignature(ValueError):
    pass


def _key() -> bytes:
    return hashlib.sha256(("wealth-draft:" + settings.jwt_secret).encode()).digest()


def _canon(x):
    """JSON as a browser round-trips it: 25000.0 comes back as 25000, so whole floats sign as ints."""
    if isinstance(x, float) and x.is_integer():
        return int(x)
    if isinstance(x, dict):
        return {k: _canon(v) for k, v in x.items()}
    if isinstance(x, list):
        return [_canon(v) for v in x]
    return x


def _digest(doc: dict, tenant_id: str) -> str:
    body = json.dumps({"tenant": tenant_id, "doc": _canon(doc)}, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hmac.new(_key(), body.encode(), hashlib.sha256).hexdigest()


def sign(doc: dict, tenant_id: str) -> dict:
    return {**doc, "sig": _digest(doc, tenant_id)}


def verify(signed: dict, tenant_id: str) -> dict:
    doc = {k: v for k, v in signed.items() if k != "sig"}
    sig = signed.get("sig")
    if not isinstance(sig, str) or not hmac.compare_digest(sig, _digest(doc, tenant_id)):
        raise BadSignature("This draft didn't come from this chat (or was changed). Ask the agent to draft it again.")
    return doc
