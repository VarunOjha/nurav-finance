"""OpenRouter: chat completions (streamed, with tools) and transcription.

Only the server talks to OpenRouter; the key never reaches the browser.
Streaming follows OpenRouter's SSE format: `data: {chunk}` lines, `: ...`
keep-alive comments, `data: [DONE]` at the end; the last chunk carries
`usage` (tokens and cost). Tool-call arguments arrive in pieces and are
joined by index. Retries (429 / 5xx / connection errors) happen only before
anything was streamed, so a reply is never shown twice.

`AGENT_FAKE=1` swaps the network for a scripted model (services/agent/fake.py)
behind the same transport, so the parsing path is the real one.
"""

import asyncio
import json
import logging
from collections.abc import AsyncIterator
from dataclasses import dataclass, field

import httpx

from config import settings

log = logging.getLogger("agent.openrouter")
RETRY_STATUS = {429, 502, 503, 504}
MAX_RETRIES = 2


class LLMError(RuntimeError):
    """A failure worded for the person (never contains the key)."""


@dataclass
class Completion:
    content: str = ""
    tool_calls: list[dict] = field(default_factory=list)
    finish_reason: str | None = None
    usage: dict | None = None
    generation_id: str | None = None
    model: str = ""


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
    def __init__(self, transport: httpx.AsyncBaseTransport | None = None, api_key: str | None = None):
        if transport is None and settings.agent_fake:
            from services.agent.fake import FakeTransport

            transport = FakeTransport()
        self.transport = transport
        self.api_key = api_key if api_key is not None else settings.openrouter_api_key

    @property
    def enabled(self) -> bool:
        return bool(self.api_key) or self.transport is not None

    def _headers(self) -> dict:
        return {
            "Authorization": f"Bearer {self.api_key or 'fake'}",
            "HTTP-Referer": settings.agent_app_url,
            "X-Title": "Nurav Finance",
            "Content-Type": "application/json",
        }

    def _client(self) -> httpx.AsyncClient:
        return httpx.AsyncClient(
            base_url=settings.openrouter_base_url,
            transport=self.transport,
            timeout=httpx.Timeout(90, connect=10),
            headers=self._headers(),
        )

    async def chat(
        self, messages: list[dict], tools: list[dict], tool_choice: dict | str | None = None, max_tokens: int = 4000
    ) -> AsyncIterator[dict]:
        """Yields {"type": "text", "delta"} as the reply streams, then {"type": "done", "completion"}."""
        if not self.enabled:
            raise LLMError("The Wealth Agent needs an OpenRouter key: add OPENROUTER_API_KEY to the nurav-finance vault app and restart.")
        body: dict = {
            "model": settings.agent_model,
            "messages": messages,
            "tools": tools,
            "stream": True,
            "temperature": 0.2,
            "max_tokens": max_tokens,
            "usage": {"include": True},
            # Only route to providers that honour tools / tool_choice.
            "provider": {"require_parameters": True},
        }
        if tool_choice is not None:
            body["tool_choice"] = tool_choice

        attempt = 0
        async with self._client() as client:
            while True:
                streamed = False
                try:
                    async with client.stream("POST", "/chat/completions", json=body) as res:
                        if res.status_code >= 400:
                            text = (await res.aread()).decode(errors="replace")
                            if res.status_code in RETRY_STATUS and attempt < MAX_RETRIES:
                                attempt += 1
                                await asyncio.sleep(1.5 * attempt)
                                continue
                            log.warning("openrouter chat failed: %s %s", res.status_code, text[:300])
                            raise LLMError(_friendly(res.status_code, text))
                        out = Completion()
                        calls: dict[int, dict] = {}
                        async for line in res.aiter_lines():
                            if not line.startswith("data:"):
                                continue  # blank separators and ": OPENROUTER PROCESSING" comments
                            data = line[5:].strip()
                            if data == "[DONE]":
                                break
                            try:
                                chunk = json.loads(data)
                            except ValueError:
                                continue
                            if "error" in chunk:
                                raise LLMError(f"The model stopped with an error: {str(chunk['error'].get('message', ''))[:200]}")
                            out.generation_id = out.generation_id or chunk.get("id")
                            out.model = chunk.get("model") or out.model
                            if chunk.get("usage"):
                                out.usage = chunk["usage"]
                            for choice in chunk.get("choices") or []:
                                delta = choice.get("delta") or {}
                                if delta.get("content"):
                                    streamed = True
                                    out.content += delta["content"]
                                    yield {"type": "text", "delta": delta["content"]}
                                for tc in delta.get("tool_calls") or []:
                                    slot = calls.setdefault(tc.get("index", 0), {"id": "", "name": "", "arguments": ""})
                                    slot["id"] = tc.get("id") or slot["id"]
                                    fn = tc.get("function") or {}
                                    slot["name"] += fn.get("name") or ""
                                    slot["arguments"] += fn.get("arguments") or ""
                                if choice.get("finish_reason"):
                                    out.finish_reason = choice["finish_reason"]
                        out.tool_calls = [
                            {"id": c["id"] or f"call_{i}", "type": "function", "function": {"name": c["name"], "arguments": c["arguments"] or "{}"}}
                            for i, c in sorted(calls.items())
                        ]
                        yield {"type": "done", "completion": out}
                        return
                except (httpx.TransportError, httpx.TimeoutException) as exc:
                    if not streamed and attempt < MAX_RETRIES:
                        attempt += 1
                        await asyncio.sleep(1.5 * attempt)
                        continue
                    log.warning("openrouter chat transport error: %s", type(exc).__name__)
                    raise LLMError("Couldn’t reach OpenRouter. Check the connection and try again.") from None

    async def transcribe(self, audio_b64: str, fmt: str) -> tuple[str, dict | None]:
        if not self.enabled:
            raise LLMError("Voice needs an OpenRouter key: add OPENROUTER_API_KEY to the nurav-finance vault app and restart.")
        body = {"model": settings.agent_stt_model, "input_audio": {"data": audio_b64, "format": fmt}}
        async with self._client() as client:
            try:
                res = await client.post("/audio/transcriptions", json=body)
            except (httpx.TransportError, httpx.TimeoutException):
                raise LLMError("Couldn’t reach OpenRouter to transcribe. Try again.") from None
        if res.status_code >= 400:
            log.warning("openrouter transcription failed: %s %s", res.status_code, res.text[:300])
            raise LLMError(_friendly(res.status_code, res.text))
        data = res.json()
        return (data.get("text") or "").strip(), data.get("usage")
