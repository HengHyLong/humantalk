from __future__ import annotations

import json

import pytest
from fastapi import FastAPI, Request

import apps.api.routes.events as events_routes
import apps.api.routes.sessions as sessions_routes
from apps.api.schemas.session import WebRTCOfferRequest
from opentalking.core.in_memory_redis import InMemoryRedis
from opentalking.core.redis_keys import events_channel
from opentalking.core.session_store import session_key


def _request(app: FastAPI, path: str) -> Request:
    return Request(
        {
            "type": "http",
            "app": app,
            "method": "GET",
            "path": path,
            "raw_path": path.encode("utf-8"),
            "query_string": b"",
            "headers": [],
        }
    )


@pytest.mark.asyncio
async def test_sse_stream_formats_events_and_reports_invalid_payloads() -> None:
    redis = InMemoryRedis()
    session_id = "sess_sse_contract"
    await redis.hset(session_key(session_id), mapping={"session_id": session_id, "state": "ready"})

    app = FastAPI()
    app.state.redis = redis
    response = await events_routes.session_events(session_id, _request(app, f"/sessions/{session_id}/events"))
    stream = response.body_iterator

    try:
        assert await anext(stream) == "retry: 3000\n\n"

        await redis.publish(
            events_channel(session_id),
            json.dumps(
                {
                    "event": "subtitle.chunk",
                    "data": {"session_id": session_id, "text": "你好"},
                },
                ensure_ascii=False,
            ),
        )
        assert await anext(stream) == (
            'event: subtitle.chunk\ndata: {"session_id": "sess_sse_contract", "text": "你好"}\n\n'
        )

        await redis.publish(events_channel(session_id), "not-json")
        assert await anext(stream) == (
            'event: error\ndata: {"code":"invalid_event","message":"invalid event payload"}\n\n'
        )
    finally:
        await stream.aclose()


@pytest.mark.asyncio
async def test_webrtc_offer_routes_to_loaded_session_runner() -> None:
    redis = InMemoryRedis()
    session_id = "sess_webrtc_contract"
    await redis.hset(session_key(session_id), mapping={"session_id": session_id, "state": "ready"})

    class FakeRunner:
        async def handle_webrtc_offer(self, sdp: str, type_: str) -> dict[str, str]:
            return {"sdp": f"answer:{sdp}", "type": type_}

    app = FastAPI()
    app.state.redis = redis
    app.state.session_runners = {session_id: FakeRunner()}

    result = await sessions_routes.webrtc_offer(
        session_id,
        WebRTCOfferRequest(sdp="v=0\r\n", type="offer"),
        _request(app, f"/sessions/{session_id}/webrtc/offer"),
    )

    assert result == {"sdp": "answer:v=0\r\n", "type": "offer"}
