"""Bounded, turn-scoped direct speech text transport for memory and Redis brokers."""
from __future__ import annotations

import asyncio
import time


class TextStreamError(RuntimeError):
    pass


class SpeechTextStream:
    def __init__(self, broker, session_id: str, token: str):
        self.broker, self.session_id, self.token = broker, session_id, token
        self.key = f"opentalking:speech-text:{session_id}:{token}"
        self.seq = 0
        self.characters = 0

    async def start(self):
        await self.broker.hset(self.key, mapping={"state": "open"})
        await self.broker.expire(self.key, 600)

    async def append(self, text: str):
        self.characters += len(text)
        if self.characters > 16000 or self.seq >= 256:
            raise TextStreamError("TEXT_STREAM_LIMIT")
        state = await self.broker.hget(self.key, "state")
        if state not in ("open", b"open"):
            raise TextStreamError("TEXT_STREAM_CLOSED")
        await self.broker.hset(self.key, mapping={f"s{self.seq}": text})
        self.seq += 1

    async def finish(self):
        await self.broker.hset(self.key, mapping={"state": "complete", "count": self.seq})

    async def fail(self):
        await self.broker.hset(self.key, mapping={"state": "failed"})
        await self.broker.expire(self.key, 600)

    async def cancel(self):
        await self.broker.hset(self.key, mapping={"state": "cancelled"})
        await self.broker.expire(self.key, 600)

    async def sentences(self):
        index = 0
        deadline = time.monotonic() + 540
        try:
            while time.monotonic() < deadline:
                current = await self.broker.get(f"opentalking:dify:turn:{self.session_id}")
                if isinstance(current, bytes):
                    current = current.decode()
                if current != self.token:
                    raise asyncio.CancelledError()
                state = await self.broker.hget(self.key, "state")
                if isinstance(state, bytes):
                    state = state.decode()
                if state == "cancelled":
                    raise asyncio.CancelledError()
                if state not in {"open", "complete"}:
                    raise TextStreamError("TEXT_STREAM_INCOMPLETE")
                value = await self.broker.hget(self.key, f"s{index}")
                if value is not None:
                    yield value.decode() if isinstance(value, bytes) else value
                    index += 1
                    continue
                if state == "complete":
                    count = await self.broker.hget(self.key, "count")
                    if count is None or int(count) != index:
                        raise TextStreamError("TEXT_STREAM_MISSING_SENTENCE")
                    return
                await asyncio.sleep(0.025)
            raise TextStreamError("TEXT_STREAM_TIMEOUT")
        finally:
            await self.broker.delete(self.key)
