from __future__ import annotations

import json
import logging
import time
import uuid

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request

from .security import decode_token, get_store
from .store import utc_now


log = logging.getLogger(__name__)
_AUDITED_PREFIXES = ("/api/v1/admin", "/api/v1/ops", "/api/v1/auth")


def _audit_target(path: str, method: str) -> tuple[str, str, str]:
    parts = [item for item in path.split("/") if item]
    if len(parts) >= 3 and parts[2] == "admin":
        resource_type = "/".join(parts[3:5]) or "admin"
        resource_id = parts[5] if len(parts) > 5 else ""
    else:
        resource_type = "/".join(parts[2:4]) or "api"
        resource_id = parts[4] if len(parts) > 4 else ""
    action = {
        "GET": "access",
        "POST": "execute",
        "PUT": "update",
        "PATCH": "update",
        "DELETE": "delete",
    }.get(method, "access")
    return action, resource_type, resource_id


def _request_user(request: Request) -> tuple[str | None, str]:
    header = request.headers.get("authorization", "")
    if not header.lower().startswith("bearer "):
        return None, "anonymous"
    try:
        payload = decode_token(request, header.split(" ", 1)[1].strip())
        user_id = str(payload["sub"])
        user = get_store(request).user(user_id)
        return user_id, str(user.get("username") if user else user_id)
    except Exception:  # noqa: BLE001
        return None, "anonymous"


class AdminTraceMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):  # type: ignore[no-untyped-def]
        audited = request.url.path.startswith(_AUDITED_PREFIXES)
        trace_id = request.headers.get("X-Trace-Id") or f"trace-{uuid.uuid4().hex[:16]}"
        request.state.trace_id = trace_id
        request.state.audit_started = time.perf_counter()
        started = time.perf_counter()
        response = None
        status_code = 500
        try:
            response = await call_next(request)
            status_code = response.status_code
            return response
        finally:
            duration_ms = round((time.perf_counter() - started) * 1000)
            if response is not None:
                response.headers["X-Trace-Id"] = trace_id
                response.headers["X-Request-Duration-Ms"] = str(duration_ms)
            if audited and not getattr(request.state, "audit_written", False):
                user_id, username = _request_user(request)
                action, resource_type, resource_id = _audit_target(request.url.path, request.method)
                try:
                    get_store(request).audit({
                        "id": uuid.uuid4().hex,
                        "trace_id": trace_id,
                        "user_id": user_id,
                        "username": username,
                        "method": request.method,
                        "path": request.url.path,
                        "action": action,
                        "resource_type": resource_type,
                        "resource_id": resource_id,
                        "ip": request.client.host if request.client else "",
                        "user_agent": request.headers.get("user-agent", ""),
                        "status_code": status_code,
                        "duration_ms": duration_ms,
                        "before_json": None,
                        "after_json": json.dumps({"status_code": status_code}, ensure_ascii=False),
                        "created_at": utc_now(),
                    })
                except Exception:  # noqa: BLE001
                    log.exception("failed to persist request audit: %s %s", request.method, request.url.path)
