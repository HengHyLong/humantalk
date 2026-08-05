from __future__ import annotations

import csv
import io
import json
import time
import uuid
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field, model_validator

from .security import current_user, decode_token, get_store, issue_tokens, password_hasher, verify_password
from .store import AdminStore, utc_now

router = APIRouter(prefix="/api/v1", tags=["admin"])
public_router = APIRouter(tags=["exhibition-public"])


class LoginRequest(BaseModel):
    username: str = Field(min_length=1, max_length=100)
    password: str = Field(min_length=1, max_length=200)


class RefreshRequest(BaseModel):
    refresh_token: str | None = None


class RecordBody(BaseModel):
    data: dict[str, Any] = Field(default_factory=dict)

    @model_validator(mode="before")
    @classmethod
    def accept_raw_object(cls, value: Any) -> Any:
        if isinstance(value, dict) and "data" not in value:
            return {"data": value}
        return value


class StatusBody(BaseModel):
    status: str
    note: str | None = None


class LinkBody(BaseModel):
    ids: list[str] = Field(default_factory=list)


class NavigationBody(BaseModel):
    text: str = Field(min_length=1, max_length=1000)
    session_id: str = Field(min_length=1, max_length=200)


def _public_user(store: AdminStore, user: dict[str, Any]) -> dict[str, Any]:
    roles = store.roles_for_user(user["id"])
    return {
        "id": user["id"],
        "username": user["username"],
        "display_name": user["display_name"],
        "displayName": user["display_name"],
        "email": user["email"],
        "phone": user["phone"],
        "department": user["department"],
        "status": user["status"],
        "roles": [role["code"] for role in roles],
        "created_at": user["created_at"],
        "updated_at": user["updated_at"],
        "last_login_at": user["last_login_at"],
    }


def _permission_codes(store: AdminStore, user_id: str) -> set[str]:
    return {item["code"] for item in store.permissions_for_user(user_id)}


def _require(store: AdminStore, auth: dict[str, Any], permission: str) -> None:
    if permission not in _permission_codes(store, auth["user"]["id"]):
        raise HTTPException(status_code=403, detail={"code": "FORBIDDEN", "detail": "没有执行该操作的权限"})


def _paginate(items: list[dict[str, Any]], page: int, page_size: int) -> dict[str, Any]:
    page = max(page, 1)
    page_size = min(max(page_size, 1), 100)
    start = (page - 1) * page_size
    return {"items": items[start : start + page_size], "total": len(items), "page": page, "page_size": page_size}


def _record(store: AdminStore, kind: str, record_id: str, *, required: bool = True) -> dict[str, Any] | None:
    item = store.get_record(kind, record_id)
    if required and item is None:
        raise HTTPException(status_code=404, detail={"code": "RESOURCE_NOT_FOUND", "detail": "资源不存在"})
    return item


def _audit(request: Request, auth: dict[str, Any] | None, *, action: str, resource_type: str, resource_id: str, before: Any, after: Any, status_code: int = 200) -> None:
    store = get_store(request)
    store.audit({
        "id": uuid.uuid4().hex,
        "trace_id": getattr(request.state, "trace_id", uuid.uuid4().hex),
        "user_id": auth["user"]["id"] if auth else None,
        "username": auth["user"]["username"] if auth else "runtime",
        "method": request.method,
        "path": request.url.path,
        "action": action,
        "resource_type": resource_type,
        "resource_id": resource_id,
        "ip": request.client.host if request.client else "",
        "user_agent": request.headers.get("user-agent", ""),
        "status_code": status_code,
        "duration_ms": 0,
        "before_json": json.dumps(before, ensure_ascii=False) if before is not None else None,
        "after_json": json.dumps(after, ensure_ascii=False) if after is not None else None,
        "created_at": utc_now(),
    })


@router.post("/auth/login")
def login(request: Request, body: LoginRequest) -> dict[str, Any]:
    store = get_store(request)
    user = store.user_by_username(body.username.strip())
    if not user or user["status"] != "active" or not verify_password(body.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail={"code": "INVALID_CREDENTIALS", "detail": "用户名或密码错误"})
    with store.connect() as conn:
        conn.execute("UPDATE admin_users SET last_login_at=?,last_login_ip=?,updated_at=? WHERE id=?", (utc_now(), request.client.host if request.client else "", utc_now(), user["id"]))
    tokens = issue_tokens(request, user["id"])
    return {**tokens, "user": _public_user(store, user)}


@router.get("/auth/me")
def me(request: Request, auth: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    store = get_store(request)
    return {"user": _public_user(store, auth["user"]), "roles": store.roles_for_user(auth["user"]["id"]), "permissions": store.permissions_for_user(auth["user"]["id"])}


@router.get("/auth/permissions")
def permissions(request: Request, auth: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    store = get_store(request)
    items = store.permissions_for_user(auth["user"]["id"])
    by_parent: dict[str | None, list[dict[str, Any]]] = {}
    for item in items:
        by_parent.setdefault(item["parent_id"], []).append({**item, "children": []})
    def tree(parent: str | None) -> list[dict[str, Any]]:
        result = []
        for item in by_parent.get(parent, []):
            item["children"] = tree(item["id"])
            result.append(item)
        return result
    return {"codes": [item["code"] for item in items], "items": items, "tree": tree(None), "roles": store.roles_for_user(auth["user"]["id"])}


@router.post("/auth/refresh")
def refresh(request: Request, body: RefreshRequest) -> dict[str, Any]:
    token = body.refresh_token
    if not token:
        raise HTTPException(status_code=400, detail={"code": "REFRESH_TOKEN_REQUIRED", "detail": "缺少 refresh_token"})
    payload = decode_token(request, token, expected_type="refresh")
    return issue_tokens(request, str(payload["sub"]))


@router.post("/auth/logout")
def logout(request: Request, auth: dict[str, Any] = Depends(current_user)) -> dict[str, bool]:
    get_store(request).revoke_token(str(auth["payload"]["jti"]))
    _audit(request, auth, action="logout", resource_type="auth", resource_id=auth["user"]["id"], before=None, after=None)
    return {"success": True}


RESOURCE_PERMISSIONS = {
    "exhibitions": "event:exhibition", "venues": "event:route", "points": "event:route", "routes": "event:route", "exhibitors": "event:exhibitor", "exhibits": "event:exhibit", "schedules": "event:schedule", "broadcasts": "event:route",
    "interaction_welcome": "interact:welcome", "interaction_explain": "interact:explain", "interaction_shopping": "interact:shopping",
    "gifs": "asset:gif", "voice_configs": "asset:voice", "scene_bindings": "asset:scene", "idle_contents": "asset:idle",
    "documents": "knowledge:document", "knowledge_bases": "knowledge:document", "qa": "knowledge:qa", "scripts": "knowledge:script", "packages": "knowledge:publish", "miss_pool": "knowledge:miss",
}

COLLECTION_RESOURCES = {
    "assets": {"avatars": "avatars", "gifs": "gifs", "voice-configs": "voice_configs", "scene-bindings": "scene_bindings", "idle-contents": "idle_contents"},
    "knowledge": {"documents": "documents", "bases": "knowledge_bases", "qa": "qa", "scripts": "scripts", "packages": "packages", "miss-pool": "miss_pool"},
}


def _collection_kind(domain: str, resource: str) -> str:
    kind = COLLECTION_RESOURCES.get(domain, {}).get(resource)
    if not kind:
        raise HTTPException(status_code=404, detail="resource not found")
    return kind


def _collection_permission(kind: str) -> str:
    return RESOURCE_PERMISSIONS.get(kind, "asset:avatar" if kind == "avatars" else "knowledge:document")


@router.post("/admin/assets/gifs/upload")
async def upload_gif(request: Request, file: UploadFile = File(...), exhibition_id: str | None = None, auth: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    store = get_store(request)
    _require(store, auth, "asset:gif")
    settings = getattr(request.app.state, "settings", None)
    root = Path(getattr(settings, "admin_media_root", "./data/admin-assets")) / "gifs"
    root.mkdir(parents=True, exist_ok=True)
    content = await file.read()
    if len(content) > 20 * 1024 * 1024:
        raise HTTPException(status_code=413, detail={"code": "FILE_TOO_LARGE", "detail": "文件不能超过 20MB"})
    extension = Path(file.filename or "asset.gif").suffix.lower()
    if extension not in {".gif", ".mp4", ".webm"}:
        raise HTTPException(status_code=400, detail={"code": "UNSUPPORTED_FILE", "detail": "仅支持 GIF、MP4 或 WebM"})
    record_id = f"gif-{uuid.uuid4().hex[:12]}"
    file_path = root / f"{record_id}{extension}"
    file_path.write_bytes(content)
    saved = store.save_record("gifs", {"id": record_id, "name": file.filename or record_id, "filename": file.filename or record_id, "mimeType": file.content_type or "application/octet-stream", "sizeBytes": len(content), "url": f"/api/v1/admin/assets/gifs/{record_id}/file", "exhibitionId": exhibition_id, "status": "active"}, exhibition_id)
    _audit(request, auth, action="upload", resource_type="gif", resource_id=record_id, before=None, after=saved)
    return saved


@router.get("/admin/assets/{resource}")
@router.get("/admin/knowledge/{resource}")
def list_collection(resource: str, request: Request, page: int = 1, page_size: int = 9, exhibition_id: str | None = None, keyword: str | None = None, status_filter: str | None = Query(None, alias="status"), auth: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    domain = request.url.path.split("/admin/", 1)[1].split("/", 1)[0]
    kind = _collection_kind(domain, resource)
    store = get_store(request)
    _require(store, auth, _collection_permission(kind))
    return _paginate(store.list_records(kind, exhibition_id=exhibition_id, keyword=keyword, status=status_filter), page, page_size)


@router.post("/admin/assets/{resource}")
@router.post("/admin/knowledge/{resource}")
def create_collection(resource: str, request: Request, body: RecordBody, auth: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    domain = request.url.path.split("/admin/", 1)[1].split("/", 1)[0]
    kind = _collection_kind(domain, resource)
    store = get_store(request)
    _require(store, auth, _collection_permission(kind))
    if kind in {"documents", "knowledge_bases", "qa", "scripts", "packages", "miss_pool"} and body.data.get("exhibitionId"):
        _validate_record(store, "knowledge_bases" if kind == "documents" else kind, body.data)
    saved = store.save_record(kind, body.data, body.data.get("exhibitionId"))
    _audit(request, auth, action="create", resource_type=kind, resource_id=saved["id"], before=None, after=saved)
    return saved


@router.get("/admin/assets/gifs/{record_id}/file")
def get_gif_file(record_id: str, request: Request, auth: dict[str, Any] = Depends(current_user)) -> Any:
    from fastapi.responses import FileResponse

    store = get_store(request)
    _require(store, auth, "asset:gif")
    item = _record(store, "gifs", record_id) or {}
    settings = getattr(request.app.state, "settings", None)
    root = Path(getattr(settings, "admin_media_root", "./data/admin-assets")) / "gifs"
    matches = list(root.glob(f"{record_id}.*"))
    if not matches:
        raise HTTPException(status_code=404, detail={"code": "FILE_NOT_FOUND", "detail": "资源文件不存在"})
    return FileResponse(matches[0], media_type=item.get("mimeType", "application/octet-stream"))


@router.get("/admin/assets/{resource}/{record_id}")
@router.get("/admin/knowledge/{resource}/{record_id}")
def get_collection(resource: str, record_id: str, request: Request, auth: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    domain = request.url.path.split("/admin/", 1)[1].split("/", 1)[0]
    kind = _collection_kind(domain, resource)
    store = get_store(request)
    _require(store, auth, _collection_permission(kind))
    return _record(store, kind, record_id) or {}


@router.patch("/admin/assets/{resource}/{record_id}")
@router.patch("/admin/knowledge/{resource}/{record_id}")
def update_collection(resource: str, record_id: str, request: Request, body: RecordBody, auth: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    domain = request.url.path.split("/admin/", 1)[1].split("/", 1)[0]
    kind = _collection_kind(domain, resource)
    store = get_store(request)
    _require(store, auth, _collection_permission(kind))
    before = _record(store, kind, record_id) or {}
    data = {**before, **body.data, "id": record_id}
    saved = store.save_record(kind, data, data.get("exhibitionId"))
    _audit(request, auth, action="update", resource_type=kind, resource_id=record_id, before=before, after=saved)
    return saved


@router.delete("/admin/assets/{resource}/{record_id}")
@router.delete("/admin/knowledge/{resource}/{record_id}")
def delete_collection(resource: str, record_id: str, request: Request, auth: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    domain = request.url.path.split("/admin/", 1)[1].split("/", 1)[0]
    kind = _collection_kind(domain, resource)
    store = get_store(request)
    _require(store, auth, _collection_permission(kind))
    before = _record(store, kind, record_id) or {}
    if not store.delete_record(kind, record_id):
        raise HTTPException(status_code=404, detail={"code": "RESOURCE_NOT_FOUND", "detail": "资源不存在"})
    _audit(request, auth, action="delete", resource_type=kind, resource_id=record_id, before=before, after=None)
    return {"deleted": True, "id": record_id}


def _event_exhibition_id(item: dict[str, Any] | None) -> str | None:
    return (item or {}).get("exhibitionId") or (item or {}).get("exhibition_id")


def _validate_record(store: AdminStore, kind: str, data: dict[str, Any], record_id: str | None = None) -> None:
    exhibition_id = _event_exhibition_id(data)
    if kind != "exhibitions" and exhibition_id and not store.get_record("exhibitions", exhibition_id):
        raise HTTPException(status_code=400, detail={"code": "EXHIBITION_NOT_FOUND", "detail": "所属展会不存在"})
    if kind == "venues":
        return
    if kind == "points":
        venue = _record(store, "venues", str(data.get("venueId")))
        if _event_exhibition_id(venue) != exhibition_id:
            raise HTTPException(status_code=400, detail={"code": "RELATION_INVALID", "detail": "点位场地不属于当前展会"})
    if kind == "routes":
        points = [store.get_record("points", str(point_id)) for point_id in data.get("pointIds", [])]
        if len(points) < 2 or any(not point or point.get("venueId") != data.get("venueId") or _event_exhibition_id(point) != exhibition_id for point in points):
            raise HTTPException(status_code=400, detail={"code": "RELATION_INVALID", "detail": "路线至少需要两个同场地点位"})
    if kind == "exhibits":
        exhibitor = _record(store, "exhibitors", str(data.get("exhibitorId")))
        if _event_exhibition_id(exhibitor) != exhibition_id:
            raise HTTPException(status_code=400, detail={"code": "RELATION_INVALID", "detail": "展品与展商必须属于同一展会"})
    if kind == "schedules" and data.get("venueId"):
        venue = _record(store, "venues", str(data.get("venueId")))
        if _event_exhibition_id(venue) != exhibition_id:
            raise HTTPException(status_code=400, detail={"code": "RELATION_INVALID", "detail": "活动场地不属于当前展会"})


@router.get("/admin/event/{resource}")
def list_event(resource: str, request: Request, page: int = 1, page_size: int = 9, exhibition_id: str | None = None, keyword: str | None = None, status_filter: str | None = Query(None, alias="status"), auth: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    permission = RESOURCE_PERMISSIONS.get(resource)
    if not permission:
        raise HTTPException(status_code=404, detail="resource not found")
    _require(get_store(request), auth, permission)
    return _paginate(get_store(request).list_records(resource, exhibition_id=exhibition_id, keyword=keyword, status=status_filter), page, page_size)


@router.post("/admin/event/{resource}")
def create_event(resource: str, request: Request, body: RecordBody, auth: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    store = get_store(request)
    permission = RESOURCE_PERMISSIONS.get(resource)
    if not permission:
        raise HTTPException(status_code=404, detail="resource not found")
    _require(store, auth, permission)
    _validate_record(store, resource, body.data)
    saved = store.save_record(resource, body.data, _event_exhibition_id(body.data))
    _audit(request, auth, action="create", resource_type=resource, resource_id=saved["id"], before=None, after=saved)
    return saved


@router.get("/admin/event/{resource}/{record_id}")
def get_event(resource: str, record_id: str, request: Request, auth: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    store = get_store(request)
    _require(store, auth, RESOURCE_PERMISSIONS.get(resource, "dashboard:view"))
    return _record(store, resource, record_id) or {}


@router.patch("/admin/event/{resource}/{record_id}")
def update_event(resource: str, record_id: str, request: Request, body: RecordBody, auth: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    store = get_store(request)
    _require(store, auth, RESOURCE_PERMISSIONS.get(resource, "dashboard:view"))
    before = _record(store, resource, record_id) or {}
    data = {**before, **body.data, "id": record_id}
    _validate_record(store, resource, data, record_id)
    saved = store.save_record(resource, data, _event_exhibition_id(data))
    _audit(request, auth, action="update", resource_type=resource, resource_id=record_id, before=before, after=saved)
    return saved


@router.delete("/admin/event/{resource}/{record_id}")
def delete_event(resource: str, record_id: str, request: Request, auth: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    store = get_store(request)
    _require(store, auth, RESOURCE_PERMISSIONS.get(resource, "dashboard:view"))
    before = _record(store, resource, record_id) or {}
    if resource == "exhibitions":
        related = {kind: len(store.list_records(kind, exhibition_id=record_id)) for kind in ("venues", "points", "routes", "exhibitors", "exhibits", "schedules", "broadcasts", "interaction_welcome", "interaction_explain", "interaction_shopping")}
        deleted = {kind: 0 for kind in related}
        for kind in related:
            for item in store.list_records(kind, exhibition_id=record_id):
                deleted[kind] += int(store.delete_record(kind, item["id"]))
        deleted["exhibitions"] = int(store.delete_record(resource, record_id))
        _audit(request, auth, action="delete_cascade", resource_type=resource, resource_id=record_id, before=before, after=deleted)
        return {"deleted": True, "id": record_id, "summary": deleted}
    if not store.delete_record(resource, record_id):
        raise HTTPException(status_code=404, detail={"code": "RESOURCE_NOT_FOUND", "detail": "资源不存在"})
    _audit(request, auth, action="delete", resource_type=resource, resource_id=record_id, before=before, after=None)
    return {"deleted": True, "id": record_id}


@router.post("/admin/event/exhibitions/{record_id}/lifecycle")
def lifecycle(record_id: str, request: Request, body: StatusBody, auth: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    store = get_store(request)
    _require(store, auth, "event:exhibition")
    before = _record(store, "exhibitions", record_id) or {}
    order = ["preparing", "setup", "operating", "teardown"]
    if body.status not in order or (before.get("status") in order and order.index(body.status) != order.index(before["status"]) + 1):
        raise HTTPException(status_code=400, detail={"code": "INVALID_LIFECYCLE", "detail": "展会生命周期只能按顺序推进"})
    saved = store.save_record("exhibitions", {**before, "status": body.status}, before.get("exhibitionId"))
    _audit(request, auth, action="lifecycle", resource_type="exhibitions", resource_id=record_id, before=before, after=saved)
    return saved


@router.get("/admin/event/exhibitions/{record_id}/overview")
def exhibition_overview(record_id: str, request: Request, auth: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    store = get_store(request)
    _require(store, auth, "event:exhibition")
    _record(store, "exhibitions", record_id)
    return {"exhibition": store.get_record("exhibitions", record_id), "counts": {kind: len(store.list_records(kind, exhibition_id=record_id)) for kind in ("venues", "points", "routes", "exhibitors", "exhibits", "schedules", "broadcasts")}}


@router.get("/admin/event/exhibitions/{record_id}/runtime-config")
def get_runtime_config(record_id: str, request: Request, auth: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    store = get_store(request)
    _require(store, auth, "event:exhibition")
    _record(store, "exhibitions", record_id)
    return store.get_record("runtime_configs", record_id) or {"exhibitionId": record_id, "keywords": {"navigation": [], "exhibition_content": []}}


@router.put("/admin/event/exhibitions/{record_id}/runtime-config")
def save_runtime_config(record_id: str, request: Request, body: RecordBody, auth: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    store = get_store(request)
    _require(store, auth, "event:exhibition")
    _record(store, "exhibitions", record_id)
    before = store.get_record("runtime_configs", record_id)
    saved = store.save_record("runtime_configs", {**body.data, "id": record_id, "exhibitionId": record_id}, record_id)
    _audit(request, auth, action="update", resource_type="runtime_config", resource_id=record_id, before=before, after=saved)
    return saved


@router.post("/admin/event/exhibitions/{record_id}/runtime-config/validate")
def validate_runtime_config(record_id: str, request: Request, body: RecordBody, auth: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    store = get_store(request)
    _require(store, auth, "event:exhibition")
    _record(store, "exhibitions", record_id)
    errors = []
    if not isinstance(body.data.get("keywords", {}).get("navigation", []), list):
        errors.append("keywords.navigation 必须是数组")
    return {"valid": not errors, "errors": errors}


INTERACTION_RESOURCES = {"welcome-configs": "interaction_welcome", "explain-flows": "interaction_explain", "shopping-strategies": "interaction_shopping"}


@router.get("/admin/interaction/{resource}")
def list_interaction(resource: str, request: Request, page: int = 1, page_size: int = 9, exhibition_id: str | None = None, keyword: str | None = None, auth: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    kind = INTERACTION_RESOURCES.get(resource)
    if not kind:
        raise HTTPException(status_code=404, detail="resource not found")
    _require(get_store(request), auth, RESOURCE_PERMISSIONS[kind])
    return _paginate(get_store(request).list_records(kind, exhibition_id=exhibition_id, keyword=keyword), page, page_size)


@router.post("/admin/interaction/{resource}")
def save_interaction(resource: str, request: Request, body: RecordBody, auth: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    kind = INTERACTION_RESOURCES.get(resource)
    if not kind:
        raise HTTPException(status_code=404, detail="resource not found")
    store = get_store(request)
    _require(store, auth, RESOURCE_PERMISSIONS[kind])
    if not body.data.get("exhibitionId"):
        raise HTTPException(status_code=400, detail={"code": "EXHIBITION_REQUIRED", "detail": "交互配置必须关联展会"})
    _validate_record(store, kind, body.data)
    before = store.get_record(kind, str(body.data.get("id"))) if body.data.get("id") else None
    saved = store.save_record(kind, body.data, body.data.get("exhibitionId"))
    _audit(request, auth, action="save", resource_type=kind, resource_id=saved["id"], before=before, after=saved)
    return saved


@router.patch("/admin/interaction/{resource}/{record_id}")
def update_interaction(resource: str, record_id: str, request: Request, body: RecordBody, auth: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    kind = INTERACTION_RESOURCES.get(resource)
    if not kind:
        raise HTTPException(status_code=404, detail="resource not found")
    store = get_store(request)
    _require(store, auth, RESOURCE_PERMISSIONS[kind])
    before = _record(store, kind, record_id) or {}
    data = {**before, **body.data, "id": record_id, "exhibitionId": body.data.get("exhibitionId", before.get("exhibitionId"))}
    _validate_record(store, kind, data, record_id)
    saved = store.save_record(kind, data, data.get("exhibitionId"))
    _audit(request, auth, action="update", resource_type=kind, resource_id=record_id, before=before, after=saved)
    return saved


@router.delete("/admin/interaction/{resource}/{record_id}")
def delete_interaction(resource: str, record_id: str, request: Request, auth: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    kind = INTERACTION_RESOURCES.get(resource)
    if not kind:
        raise HTTPException(status_code=404, detail="resource not found")
    store = get_store(request)
    _require(store, auth, RESOURCE_PERMISSIONS[kind])
    before = _record(store, kind, record_id) or {}
    if not store.delete_record(kind, record_id):
        raise HTTPException(status_code=404, detail={"code": "RESOURCE_NOT_FOUND", "detail": "资源不存在"})
    _audit(request, auth, action="delete", resource_type=kind, resource_id=record_id, before=before, after=None)
    return {"deleted": True, "id": record_id}


@router.get("/admin/interaction/shopping-strategies/{record_id}/exhibits")
def strategy_exhibits(record_id: str, request: Request, page: int = 1, page_size: int = 9, keyword: str | None = None, exhibitor_id: str | None = None, auth: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    store = get_store(request)
    _require(store, auth, "interact:shopping")
    strategy = _record(store, "interaction_shopping", record_id) or {}
    items = store.list_records("exhibits", exhibition_id=strategy.get("exhibitionId"), keyword=keyword)
    if exhibitor_id:
        items = [item for item in items if item.get("exhibitorId") == exhibitor_id]
    selected = set(store.get_links("interaction_shopping", record_id, "exhibits"))
    return {**_paginate([{**item, "selected": item["id"] in selected} for item in items], page, page_size), "selected_ids": sorted(selected)}


@router.put("/admin/interaction/shopping-strategies/{record_id}/exhibits")
def save_strategy_exhibits(record_id: str, request: Request, body: LinkBody, auth: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    store = get_store(request)
    _require(store, auth, "interact:shopping")
    strategy = _record(store, "interaction_shopping", record_id) or {}
    allowed = {item["id"] for item in store.list_records("exhibits", exhibition_id=strategy.get("exhibitionId"))}
    if not set(body.ids).issubset(allowed):
        raise HTTPException(status_code=400, detail={"code": "RELATION_INVALID", "detail": "选择的展品不属于策略关联展会"})
    before = store.get_links("interaction_shopping", record_id, "exhibits")
    store.set_links("interaction_shopping", record_id, "exhibits", body.ids)
    _audit(request, auth, action="update_links", resource_type="shopping_strategy_exhibits", resource_id=record_id, before=before, after=body.ids)
    return {"strategy_id": record_id, "selected_ids": body.ids}


@router.get("/admin/lead")
def list_leads(request: Request, page: int = 1, page_size: int = 9, exhibition_id: str | None = None, keyword: str | None = None, status_filter: str | None = Query(None, alias="status"), from_date: str = Query("", alias="from"), to_date: str = Query("", alias="to"), auth: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    store = get_store(request)
    _require(store, auth, "lead:view")
    items = store.list_records("leads", exhibition_id=exhibition_id, keyword=keyword, status=status_filter)
    items = [item for item in items if (not from_date or str(item.get("createdAt", ""))[:10] >= from_date) and (not to_date or str(item.get("createdAt", ""))[:10] <= to_date)]
    if "lead:view_sensitive" not in _permission_codes(store, auth["user"]["id"]):
        items = [{**item, "phone": _mask_phone(str(item.get("phone", ""))), "email": _mask_email(str(item.get("email", "")))} for item in items]
    return _paginate(items, page, page_size)


def _mask_phone(value: str) -> str:
    return f"{value[:3]}****{value[-4:]}" if len(value) >= 7 else ("****" if value else "")


def _mask_email(value: str) -> str:
    if "@" not in value:
        return "****" if value else ""
    name, domain = value.split("@", 1)
    return f"{name[:1]}***@{domain}"


@router.post("/admin/lead")
def create_lead(request: Request, body: RecordBody, auth: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    store = get_store(request)
    _require(store, auth, "lead:view")
    _validate_record(store, "leads", body.data)
    saved = store.save_record("leads", {**body.data, "status": body.data.get("status", "new")}, body.data.get("exhibitionId"))
    _audit(request, auth, action="create", resource_type="lead", resource_id=saved["id"], before=None, after=saved)
    return saved


@router.get("/admin/lead/export")
def export_leads(request: Request, exhibition_id: str | None = None, keyword: str | None = None, status_filter: str | None = Query(None, alias="status"), from_date: str = Query("", alias="from"), to_date: str = Query("", alias="to"), auth: dict[str, Any] = Depends(current_user)) -> StreamingResponse:
    store = get_store(request)
    _require(store, auth, "lead:export")
    items = store.list_records("leads", exhibition_id=exhibition_id, keyword=keyword, status=status_filter)
    items = [item for item in items if (not from_date or str(item.get("createdAt", ""))[:10] >= from_date) and (not to_date or str(item.get("createdAt", ""))[:10] <= to_date)]
    sensitive = "lead:view_sensitive" in _permission_codes(store, auth["user"]["id"])
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["线索ID", "展会", "单位名称", "联系人", "手机号", "邮箱", "状态", "创建时间"])
    for item in items:
        writer.writerow([item.get("id", ""), item.get("exhibitionName", item.get("exhibitionId", "")), item.get("companyName", ""), item.get("contactName", ""), item.get("phone", "") if sensitive else _mask_phone(str(item.get("phone", ""))), item.get("email", "") if sensitive else _mask_email(str(item.get("email", ""))), item.get("status", ""), item.get("createdAt", "")])
    return StreamingResponse(iter([output.getvalue().encode("utf-8-sig")]), media_type="text/csv", headers={"Content-Disposition": "attachment; filename=leads.csv"})


@router.get("/admin/lead/{record_id}")
def get_lead(record_id: str, request: Request, auth: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    store = get_store(request)
    _require(store, auth, "lead:view")
    item = _record(store, "leads", record_id) or {}
    if "lead:view_sensitive" not in _permission_codes(store, auth["user"]["id"]):
        item = {**item, "phone": _mask_phone(str(item.get("phone", ""))), "email": _mask_email(str(item.get("email", "")))}
    return item


@router.patch("/admin/lead/{record_id}")
def patch_lead(record_id: str, request: Request, body: RecordBody, auth: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    store = get_store(request)
    _require(store, auth, "lead:view")
    before = _record(store, "leads", record_id) or {}
    saved = store.save_record("leads", {**before, **body.data, "id": record_id}, before.get("exhibitionId"))
    _audit(request, auth, action="update", resource_type="lead", resource_id=record_id, before=before, after=saved)
    return saved


@router.get("/admin/lead/{record_id}/decrypt")
def decrypt_lead(record_id: str, request: Request, auth: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    store = get_store(request)
    _require(store, auth, "lead:view_sensitive")
    return _record(store, "leads", record_id) or {}


@router.post("/admin/lead/{record_id}/status")
def update_lead_status(record_id: str, request: Request, body: StatusBody, auth: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    store = get_store(request)
    _require(store, auth, "lead:view")
    if body.status not in {"new", "contacted", "converted", "invalid"}:
        raise HTTPException(status_code=400, detail={"code": "INVALID_STATUS", "detail": "线索状态无效"})
    before = _record(store, "leads", record_id) or {}
    history = [*before.get("statusHistory", []), {"status": body.status, "operator": auth["user"]["display_name"], "time": utc_now(), "note": body.note}]
    saved = store.save_record("leads", {**before, "status": body.status, "statusHistory": history}, before.get("exhibitionId"))
    _audit(request, auth, action="status", resource_type="lead", resource_id=record_id, before=before, after=saved)
    return saved


@router.get("/admin/feedback")
def list_feedback(request: Request, page: int = 1, page_size: int = 9, exhibition_id: str | None = None, keyword: str | None = None, status_filter: str | None = Query(None, alias="status"), auth: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    store = get_store(request)
    _require(store, auth, "lead:feedback")
    return _paginate(store.list_records("feedback", exhibition_id=exhibition_id, keyword=keyword, status=status_filter), page, page_size)


@router.get("/admin/feedback/{record_id}")
def get_feedback(record_id: str, request: Request, auth: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    store = get_store(request)
    _require(store, auth, "lead:feedback")
    return _record(store, "feedback", record_id) or {}


@router.post("/admin/feedback/{record_id}/resolve")
def resolve_feedback(record_id: str, request: Request, body: RecordBody, auth: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    store = get_store(request)
    _require(store, auth, "lead:feedback")
    before = _record(store, "feedback", record_id) or {}
    saved = store.save_record("feedback", {**before, "status": "handled", "note": body.data.get("note", ""), "handledBy": auth["user"]["display_name"], "handledAt": utc_now()}, before.get("exhibitionId"))
    _audit(request, auth, action="resolve", resource_type="feedback", resource_id=record_id, before=before, after=saved)
    return saved


@router.get("/admin/report")
def report(request: Request, exhibition_id: str | None = None, auth: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    store = get_store(request)
    _require(store, auth, "dashboard:view")
    return {"exhibition_id": exhibition_id or "current", "interaction_count": len(store.list_records("audit")), "online_terminals": len([x for x in store.list_records("terminals") if x.get("status") == "online"]), "pending_knowledge": len([x for x in store.list_records("qa") if x.get("status") == "pending_review"]), "new_leads": len(store.list_records("leads", exhibition_id=exhibition_id, status="new")), "alerts": len([x for x in store.list_records("alerts") if x.get("status") == "open"]), "todo": []}


@router.get("/admin/report/operations")
def operations_report(request: Request, exhibition_id: str | None = None, auth: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    store = get_store(request)
    _require(store, auth, "dashboard:view")
    return {"summary": report(request, exhibition_id, auth), "series": [], "dimensions": {"interaction": [], "hotspot": [], "lead": [], "resource": []}}


@router.get("/admin/report/export")
def export_report(request: Request, exhibition_id: str | None = None, auth: dict[str, Any] = Depends(current_user)) -> StreamingResponse:
    store = get_store(request)
    _require(store, auth, "report:export" if "report:export" in _permission_codes(store, auth["user"]["id"]) else "dashboard:view")
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["指标", "数值", "展会"])
    summary = report(request, exhibition_id, auth)
    for key, value in summary.items():
        if isinstance(value, (str, int, float)):
            writer.writerow([key, value, exhibition_id or "current"])
    return StreamingResponse(iter([output.getvalue().encode("utf-8-sig")]), media_type="text/csv", headers={"Content-Disposition": "attachment; filename=operations-report.csv"})


@router.get("/admin/audit-logs")
def audit_logs(request: Request, page: int = 1, page_size: int = 9, username: str = "", ip: str = "", keyword: str = "", from_date: str = Query("", alias="from"), to_date: str = Query("", alias="to"), auth: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    store = get_store(request)
    _require(store, auth, "system:audit")
    return _paginate(store.audit_list(username=username, ip=ip, keyword=keyword, from_date=from_date, to_date=to_date), page, page_size)


@router.get("/admin/trace-records/{trace_id}")
def trace_record(trace_id: str, request: Request, auth: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    store = get_store(request)
    _require(store, auth, "audit:trace")
    rows = [item for item in store.audit_list() if item["trace_id"] == trace_id]
    if not rows:
        raise HTTPException(status_code=404, detail={"code": "TRACE_NOT_FOUND", "detail": "Trace 不存在"})
    return {"trace_id": trace_id, "logs": rows, "spans": [{"id": row["id"], "service": "api", "operation": f"{row['method']} {row['path']}", "duration_ms": row["duration_ms"], "status": "ok" if row["status_code"] < 400 else "error"} for row in rows]}


@router.get("/admin/audit/trace/{trace_id}")
def audit_trace_alias(trace_id: str, request: Request, auth: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    return trace_record(trace_id, request, auth)


@router.get("/admin/audit-logs/export")
def export_audit_logs(request: Request, auth: dict[str, Any] = Depends(current_user)) -> StreamingResponse:
    store = get_store(request)
    _require(store, auth, "system:audit")
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["Trace ID", "用户名", "IP", "动作", "路径", "状态", "创建时间"])
    for item in store.audit_list():
        writer.writerow([item["trace_id"], item["username"], item["ip"], item["action"], item["path"], item["status_code"], item["created_at"]])
    return StreamingResponse(iter([output.getvalue().encode("utf-8-sig")]), media_type="text/csv", headers={"Content-Disposition": "attachment; filename=audit-logs.csv"})


@router.delete("/admin/audit-logs")
def clear_audit_logs(request: Request, auth: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    store = get_store(request)
    _require(store, auth, "system:audit")
    with store.connect() as conn:
        deleted = conn.execute("DELETE FROM admin_audit_logs").rowcount
    return {"deleted": deleted}


@router.get("/admin/alerts")
def alerts(request: Request, page: int = 1, page_size: int = 9, auth: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    store = get_store(request)
    _require(store, auth, "system:ops")
    return _paginate(store.list_records("alerts"), page, page_size)


@router.get("/admin/users")
def list_users(request: Request, page: int = 1, page_size: int = 9, keyword: str | None = None, status_filter: str | None = Query(None, alias="status"), auth: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    store = get_store(request)
    _require(store, auth, "system:user")
    with store.connect() as conn:
        rows = [dict(row) for row in conn.execute("SELECT * FROM admin_users ORDER BY created_at DESC")]
    needle = (keyword or "").lower()
    items = [_public_user(store, row) for row in rows if (not status_filter or row["status"] == status_filter) and (not needle or needle in f"{row['username']} {row['display_name']} {row['email']}".lower())]
    return _paginate(items, page, page_size)


@router.get("/admin/users/export")
def export_users(request: Request, keyword: str | None = None, status_filter: str | None = Query(None, alias="status"), auth: dict[str, Any] = Depends(current_user)) -> StreamingResponse:
    store = get_store(request)
    _require(store, auth, "system:user")
    needle = (keyword or "").lower()
    with store.connect() as conn:
        rows = [dict(row) for row in conn.execute("SELECT * FROM admin_users ORDER BY created_at DESC")]
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["用户名", "昵称", "邮箱", "部门", "状态", "创建日期"])
    for row in rows:
        if status_filter and row["status"] != status_filter:
            continue
        if needle and needle not in f"{row['username']} {row['display_name']} {row['email']}".lower():
            continue
        writer.writerow([row["username"], row["display_name"], row["email"], row["department"], row["status"], row["created_at"]])
    return StreamingResponse(iter([output.getvalue().encode("utf-8-sig")]), media_type="text/csv", headers={"Content-Disposition": "attachment; filename=users.csv"})


@router.post("/admin/users")
def create_user(request: Request, body: RecordBody, auth: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    store = get_store(request)
    _require(store, auth, "system:user")
    data = body.data
    username = str(data.get("username", "")).strip()
    if not username or not data.get("password"):
        raise HTTPException(status_code=400, detail={"code": "INVALID_USER", "detail": "用户名和密码不能为空"})
    if store.user_by_username(username):
        raise HTTPException(status_code=409, detail={"code": "USERNAME_EXISTS", "detail": "用户名已存在"})
    user_id = str(data.get("id") or f"user-{uuid.uuid4().hex[:12]}")
    now = utc_now()
    with store.connect() as conn:
        conn.execute("INSERT INTO admin_users(id,username,display_name,password_hash,email,phone,gender,department,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)", (user_id, username, str(data.get("displayName", data.get("display_name", username))), password_hasher.hash(str(data["password"])), str(data.get("email", "")), str(data.get("phone", "")), str(data.get("gender", "unknown")), str(data.get("department", "")), str(data.get("status", "active")), now, now))
        for role_code in data.get("roleCodes", data.get("roles", [])):
            role = conn.execute("SELECT id FROM admin_roles WHERE code=?", (role_code,)).fetchone()
            if role:
                conn.execute("INSERT OR IGNORE INTO admin_user_roles(user_id,role_id) VALUES (?,?)", (user_id, role[0]))
    saved = _public_user(store, store.user(user_id) or {})
    _audit(request, auth, action="create", resource_type="user", resource_id=user_id, before=None, after=saved)
    return saved


@router.patch("/admin/users/{user_id}")
def update_user(user_id: str, request: Request, body: RecordBody, auth: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    store = get_store(request)
    _require(store, auth, "system:user")
    before = store.user(user_id)
    if not before:
        raise HTTPException(status_code=404, detail={"code": "RESOURCE_NOT_FOUND", "detail": "用户不存在"})
    data = body.data
    with store.connect() as conn:
        fields = {"display_name": data.get("displayName", data.get("display_name", before["display_name"])), "email": data.get("email", before["email"]), "phone": data.get("phone", before["phone"]), "department": data.get("department", before["department"]), "status": data.get("status", before["status"]), "updated_at": utc_now()}
        if data.get("password"):
            fields["password_hash"] = password_hasher.hash(str(data["password"]))
        conn.execute("UPDATE admin_users SET display_name=?,email=?,phone=?,department=?,status=?,updated_at=?" + (",password_hash=?" if "password_hash" in fields else "") + " WHERE id=?", tuple(fields.values()) + (user_id,))
        if "roles" in data or "roleCodes" in data:
            conn.execute("DELETE FROM admin_user_roles WHERE user_id=?", (user_id,))
            for role_code in data.get("roleCodes", data.get("roles", [])):
                role = conn.execute("SELECT id FROM admin_roles WHERE code=?", (role_code,)).fetchone()
                if role:
                    conn.execute("INSERT INTO admin_user_roles(user_id,role_id) VALUES (?,?)", (user_id, role[0]))
    saved = _public_user(store, store.user(user_id) or {})
    _audit(request, auth, action="update", resource_type="user", resource_id=user_id, before=before, after=saved)
    return saved


@router.delete("/admin/users/{user_id}")
def delete_user(user_id: str, request: Request, auth: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    store = get_store(request)
    _require(store, auth, "system:user")
    if user_id == auth["user"]["id"]:
        raise HTTPException(status_code=400, detail={"code": "SELF_DELETE_FORBIDDEN", "detail": "不能删除当前登录用户"})
    before = store.user(user_id)
    if not before:
        raise HTTPException(status_code=404, detail={"code": "RESOURCE_NOT_FOUND", "detail": "用户不存在"})
    with store.connect() as conn:
        conn.execute("DELETE FROM admin_users WHERE id=?", (user_id,))
    _audit(request, auth, action="delete", resource_type="user", resource_id=user_id, before=before, after=None)
    return {"deleted": True, "id": user_id}


@router.post("/admin/users/{user_id}/reset-password")
def reset_password(user_id: str, request: Request, body: RecordBody, auth: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    store = get_store(request)
    _require(store, auth, "system:user")
    if not store.user(user_id):
        raise HTTPException(status_code=404, detail={"code": "RESOURCE_NOT_FOUND", "detail": "用户不存在"})
    password = str(body.data.get("password", "Admin@123456"))
    with store.connect() as conn:
        conn.execute("UPDATE admin_users SET password_hash=?,updated_at=? WHERE id=?", (password_hasher.hash(password), utc_now(), user_id))
    _audit(request, auth, action="reset_password", resource_type="user", resource_id=user_id, before=None, after={"reset": True})
    return {"success": True}


@router.get("/admin/roles")
def list_roles(request: Request, page: int = 1, page_size: int = 9, auth: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    store = get_store(request)
    _require(store, auth, "system:role")
    with store.connect() as conn:
        roles = [dict(row) for row in conn.execute("SELECT * FROM admin_roles ORDER BY level,id")]
        for role in roles:
            role["permissionIds"] = [row[0] for row in conn.execute("SELECT permission_id FROM admin_role_permissions WHERE role_id=?", (role["id"],))]
    return _paginate(roles, page, page_size)


@router.post("/admin/roles")
def create_role(request: Request, body: RecordBody, auth: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    store = get_store(request)
    _require(store, auth, "system:role")
    data = body.data
    role_id = str(data.get("id") or f"role-{uuid.uuid4().hex[:12]}")
    now = utc_now()
    with store.connect() as conn:
        conn.execute("INSERT INTO admin_roles(id,code,name,description,data_scope,level,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)", (role_id, str(data.get("code", role_id)), str(data.get("name", "新角色")), str(data.get("description", "")), str(data.get("dataScope", "custom")), int(data.get("level", 1)), now, now))
    return next(item for item in list_roles(request, 1, 100, auth)["items"] if item["id"] == role_id)


@router.patch("/admin/roles/{role_id}")
def update_role(role_id: str, request: Request, body: RecordBody, auth: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    store = get_store(request)
    _require(store, auth, "system:role")
    with store.connect() as conn:
        row = conn.execute("SELECT * FROM admin_roles WHERE id=?", (role_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail={"code": "RESOURCE_NOT_FOUND", "detail": "角色不存在"})
        data = body.data
        conn.execute("UPDATE admin_roles SET name=?,description=?,data_scope=?,level=?,updated_at=? WHERE id=?", (data.get("name", row["name"]), data.get("description", row["description"]), data.get("dataScope", row["data_scope"]), data.get("level", row["level"]), utc_now(), role_id))
        if "permissionIds" in data:
            conn.execute("DELETE FROM admin_role_permissions WHERE role_id=?", (role_id,))
            conn.executemany("INSERT OR IGNORE INTO admin_role_permissions(role_id,permission_id) VALUES (?,?)", [(role_id, item) for item in data["permissionIds"]])
    _audit(request, auth, action="update", resource_type="role", resource_id=role_id, before=dict(row), after=body.data)
    return next(item for item in list_roles(request, 1, 100, auth)["items"] if item["id"] == role_id)


@router.delete("/admin/roles/{role_id}")
def delete_role(role_id: str, request: Request, auth: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    store = get_store(request)
    _require(store, auth, "system:role")
    with store.connect() as conn:
        row = conn.execute("SELECT * FROM admin_roles WHERE id=?", (role_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail={"code": "RESOURCE_NOT_FOUND", "detail": "角色不存在"})
        users = conn.execute("SELECT COUNT(*) FROM admin_user_roles WHERE role_id=?", (role_id,)).fetchone()[0]
        if users:
            raise HTTPException(status_code=409, detail={"code": "ROLE_IN_USE", "detail": "角色仍绑定用户，不能删除"})
        conn.execute("DELETE FROM admin_roles WHERE id=?", (role_id,))
    _audit(request, auth, action="delete", resource_type="role", resource_id=role_id, before=dict(row), after=None)
    return {"deleted": True, "id": role_id}


@router.put("/admin/roles/{role_id}/permissions")
def save_role_permissions(role_id: str, request: Request, body: LinkBody, auth: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    store = get_store(request)
    _require(store, auth, "system:role")
    with store.connect() as conn:
        if not conn.execute("SELECT id FROM admin_roles WHERE id=?", (role_id,)).fetchone():
            raise HTTPException(status_code=404, detail={"code": "RESOURCE_NOT_FOUND", "detail": "角色不存在"})
        before = [row[0] for row in conn.execute("SELECT permission_id FROM admin_role_permissions WHERE role_id=?", (role_id,))]
        conn.execute("DELETE FROM admin_role_permissions WHERE role_id=?", (role_id,))
        conn.executemany("INSERT OR IGNORE INTO admin_role_permissions(role_id,permission_id) VALUES (?,?)", [(role_id, item) for item in body.ids])
    _audit(request, auth, action="assign_permissions", resource_type="role", resource_id=role_id, before=before, after=body.ids)
    return {"role_id": role_id, "permission_ids": body.ids}


@router.get("/admin/permission-tree")
def permission_tree(request: Request, auth: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    store = get_store(request)
    _require(store, auth, "system:role")
    with store.connect() as conn:
        items = [dict(row) for row in conn.execute("SELECT * FROM admin_permissions ORDER BY sort_order,id")]
    return {"items": items}


@router.get("/admin/trace-records")
def trace_records(request: Request, page: int = 1, page_size: int = 9, auth: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    return audit_logs(request, page, page_size, username="", ip="", keyword="", from_date="", to_date="", auth=auth)


@router.post("/admin/alerts/{record_id}/acknowledge")
def acknowledge_alert(record_id: str, request: Request, auth: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    store = get_store(request)
    _require(store, auth, "system:ops")
    before = _record(store, "alerts", record_id) or {}
    saved = store.save_record("alerts", {**before, "status": "acknowledged", "acknowledgedBy": auth["user"]["display_name"], "acknowledgedAt": utc_now()})
    _audit(request, auth, action="acknowledge", resource_type="alert", resource_id=record_id, before=before, after=saved)
    return saved


@router.get("/admin/ops/system")
def monitor(request: Request, auth: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    store = get_store(request)
    _require(store, auth, "system:ops")
    item = store.get_record("monitor", "system") or {}
    return {**item, "refreshedAt": utc_now(), "services": store.list_records("services"), "terminals": store.list_records("terminals"), "alerts": store.list_records("alerts")}


@router.get("/admin/ops/services")
def services(request: Request, auth: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    _require(get_store(request), auth, "system:ops")
    return {"items": get_store(request).list_records("services")}


@router.get("/admin/ops/terminals")
def terminals(request: Request, auth: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    _require(get_store(request), auth, "system:ops")
    return {"items": get_store(request).list_records("terminals")}


@router.post("/ops/failover")
def failover(request: Request, body: RecordBody, auth: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    _require(get_store(request), auth, "ops:failover")
    result = {"accepted": True, "mode": "mock", "service": body.data.get("service", ""), "from": body.data.get("from", ""), "to": body.data.get("to", ""), "trace_id": getattr(request.state, "trace_id", "")}
    _audit(request, auth, action="failover", resource_type="service", resource_id=str(body.data.get("service", "")), before=None, after=result)
    return result


@router.get("/exhibitions/{exhibition_id}/digital-human-config")
def public_config(exhibition_id: str, request: Request) -> dict[str, Any]:
    store = get_store(request)
    if exhibition_id == "current":
        current = next((item for item in store.list_records("exhibitions") if item.get("isCurrent")), None)
        if not current:
            raise HTTPException(status_code=404, detail={"code": "CURRENT_EXHIBITION_NOT_FOUND", "detail": "当前展会未配置"})
        exhibition_id = current["id"]
    _record(store, "exhibitions", exhibition_id)
    config = store.get_record("runtime_configs", exhibition_id)
    if not config:
        raise HTTPException(status_code=404, detail={"code": "EXHIBITION_CONFIG_NOT_FOUND", "detail": "当前展会未配置数字人参数"})
    return {"exhibition_id": exhibition_id, "keywords": config.get("keywords", {"navigation": [], "exhibition_content": []}), "supports_deferred_speak": bool(config.get("supports_deferred_speak", False))}


@router.post("/exhibitions/{exhibition_id}/navigation/query")
def navigation(exhibition_id: str, request: Request, body: NavigationBody) -> dict[str, Any]:
    store = get_store(request)
    if exhibition_id == "current":
        current = next((item for item in store.list_records("exhibitions") if item.get("isCurrent")), None)
        if not current:
            raise HTTPException(status_code=404, detail={"code": "CURRENT_EXHIBITION_NOT_FOUND", "detail": "当前展会未配置"})
        exhibition_id = current["id"]
    _record(store, "exhibitions", exhibition_id)
    text = body.text.strip().lower()
    candidates = store.list_records("exhibitors", exhibition_id=exhibition_id) + store.list_records("exhibits", exhibition_id=exhibition_id) + store.list_records("venues", exhibition_id=exhibition_id)
    match = next((item for item in candidates if any(text_part and text_part.lower() in text for text_part in [str(item.get("name", "")), str(item.get("boothCode", "")), str(item.get("category", ""))])), None)
    if not match:
        return {"title": "导航提示", "spoken_text": "暂时没有找到匹配的展位或设施，您可以告诉我更具体的展商、展品或场馆名称。", "subtitle_text": "未找到匹配路线", "route": {"from": "当前位置", "to": "", "directions": [], "estimated_minutes": None}}
    routes = store.list_records("routes", exhibition_id=exhibition_id)
    route = routes[0] if routes else None
    target = match.get("name", "目标位置")
    return {"title": f"前往{target}", "spoken_text": f"正在为您规划前往{target}的路线。", "subtitle_text": f"目的地：{target}", "route": {"from": "当前位置", "to": target, "directions": (route or {}).get("directions", ["请沿现场指引前行"]), "estimated_minutes": (route or {}).get("estimatedMinutes", 5)}}


@router.post("/runtime/lead")
def runtime_lead(request: Request, body: RecordBody) -> dict[str, Any]:
    data = {**body.data, "status": "new"}
    _validate_record(get_store(request), "leads", data)
    saved = get_store(request).save_record("leads", data, data.get("exhibitionId"))
    _audit(request, None, action="create", resource_type="lead", resource_id=saved["id"], before=None, after=saved)
    return saved


@router.post("/runtime/feedback")
def runtime_feedback(request: Request, body: RecordBody) -> dict[str, Any]:
    data = {**body.data, "status": "pending"}
    saved = get_store(request).save_record("feedback", data, data.get("exhibitionId"))
    _audit(request, None, action="create", resource_type="feedback", resource_id=saved["id"], before=None, after=saved)
    return saved


@router.post("/terminal/heartbeat")
def terminal_heartbeat(request: Request, body: RecordBody) -> dict[str, Any]:
    data = {**body.data, "status": "online", "lastHeartbeat": utc_now()}
    saved = get_store(request).save_record("terminals", data, data.get("exhibitionId"))
    _audit(request, None, action="heartbeat", resource_type="terminal", resource_id=saved["id"], before=None, after=saved)
    return saved


# Web 端历史调用路径没有 /api/v1 前缀，保留原调用契约；Admin 端仍使用上面的统一前缀。
public_router.add_api_route("/exhibitions/{exhibition_id}/digital-human-config", public_config, methods=["GET"])
public_router.add_api_route("/exhibitions/{exhibition_id}/navigation/query", navigation, methods=["POST"])
