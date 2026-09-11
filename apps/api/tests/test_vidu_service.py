from __future__ import annotations

import asyncio
from types import SimpleNamespace

from apps.api.services import vidu_service


def test_vidu_live_create_matches_external_protocol(monkeypatch) -> None:
    captured: dict[str, object] = {}

    class FakeResponse:
        def raise_for_status(self) -> None:
            return None

        def json(self) -> dict[str, object]:
            return {
                "live": {"id": "live-1"},
                "rtc": {
                    "app_id": "app-1",
                    "channel_id": "channel-1",
                    "user_id": "user-1",
                    "token": "rtc-token",
                    "token_expire_at": 123,
                },
            }

    class FakeClient:
        def __init__(self, **kwargs: object) -> None:
            captured["client"] = kwargs

        async def __aenter__(self) -> "FakeClient":
            return self

        async def __aexit__(self, *_args: object) -> None:
            return None

        async def post(self, url: str, **kwargs: object) -> FakeResponse:
            captured["url"] = url
            captured.update(kwargs)
            return FakeResponse()

    monkeypatch.setattr(vidu_service.httpx, "AsyncClient", FakeClient)
    manager = vidu_service.ViduSessionManager(
        SimpleNamespace(
            vidu_service_url="http://127.0.0.1:18088/proxy/cn",
            vidu_api_key="vda-secret",
            vidu_connect_timeout_sec=60,
        )
    )

    async def fake_connect(live_id: str) -> vidu_service.ViduLiveConnection:
        assert live_id == "live-1"
        return vidu_service.ViduLiveConnection(live_id=live_id, socket=object(), conn_id="conn-1")

    monkeypatch.setattr(manager, "_connect_app_socket", fake_connect)
    result = asyncio.run(
        manager.create(
            "session-1",
            image_uri="https://example.test/avatars/avatar-1/preview",
            persona="你是会展讲解员。",
            name="会展数字人",
            voice="Tina",
            call_mode="audio",
            character_id="1",
        )
    )

    assert captured["url"] == "http://127.0.0.1:18088/proxy/cn/live/v1/lives"
    assert captured["headers"] == {
        "Authorization": "Token vda-secret",
        "Content-Type": "application/json",
        "Accept": "*/*",
    }
    assert captured["json"] == {
        "call_mode": "audio",
        "character_id": "1",
        "avatar": {
            "persona": "你是会展讲解员。",
            "image_uri": "https://example.test/avatars/avatar-1/preview",
            "name": "会展数字人",
            "voice": "Tina",
        },
    }
    assert result["live_id"] == "live-1"
    assert result["rtc"]["token"] == "rtc-token"


def test_vidu_close_sends_hangup_before_socket_close() -> None:
    events: list[object] = []

    class FakeSocket:
        closed = False

        async def send(self, raw: str) -> None:
            import json

            events.append(json.loads(raw))

        async def close(self) -> None:
            self.closed = True
            events.append("closed")

    manager = vidu_service.ViduSessionManager(
        SimpleNamespace(vidu_service_url="http://vidu.test", vidu_api_key="secret")
    )
    manager._connections["session-1"] = vidu_service.ViduLiveConnection(
        live_id="live-1",
        socket=FakeSocket(),
        conn_id="conn-1",
        seq_id=7,
    )

    asyncio.run(manager.close_all())

    assert manager.active_count == 0
    assert events[0] == {
        "type": 5,
        "live_id": "live-1",
        "conn_id": "conn-1",
        "seq_id": 7,
        "payload": {"hangup": {"hangup_reason": "opentalking_hangup"}},
    }
    assert events[1] == "closed"
