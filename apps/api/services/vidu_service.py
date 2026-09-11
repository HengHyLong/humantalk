from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import time
import uuid
from dataclasses import dataclass
from typing import Any
from urllib.parse import urlencode, urlsplit, urlunsplit

import httpx
import websockets


log = logging.getLogger("opentalking.vidu")


class ViduServiceError(RuntimeError):
    """A safe, provider-neutral Vidu integration failure."""


def _auth_header(api_key: str) -> str:
    value = api_key.strip()
    if value.startswith(("Token ", "Bearer ")):
        return value
    return f"Token {value}"


def _raw_api_key(api_key: str) -> str:
    value = api_key.strip()
    for prefix in ("Token ", "Bearer "):
        if value.startswith(prefix):
            return value[len(prefix) :].strip()
    return value


def _join_service_url(base_url: str, path: str) -> str:
    return f"{base_url.rstrip('/')}/{path.lstrip('/')}"


def _websocket_url(http_url: str, query: dict[str, str]) -> str:
    parts = urlsplit(http_url)
    scheme = "wss" if parts.scheme.lower() == "https" else "ws"
    return urlunsplit((scheme, parts.netloc, parts.path, urlencode(query), ""))


@dataclass
class ViduLiveConnection:
    live_id: str
    socket: Any
    conn_id: str
    seq_id: int = 1
    receiver_task: asyncio.Task[None] | None = None

    def signal(self, type_: int, payload: dict[str, Any]) -> dict[str, Any]:
        result = {
            "type": type_,
            "live_id": self.live_id,
            "conn_id": self.conn_id,
            "seq_id": self.seq_id,
            "payload": payload,
        }
        self.seq_id += 1
        return result


class ViduSessionManager:
    """Owns Vidu App WebSockets while browsers consume the AliRTC stream."""

    def __init__(self, settings: object) -> None:
        self.settings = settings
        self._connections: dict[str, ViduLiveConnection] = {}
        self._lock = asyncio.Lock()

    @property
    def service_url(self) -> str:
        return str(getattr(self.settings, "vidu_service_url", "") or "").strip()

    @property
    def api_key(self) -> str:
        return str(getattr(self.settings, "vidu_api_key", "") or "").strip()

    def ensure_configured(self) -> None:
        if not self.service_url or not self.api_key:
            raise ViduServiceError("Vidu 服务尚未配置")

    @property
    def active_count(self) -> int:
        return len(self._connections)

    async def create(
        self,
        session_id: str,
        *,
        image_uri: str,
        persona: str,
        name: str,
        voice: str,
        call_mode: str,
        character_id: str,
    ) -> dict[str, Any]:
        self.ensure_configured()
        body = {
            "call_mode": call_mode if call_mode in {"audio", "video"} else "video",
            "character_id": str(character_id or "1"),
            "avatar": {
                "persona": persona,
                "image_uri": image_uri,
                "name": name,
                "voice": voice,
            },
        }
        try:
            async with httpx.AsyncClient(
                timeout=float(getattr(self.settings, "vidu_connect_timeout_sec", 60.0) or 60.0)
            ) as client:
                response = await client.post(
                    _join_service_url(self.service_url, "/live/v1/lives"),
                    headers={
                        "Authorization": _auth_header(self.api_key),
                        "Content-Type": "application/json",
                        "Accept": "*/*",
                    },
                    json=body,
                )
                response.raise_for_status()
                payload = response.json()
        except Exception as exc:  # noqa: BLE001
            log.exception("Vidu live creation failed: session=%s", session_id)
            raise ViduServiceError("Vidu 会话创建失败") from exc

        live = payload.get("live") if isinstance(payload, dict) else None
        rtc = payload.get("rtc") if isinstance(payload, dict) else None
        if not isinstance(live, dict) or not live.get("id") or not isinstance(rtc, dict):
            raise ViduServiceError("Vidu 服务返回了无效的会话信息")
        required_rtc = {"app_id", "channel_id", "user_id", "token"}
        if any(not rtc.get(key) for key in required_rtc):
            raise ViduServiceError("Vidu 服务返回了不完整的 RTC 信息")

        await self.close(session_id)
        connection = await self._connect_app_socket(str(live["id"]))
        async with self._lock:
            self._connections[session_id] = connection
        return {
            "live_id": str(live["id"]),
            "rtc": {
                "app_id": str(rtc["app_id"]),
                "channel_id": str(rtc["channel_id"]),
                "user_id": str(rtc["user_id"]),
                "token": str(rtc["token"]),
                "token_expire_at": rtc.get("token_expire_at"),
            },
        }

    async def _connect_app_socket(self, live_id: str) -> ViduLiveConnection:
        conn_id = str(uuid.uuid4())
        ws_url = _websocket_url(
            _join_service_url(self.service_url, "/live/ws/live/connect"),
            {
                "live_id": live_id,
                "conn_id": conn_id,
                "authorization": _raw_api_key(self.api_key),
            },
        )
        socket = None
        try:
            socket = await websockets.connect(ws_url, open_timeout=20, close_timeout=5)
            connection = ViduLiveConnection(live_id=live_id, socket=socket, conn_id=conn_id)
            timeout = float(getattr(self.settings, "vidu_connect_timeout_sec", 60.0) or 60.0)
            deadline = asyncio.get_running_loop().time() + max(5.0, timeout)
            while asyncio.get_running_loop().time() < deadline:
                await socket.send(
                    json.dumps(connection.signal(1, {"conn_init": {"version": 1}}), ensure_ascii=False)
                )
                retry_at = min(deadline, asyncio.get_running_loop().time() + 2.0)
                while asyncio.get_running_loop().time() < retry_at:
                    remaining = retry_at - asyncio.get_running_loop().time()
                    try:
                        raw = await asyncio.wait_for(socket.recv(), timeout=remaining)
                    except asyncio.TimeoutError:
                        break
                    message = json.loads(raw)
                    ack = message.get("payload", {}).get("conn_init_ack") if isinstance(message, dict) else None
                    if not isinstance(ack, dict):
                        continue
                    if ack.get("success"):
                        connection.receiver_task = asyncio.create_task(
                            self._consume_messages(connection),
                            name=f"vidu-recv-{live_id}",
                        )
                        return connection
                    if ack.get("error_code") != "NOT_READY":
                        raise ViduServiceError("Vidu App 通道初始化失败")
            raise ViduServiceError("等待 Vidu App 通道就绪超时")
        except ViduServiceError:
            if socket is not None:
                await self._hangup_socket(socket, live_id, conn_id, reason="app_channel_init_failed")
                await socket.close()
            raise
        except Exception as exc:  # noqa: BLE001
            if socket is not None:
                await self._hangup_socket(socket, live_id, conn_id, reason="app_channel_connect_failed")
                await socket.close()
            log.exception("Vidu App WebSocket failed: live_id=%s", live_id)
            raise ViduServiceError("Vidu App 通道连接失败") from exc

    async def _hangup_socket(
        self,
        socket: Any,
        live_id: str,
        conn_id: str,
        *,
        reason: str,
        seq_id: int = 1,
    ) -> None:
        """Best-effort provider hangup used by normal and failed sessions."""
        if getattr(socket, "closed", False):
            return
        signal = {
            "type": 5,
            "live_id": live_id,
            "conn_id": conn_id,
            "seq_id": seq_id,
            "payload": {"hangup": {"hangup_reason": reason}},
        }
        try:
            await asyncio.wait_for(socket.send(json.dumps(signal, ensure_ascii=False)), timeout=3.0)
            log.info("Vidu hangup sent: live_id=%s reason=%s", live_id, reason)
        except Exception:  # noqa: BLE001
            log.warning("Vidu hangup send failed: live_id=%s reason=%s", live_id, reason, exc_info=True)

    async def _consume_messages(self, connection: ViduLiveConnection) -> None:
        try:
            async for raw in connection.socket:
                try:
                    message = json.loads(raw)
                except (TypeError, json.JSONDecodeError):
                    continue
                if isinstance(message, dict) and message.get("type") == 6:
                    log.warning("Vidu forced hangup: live_id=%s", connection.live_id)
                    return
        except Exception:  # noqa: BLE001
            log.info("Vidu App WebSocket closed: live_id=%s", connection.live_id)

    async def send_text(self, session_id: str, text: str) -> None:
        async with self._lock:
            connection = self._connections.get(session_id)
        if connection is None or getattr(connection.socket, "closed", False):
            raise ViduServiceError("Vidu 会话尚未连接")
        signal = connection.signal(
            99,
            {
                "text_msg": {
                    "msg_id": str(uuid.uuid4()),
                    "content": text,
                    "timestamp": int(time.time() * 1000),
                }
            },
        )
        try:
            await connection.socket.send(json.dumps(signal, ensure_ascii=False))
        except Exception as exc:  # noqa: BLE001
            log.exception("Vidu text send failed: session=%s", session_id)
            raise ViduServiceError("Vidu 文本发送失败") from exc

    async def close(self, session_id: str) -> None:
        async with self._lock:
            connection = self._connections.pop(session_id, None)
        if connection is None:
            return
        try:
            if not getattr(connection.socket, "closed", False):
                await self._hangup_socket(
                    connection.socket,
                    connection.live_id,
                    connection.conn_id,
                    reason="opentalking_hangup",
                    seq_id=connection.seq_id,
                )
                await connection.socket.close()
        except Exception:  # noqa: BLE001
            log.info("Vidu close cleanup failed: session=%s", session_id, exc_info=True)
        finally:
            if connection.receiver_task is not None:
                connection.receiver_task.cancel()
                with contextlib.suppress(asyncio.CancelledError):
                    await connection.receiver_task

    async def close_all(self) -> None:
        async with self._lock:
            session_ids = list(self._connections)
        await asyncio.gather(*(self.close(session_id) for session_id in session_ids), return_exceptions=True)
