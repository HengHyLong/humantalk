from __future__ import annotations

import secrets
import time
import uuid
from typing import Any

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from .store import AdminStore

password_hasher = PasswordHasher()
bearer = HTTPBearer(auto_error=False)


def get_store(request: Request) -> AdminStore:
    store = getattr(request.app.state, "admin_store", None)
    if store is None:
        settings = getattr(request.app.state, "settings", None)
        path = getattr(settings, "admin_sqlite_path", "./data/opentalking_admin.sqlite3")
        initialize = bool(getattr(settings, "admin_initialize_defaults", True))
        store = AdminStore(path, initialize_defaults=initialize)
        request.app.state.admin_store = store
    return store


def jwt_secret(request: Request) -> str:
    settings = getattr(request.app.state, "settings", None)
    secret = str(getattr(settings, "admin_jwt_secret", "") or "").strip()
    if secret:
        return secret
    generated = getattr(request.app.state, "admin_jwt_secret", None)
    if not generated:
        generated = secrets.token_urlsafe(48)
        request.app.state.admin_jwt_secret = generated
    return generated


def _token(request: Request, user_id: str, token_type: str, expires_in: int) -> str:
    now = int(time.time())
    jti = uuid.uuid4().hex
    encoded = jwt.encode({"sub": user_id, "type": token_type, "jti": jti, "iat": now, "exp": now + expires_in}, jwt_secret(request), algorithm="HS256")
    get_store(request).issue_token(user_id, token_type, now + expires_in, jti)
    return encoded


def issue_tokens(request: Request, user_id: str) -> dict[str, Any]:
    settings = getattr(request.app.state, "settings", None)
    access_seconds = int(getattr(settings, "admin_access_token_minutes", 30)) * 60
    refresh_seconds = int(getattr(settings, "admin_refresh_token_days", 7)) * 86400
    access = _token(request, user_id, "access", access_seconds)
    refresh = _token(request, user_id, "refresh", refresh_seconds)
    return {"token": access, "access_token": access, "refresh_token": refresh, "expires_in": access_seconds, "expires_at": int(time.time()) + access_seconds}


def decode_token(request: Request, token: str, expected_type: str = "access") -> dict[str, Any]:
    try:
        payload = jwt.decode(token, jwt_secret(request), algorithms=["HS256"])
    except jwt.PyJWTError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail={"code": "INVALID_TOKEN", "detail": "登录状态无效或已过期"}) from exc
    if payload.get("type") != expected_type or not payload.get("sub") or not payload.get("jti"):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail={"code": "INVALID_TOKEN", "detail": "Token 类型无效"})
    if get_store(request).token_revoked(str(payload["jti"])):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail={"code": "TOKEN_REVOKED", "detail": "登录状态已注销"})
    return payload


def current_user(request: Request, credentials: HTTPAuthorizationCredentials | None = Depends(bearer)) -> dict[str, Any]:
    if not credentials:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail={"code": "UNAUTHORIZED", "detail": "请先登录"})
    payload = decode_token(request, credentials.credentials)
    user = get_store(request).user(str(payload["sub"]))
    if not user or user.get("status") != "active":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail={"code": "USER_DISABLED", "detail": "用户不存在或已停用"})
    return {"user": user, "payload": payload}


def require_permission(permission: str):
    def dependency(request: Request, auth: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
        permissions = {row["code"] for row in get_store(request).permissions_for_user(auth["user"]["id"])}
        if permission not in permissions:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail={"code": "FORBIDDEN", "detail": "没有执行该操作的权限"})
        return auth

    return dependency


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return password_hasher.verify(password_hash, password)
    except (VerifyMismatchError, ValueError):
        return False
