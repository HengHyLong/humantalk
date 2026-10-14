"""Shared frontend password, hashed at rest; rotation invalidates browser sessions."""
from __future__ import annotations

import time
import threading
from collections import OrderedDict

import jwt
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from starlette.concurrency import run_in_threadpool
from starlette.requests import HTTPConnection

from apps.api.admin.security import current_user, get_store, password_hasher, require_permission, verify_password
from apps.api.admin.store import utc_now

COOKIE = "humantalk_frontend_access"
_attempt_lock = threading.Lock()
router = APIRouter(prefix="/frontend-access", tags=["frontend-access"])
admin_router = APIRouter(prefix="/api/v1/admin/frontend-access", tags=["frontend-access"])


def access_record(request):
    store = get_store(request)
    with store.connect() as conn:
        conn.execute("CREATE TABLE IF NOT EXISTS frontend_access (id INTEGER PRIMARY KEY CHECK(id=1), password_hash TEXT NOT NULL, updated_at TEXT NOT NULL)")
        row = conn.execute("SELECT * FROM frontend_access WHERE id=1").fetchone()
        if row is None:
            conn.execute("INSERT OR IGNORE INTO frontend_access VALUES (1, ?, ?)", (password_hasher.hash("10528"), utc_now()))
            row = conn.execute("SELECT * FROM frontend_access WHERE id=1").fetchone()
        return dict(row)


def authenticated(request) -> bool:
    token = request.cookies.get(COOKIE)
    if not token:
        return False
    try:
        payload = jwt.decode(token, access_record(request)["password_hash"], algorithms=["HS256"], options={"require": ["iat", "type"]})
        # Reject the former persistent, 12-hour cookies after this migration.
        return payload.get("type") == "frontend-browser-session"
    except jwt.PyJWTError:
        return False


def session_response(request):
    issued = int(time.time())
    token = jwt.encode({"type": "frontend-browser-session", "iat": issued}, access_record(request)["password_hash"], algorithm="HS256")
    response = JSONResponse({"authenticated": True})
    secure = request.url.scheme == "https" or request.headers.get("origin", "").startswith("https://")
    response.set_cookie(COOKIE, token, httponly=True, secure=secure, samesite="lax", path="/")
    response.headers["Cache-Control"] = "no-store"
    return response


class PasswordBody(BaseModel):
    password: str = Field(min_length=5, max_length=128)


@router.get("/status")
def status(request: Request):
    return {"authenticated": authenticated(request)}


@router.post("/login")
def login(body: PasswordBody, request: Request):
    now = time.monotonic()
    ip = request.client.host if request.client else "unknown"
    with _attempt_lock:
        attempts = getattr(request.app.state, "frontend_login_attempts", None)
        if attempts is None:
            attempts = request.app.state.frontend_login_attempts = OrderedDict()
        previous = [at for at in attempts.get(ip, []) if now - at < 60]
        if len(previous) >= 5:
            return JSONResponse({"message": "尝试次数过多，请一分钟后重试。"}, status_code=429)
        attempts[ip] = previous + [now]
        attempts.move_to_end(ip)
        if len(attempts) > 4096:
            attempts.popitem(last=False)
    record = access_record(request)
    if not verify_password(body.password, record["password_hash"]):
        return JSONResponse({"message": "访问密码错误。"}, status_code=401)
    with _attempt_lock:
        attempts.pop(ip, None)
    return session_response(request)


@router.post("/logout")
def logout():
    response = JSONResponse({"authenticated": False})
    response.delete_cookie(COOKIE, path="/")
    return response


@admin_router.get("", dependencies=[Depends(require_permission("system:llm"))])
def admin_status(request: Request):
    record = access_record(request)
    return {"password_set": True, "updated_at": record["updated_at"]}


@admin_router.put("")
def change_password(body: PasswordBody, request: Request, auth: dict = Depends(require_permission("system:llm:write"))):
    access_record(request)
    hashed = password_hasher.hash(body.password)
    with get_store(request).connect() as conn:
        conn.execute("UPDATE frontend_access SET password_hash=?, updated_at=? WHERE id=1", (hashed, utc_now()))
    from apps.api.admin.routes import _audit
    _audit(request, auth, action="update", resource_type="frontend_access", resource_id="1", before=None, after={"password_changed": True})
    return {"password_set": True, "updated_at": access_record(request)["updated_at"]}


class FrontendAccessMiddleware:
    """Guard HTTP/SSE/WebSocket; admin routes retain their separate authentication."""
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] not in {"http", "websocket"}:
            return await self.app(scope, receive, send)
        path = scope["path"]
        method = scope.get("method")
        remote_parts = path.strip("/").split("/")
        public_remote_question = (
            len(remote_parts) == 2 and remote_parts[0] == "remote-questions" and method == "GET"
        ) or (
            len(remote_parts) == 3 and remote_parts[0] == "remote-questions"
            and remote_parts[2] == "questions" and method == "POST"
        )
        if method == "OPTIONS" or path == "/healthz" or public_remote_question or path.startswith(("/frontend-access/", "/api/v1/auth/", "/api/v1/public/exhibit-surveys/")):
            return await self.app(scope, receive, send)
        connection = HTTPConnection(scope)
        if await run_in_threadpool(authenticated, connection):
            return await self.app(scope, receive, send)
        # Admin tools already send the existing authenticated bearer token.
        header = connection.headers.get("authorization", "")
        if header.startswith("Bearer "):
            from fastapi.security import HTTPAuthorizationCredentials
            try:
                await run_in_threadpool(current_user, connection, HTTPAuthorizationCredentials(scheme="Bearer", credentials=header[7:]))
                cookie = (await run_in_threadpool(session_response, connection)).headers["set-cookie"]
                async def admin_send(message):
                    if message["type"] == "http.response.start":
                        message["headers"] = list(message.get("headers", [])) + [(b"set-cookie", cookie.encode("latin-1"))]
                    await send(message)
                return await self.app(scope, receive, admin_send if scope["type"] == "http" else send)
            except HTTPException:
                pass
        if path.startswith("/api/v1/admin/") or path == "/api/v1/admin/frontend-access":
            return await self.app(scope, receive, send)
        if scope["type"] == "websocket":
            return await send({"type": "websocket.close", "code": 4401})
        response = JSONResponse({"code": "FRONTEND_AUTH_REQUIRED", "message": "请输入数字人访问密码。"}, status_code=401, headers={"Cache-Control": "no-store"})
        await response(scope, receive, send)
