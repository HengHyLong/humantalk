from __future__ import annotations

import hmac
import os
import secrets
import time
from typing import Any

from fastapi import HTTPException, Request


ADMIN_ROLES = {"sys_admin", "content_ops", "data_viewer", "security_audit", "readonly"}

_ASSET_READ = frozenset({"asset:avatar", "asset:gif", "asset:voice", "asset:scene", "asset:idle"})
_INTERACTION_READ = frozenset({"interact:test", "interact:welcome", "interact:explain", "interact:shopping", "knowledge:script"})
_REPORT_READ = frozenset({"dashboard:view", "report:interaction", "report:export", "report:ingest"})
_OPS_READ = frozenset({"system:ops"})
_CONTENT_WRITE = frozenset(
    {
        "asset:gif:write",
        "asset:voice:write",
        "asset:scene:write",
        "asset:idle:write",
        "knowledge:script:write",
        "interact:welcome:write",
        "interact:explain:write",
        "interact:shopping:write",
    }
)
_ALL_WRITE = _CONTENT_WRITE | frozenset({"system:ops:write"})

ROLE_PERMISSIONS: dict[str, frozenset[str]] = {
    "sys_admin": _ASSET_READ | _INTERACTION_READ | _REPORT_READ | _OPS_READ | _ALL_WRITE,
    "content_ops": _ASSET_READ | _INTERACTION_READ | _REPORT_READ | _CONTENT_WRITE,
    "data_viewer": frozenset({"dashboard:view", "report:interaction", "report:export"}),
    "security_audit": frozenset({"dashboard:view", "report:interaction", "system:ops"}),
    "readonly": _ASSET_READ | _INTERACTION_READ | frozenset({"dashboard:view", "report:interaction", "system:ops"}),
}

# These are the UI-facing button permissions. The server also has narrower
# write permissions for resources that the old admin UI did not expose as a
# separate button.
ROLE_BUTTON_PERMISSIONS: dict[str, frozenset[str]] = {
    "sys_admin": frozenset(
        {
            "asset:gif:write",
            "asset:scene:write",
            "interact:welcome:write",
            "interact:explain:write",
            "interact:shopping:write",
            "report:export",
            "ops:failover",
        }
    ),
    "content_ops": frozenset(
        {
            "asset:gif:write",
            "asset:scene:write",
            "interact:welcome:write",
            "interact:explain:write",
            "interact:shopping:write",
            "report:export",
        }
    ),
    "data_viewer": frozenset({"report:export"}),
    "security_audit": frozenset(),
    "readonly": frozenset(),
}


def _normalized_admin_path(request: Request) -> str:
    path = request.url.path.rstrip("/") or "/"
    marker = path.find("/admin")
    return path[marker:] if marker >= 0 else path


def _admin_tokens(request: Request) -> dict[str, dict[str, Any]]:
    tokens = getattr(request.app.state, "admin_tokens", None)
    if tokens is None:
        tokens = {}
        request.app.state.admin_tokens = tokens
    return tokens


def _configured_admin_credentials(request: Request) -> tuple[str, str]:
    settings = getattr(request.app.state, "settings", None)
    username = os.environ.get("OPENTALKING_ADMIN_USERNAME", "").strip() or str(
        getattr(settings, "admin_username", "admin")
    )
    password = os.environ.get("OPENTALKING_ADMIN_PASSWORD", "").strip() or str(
        getattr(settings, "admin_password", "Admin@123456")
    )
    return username, password


def _configured_admin_role(request: Request) -> str:
    settings = getattr(request.app.state, "settings", None)
    role = os.environ.get("OPENTALKING_ADMIN_ROLE", "").strip() or str(
        getattr(settings, "admin_role", "sys_admin")
    )
    if role not in ADMIN_ROLES:
        raise HTTPException(status_code=500, detail="invalid configured admin role")
    return role


def _admin_user(username: str, role: str = "sys_admin") -> dict[str, Any]:
    if role not in ADMIN_ROLES:
        raise HTTPException(status_code=500, detail="invalid admin role")
    return {
        "id": f"user-{username}",
        "username": username,
        "displayName": username,
        "role": role,
        "permissions": sorted(ROLE_PERMISSIONS[role]),
        "buttonPermissions": sorted(ROLE_BUTTON_PERMISSIONS[role]),
    }


def issue_admin_token(request: Request, username: str, role: str) -> tuple[str, int, dict[str, Any]]:
    settings = getattr(request.app.state, "settings", None)
    try:
        ttl = int(getattr(settings, "admin_token_ttl_sec", 8 * 3600))
    except (TypeError, ValueError):
        ttl = 8 * 3600
    ttl = max(300, min(ttl, 7 * 24 * 3600))
    expires_at = int(time.time()) + ttl
    token = secrets.token_urlsafe(32)
    user = _admin_user(username, role)
    _admin_tokens(request)[token] = {"user": user, "expiresAt": expires_at}
    return token, expires_at, user


def current_admin_user(request: Request) -> dict[str, Any]:
    now = int(time.time())
    tokens = _admin_tokens(request)
    for token, item in list(tokens.items()):
        if int(item.get("expiresAt", 0)) <= now:
            tokens.pop(token, None)
    authorization = request.headers.get("authorization", "")
    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token.strip():
        raise HTTPException(status_code=401, detail="admin authentication required")
    session = tokens.get(token.strip())
    if not session or int(session.get("expiresAt", 0)) <= now:
        raise HTTPException(status_code=401, detail="admin token is invalid or expired")
    user = session.get("user")
    if not isinstance(user, dict) or user.get("role") not in ADMIN_ROLES:
        raise HTTPException(status_code=401, detail="admin token is invalid")
    return user


def revoke_admin_token(request: Request) -> None:
    authorization = request.headers.get("authorization", "")
    scheme, _, token = authorization.partition(" ")
    if scheme.lower() == "bearer":
        _admin_tokens(request).pop(token.strip(), None)


def _write_permission(read_permission: str) -> str:
    return {
        "asset:gif": "asset:gif:write",
        "asset:voice": "asset:voice:write",
        "asset:scene": "asset:scene:write",
        "asset:idle": "asset:idle:write",
        "knowledge:script": "knowledge:script:write",
        "interact:welcome": "interact:welcome:write",
        "interact:explain": "interact:explain:write",
        "interact:shopping": "interact:shopping:write",
        "system:ops": "system:ops:write",
    }.get(read_permission, read_permission)


def required_admin_permission(request: Request) -> str | None:
    path = _normalized_admin_path(request)
    method = request.method.upper()
    if path == "/admin/auth/login" and method == "POST":
        return None
    if path in {"/admin/auth/me", "/admin/auth/logout"}:
        return None

    if path.startswith("/admin/assets"):
        rest = path[len("/admin/assets") :].strip("/")
        if rest.startswith("voice-configs"):
            read = "asset:voice"
        elif rest.startswith("scene-bindings"):
            read = "asset:scene"
        elif rest.startswith("idle-contents"):
            read = "asset:idle"
        elif rest.endswith("/file") or rest.startswith("gifs") or rest == "":
            read = "asset:gif"
        else:
            read = "asset:gif"
        return _write_permission(read) if method not in {"GET", "HEAD"} else read

    if path.startswith("/admin/interaction/"):
        resource = path[len("/admin/interaction/") :].split("/", 1)[0]
        read = {
            "scripts": "knowledge:script",
            "welcome-configs": "interact:welcome",
            "explain-flows": "interact:explain",
            "shopping-strategies": "interact:shopping",
        }.get(resource)
        if read is None:
            return "__deny__"
        return _write_permission(read) if method not in {"GET", "HEAD"} else read

    if path == "/admin/alerts" and method == "GET":
        return "system:ops"
    if path.startswith("/admin/alerts/") and method not in {"GET", "HEAD"}:
        return "system:ops:write"
    if path in {"/admin/health", "/admin/runtime/status", "/admin/queue/status", "/admin/ops/monitor"}:
        return "system:ops"
    if path == "/admin/report":
        return "dashboard:view"
    if path == "/admin/report/events":
        return "report:ingest"
    if path == "/admin/report/export":
        return "report:export"
    if path.startswith("/admin/report/"):
        return "report:interaction"
    return "__deny__"


def authorize_admin_request(request: Request) -> dict[str, Any] | None:
    permission = required_admin_permission(request)
    if permission is None and _normalized_admin_path(request) == "/admin/auth/login":
        return None
    user = current_admin_user(request)
    request.state.admin_user = user
    if permission is None:
        return user
    if permission == "__deny__" or permission not in ROLE_PERMISSIONS.get(str(user.get("role")), frozenset()):
        required = "unknown admin route" if permission == "__deny__" else permission
        raise HTTPException(status_code=403, detail=f"admin permission required: {required}")
    return user


def verify_admin_credentials(request: Request, payload: dict[str, Any]) -> tuple[str, str, str]:
    username, password = _configured_admin_credentials(request)
    supplied_username = str(payload.get("username") or "")
    supplied_password = str(payload.get("password") or "")
    if not hmac.compare_digest(supplied_username, username) or not hmac.compare_digest(supplied_password, password):
        raise HTTPException(status_code=401, detail="invalid admin credentials")
    return username, password, _configured_admin_role(request)
