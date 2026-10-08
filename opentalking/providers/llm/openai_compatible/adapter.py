from __future__ import annotations

import json
import logging
import time
from collections.abc import AsyncIterator
from typing import Any

import httpx

log = logging.getLogger(__name__)


class OpenAICompatibleLLMClient:
    """Async streaming client for OpenAI-compatible chat completion APIs."""

    def __init__(
        self,
        base_url: str,
        api_key: str,
        model: str = "qwen-turbo",
        *, reuse_connections: bool = False, extra_body: dict[str, Any] | None = None,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.model = model
        self.reuse_connections = reuse_connections
        self.extra_body = dict(extra_body or {})
        self._client: httpx.AsyncClient | None = None

    async def aclose(self) -> None:
        if self._client is not None:
            await self._client.aclose()
            self._client = None

    async def chat_stream(self, messages: list[dict[str, str]]) -> AsyncIterator[str]:
        if not self.base_url:
            raise RuntimeError("LLM base_url is not configured")

        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        payload = {**self.extra_body, "model": self.model, "messages": messages, "stream": True}
        timeout = httpx.Timeout(connect=60.0, read=120.0, write=30.0, pool=30.0)
        url = f"{self.base_url}/chat/completions"

        if self.reuse_connections:
            if self._client is None:
                self._client = httpx.AsyncClient(timeout=timeout)
            client = self._client
        else:
            client = httpx.AsyncClient(timeout=timeout)
        started = time.perf_counter()
        first_content = False
        log.info("LLM stream request: model=%s messages=%d prompt_chars=%d pooled=%s",
                 self.model, len(messages), sum(len(m.get("content", "")) for m in messages),
                 self.reuse_connections)
        try:
            async with client.stream("POST", url, headers=headers, json=payload) as response:
                response.raise_for_status()
                log.info("LLM response headers: model=%s elapsed_ms=%.0f", payload["model"],
                         (time.perf_counter() - started) * 1000)
                async for raw_line in response.aiter_lines():
                    line = raw_line.strip()
                    if not line or not line.startswith("data:"):
                        continue
                    data = line[len("data:") :].strip()
                    if data == "[DONE]":
                        return
                    try:
                        chunk = json.loads(data)
                    except json.JSONDecodeError:
                        continue
                    choices = chunk.get("choices", [])
                    if not choices:
                        continue
                    delta = choices[0].get("delta", {})
                    content = delta.get("content")
                    if content:
                        if not first_content:
                            first_content = True
                            log.info("LLM first content: model=%s elapsed_ms=%.0f", payload["model"],
                                     (time.perf_counter() - started) * 1000)
                        yield content
        finally:
            if not self.reuse_connections:
                await client.aclose()
