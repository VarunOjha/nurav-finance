"""OpenRouter chat completions with structured output (a strict JSON schema).

Each step is described as a tool-style definition (name, description, JSON
schema); it's sent as `response_format: json_schema` with `strict: true`, so
the reply must match the schema. (Forced tool calls aren't an option: Claude
Sonnet 5.5 rejects tool_choice "tool"/"any"; it also refuses `temperature`.)

Only the server talks to OpenRouter; the key never reaches the browser. Images
travel inside the request body and are not logged. Retries on 429 / 5xx and
connection errors.
"""

import asyncio
import copy
import json
import logging
from dataclasses import dataclass

import httpx

from config import settings

log = logging.getLogger("screenshot.openrouter")
RETRY_STATUS = {429, 500, 502, 503, 504}
MAX_RETRIES = 2
# Output token budgets. Only tokens actually written are billed, so a generous first
# budget costs nothing extra; a reply that still hits it is retried at the maximum.
# (8,000 used to cut off the merged list for long or several screenshots.)
FIRST_BUDGET = 16_000
MAX_BUDGET = 64_000


class LLMError(RuntimeError):
    """A failure worded for the person (never contains the key)."""


@dataclass
class ToolResult:
    args: dict
    cost: float
    model: str


def strict_schema(schema: dict) -> dict:
    """Strict mode: every object lists all its properties as required and allows no others.
    Optional values are expressed as nullable types in the schema itself."""
    out = copy.deepcopy(schema)

    def walk(node):
        if isinstance(node, dict):
            if node.get("type") == "object" and "properties" in node:
                node["required"] = list(node["properties"])
                node["additionalProperties"] = False
            for v in node.values():
                walk(v)
        elif isinstance(node, list):
            for v in node:
                walk(v)

    walk(out)
    return out


def _friendly(status: int, body: str) -> str:
    if status == 401:
        return "OpenRouter rejected the API key. Check OPENROUTER_API_KEY in the nurav-finance vault app."
    if status == 402:
        return "The OpenRouter account is out of credits."
    if status == 429:
        return "OpenRouter is rate-limiting requests right now. Try again in a minute."
    if status == 400:
        try:
            msg = json.loads(body).get("error", {}).get("message", "")
        except ValueError:
            msg = ""
        return f"OpenRouter refused the request{': ' + msg[:200] if msg else ''}."
    return f"OpenRouter had a problem (HTTP {status}). Try again shortly."


class OpenRouter:
    def __init__(self, transport: httpx.AsyncBaseTransport | None = None, api_key: str | None = None, model: str | None = None):
        self.transport = transport
        self.api_key = api_key if api_key is not None else settings.openrouter_api_key
        self.model = model or settings.screenshot_model

    @property
    def enabled(self) -> bool:
        return bool(self.api_key) or self.transport is not None

    async def tool_call(self, system: str, content: list[dict] | str, tool: dict, max_tokens: int = FIRST_BUDGET) -> ToolResult:
        """Send one user turn; the reply is JSON matching `tool`'s parameters, returned parsed.

        A reply cut off at the token budget (a long list of holdings) is retried once
        with the model's full output budget before giving up."""
        if not self.enabled:
            raise LLMError("Screenshot import needs an OpenRouter key: add OPENROUTER_API_KEY to the nurav-finance vault app and restart.")
        name = tool["function"]["name"]
        fn = tool["function"]
        schema = strict_schema(fn["parameters"])
        body = {
            "model": self.model,
            "messages": [
                {"role": "system", "content": f"{system}\n\nReply with JSON only: {fn['description']}"},
                {"role": "user", "content": content},
            ],
            "response_format": {"type": "json_schema", "json_schema": {"name": name, "strict": True, "schema": schema}},
            "usage": {"include": True},
            # Only route to providers that honour structured output.
            "provider": {"require_parameters": True},
        }
        cost = 0.0
        budgets = [max_tokens] + ([MAX_BUDGET] if max_tokens < MAX_BUDGET else [])
        for budget in budgets:
            data = await self._post({**body, "max_tokens": budget}, name)
            usage = data.get("usage") or {}
            cost += float(usage.get("cost") or 0)
            finish = (data.get("choices") or [{}])[0].get("finish_reason")
            log.info("openrouter %s: finish=%s budget=%s completion_tokens=%s", name, finish, budget, usage.get("completion_tokens"))
            try:
                message = data["choices"][0]["message"]
                args = json.loads(message.get("content") or "")
                if not isinstance(args, dict):
                    raise ValueError("not an object")
            except (KeyError, IndexError, ValueError) as exc:
                log.warning("openrouter %s: no usable JSON (finish_reason=%s, budget=%s)", name, finish, budget)
                if finish == "length":
                    if budget != budgets[-1]:
                        continue  # cut off mid-answer: once more with the full budget
                    raise LLMError(
                        "These screenshots hold more rows than the model can write out in one answer. "
                        "Split them: import the first screens, save, then record the rest."
                    ) from exc
                raise LLMError("The model didn't return a usable answer. Try again.") from exc
            return ToolResult(args=args, cost=cost, model=data.get("model") or self.model)
        raise AssertionError("unreachable")

    async def _post(self, body: dict, name: str) -> dict:
        headers = {
            "Authorization": f"Bearer {self.api_key or 'test'}",
            "HTTP-Referer": settings.app_url,
            "X-Title": "Nurav Finance",
        }
        # Long lists take a while to write out; allow for a full-budget answer.
        timeout = httpx.Timeout(600, connect=10)
        async with httpx.AsyncClient(base_url=settings.openrouter_base_url, transport=self.transport, timeout=timeout, headers=headers) as client:
            for attempt in range(MAX_RETRIES + 1):
                try:
                    res = await client.post("/chat/completions", json=body)
                except httpx.TransportError as exc:
                    if attempt < MAX_RETRIES:
                        await asyncio.sleep(1.5 * (attempt + 1))
                        continue
                    raise LLMError("Couldn't reach OpenRouter. Check the internet connection and try again.") from exc
                if res.status_code in RETRY_STATUS and attempt < MAX_RETRIES:
                    await asyncio.sleep(1.5 * (attempt + 1))
                    continue
                if res.status_code >= 400:
                    log.warning("openrouter %s failed: HTTP %s %s", name, res.status_code, res.text[:300])
                    raise LLMError(_friendly(res.status_code, res.text))
                break
        data = res.json()
        if "error" in data:
            raise LLMError(f"The model stopped with an error: {str(data['error'].get('message', ''))[:200]}")
        return data


def get_llm() -> OpenRouter:
    """FastAPI dependency (tests override it with a scripted transport)."""
    return OpenRouter()
