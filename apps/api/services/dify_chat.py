"""Dify app API integration. App keys are independent of dataset keys."""
from __future__ import annotations

import asyncio
import hashlib
import json
import re
from dataclasses import dataclass
from typing import Any

import httpx

from opentalking.pipeline.speak.text_sanitize import sanitize_tts_text


class DifyChatError(Exception):
    """Safe error code; never expose provider responses or credentials."""

    def __init__(self, code: str = "DIFY_CHAT_UNAVAILABLE", *, retryable: bool | None = None,
                 http_status: int | None = None, retry_after: float = 0) -> None:
        self.code = code
        self.retryable = retryable if retryable is not None else code in {
            "DIFY_CHAT_UNAVAILABLE", "DIFY_CHAT_INVALID_RESPONSE", "DIFY_CHAT_EMPTY_ANSWER",
            "DIFY_CHAT_INCOMPLETE", "DIFY_CHAT_TIMEOUT",
        }
        self.http_status = http_status
        self.retry_after = retry_after
        self.attempts: list[dict] = []
        self.conversation_id = ""
        self.message_id = ""
        self.task_id = ""
        self.workflow_run_id = ""
        super().__init__(code)


def spoken_answer(text: str) -> str:
    # Defensive fallback for older Dify/model plugins, including an unclosed tag.
    text = re.sub(r"<think\b[^>]*>.*?(?:</think\s*>|$)", "", text, flags=re.S | re.I)
    text = re.sub(r"<!--.*?(?:-->|$)", "", text, flags=re.S)
    return sanitize_tts_text(text).strip()


@dataclass
class ChatReply:
    answer: str
    conversation_id: str = ""
    message_id: str = ""
    first_delta_ms: int | None = None
    generation_ms: int | None = None
    task_id: str = ""
    workflow_run_id: str = ""


class DifyChatClient:
    def __init__(self, base_url: str, api_key: str, timeout_sec: float = 60) -> None:
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.timeout_sec = timeout_sec
        self.task_id = ""

    @property
    def identity(self) -> str:
        return hashlib.sha256(f"{self.base_url}|{self.api_key}".encode()).hexdigest()[:16]

    async def parameters(self) -> dict[str, Any]:
        if not self.base_url or not self.api_key:
            raise DifyChatError("DIFY_CHAT_NOT_CONFIGURED")
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                headers = {"Authorization": f"Bearer {self.api_key}"}
                info = await client.get(f"{self.base_url}/info", headers=headers)
                info.raise_for_status()
                params = await client.get(f"{self.base_url}/parameters", headers=headers)
                params.raise_for_status()
                return {"name": info.json().get("name", ""), "mode": info.json().get("mode", ""),
                        "input_variables": [next(iter(v.values())).get("variable")
                                            for v in params.json().get("user_input_form", [])]}
        except (httpx.HTTPError, ValueError, TypeError, AttributeError) as exc:
            raise DifyChatError() from exc

    async def stop(self, user: str) -> None:
        if not self.task_id:
            return
        task_id, self.task_id = self.task_id, ""
        try:
            async with asyncio.timeout(2), httpx.AsyncClient(timeout=2) as client:
                await client.post(f"{self.base_url}/chat-messages/{task_id}/stop",
                                  headers={"Authorization": f"Bearer {self.api_key}"}, json={"user": user})
        except (httpx.HTTPError, TimeoutError):
            pass

    async def chat(self, *, question: str, inputs: dict[str, Any], user: str,
                   conversation_id: str = "", is_current: Any = None,
                   on_delta: Any = None, on_replace: Any = None) -> ChatReply:
        import time
        started = time.perf_counter()
        if not self.base_url or not self.api_key:
            raise DifyChatError("DIFY_CHAT_NOT_CONFIGURED")
        body = {"query": question, "inputs": inputs, "user": user,
                "conversation_id": conversation_id, "response_mode": "streaming", "auto_generate_name": False}
        parts: list[str] = []
        reply = ChatReply("")
        completed = False
        size = 0
        async def consume() -> None:
            nonlocal size, completed, parts
            async with httpx.AsyncClient(timeout=self.timeout_sec) as client:
                async with client.stream("POST", f"{self.base_url}/chat-messages",
                                         headers={"Authorization": f"Bearer {self.api_key}"}, json=body) as response:
                    response.raise_for_status()
                    async for line in response.aiter_lines():
                        if not line.startswith("data:"):
                            continue
                        event = json.loads(line[5:].strip())
                        self.task_id = event.get("task_id") or self.task_id
                        reply.task_id = self.task_id
                        if is_current is not None and not await is_current():
                            raise asyncio.CancelledError()
                        reply.conversation_id = event.get("conversation_id") or reply.conversation_id
                        reply.message_id = event.get("message_id") or reply.message_id
                        kind = event.get("event")
                        reply.workflow_run_id = event.get("workflow_run_id") or reply.workflow_run_id
                        if kind == "workflow_started":
                            reply.workflow_run_id = event.get("data", {}).get("id") or reply.workflow_run_id
                        if kind == "error":
                            status = int(event.get("status") or 500)
                            permanent = (400 <= status < 500 and status not in {408, 429}) or event.get("code") in {
                                "invalid_param", "invalid_api_key", "unauthorized", "app_unavailable", "model_not_supported",
                            }
                            raise DifyChatError(retryable=not permanent, http_status=status)
                        if kind in {"message", "agent_message", "message_replace"}:
                            delta = str(event.get("answer") or "")
                            size += len(delta)
                            if size > 100_000:
                                raise DifyChatError("DIFY_CHAT_INVALID_RESPONSE", retryable=False)
                            if kind == "message_replace":
                                parts = [delta]
                                if on_replace:
                                    await on_replace(delta)
                            else:
                                parts.append(delta)
                                if delta and reply.first_delta_ms is None:
                                    reply.first_delta_ms = round((time.perf_counter() - started) * 1000)
                                if on_delta and delta:
                                    await on_delta(delta)
                        if kind == "message_end":
                            completed = True
                            break

        try:
            await asyncio.wait_for(consume(), timeout=self.timeout_sec)
            reply.answer = spoken_answer("".join(parts))
            reply.generation_ms = round((time.perf_counter() - started) * 1000)
            if not completed:
                raise DifyChatError("DIFY_CHAT_INCOMPLETE")
            if not reply.answer or not re.search(r"\w", reply.answer):
                raise DifyChatError("DIFY_CHAT_EMPTY_ANSWER")
            return reply
        except asyncio.CancelledError:
            await self.stop(user)
            raise
        except DifyChatError as exc:
            exc.conversation_id, exc.message_id, exc.task_id = reply.conversation_id, reply.message_id, self.task_id
            exc.workflow_run_id = reply.workflow_run_id
            await self.stop(user)
            raise
        except httpx.HTTPStatusError as exc:
            status = exc.response.status_code
            delay = 0.0
            try:
                delay = max(0.0, float(exc.response.headers.get("Retry-After", "0")))
            except ValueError:
                from email.utils import parsedate_to_datetime
                from datetime import datetime, timezone
                try:
                    delay = max(0.0, (parsedate_to_datetime(exc.response.headers["Retry-After"]) - datetime.now(timezone.utc)).total_seconds())
                except (ValueError, KeyError, TypeError):
                    pass
            await self.stop(user)
            error = DifyChatError("DIFY_CHAT_HTTP_ERROR", retryable=status in {408, 429} or status >= 500,
                                  http_status=status, retry_after=delay)
            error.conversation_id, error.message_id = reply.conversation_id, reply.message_id
            raise error from exc
        except (httpx.HTTPError, TimeoutError, ValueError, TypeError, AttributeError) as exc:
            task_id = self.task_id
            await self.stop(user)
            code = ("DIFY_CHAT_TIMEOUT" if isinstance(exc, (TimeoutError, httpx.TimeoutException))
                    else "DIFY_CHAT_INVALID_RESPONSE" if isinstance(exc, (ValueError, TypeError, AttributeError))
                    else "DIFY_CHAT_UNAVAILABLE")
            error = DifyChatError(code)
            error.conversation_id, error.message_id, error.task_id = reply.conversation_id, reply.message_id, task_id
            error.workflow_run_id = reply.workflow_run_id
            raise error from exc


class DifyTurns:
    """Cancel active HTTP streams; Redis separately guards delivery across API processes."""

    def __init__(self) -> None:
        self.active: dict[str, asyncio.Task] = {}

    async def cancel(self, session_id: str) -> None:
        old = self.active.pop(session_id, None)
        if old and old is not asyncio.current_task() and not old.done():
            old.cancel()
            try:
                await old
            except (asyncio.CancelledError, DifyChatError):
                pass

    async def run(self, session_id: str, call: Any) -> ChatReply:
        task = asyncio.create_task(call)
        self.active[session_id] = task
        try:
            return await task
        finally:
            if self.active.get(session_id) is task:
                self.active.pop(session_id, None)


def turns_for(app: Any) -> DifyTurns:
    if not hasattr(app.state, "dify_turns"):
        app.state.dify_turns = DifyTurns()
    return app.state.dify_turns


def turn_key(session_id: str) -> str:
    return f"opentalking:dify:turn:{session_id}"


async def same_turn(r: Any, session_id: str, token: str) -> bool:
    value = await r.get(turn_key(session_id))
    return (value.decode() if isinstance(value, bytes) else value) == token


async def save_context(r: Any, session_id: str, token: str, key: str, value: str) -> None:
    from opentalking.core.in_memory_redis import InMemoryRedis

    if isinstance(r, InMemoryRedis):
        # These in-memory operations do not suspend, so the pair is atomic.
        if await same_turn(r, session_id, token):
            await r.set(key, value, ex=86400)
    else:
        await r.eval("if redis.call('GET', KEYS[1]) == ARGV[1] then "
                     "return redis.call('SET', KEYS[2], ARGV[2], 'EX', 86400) else return 0 end", 2,
                     turn_key(session_id), key, token, value)
