from __future__ import annotations

import asyncio
import json
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

    async def fake_connect(
        live_id: str,
        *,
        service_url: str | None = None,
    ) -> vidu_service.ViduLiveConnection:
        assert live_id == "live-1"
        assert service_url == "http://127.0.0.1:18088/proxy/cn"
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


def test_vidu_live_create_falls_back_from_stale_loopback_to_official_service(monkeypatch) -> None:
    requested_urls: list[str] = []
    connected_service_urls: list[str | None] = []

    class FakeResponse:
        def raise_for_status(self) -> None:
            return None

        def json(self) -> dict[str, object]:
            return {
                "live": {"id": "live-fallback"},
                "rtc": {
                    "app_id": "app-1",
                    "channel_id": "channel-1",
                    "user_id": "user-1",
                    "token": "rtc-token",
                },
            }

    class FakeClient:
        def __init__(self, **_kwargs: object) -> None:
            pass

        async def __aenter__(self) -> "FakeClient":
            return self

        async def __aexit__(self, *_args: object) -> None:
            return None

        async def post(self, url: str, **_kwargs: object) -> FakeResponse:
            requested_urls.append(url)
            if url.startswith("http://127.0.0.1:18088"):
                raise vidu_service.httpx.ConnectError(
                    "connection refused",
                    request=vidu_service.httpx.Request("POST", url),
                )
            return FakeResponse()

    manager = vidu_service.ViduSessionManager(
        SimpleNamespace(
            vidu_service_url="http://127.0.0.1:18088/proxy/cn",
            vidu_api_key="vda-secret",
            vidu_connect_timeout_sec=60,
        )
    )

    async def fake_connect(
        live_id: str,
        *,
        service_url: str | None = None,
    ) -> vidu_service.ViduLiveConnection:
        connected_service_urls.append(service_url)
        return vidu_service.ViduLiveConnection(live_id=live_id, socket=object(), conn_id="conn-1")

    monkeypatch.setattr(vidu_service.httpx, "AsyncClient", FakeClient)
    monkeypatch.setattr(manager, "_connect_app_socket", fake_connect)

    result = asyncio.run(
        manager.create(
            "session-fallback",
            image_uri="https://example.test/avatar.png",
            persona="会展讲解员",
            name="会展数字人",
            voice="Tina",
            call_mode="video",
            character_id="1",
        )
    )

    assert requested_urls == [
        "http://127.0.0.1:18088/proxy/cn/live/v1/lives",
        "https://api.vidu.cn/live/v1/lives",
    ]
    assert connected_service_urls == ["https://api.vidu.cn"]
    assert result["live_id"] == "live-fallback"


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


def test_vidu_create_replaces_previous_live_for_same_owner(monkeypatch) -> None:
    create_count = 0
    sockets: list[FakeSocket] = []

    class FakeResponse:
        def __init__(self, index: int) -> None:
            self.index = index

        def raise_for_status(self) -> None:
            return None

        def json(self) -> dict[str, object]:
            return {
                "live": {"id": f"live-{self.index}"},
                "rtc": {
                    "app_id": "app-1",
                    "channel_id": f"channel-{self.index}",
                    "user_id": f"rtc-user-{self.index}",
                    "token": f"rtc-token-{self.index}",
                },
            }

    class FakeClient:
        def __init__(self, **_kwargs: object) -> None:
            pass

        async def __aenter__(self) -> "FakeClient":
            return self

        async def __aexit__(self, *_args: object) -> None:
            return None

        async def post(self, _url: str, **_kwargs: object) -> FakeResponse:
            nonlocal create_count
            create_count += 1
            return FakeResponse(create_count)

    class FakeSocket:
        closed = False

        async def send(self, _raw: str) -> None:
            return None

        async def close(self) -> None:
            self.closed = True

    manager = vidu_service.ViduSessionManager(
        SimpleNamespace(vidu_service_url="https://api.vidu.cn", vidu_api_key="secret")
    )

    async def fake_connect(
        live_id: str,
        *,
        service_url: str | None = None,
    ) -> vidu_service.ViduLiveConnection:
        assert service_url == "https://api.vidu.cn"
        socket = FakeSocket()
        sockets.append(socket)
        return vidu_service.ViduLiveConnection(live_id=live_id, socket=socket, conn_id=f"conn-{live_id}")

    monkeypatch.setattr(vidu_service.httpx, "AsyncClient", FakeClient)
    monkeypatch.setattr(manager, "_connect_app_socket", fake_connect)

    async def scenario() -> None:
        common = {
            "image_uri": "https://example.test/avatar.png",
            "persona": "会展讲解员",
            "name": "会展数字人",
            "voice": "Tina",
            "call_mode": "video",
            "character_id": "1",
            "owner_key": "browser-1",
        }
        await manager.create("session-1", **common)
        await manager.create("session-2", **common)

    asyncio.run(scenario())

    assert create_count == 2
    assert sockets[0].closed is True
    assert sockets[1].closed is False
    assert manager.active_count == 1
    assert set(manager._connections) == {"session-2"}
    assert manager._owner_sessions == {"browser-1": "session-2"}


def test_vidu_app_socket_uses_authorization_header_without_key_in_url(monkeypatch) -> None:
    captured: dict[str, object] = {}

    class FakeSocket:
        closed = False

        async def send(self, raw: str) -> None:
            captured["signal"] = json.loads(raw)

        async def recv(self) -> str:
            return json.dumps({"payload": {"conn_init_ack": {"success": True}}})

        async def close(self) -> None:
            self.closed = True

        def __aiter__(self):
            return self

        async def __anext__(self):
            raise StopAsyncIteration

    async def fake_connect(url: str, **kwargs: object) -> FakeSocket:
        captured["url"] = url
        captured["connect_kwargs"] = kwargs
        return FakeSocket()

    monkeypatch.setattr(vidu_service.websockets, "connect", fake_connect)
    manager = vidu_service.ViduSessionManager(
        SimpleNamespace(
            vidu_service_url="https://api.vidu.cn",
            vidu_api_key="vda-secret",
            vidu_connect_timeout_sec=5,
        )
    )

    connection = asyncio.run(
        manager._connect_app_socket("live-1", service_url="https://api.vidu.cn")
    )

    assert connection.live_id == "live-1"
    assert str(captured["url"]).startswith(
        "wss://api.vidu.cn/live/ws/live/connect?live_id=live-1&conn_id="
    )
    assert "vda-secret" not in str(captured["url"])
    assert captured["connect_kwargs"] == {
        "additional_headers": {"Authorization": "Token vda-secret"},
        "open_timeout": 20,
        "close_timeout": 5,
    }
    assert captured["signal"]["payload"] == {"conn_init": {"version": 1}}
