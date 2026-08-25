from __future__ import annotations

import csv
from difflib import SequenceMatcher
import hashlib
import io
import json
import mimetypes
import re
import secrets
import time
import uuid
from pathlib import Path
from typing import Any, Literal

import httpx
from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Request, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field, model_validator

from .security import current_user, decode_token, get_store, issue_tokens, password_hasher, verify_password
from .monitoring import collect_runtime_monitor
from .store import AdminStore, utc_now
from .event_import import (
    SHEETS,
    create_template,
    extract_package,
    normalized_image_urls,
    parse_workbook,
    public_preview,
)
from apps.api.routes.runtime_config import RuntimeConfigPayload, apply_runtime_config
from opentalking.providers.stt.factory import normalize_stt_provider, stt_provider_config
from opentalking.agent.context_builder import default_knowledge_store
from opentalking.agent.dify_index import DifyKnowledgeError, DifyKnowledgeIndex
from opentalking.scene_assets import SceneAssetStore

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


class EventImportCommitBody(BaseModel):
    batchId: str = Field(min_length=1, max_length=120)


class NavigationBody(BaseModel):
    text: str = Field(min_length=1, max_length=1000)
    session_id: str = Field(min_length=1, max_length=200)
    language: Literal["zh-CN", "en-US"] = "zh-CN"


class ShoppingQueryBody(BaseModel):
    text: str = Field(min_length=1, max_length=1000)
    session_id: str = Field(min_length=1, max_length=200)
    language: Literal["zh-CN", "en-US"] = "zh-CN"


class ShoppingRegistrationBody(BaseModel):
    strategy_id: str = Field(min_length=1, max_length=200)
    session_id: str = Field(min_length=1, max_length=200)
    confirmation_text: str = Field(min_length=1, max_length=1000)
    exhibit_id: str | None = Field(default=None, min_length=1, max_length=200)
    language: Literal["zh-CN", "en-US"] = "zh-CN"


class ExhibitSurveySubmissionBody(BaseModel):
    companyName: str = Field(default="", max_length=200)
    contactName: str = Field(min_length=1, max_length=100)
    phone: str = Field(default="", max_length=50)
    email: str = Field(default="", max_length=200)
    intentSummary: str = Field(default="", max_length=2000)
    consent: bool

    @model_validator(mode="after")
    def validate_contact(self) -> "ExhibitSurveySubmissionBody":
        if not self.phone.strip() and not self.email.strip():
            raise ValueError("手机号和邮箱至少填写一项")
        if not self.consent:
            raise ValueError("请同意线索信息使用说明")
        return self


class LlmConfigBody(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    provider: str = Field(default="openai_compatible", min_length=1, max_length=64)
    base_url: str = Field(min_length=1, max_length=2048, alias="baseUrl")
    model: str = Field(min_length=1, max_length=256)
    api_key: str | None = Field(default=None, max_length=4096, alias="apiKey")
    system_prompt: str = Field(default="", max_length=12000, alias="systemPrompt")

    model_config = {"populate_by_name": True}


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
    request.state.audit_written = True
    started = getattr(request.state, "audit_started", None)
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
        "duration_ms": round((time.perf_counter() - started) * 1000) if started else 0,
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
    _audit(request, {"user": user}, action="login", resource_type="auth", resource_id=user["id"], before=None, after={"success": True})
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


def _public_llm_config(item: dict[str, Any]) -> dict[str, Any]:
    secret = str(item.get("apiKey") or "")
    return {
        "id": str(item.get("id") or ""),
        "name": str(item.get("name") or ""),
        "provider": str(item.get("provider") or "openai_compatible"),
        "baseUrl": str(item.get("baseUrl") or ""),
        "model": str(item.get("model") or ""),
        "apiKey": "",
        "apiKeyConfigured": bool(secret),
        "systemPrompt": str(item.get("systemPrompt") or ""),
        "isActive": bool(item.get("isActive")),
        "usage": str(item.get("usage") or "conversation"),
        "source": str(item.get("source") or "managed"),
        "readOnly": bool(item.get("readOnly")),
        "createdAt": str(item.get("createdAt") or ""),
        "updatedAt": str(item.get("updatedAt") or ""),
    }


def _setting_text(settings: Any, name: str, default: str = "") -> str:
    return str(getattr(settings, name, default) or default).strip()


def _configured_llm_configs(request: Request) -> list[dict[str, Any]]:
    settings = getattr(request.app.state, "settings", None)
    if settings is None:
        return []

    provider = _setting_text(settings, "llm_provider", "openai_compatible")
    base_url = _setting_text(settings, "llm_base_url").rstrip("/")
    api_key = _setting_text(settings, "llm_api_key")
    model = _setting_text(settings, "llm_model")
    system_prompt = _setting_text(settings, "llm_system_prompt")
    items: list[dict[str, Any]] = []

    if base_url or api_key or model:
        items.append({
            "id": "configured-conversation-llm",
            "name": "主对话大模型",
            "provider": provider,
            "baseUrl": base_url,
            "model": model,
            "apiKey": api_key,
            "systemPrompt": system_prompt,
            "isActive": True,
            "usage": "conversation",
            "source": "config",
            "readOnly": True,
            "createdAt": "",
            "updatedAt": "",
        })

    knowledge_base_url = _setting_text(settings, "agent_lightrag_llm_base_url").rstrip("/") or base_url
    knowledge_api_key = _setting_text(settings, "agent_lightrag_llm_api_key") or api_key
    knowledge_model = _setting_text(settings, "agent_lightrag_llm_model") or model
    if knowledge_base_url or knowledge_api_key or knowledge_model:
        inherited = not any(
            _setting_text(settings, name)
            for name in ("agent_lightrag_llm_base_url", "agent_lightrag_llm_api_key", "agent_lightrag_llm_model")
        )
        items.append({
            "id": "configured-knowledge-llm",
            "name": "LightRAG 知识检索模型" + ("（继承主配置）" if inherited else ""),
            "provider": provider,
            "baseUrl": knowledge_base_url,
            "model": knowledge_model,
            "apiKey": knowledge_api_key,
            "systemPrompt": "",
            "isActive": True,
            "usage": "knowledge",
            "source": "config",
            "readOnly": True,
            "createdAt": "",
            "updatedAt": "",
        })

    memory_base_url = _setting_text(settings, "memory_mem0_llm_base_url").rstrip("/")
    memory_api_key = _setting_text(settings, "memory_mem0_llm_api_key")
    memory_model = _setting_text(settings, "memory_mem0_llm_model")
    memory_enabled = bool(getattr(settings, "memory_enabled", False))
    if memory_enabled or memory_base_url or memory_api_key:
        items.append({
            "id": "configured-memory-llm",
            "name": "Mem0 记忆模型",
            "provider": _setting_text(settings, "memory_mem0_llm_provider", "openai"),
            "baseUrl": memory_base_url,
            "model": memory_model,
            "apiKey": memory_api_key,
            "systemPrompt": "",
            "isActive": memory_enabled,
            "usage": "memory",
            "source": "config",
            "readOnly": True,
            "createdAt": "",
            "updatedAt": "",
        })

    return items


def _llm_signature(item: dict[str, Any]) -> tuple[str, str, str]:
    return (
        str(item.get("provider") or "").strip().lower(),
        str(item.get("baseUrl") or "").strip().rstrip("/").lower(),
        str(item.get("model") or "").strip().lower(),
    )


def _llm_usage(item: dict[str, Any]) -> str:
    return str(item.get("usage") or "conversation").strip().lower() or "conversation"


def _resolve_llm_config(request: Request, record_id: str) -> dict[str, Any] | None:
    stored = get_store(request).get_record("llm_configs", record_id)
    if stored is not None:
        return stored
    return next((item for item in _configured_llm_configs(request) if item["id"] == record_id), None)


def _normalized_llm_config(body: LlmConfigBody, *, existing: dict[str, Any] | None = None) -> dict[str, Any]:
    current = existing or {}
    provided_key = (body.api_key or "").strip()
    return {
        **current,
        "name": body.name.strip(),
        "provider": body.provider.strip().lower(),
        "baseUrl": body.base_url.strip().rstrip("/"),
        "model": body.model.strip(),
        "apiKey": provided_key or str(current.get("apiKey") or ""),
        "systemPrompt": body.system_prompt.strip(),
    }


async def _apply_llm_config(request: Request, item: dict[str, Any]) -> dict[str, Any]:
    api_key = str(item.get("apiKey") or "").strip()
    if not api_key:
        raise HTTPException(status_code=400, detail={"code": "LLM_API_KEY_REQUIRED", "detail": "启用前必须配置 API Key"})
    return await apply_runtime_config(
        RuntimeConfigPayload(
            llm_base_url=str(item.get("baseUrl") or ""),
            llm_model=str(item.get("model") or ""),
            llm_api_key=api_key,
            llm_system_prompt=str(item.get("systemPrompt") or ""),
            sync_dashscope_api_key=False,
        ),
        request,
    )


@router.get("/admin/llm-configs")
def list_llm_configs(request: Request, auth: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    store = get_store(request)
    _require(store, auth, "system:llm")
    configured = _configured_llm_configs(request)
    configured_conversation = next((item for item in configured if _llm_usage(item) == "conversation"), None)
    managed = store.list_records("llm_configs")
    if configured_conversation is not None:
        current_signature = _llm_signature(configured_conversation)
        matching_managed = next(
            (
                item
                for item in managed
                if _llm_usage(item) == "conversation" and _llm_signature(item) == current_signature
            ),
            None,
        )
        if matching_managed is not None:
            configured = [item for item in configured if _llm_usage(item) != "conversation"]
            managed = [
                {**item, "isActive": str(item.get("id")) == str(matching_managed.get("id"))}
                for item in managed
            ]
        else:
            managed = [{**item, "isActive": False} for item in managed]
    managed = sorted(managed, key=lambda item: (not bool(item.get("isActive")), str(item.get("updatedAt") or "")), reverse=False)
    # A managed record can itself have been saved more than once with the same
    # provider/base URL/model. Keep the active/newest record and never expose
    # duplicate logical configurations to the admin UI.
    items: list[dict[str, Any]] = []
    seen: set[tuple[str, str, str, str]] = set()
    for item in [*configured, *managed]:
        key = (_llm_usage(item), *_llm_signature(item))
        if key in seen:
            continue
        seen.add(key)
        items.append(item)
    return {"items": [_public_llm_config(item) for item in items], "total": len(items)}


@router.post("/admin/llm-configs")
def create_llm_config(body: LlmConfigBody, request: Request, auth: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    store = get_store(request)
    _require(store, auth, "system:llm:write")
    now = utc_now()
    record_id = f"llm-{uuid.uuid4().hex[:12]}"
    item = {**_normalized_llm_config(body), "id": record_id, "isActive": False, "createdAt": now, "updatedAt": now}
    saved = store.save_record("llm_configs", item)
    _audit(request, auth, action="create", resource_type="llm_config", resource_id=record_id, before=None, after=_public_llm_config(saved))
    return _public_llm_config(saved)


@router.patch("/admin/llm-configs/{record_id}")
async def update_llm_config(record_id: str, body: LlmConfigBody, request: Request, auth: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    store = get_store(request)
    _require(store, auth, "system:llm:write")
    before = _record(store, "llm_configs", record_id) or {}
    prospective = {**_normalized_llm_config(body, existing=before), "id": record_id, "updatedAt": utc_now()}
    if prospective.get("isActive"):
        await _apply_llm_config(request, prospective)
    saved = store.save_record("llm_configs", prospective)
    _audit(request, auth, action="update", resource_type="llm_config", resource_id=record_id, before=_public_llm_config(before), after=_public_llm_config(saved))
    return _public_llm_config(saved)


@router.delete("/admin/llm-configs/{record_id}")
def delete_llm_config(record_id: str, request: Request, auth: dict[str, Any] = Depends(current_user)) -> dict[str, bool]:
    store = get_store(request)
    _require(store, auth, "system:llm:write")
    before = _record(store, "llm_configs", record_id) or {}
    if before.get("isActive"):
        raise HTTPException(status_code=409, detail={"code": "ACTIVE_LLM_CONFIG", "detail": "当前使用中的配置不能删除，请先启用其他配置"})
    store.delete_record("llm_configs", record_id)
    _audit(request, auth, action="delete", resource_type="llm_config", resource_id=record_id, before=_public_llm_config(before), after=None)
    return {"success": True}


@router.post("/admin/llm-configs/{record_id}/activate")
async def activate_llm_config(record_id: str, request: Request, auth: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    store = get_store(request)
    _require(store, auth, "system:llm:write")
    target = _record(store, "llm_configs", record_id) or {}
    runtime = await _apply_llm_config(request, target)
    now = utc_now()
    for item in store.list_records("llm_configs"):
        is_active = str(item.get("id")) == record_id
        if bool(item.get("isActive")) != is_active:
            store.save_record("llm_configs", {**item, "isActive": is_active, "updatedAt": now})
    saved = _record(store, "llm_configs", record_id) or target
    _audit(request, auth, action="activate", resource_type="llm_config", resource_id=record_id, before=None, after={**_public_llm_config(saved), "runtime": {"liveRunnersRefreshed": runtime.get("live_runners_refreshed", 0)}})
    return {**_public_llm_config(saved), "liveRunnersRefreshed": runtime.get("live_runners_refreshed", 0)}


@router.post("/admin/llm-configs/{record_id}/test")
async def test_llm_config(record_id: str, request: Request, auth: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    store = get_store(request)
    _require(store, auth, "system:llm")
    item = _resolve_llm_config(request, record_id) or {}
    if not item:
        raise HTTPException(status_code=404, detail={"code": "RESOURCE_NOT_FOUND", "detail": "大模型配置不存在"})
    api_key = str(item.get("apiKey") or "").strip()
    if not api_key:
        raise HTTPException(status_code=400, detail={"code": "LLM_API_KEY_REQUIRED", "detail": "请先保存 API Key"})
    url = f"{str(item.get('baseUrl') or '').rstrip('/')}/chat/completions"
    started = time.perf_counter()
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(12.0, connect=5.0)) as client:
            response = await client.post(
                url,
                headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
                json={"model": item.get("model"), "messages": [{"role": "user", "content": "请只回复 OK"}], "max_tokens": 4, "temperature": 0},
            )
            response.raise_for_status()
    except httpx.HTTPStatusError as exc:
        raise HTTPException(status_code=502, detail={"code": "LLM_TEST_FAILED", "detail": "模型服务暂时不可用，请稍后重试"}) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail={"code": "LLM_TEST_FAILED", "detail": "模型服务暂时不可用，请稍后重试"}) from exc
    latency_ms = round((time.perf_counter() - started) * 1000)
    _audit(request, auth, action="test", resource_type="llm_config", resource_id=record_id, before=None, after={"success": True, "latencyMs": latency_ms})
    return {"success": True, "latencyMs": latency_ms, "message": "连接成功"}

EVENT_IMAGE_RESOURCES = {"exhibitors", "exhibits", "venues", "points", "routes"}

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


QA_TRANSITIONS = {
    "draft": {"pending_review"},
    "pending_review": {"published", "draft"},
    "published": {"archived"},
    "archived": {"draft"},
}
PACKAGE_TRANSITIONS = {
    "draft": {"pending_review"},
    "pending_review": {"published", "draft"},
    "published": {"rolled_back"},
    "rolled_back": {"draft"},
}


def _operator_name(auth: dict[str, Any]) -> str:
    user = auth.get("user") if isinstance(auth, dict) else None
    if not isinstance(user, dict):
        return "系统管理员"
    return str(user.get("display_name") or user.get("username") or "系统管理员")


def _resolve_knowledge_exhibition(
    store: AdminStore,
    data: dict[str, Any],
) -> tuple[str, str]:
    exhibition_id = str(
        data.get("exhibitionId") or data.get("exhibition_id") or ""
    ).strip()
    display_value = str(
        data.get("exhibition") or data.get("exhibitionName") or ""
    ).strip()
    exhibitions = store.list_records("exhibitions")
    if not exhibition_id and display_value:
        matched = next(
            (
                item
                for item in exhibitions
                if display_value
                in {
                    str(item.get("id") or "").strip(),
                    str(item.get("name") or "").strip(),
                    str(item.get("code") or "").strip(),
                }
            ),
            None,
        )
        exhibition_id = str((matched or {}).get("id") or "").strip()
    exhibition = next(
        (
            item
            for item in exhibitions
            if str(item.get("id") or "").strip() == exhibition_id
        ),
        None,
    )
    if exhibition is None:
        raise HTTPException(
            status_code=422,
            detail={
                "code": "EXHIBITION_REQUIRED",
                "detail": "请选择有效的所属展会",
            },
        )
    exhibition_name = str(exhibition.get("name") or exhibition_id).strip()
    data["exhibitionId"] = exhibition_id
    data["exhibition"] = exhibition_name
    return exhibition_id, exhibition_name


def _normalize_keyword_list(value: Any) -> list[str]:
    if isinstance(value, str):
        values = re.split(r"[,，、\n]", value)
    elif isinstance(value, list):
        values = value
    else:
        values = []
    return list(
        dict.fromkeys(str(item or "").strip() for item in values if str(item or "").strip())
    )


def _qa_history_entry(
    data: dict[str, Any],
    *,
    operator: str,
    reason: str,
) -> dict[str, Any]:
    return {
        "version": int(data.get("version") or 1),
        "answer": str(data.get("answer") or ""),
        "editor": operator,
        "time": utc_now(),
        "reason": reason,
    }


def _prepare_qa_record(
    store: AdminStore,
    data: dict[str, Any],
    *,
    before: dict[str, Any] | None,
    operator: str,
) -> dict[str, Any]:
    exhibition_id, _ = _resolve_knowledge_exhibition(store, data)
    question = str(data.get("question") or "").strip()
    answer = str(data.get("answer") or "").strip()
    if not question or not answer:
        raise HTTPException(
            status_code=422,
            detail={"code": "QA_CONTENT_REQUIRED", "detail": "问题和官方答案不能为空"},
        )
    data["question"] = question
    data["answer"] = answer
    data["keywords"] = _normalize_keyword_list(data.get("keywords"))
    data["category"] = str(data.get("category") or "未分类").strip() or "未分类"
    data["exhibitionId"] = exhibition_id
    requested_status = str(data.get("status") or "draft").strip().lower()
    if requested_status not in {"draft", "pending_review", "published", "archived"}:
        raise HTTPException(
            status_code=422,
            detail={"code": "QA_STATUS_INVALID", "detail": "问答状态不合法"},
        )
    if before is None:
        data["status"] = "draft"
        data["version"] = 1
        data["creator"] = str(data.get("creator") or operator)
        data["history"] = [
            _qa_history_entry(data, operator=operator, reason="创建")
        ]
        return data

    old_status = str(before.get("status") or "draft").strip().lower()
    content_changed = any(
        data.get(field) != before.get(field)
        for field in ("question", "answer", "keywords", "category", "exhibitionId")
    )
    status_changed = requested_status != old_status
    if status_changed and requested_status not in QA_TRANSITIONS.get(old_status, set()):
        raise HTTPException(
            status_code=409,
            detail={
                "code": "QA_INVALID_TRANSITION",
                "detail": f"不允许从 {old_status} 流转到 {requested_status}",
            },
        )
    data["version"] = max(1, int(before.get("version") or 1))
    history = list(before.get("history") or [])
    if content_changed:
        data["version"] += 1
        if not status_changed and old_status in {"pending_review", "published", "archived"}:
            requested_status = "draft"
        history.append(_qa_history_entry(data, operator=operator, reason="编辑"))
    if status_changed:
        history.append(
            _qa_history_entry(
                data,
                operator=operator,
                reason={
                    "pending_review": "提交审核",
                    "published": "审核发布",
                    "archived": "归档",
                    "draft": "退回草稿",
                }[requested_status],
            )
        )
    data["status"] = requested_status
    data["history"] = history
    data["creator"] = str(before.get("creator") or data.get("creator") or operator)
    if requested_status == "published":
        data["reviewer"] = operator
    return data


def _prepare_script_record(
    store: AdminStore,
    data: dict[str, Any],
    *,
    operator: str,
) -> dict[str, Any]:
    exhibition_id, _ = _resolve_knowledge_exhibition(store, data)
    name = str(data.get("name") or "").strip()
    content = str(data.get("content") or "").strip()
    scene = str(data.get("scene") or "welcome").strip().lower()
    status = str(data.get("status") or "active").strip().lower()
    if not name or not content:
        raise HTTPException(
            status_code=422,
            detail={"code": "SCRIPT_CONTENT_REQUIRED", "detail": "话术名称和内容不能为空"},
        )
    if scene not in {"welcome", "explain", "shopping", "emergency"}:
        raise HTTPException(
            status_code=422,
            detail={"code": "SCRIPT_SCENE_INVALID", "detail": "话术场景不合法"},
        )
    if status not in {"active", "inactive"}:
        raise HTTPException(
            status_code=422,
            detail={"code": "SCRIPT_STATUS_INVALID", "detail": "话术状态不合法"},
        )
    data.update(
        {
            "name": name,
            "content": content,
            "scene": scene,
            "status": status,
            "exhibitionId": exhibition_id,
            "creator": str(data.get("creator") or operator),
        }
    )
    return data


def _prepare_package_record(
    store: AdminStore,
    data: dict[str, Any],
    *,
    before: dict[str, Any] | None,
    operator: str,
) -> dict[str, Any]:
    exhibition_id, _ = _resolve_knowledge_exhibition(store, data)
    name = str(data.get("name") or "").strip()
    if not name:
        raise HTTPException(
            status_code=422,
            detail={"code": "PACKAGE_NAME_REQUIRED", "detail": "发布包名称不能为空"},
        )
    requested_status = str(data.get("status") or "draft").strip().lower()
    if requested_status not in {"draft", "pending_review", "published", "rolled_back"}:
        raise HTTPException(
            status_code=422,
            detail={"code": "PACKAGE_STATUS_INVALID", "detail": "发布包状态不合法"},
        )
    if before is None:
        published_qa = store.list_records(
            "qa", exhibition_id=exhibition_id, status="published"
        )
        published_documents = [
            item
            for item in store.list_records("documents", exhibition_id=exhibition_id)
            if str(item.get("status") or "published").lower()
            in {"published", "ready", "active"}
        ]
        exhibition = store.get_record("exhibitions", exhibition_id) or {}
        existing_versions = [
            int(item.get("version") or 0)
            for item in store.list_records("packages", exhibition_id=exhibition_id)
        ]
        data.update(
            {
                "status": "draft",
                "version": max(existing_versions, default=0) + 1,
                "qaCount": len(published_qa),
                "documentCount": len(published_documents),
                "qaIds": [str(item.get("id") or "") for item in published_qa],
                "documentIds": [
                    str(item.get("id") or "") for item in published_documents
                ],
                "knowledgeBaseIds": list(exhibition.get("knowledgeBaseIds") or []),
                "snapshotAt": utc_now(),
                "creator": operator,
            }
        )
        return data

    old_status = str(before.get("status") or "draft").strip().lower()
    if requested_status != old_status and requested_status not in PACKAGE_TRANSITIONS.get(
        old_status, set()
    ):
        raise HTTPException(
            status_code=409,
            detail={
                "code": "PACKAGE_INVALID_TRANSITION",
                "detail": f"不允许从 {old_status} 流转到 {requested_status}",
            },
        )
    data["status"] = requested_status
    data["exhibitionId"] = exhibition_id
    if requested_status == "published" and requested_status != old_status:
        for item in store.list_records("packages", exhibition_id=exhibition_id):
            if item.get("id") != before.get("id") and item.get("status") == "published":
                store.save_record(
                    "packages",
                    {**item, "status": "rolled_back", "rollbackReason": "由新发布包替换"},
                    exhibition_id,
                )
        data["reviewer"] = operator
        data["publishedAt"] = utc_now()
    if requested_status == "rolled_back" and requested_status != old_status:
        data["rolledBackBy"] = operator
        data["rolledBackAt"] = utc_now()
    return data


def _prepare_knowledge_record(
    store: AdminStore,
    auth: dict[str, Any],
    kind: str,
    data: dict[str, Any],
    *,
    before: dict[str, Any] | None,
) -> dict[str, Any]:
    operator = _operator_name(auth)
    if kind == "qa":
        return _prepare_qa_record(
            store,
            data,
            before=before,
            operator=operator,
        )
    if kind == "scripts":
        return _prepare_script_record(store, data, operator=operator)
    if kind == "packages":
        return _prepare_package_record(
            store,
            data,
            before=before,
            operator=operator,
        )
    return data


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
    data = dict(body.data)
    if kind in {"qa", "scripts", "packages"}:
        data = _prepare_knowledge_record(
            store,
            auth,
            kind,
            data,
            before=None,
        )
    elif kind in {"documents", "knowledge_bases", "miss_pool"} and data.get("exhibitionId"):
        _validate_record(store, "knowledge_bases" if kind == "documents" else kind, data)
    saved = store.save_record(kind, data, data.get("exhibitionId"))
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


@router.post("/admin/event/images/upload")
async def upload_event_images(
    request: Request,
    resource: str = Form(...),
    files: list[UploadFile] = File(...),
    auth: dict[str, Any] = Depends(current_user),
) -> dict[str, Any]:
    if resource not in EVENT_IMAGE_RESOURCES:
        raise HTTPException(status_code=400, detail={"code": "UNSUPPORTED_RESOURCE", "detail": "不支持该展会图片资源类型"})
    store = get_store(request)
    _require(store, auth, RESOURCE_PERMISSIONS[resource])
    if not files:
        raise HTTPException(status_code=400, detail={"code": "FILES_REQUIRED", "detail": "至少选择一张图片"})
    if len(files) > 20:
        raise HTTPException(status_code=400, detail={"code": "TOO_MANY_FILES", "detail": "一次最多上传 20 张图片"})
    settings = getattr(request.app.state, "settings", None)
    service_store = SceneAssetStore(Path(getattr(settings, "scene_assets_dir", "./data/scene-assets")), seed_defaults=True)
    allowed_extensions = {".jpg", ".jpeg", ".png", ".webp", ".gif", ".svg"}
    uploaded: list[dict[str, Any]] = []
    for file in files:
        content_type = (file.content_type or "").lower()
        extension = Path(file.filename or "image.jpg").suffix.lower()
        if not content_type.startswith("image/") or extension not in allowed_extensions:
            raise HTTPException(status_code=400, detail={"code": "UNSUPPORTED_FILE", "detail": "仅支持 JPG、PNG、WebP、GIF 或 SVG 图片"})
        content = await file.read()
        if not content:
            raise HTTPException(status_code=400, detail={"code": "EMPTY_FILE", "detail": "不能上传空文件"})
        if len(content) > 10 * 1024 * 1024:
            raise HTTPException(status_code=413, detail={"code": "FILE_TOO_LARGE", "detail": "单张图片不能超过 10MB"})
        try:
            saved = service_store.create_file(
                content=content,
                filename=file.filename or "image",
                mime_type=content_type,
                name=Path(file.filename or "image").stem,
                category=f"event:{resource}",
            )
        except ValueError as exc:
            raise HTTPException(status_code=400, detail={"code": "UNSUPPORTED_FILE", "detail": "文件格式不受支持，请上传平台要求的文件类型"}) from exc
        uploaded.append(saved)
    _audit(request, auth, action="upload", resource_type="service_file", resource_id=str(uploaded[0]["id"]), before=None, after={"resource": resource, "items": uploaded})
    return {"urls": [item["url"] for item in uploaded], "items": uploaded}


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
    if not before:
        raise HTTPException(
            status_code=404,
            detail={"code": "RESOURCE_NOT_FOUND", "detail": "资源不存在"},
        )
    data = {**before, **body.data, "id": record_id}
    if kind in {"qa", "scripts", "packages"}:
        data = _prepare_knowledge_record(
            store,
            auth,
            kind,
            data,
            before=before,
        )
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
    if kind == "gifs":
        settings = getattr(request.app.state, "settings", None)
        root = Path(getattr(settings, "admin_media_root", "./data/admin-assets")) / "gifs"
        for match in root.glob(f"{record_id}.*"):
            match.unlink(missing_ok=True)
    _audit(request, auth, action="delete", resource_type=kind, resource_id=record_id, before=before, after=None)
    return {"deleted": True, "id": record_id}


def _event_exhibition_id(item: dict[str, Any] | None) -> str | None:
    return (item or {}).get("exhibitionId") or (item or {}).get("exhibition_id")


def _knowledge_base_ids(item: dict[str, Any] | None) -> list[str]:
    raw = (item or {}).get("knowledgeBaseIds", (item or {}).get("knowledge_base_ids", []))
    if raw is None:
        return []
    if not isinstance(raw, list):
        raise HTTPException(
            status_code=422,
            detail={"code": "KNOWLEDGE_BASE_IDS_INVALID", "detail": "knowledgeBaseIds 必须是数组"},
        )
    result: list[str] = []
    seen: set[str] = set()
    for value in raw:
        knowledge_base_id = str(value or "").strip()
        if knowledge_base_id and knowledge_base_id not in seen:
            result.append(knowledge_base_id)
            seen.add(knowledge_base_id)
    return result


def _sync_exhibition_knowledge_bases(
    exhibition_id: str,
    data: dict[str, Any],
    before: dict[str, Any] | None = None,
) -> None:
    selected_ids = _knowledge_base_ids(data)
    data["knowledgeBaseIds"] = selected_ids
    index = default_knowledge_store().knowledge_index
    if not isinstance(index, DifyKnowledgeIndex):
        return
    try:
        index.sync_exhibition_bindings(
            exhibition_id=exhibition_id,
            knowledge_base_ids=selected_ids,
            previous_knowledge_base_ids=_knowledge_base_ids(before),
        )
    except DifyKnowledgeError as exc:
        raise HTTPException(
            status_code=exc.status_code,
            detail={"code": exc.code, "detail": str(exc)},
        ) from exc
    except ValueError as exc:
        raise HTTPException(
            status_code=422,
            detail={"code": "KNOWLEDGE_BASE_BINDING_INVALID", "detail": str(exc)},
        ) from exc


def _welcome_wake_words(data: dict[str, Any]) -> list[str]:
    raw = data.get("wakeWords", data.get("wake_words", []))
    if isinstance(raw, str):
        values = re.split(r"[,，、\n]", raw)
    elif isinstance(raw, list):
        values = [str(value) for value in raw]
    else:
        values = []
    if not values:
        triggers = data.get("triggers", data.get("trigger", []))
        if not isinstance(triggers, list):
            triggers = [triggers]
        for trigger in triggers:
            matched = re.match(r"^唤醒词[：:]\s*(.+)$", str(trigger or ""))
            if matched:
                values.extend(re.split(r"[,，、\n]", matched.group(1)))
    return list(dict.fromkeys(value.strip() for value in values if value.strip()))


def _welcome_triggers(data: dict[str, Any]) -> list[str]:
    raw = data.get("triggers", data.get("trigger", []))
    values = raw if isinstance(raw, list) else [raw]
    aliases = {"terminal_start": "终端启动", "user_nearby": "用户靠近", "wake_word": "唤醒词"}
    normalized = ["唤醒词" if str(value).startswith("唤醒词") else aliases.get(str(value), str(value)) for value in values if str(value or "")]
    return list(dict.fromkeys(normalized))


def _welcome_active_seconds(data: dict[str, Any]) -> int:
    try:
        seconds = int(data.get("wakeActiveSeconds", data.get("wake_active_seconds", 30)))
    except (TypeError, ValueError):
        return 30
    return seconds if 10 <= seconds <= 600 else 30


def _auto_route_directions(store: AdminStore, points: list[dict[str, Any]]) -> list[str]:
    directions: list[str] = []
    for start, destination in zip(points, points[1:]):
        start_name = str(start.get("name") or start.get("code") or "起点").strip()
        destination_name = str(destination.get("name") or destination.get("code") or "下一点位").strip()
        start_venue_id = str(start.get("venueId") or "")
        destination_venue_id = str(destination.get("venueId") or "")
        if start_venue_id != destination_venue_id:
            start_venue = store.get_record("venues", start_venue_id) or {}
            destination_venue = store.get_record("venues", destination_venue_id) or {}
            start_venue_name = str(start_venue.get("name") or "当前场馆").strip()
            destination_venue_name = str(destination_venue.get("name") or "目标场馆").strip()
            directions.append(f"从{start_venue_name}的{start_name}出发，离馆后前往{destination_venue_name}的{destination_name}。")
            continue
        start_floor = str(start.get("floor") or "").strip()
        destination_floor = str(destination.get("floor") or "").strip()
        if start_floor and destination_floor and start_floor != destination_floor:
            directions.append(f"从{start_name}出发，由{start_floor}前往{destination_floor}的{destination_name}。")
        else:
            directions.append(f"从{start_name}出发，前往{destination_name}。")
    return directions


def _validate_record(store: AdminStore, kind: str, data: dict[str, Any], record_id: str | None = None) -> None:
    if kind == "routes" and not _event_exhibition_id(data):
        point_ids = data.get("pointIds", [])
        first_point = store.get_record("points", str(point_ids[0])) if isinstance(point_ids, list) and point_ids else None
        venue = store.get_record("venues", str((first_point or {}).get("venueId") or data.get("venueId") or data.get("venue_id") or ""))
        if venue:
            data["exhibitionId"] = _event_exhibition_id(venue)
    if kind == "points" and not _event_exhibition_id(data):
        venue = store.get_record("venues", str(data.get("venueId") or data.get("venue_id") or ""))
        if venue:
            data["exhibitionId"] = _event_exhibition_id(venue)
    exhibition_id = _event_exhibition_id(data)
    if kind != "exhibitions" and exhibition_id and not store.get_record("exhibitions", exhibition_id):
        raise HTTPException(status_code=400, detail={"code": "EXHIBITION_NOT_FOUND", "detail": "所属展会不存在"})
    if kind == "venues":
        pass
    if kind == "points":
        venue = _record(store, "venues", str(data.get("venueId")))
        if _event_exhibition_id(venue) != exhibition_id:
            raise HTTPException(status_code=400, detail={"code": "RELATION_INVALID", "detail": "点位场地不属于当前展会"})
    if kind == "routes":
        points = [store.get_record("points", str(point_id)) for point_id in data.get("pointIds", [])]
        if len(points) < 2 or any(not point or _event_exhibition_id(point) != exhibition_id for point in points):
            raise HTTPException(status_code=400, detail={"code": "RELATION_INVALID", "detail": "路线至少需要两个属于同一展会的有效点位"})
        route_points = [point for point in points if point]
        data["venueId"] = str(route_points[0].get("venueId") or "")
        for field in ("keywords", "aliases", "imageUrls"):
            raw_values = data.get(field, [])
            if isinstance(raw_values, str):
                raw_values = re.split(r"[,，、\n]", raw_values)
            if not isinstance(raw_values, list):
                raise HTTPException(status_code=400, detail={"code": "ROUTE_CONFIG_INVALID", "detail": f"{field} 必须是数组"})
            data[field] = list(dict.fromkeys(str(value).strip() for value in raw_values if str(value).strip()))
        raw_directions = data.get("directions", [])
        if isinstance(raw_directions, str):
            raw_directions = raw_directions.splitlines()
        if not isinstance(raw_directions, list):
            raise HTTPException(status_code=400, detail={"code": "ROUTE_CONFIG_INVALID", "detail": "directions 必须是数组"})
        data["directions"] = [str(value).strip() for value in raw_directions if str(value).strip()]
        if not data["directions"]:
            data["directions"] = _auto_route_directions(store, route_points)
        if len(data["keywords"]) > 30 or len(data["aliases"]) > 30:
            raise HTTPException(status_code=400, detail={"code": "ROUTE_KEYWORD_LIMIT", "detail": "路线关键词和别名分别最多配置 30 个"})
        if any(len(value) > 100 for value in [*data["keywords"], *data["aliases"]]):
            raise HTTPException(status_code=400, detail={"code": "ROUTE_KEYWORD_INVALID", "detail": "单个路线关键词或别名不能超过 100 个字符"})
        data["spokenText"] = str(data.get("spokenText") or data.get("spoken_text") or "").strip()[:4000]
        data["fuzzyMatch"] = bool(data.get("fuzzyMatch", data.get("fuzzy_match", True)))
    if kind == "exhibits":
        exhibitor = _record(store, "exhibitors", str(data.get("exhibitorId")))
        if _event_exhibition_id(exhibitor) != exhibition_id:
            raise HTTPException(status_code=400, detail={"code": "RELATION_INVALID", "detail": "展品与展商必须属于同一展会"})
    if kind in {"venues", "points", "exhibitors", "exhibits"}:
        for field in ("introductionKeywords", "aliases"):
            raw_values = data.get(field, [])
            if isinstance(raw_values, str):
                raw_values = re.split(r"[,，、\n]", raw_values)
            if not isinstance(raw_values, list):
                raise HTTPException(status_code=400, detail={"code": "INTRODUCTION_CONFIG_INVALID", "detail": f"{field} 必须是数组"})
            data[field] = list(dict.fromkeys(str(value).strip() for value in raw_values if str(value).strip()))
        if len(data["introductionKeywords"]) > 30 or len(data["aliases"]) > 30:
            raise HTTPException(status_code=400, detail={"code": "INTRODUCTION_KEYWORD_LIMIT", "detail": "介绍关键词和别名分别最多配置 30 个"})
        data["spokenText"] = str(data.get("spokenText") or data.get("spoken_text") or "").strip()[:4000]
        data["fuzzyMatch"] = bool(data.get("fuzzyMatch", data.get("fuzzy_match", True)))
    if kind == "interaction_shopping":
        defaults = {
            "tags": [],
            "aliases": [],
            "confirmKeywords": ["需要", "好的", "可以", "同意", "登记", "我要登记"],
            "declineKeywords": ["不需要", "不用", "不要", "暂不", "取消", "不登记"],
        }
        for field, fallback in defaults.items():
            raw_values = data.get(field, data.get(re.sub(r"(?<!^)(?=[A-Z])", "_", field).lower(), fallback))
            if isinstance(raw_values, str):
                raw_values = re.split(r"[,，、\n]", raw_values)
            if not isinstance(raw_values, list):
                raise HTTPException(status_code=400, detail={"code": "SHOPPING_CONFIG_INVALID", "detail": f"{field} 必须是数组"})
            data[field] = list(dict.fromkeys(str(value).strip() for value in raw_values if str(value).strip()))
        if not data["tags"]:
            raise HTTPException(status_code=400, detail={"code": "SHOPPING_KEYWORD_REQUIRED", "detail": "导购策略至少配置一个匹配关键词"})
        if len(data["tags"]) > 30 or len(data["aliases"]) > 30:
            raise HTTPException(status_code=400, detail={"code": "SHOPPING_KEYWORD_LIMIT", "detail": "导购关键词和别名分别最多配置 30 个"})
        data["fuzzyMatch"] = bool(data.get("fuzzyMatch", data.get("fuzzy_match", True)))
        data["spokenText"] = str(data.get("spokenText") or data.get("spoken_text") or "").strip()[:4000]
        data["registrationPrompt"] = str(data.get("registrationPrompt") or data.get("registration_prompt") or "需要为您弹出登记二维码吗？").strip()[:1000]
        data["confirmationRetryPrompt"] = str(data.get("confirmationRetryPrompt") or data.get("confirmation_retry_prompt") or "请回答需要或不需要登记。").strip()[:1000]
        data["registrationSuccessText"] = str(data.get("registrationSuccessText") or data.get("registration_success_text") or "好的，登记二维码已为您打开，请使用手机扫码填写信息。").strip()[:1000]
    if kind == "schedules" and data.get("venueId"):
        venue = _record(store, "venues", str(data.get("venueId")))
        if _event_exhibition_id(venue) != exhibition_id:
            raise HTTPException(status_code=400, detail={"code": "RELATION_INVALID", "detail": "活动场地不属于当前展会"})
    if kind == "interaction_welcome":
        triggers = _welcome_triggers(data)
        wake_words = _welcome_wake_words(data)
        if "唤醒词" in triggers and not wake_words:
            raise HTTPException(status_code=400, detail={"code": "WAKE_WORD_REQUIRED", "detail": "启用唤醒词后至少需要配置一个唤醒词"})
        if len(wake_words) > 5:
            raise HTTPException(status_code=400, detail={"code": "WAKE_WORD_LIMIT_EXCEEDED", "detail": "唤醒词最多配置 5 个"})
        if any(len(word) < 2 or len(word) > 12 for word in wake_words):
            raise HTTPException(status_code=400, detail={"code": "WAKE_WORD_LENGTH_INVALID", "detail": "每个唤醒词应为 2～12 个字符"})
        try:
            active_seconds = int(data.get("wakeActiveSeconds", data.get("wake_active_seconds", 30)))
        except (TypeError, ValueError) as exc:
            raise HTTPException(status_code=400, detail={"code": "WAKE_WINDOW_INVALID", "detail": "休眠时间必须为整数"}) from exc
        if active_seconds < 10 or active_seconds > 600:
            raise HTTPException(status_code=400, detail={"code": "WAKE_WINDOW_INVALID", "detail": "休眠时间必须在 10～600 秒之间"})
        script = store.get_record("scripts", str(data.get("scriptId") or data.get("script_id") or ""))
        if (
            not script
            or script.get("scene") != "welcome"
            or script.get("status", "active") != "active"
            or (
                _event_exhibition_id(script)
                and _event_exhibition_id(script) != exhibition_id
            )
        ):
            raise HTTPException(
                status_code=400,
                detail={
                    "code": "WELCOME_SCRIPT_INVALID",
                    "detail": "欢迎配置必须关联当前展会已启用的迎宾话术",
                },
            )
        data["triggers"] = triggers
        data["wakeWords"] = wake_words
        data["wakeActiveSeconds"] = active_seconds


EVENT_IMPORT_KINDS = ("exhibitors", "venues", "exhibits", "points", "routes", "schedules", "broadcasts", "knowledge_bases", "documents", "qa")


def _event_import_root(request: Request) -> Path:
    settings = getattr(request.app.state, "settings", None)
    root = Path(getattr(settings, "admin_event_import_root", "./data/admin-event-imports"))
    root.mkdir(parents=True, exist_ok=True)
    return root


def _import_sheet(kind: str) -> str:
    return next((spec.title for spec in SHEETS if spec.kind == kind), kind)


def _import_error(item: dict[str, Any], message: str, field: str | None = None) -> dict[str, Any]:
    error = {"sheet": item.get("_sheet", ""), "row": item.get("_row", 0), "message": message}
    if field:
        error["field"] = field
    return error


def _resolve_import_reference(
    records: dict[str, dict[str, Any]],
    value: Any,
    fields: tuple[str, ...],
) -> str:
    """Resolve an imported relation by system ID or a human-friendly key."""
    raw = str(value or "").strip()
    if not raw:
        return ""
    if raw in records:
        return raw
    needle = raw.casefold()
    for record_id, record in records.items():
        for field in fields:
            candidate = str(record.get(field) or "").strip()
            if candidate and candidate.casefold() == needle:
                return record_id
    return raw


def _validate_event_import(
    store: AdminStore,
    exhibition_id: str,
    records: dict[str, list[dict[str, Any]]],
    image_manifest: dict[str, Any],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    errors: list[dict[str, Any]] = []
    warnings: list[dict[str, Any]] = []
    if not store.get_record("exhibitions", exhibition_id):
        return [{"sheet": "", "row": 0, "message": "展会不存在"}], []

    known: dict[str, dict[str, dict[str, Any]]] = {}
    for kind in EVENT_IMPORT_KINDS:
        known[kind] = {str(item.get("id")): item for item in store.list_records(kind, exhibition_id=exhibition_id) if item.get("id")}
    for kind, items in records.items():
        if kind not in EVENT_IMPORT_KINDS:
            continue
        seen: set[str] = set()
        for item in items:
            record_id = str(item.get("id") or "").strip()
            if not record_id:
                errors.append(_import_error(item, "记录 ID 不能为空", "id"))
                continue
            if record_id in seen:
                errors.append(_import_error(item, "同一工作表内存在重复记录 ID", "id"))
            seen.add(record_id)
            if record_id in known[kind] and known[kind][record_id].get("exhibitionId") not in (None, exhibition_id):
                errors.append(_import_error(item, "该记录 ID 已属于其他展会", "id"))
            item["id"] = record_id
            supplied_exhibition_id = str(item.get("exhibitionId") or "").strip()
            if not supplied_exhibition_id:
                item["exhibitionId"] = exhibition_id
            elif supplied_exhibition_id != exhibition_id:
                errors.append(_import_error(item, "exhibition_id 必须等于当前展会 ID", "exhibition_id"))
            known[kind][record_id] = item

    # Normalize human-friendly relation values before route ordering and
    # validation. New records may have auto-generated IDs, so names/codes are
    # the practical way to reference them inside the same workbook.
    for item in records.get("exhibits", []):
        item["exhibitorId"] = _resolve_import_reference(known["exhibitors"], item.get("exhibitorId"), ("name", "boothCode"))
    for item in records.get("points", []):
        item["venueId"] = _resolve_import_reference(known["venues"], item.get("venueId"), ("name",))
        item["exhibitorId"] = _resolve_import_reference(known["exhibitors"], item.get("exhibitorId"), ("name", "boothCode"))
        item["exhibitId"] = _resolve_import_reference(known["exhibits"], item.get("exhibitId"), ("name",))
    for item in records.get("schedules", []):
        item["venueId"] = _resolve_import_reference(known["venues"], item.get("venueId"), ("name",))
        item["pointId"] = _resolve_import_reference(known["points"], item.get("pointId"), ("code", "name"))

    route_point_map: dict[str, list[tuple[int, str, dict[str, Any]]]] = {}
    for item in records.get("route_points", []):
        route_id = _resolve_import_reference(known["routes"], item.get("routeId"), ("name",))
        point_id = _resolve_import_reference(known["points"], item.get("pointId"), ("code", "name"))
        item["routeId"] = route_id
        item["pointId"] = point_id
        try:
            order = int(float(item.get("sortOrder")))
        except (TypeError, ValueError):
            order = 0
        if not route_id or not point_id or order < 1:
            errors.append(_import_error(item, "路线 ID、点位 ID 和顺序均不能为空，顺序从 1 开始"))
            continue
        route_point_map.setdefault(route_id, []).append((order, point_id, item))
    for route_id, links in route_point_map.items():
        seen_points: set[str] = set()
        for _, point_id, item in links:
            if route_id not in known["routes"]:
                errors.append(_import_error(item, f"路线不存在：{route_id}", "route_id"))
            point = known["points"].get(point_id)
            if not point:
                errors.append(_import_error(item, f"点位不存在：{point_id}", "point_id"))
            elif point_id in seen_points:
                errors.append(_import_error(item, "同一路线不能重复关联同一点位", "point_id"))
            seen_points.add(point_id)
    for route in records.get("routes", []):
        route_id = str(route.get("id") or "")
        links = sorted(route_point_map.get(route_id, []), key=lambda item: item[0])
        if links:
            route["pointIds"] = [point_id for _, point_id, _ in links]
        else:
            existing_route = store.get_record("routes", route_id) or {}
            route["pointIds"] = list(existing_route.get("pointIds") or [])
        if len(route["pointIds"]) < 2:
            errors.append(_import_error(route, "路线至少需要在路线点位表配置两个点位", "route_id"))
        else:
            route["venueId"] = str((known["points"].get(route["pointIds"][0]) or {}).get("venueId") or "")

    knowledge_bases = {
        str(item.get("id") or ""): item
        for item in records.get("knowledge_bases", [])
        if str(item.get("id") or "")
    }
    for item in records.get("knowledge_bases", []):
        if not str(item.get("name") or "").strip():
            errors.append(_import_error(item, "知识库名称不能为空", "name"))
        item["status"] = str(item.get("status") or "active").strip().lower()
        if item["status"] not in {"active", "inactive"}:
            errors.append(_import_error(item, "知识库状态只能是 active 或 inactive", "status"))
    existing_knowledge_bases = {
        str(item.get("id") or ""): item
        for item in store.list_records("knowledge_bases", exhibition_id=exhibition_id)
        if str(item.get("id") or "")
    }
    knowledge_bases.update(existing_knowledge_bases)
    for item in records.get("documents", []):
        kb_id = str(item.get("knowledgeBaseId") or "").strip()
        if kb_id not in knowledge_bases:
            errors.append(_import_error(item, f"知识库不存在：{kb_id}", "knowledge_base_id"))
        if not str(item.get("title") or "").strip():
            errors.append(_import_error(item, "知识文档标题不能为空", "title"))
        if not str(item.get("content") or "").strip():
            errors.append(_import_error(item, "知识文档正文不能为空", "content"))
        item["status"] = str(item.get("status") or "published").strip().lower()
        if item["status"] not in {"published", "draft", "archived"}:
            errors.append(_import_error(item, "知识文档状态只能是 published、draft 或 archived", "status"))
        if isinstance(item.get("keywords"), str):
            item["keywords"] = re.split(r"[,，、\n]", item["keywords"])
        item["keywords"] = list(dict.fromkeys(str(value).strip() for value in (item.get("keywords") or []) if str(value).strip()))
    for item in records.get("qa", []):
        if not str(item.get("question") or "").strip():
            errors.append(_import_error(item, "标准问题不能为空", "question"))
        if not str(item.get("answer") or "").strip():
            errors.append(_import_error(item, "官方答案不能为空", "answer"))
        item["status"] = str(item.get("status") or "published").strip().lower()
        if item["status"] not in {"published", "draft", "pending_review", "archived"}:
            errors.append(_import_error(item, "问答状态不合法", "status"))
        if isinstance(item.get("keywords"), str):
            item["keywords"] = re.split(r"[,，、\n]", item["keywords"])
        item["keywords"] = list(dict.fromkeys(str(value).strip() for value in (item.get("keywords") or []) if str(value).strip()))

    for kind in EVENT_IMPORT_KINDS:
        for item in records.get(kind, []):
            existing_record = store.get_record(kind, str(item.get("id") or "")) or {}
            supplied_fields = dict(item)
            supplied_image_fields = {key: supplied_fields[key] for key in ("imageMode", "imageRefs", "imageUrls") if key in supplied_fields}
            if existing_record:
                # Upsert semantics preserve columns omitted from the workbook;
                # explicitly supplied image controls are applied below.
                item.update(existing_record)
                item.update(supplied_fields)
                if not supplied_image_fields:
                    item["imageMode"] = "keep"
                    item["imageRefs"] = []
                    item["imageUrls"] = list(existing_record.get("imageUrls") or [])
            image_mode = str(item.get("imageMode") or ("replace" if item.get("imageRefs") or item.get("imageUrls") else "keep")).lower()
            if image_mode not in {"keep", "replace", "clear"}:
                errors.append(_import_error(item, "图片策略只能是 keep、replace 或 clear", "image_mode"))
            item["imageMode"] = image_mode
            if image_mode == "keep" and existing_record:
                item["imageUrls"] = list(existing_record.get("imageUrls") or [])
            elif image_mode == "replace":
                item["imageUrls"] = list(supplied_image_fields.get("imageUrls") or [])
            try:
                item["imageUrls"] = normalized_image_urls(item)
            except ValueError as exc:
                errors.append(_import_error(item, str(exc), "image_urls"))
            if image_mode == "replace" and not item.get("imageRefs") and not item.get("imageUrls"):
                errors.append(_import_error(item, "replace 策略至少需要一个 image_refs 或 image_urls", "image_refs"))
            if image_mode == "keep" and (item.get("imageRefs") or item.get("imageUrls")):
                warnings.append(_import_error(item, "keep 策略会忽略 image_refs/image_urls", "image_mode"))
            if image_mode == "clear":
                item["imageRefs"] = []
                item["imageUrls"] = []
            if kind == "exhibits":
                item["exhibitorId"] = _resolve_import_reference(known["exhibitors"], item.get("exhibitorId"), ("name", "boothCode"))
                exhibitor = known["exhibitors"].get(str(item.get("exhibitorId") or ""))
                if not exhibitor or str(exhibitor.get("exhibitionId")) != exhibition_id:
                    errors.append(_import_error(item, "展品关联的展商不存在或不属于当前展会", "exhibitor_id"))
            if kind == "points":
                item["venueId"] = _resolve_import_reference(known["venues"], item.get("venueId"), ("name",))
                item["exhibitorId"] = _resolve_import_reference(known["exhibitors"], item.get("exhibitorId"), ("name", "boothCode"))
                item["exhibitId"] = _resolve_import_reference(known["exhibits"], item.get("exhibitId"), ("name",))
                venue = known["venues"].get(str(item.get("venueId") or ""))
                if not venue or str(venue.get("exhibitionId")) != exhibition_id:
                    errors.append(_import_error(item, "点位关联的场馆不存在或不属于当前展会", "venue_id"))
                for field, related_kind, label in (("exhibitorId", "exhibitors", "exhibitor_id"), ("exhibitId", "exhibits", "exhibit_id")):
                    value = str(item.get(field) or "").strip()
                    if value and (value not in known[related_kind] or str(known[related_kind][value].get("exhibitionId")) != exhibition_id):
                        errors.append(_import_error(item, f"{label} 关联记录不存在或不属于当前展会", label))
            if kind == "documents":
                item["exhibitionId"] = exhibition_id
            if kind == "qa":
                item["exhibitionId"] = exhibition_id
            if kind == "schedules":
                for field, related_kind, label in (("venueId", "venues", "venue_id"), ("pointId", "points", "point_id")):
                    reference_fields = ("name",) if field == "venueId" else ("code", "name")
                    item[field] = _resolve_import_reference(known[related_kind], item.get(field), reference_fields)
                    value = str(item.get(field) or "").strip()
                    if value and (value not in known[related_kind] or str(known[related_kind][value].get("exhibitionId")) != exhibition_id):
                        errors.append(_import_error(item, f"{label} 关联记录不存在或不属于当前展会", label))
    for filename in sorted({str(ref) for items in records.values() for item in items for ref in item.get("imageRefs", [])}):
        if filename not in image_manifest:
            errors.append({"sheet": "", "row": 0, "field": "image_refs", "message": f"附件不存在：{filename}"})
    return errors, warnings


def _materialize_import_images(request: Request, batch: dict[str, Any], records: dict[str, list[dict[str, Any]]]) -> list[dict[str, Any]]:
    package_path = Path(str(batch.get("package_path") or ""))
    image_root = package_path / "images"
    settings = getattr(request.app.state, "settings", None)
    service_store = SceneAssetStore(Path(getattr(settings, "scene_assets_dir", "./data/scene-assets")), seed_defaults=True)
    cache: dict[str, str] = {}
    created: list[dict[str, Any]] = []
    for kind, items in records.items():
        if kind == "route_points":
            continue
        for item in items:
            if item.get("imageMode") == "clear":
                item["imageUrls"] = []
            elif item.get("imageMode") == "replace":
                urls = list(item.get("imageUrls", []))
                for filename in item.get("imageRefs", []):
                    safe_name = Path(str(filename)).name
                    source = (image_root / safe_name).resolve()
                    try:
                        source.relative_to(image_root.resolve())
                    except ValueError as exc:
                        raise ValueError(f"附件路径非法：{safe_name}") from exc
                    content = source.read_bytes()
                    digest = hashlib.sha256(content).hexdigest()
                    if digest not in cache:
                        mime = mimetypes.guess_type(safe_name)[0] or "application/octet-stream"
                        saved = service_store.create_file(content=content, filename=safe_name, mime_type=mime, name=Path(safe_name).stem, category=f"event:{kind}")
                        cache[digest] = str(saved["url"])
                        created.append(saved)
                    urls.append(cache[digest])
                item["imageUrls"] = list(dict.fromkeys(urls))
    return created


def _build_import_runtime_config(store: AdminStore, exhibition_id: str, records: dict[str, list[dict[str, Any]]]) -> dict[str, Any] | None:
    """Create a minimal runtime config for imported exhibitions when none exists.

    The public Web client loads ``digital-human-config`` before it can match
    navigation intent.  Excel imports intentionally focus on exhibition
    content and routes, so bootstrap the runtime config from those routes while
    preserving any config that an operator already created.
    """
    if store.get_record("runtime_configs", exhibition_id):
        return None

    def values(*raw_values: Any) -> list[str]:
        result: list[str] = []
        for raw in raw_values:
            candidates = raw if isinstance(raw, (list, tuple)) else [raw]
            for candidate in candidates:
                text = str(candidate or "").strip()
                if text and text not in result:
                    result.append(text)
        return result

    navigation: list[str] = []
    for route in records.get("routes", []):
        if str(route.get("type") or "navigation") in {"navigation", "tour"} and str(route.get("status") or "") != "offline":
            navigation.extend(values(route.get("name"), route.get("keywords"), route.get("aliases")))

    content: list[str] = []
    for kind in ("exhibitors", "exhibits", "venues", "points", "schedules"):
        for item in records.get(kind, []):
            content.extend(values(item.get("name"), item.get("title"), item.get("category"), item.get("aliases"), item.get("introductionKeywords")))
    for item in records.get("documents", []):
        content.extend(values(item.get("title"), item.get("keywords"), item.get("category")))
    for item in records.get("qa", []):
        content.extend(values(item.get("question"), item.get("keywords")))

    return {
        "id": exhibition_id,
        "exhibitionId": exhibition_id,
        "keywords": {
            "navigation": list(dict.fromkeys(navigation)),
            "exhibition_content": list(dict.fromkeys(content)),
        },
    }


@router.get("/admin/event/exhibitions/{exhibition_id}/import-template")
def event_import_template(exhibition_id: str, request: Request, auth: dict[str, Any] = Depends(current_user)) -> StreamingResponse:
    store = get_store(request)
    _require(store, auth, "event:import")
    _record(store, "exhibitions", exhibition_id)
    return StreamingResponse(
        io.BytesIO(create_template()),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="event-import-template-{exhibition_id}.xlsx"'},
    )


@router.post("/admin/event/exhibitions/{exhibition_id}/import/preview")
async def preview_event_import(exhibition_id: str, request: Request, file: UploadFile = File(...), auth: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    store = get_store(request)
    _require(store, auth, "event:import")
    _record(store, "exhibitions", exhibition_id)
    payload = await file.read()
    try:
        workbook_bytes, images = extract_package(payload, file.filename or "data.xlsx")
        records, parse_errors = parse_workbook(workbook_bytes, images)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail={"code": "IMPORT_FILE_INVALID", "detail": "导入文件无法解析，请检查模板和文件内容后重试"}) from exc
    batch_id = f"import-{uuid.uuid4().hex[:16]}"
    batch_dir = _event_import_root(request) / batch_id
    batch_dir.mkdir(parents=True, exist_ok=False)
    (batch_dir / "data.xlsx").write_bytes(workbook_bytes)
    if images:
        (batch_dir / "images").mkdir(parents=True, exist_ok=True)
        for filename, (content, _) in images.items():
            (batch_dir / "images" / filename).write_bytes(content)
    image_manifest = {filename: {"mimeType": mime, "size": len(content)} for filename, (content, mime) in images.items()}
    validation_errors, warnings = _validate_event_import(store, exhibition_id, records, image_manifest)
    preview = public_preview(batch_id, exhibition_id, file.filename or "data.xlsx", records, [*parse_errors, *validation_errors], warnings)
    for kind, values in preview["summary"].items():
        existing = {item.get("id") for item in store.list_records(kind, exhibition_id=exhibition_id)}
        values["creates"] = sum(1 for item in records.get(kind, []) if item.get("id") not in existing)
        values["updates"] = sum(1 for item in records.get(kind, []) if item.get("id") in existing)
        values["warnings"] = sum(1 for warning in warnings if warning.get("sheet") == _import_sheet(kind))
    preview["conflicts"] = [
        {"kind": kind, "id": str(item.get("id") or ""), "action": "update" if item.get("id") in {existing_item.get("id") for existing_item in store.list_records(kind, exhibition_id=exhibition_id)} else "create"}
        for kind, items in records.items() if kind in EVENT_IMPORT_KINDS for item in items
    ]
    store.save_event_import_batch({"id": batch_id, "exhibition_id": exhibition_id, "status": "previewed", "filename": file.filename or "data.xlsx", "package_path": str(batch_dir), "preview": preview, "records": records, "image_manifest": image_manifest, "created_by": auth["user"]["id"]})
    _audit(request, auth, action="import_preview", resource_type="event_import", resource_id=batch_id, before=None, after=preview)
    return preview


@router.post("/admin/event/imports/commit")
def commit_event_import(request: Request, body: EventImportCommitBody, auth: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    store = get_store(request)
    _require(store, auth, "event:import")
    batch = store.get_event_import_batch(body.batchId)
    if not batch:
        raise HTTPException(status_code=404, detail={"code": "IMPORT_BATCH_NOT_FOUND", "detail": "导入批次不存在或已过期"})
    if batch["status"] == "committed":
        return {"batchId": body.batchId, "status": "committed", "idempotent": True}
    preview = batch.get("preview") or {}
    if preview.get("errors"):
        raise HTTPException(status_code=409, detail={"code": "IMPORT_HAS_ERRORS", "detail": "导入存在错误，修复后请重新上传", "errors": preview["errors"]})
    records = batch.get("records") or {}
    created_assets: list[dict[str, Any]] = []
    try:
        created_assets = _materialize_import_images(request, batch, records)
        records_to_save = {kind: list(items) for kind, items in records.items()}
        runtime_config = _build_import_runtime_config(store, str(batch.get("exhibition_id") or ""), records)
        if runtime_config:
            records_to_save["runtime_configs"] = [runtime_config]
        store.save_records_atomic(records_to_save)
    except Exception as exc:
        settings = getattr(request.app.state, "settings", None)
        service_store = SceneAssetStore(Path(getattr(settings, "scene_assets_dir", "./data/scene-assets")), seed_defaults=True)
        for asset in created_assets:
            service_store.delete_file(str(asset.get("id") or ""))
        raise HTTPException(status_code=500, detail={"code": "IMPORT_COMMIT_FAILED", "detail": "导入提交失败，请稍后重试"}) from exc
    store.mark_event_import_committed(body.batchId)
    result = {"batchId": body.batchId, "status": "committed", "records": {kind: len(items) for kind, items in records.items()}, "assets": len(created_assets)}
    _audit(request, auth, action="import_commit", resource_type="event_import", resource_id=body.batchId, before=preview, after=result)
    return result


@router.get("/admin/event/exhibitions/{exhibition_id}/imports")
def list_event_imports(exhibition_id: str, request: Request, auth: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    store = get_store(request)
    _require(store, auth, "event:import")
    _record(store, "exhibitions", exhibition_id)
    return {"items": store.list_event_import_batches(exhibition_id)}


@router.get("/admin/event/imports/{batch_id}/error-report")
def event_import_error_report(batch_id: str, request: Request, auth: dict[str, Any] = Depends(current_user)) -> StreamingResponse:
    store = get_store(request)
    _require(store, auth, "event:import")
    batch = store.get_event_import_batch(batch_id)
    if not batch:
        raise HTTPException(status_code=404, detail={"code": "IMPORT_BATCH_NOT_FOUND", "detail": "导入批次不存在或已过期"})
    rows = [{"sheet": item.get("sheet", ""), "row": item.get("row", ""), "field": item.get("field", ""), "message": item.get("message", "")} for item in (batch.get("preview") or {}).get("errors", [])]
    output = io.StringIO()
    writer = csv.DictWriter(output, fieldnames=["sheet", "row", "field", "message"])
    writer.writeheader()
    writer.writerows(rows)
    return StreamingResponse(iter([output.getvalue().encode("utf-8-sig")]), media_type="text/csv", headers={"Content-Disposition": f'attachment; filename="{batch_id}-errors.csv"'})


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
    try:
        if resource == "exhibitions":
            _sync_exhibition_knowledge_bases(saved["id"], saved)
            saved = store.save_record(resource, saved, _event_exhibition_id(saved))
    except Exception:
        store.delete_record(resource, saved["id"])
        raise
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
    try:
        if resource == "exhibitions":
            _sync_exhibition_knowledge_bases(record_id, saved, before)
            saved = store.save_record(resource, saved, _event_exhibition_id(saved))
    except Exception:
        store.save_record(resource, before, _event_exhibition_id(before))
        raise
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


def _survey_payload(store: AdminStore, exhibit: dict[str, Any]) -> dict[str, Any]:
    exhibitor = store.get_record("exhibitors", str(exhibit.get("exhibitorId", ""))) or {}
    exhibition = store.get_record("exhibitions", str(exhibit.get("exhibitionId", ""))) or {}
    token = str(exhibit.get("surveyToken", ""))
    submissions = [item for item in store.list_records("leads") if item.get("qrToken") == token]
    return {
        "token": token,
        "path": f"/survey/{token}",
        "exhibitId": exhibit["id"],
        "exhibitName": exhibit.get("name", ""),
        "exhibitorId": exhibit.get("exhibitorId", ""),
        "exhibitorName": exhibitor.get("name", ""),
        "exhibitionId": exhibit.get("exhibitionId", ""),
        "exhibitionName": exhibition.get("name", ""),
        "description": exhibit.get("description", ""),
        "imageUrls": exhibit.get("imageUrls", []),
        "submissionCount": len(submissions),
        "createdAt": exhibit.get("surveyCreatedAt", ""),
    }


@router.post("/admin/event/exhibits/{record_id}/survey")
def create_exhibit_survey(record_id: str, request: Request, auth: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    store = get_store(request)
    _require(store, auth, "event:exhibit")
    before = _record(store, "exhibits", record_id) or {}
    if before.get("surveyToken"):
        return _survey_payload(store, before)
    saved = store.save_record(
        "exhibits",
        {**before, "surveyToken": secrets.token_urlsafe(18), "surveyCreatedAt": utc_now()},
        before.get("exhibitionId"),
    )
    _audit(request, auth, action="create_survey", resource_type="exhibit", resource_id=record_id, before=before, after=saved)
    return _survey_payload(store, saved)


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
    if kind == "interaction_welcome" and body.data.get("status") == "active":
        for item in store.list_records(kind, exhibition_id=body.data.get("exhibitionId")):
            if item.get("id") != body.data.get("id") and item.get("status") == "active":
                store.save_record(kind, {**item, "status": "inactive"}, body.data.get("exhibitionId"))
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
    if kind == "interaction_welcome" and data.get("status") == "active":
        for item in store.list_records(kind, exhibition_id=data.get("exhibitionId")):
            if item.get("id") != record_id and item.get("status") == "active":
                store.save_record(kind, {**item, "status": "inactive"}, data.get("exhibitionId"))
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
def export_leads(request: Request, exhibition_id: str | None = None, keyword: str | None = None, status_filter: str | None = Query(None, alias="status"), source: str = "", from_date: str = Query("", alias="from"), to_date: str = Query("", alias="to"), auth: dict[str, Any] = Depends(current_user)) -> StreamingResponse:
    store = get_store(request)
    _require(store, auth, "lead:export")
    items = store.list_records("leads", exhibition_id=exhibition_id, keyword=keyword, status=status_filter)
    items = [item for item in items if (not from_date or str(item.get("createdAt", ""))[:10] >= from_date) and (not to_date or str(item.get("createdAt", ""))[:10] <= to_date) and (not source or (item.get("source") == "exhibit_survey" if source == "exhibit_survey" else item.get("source") != "exhibit_survey"))]
    sensitive = "lead:view_sensitive" in _permission_codes(store, auth["user"]["id"])
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["线索ID", "来源", "展品", "展商", "展会", "单位名称", "联系人", "手机号", "邮箱", "状态", "创建时间"])
    for item in items:
        writer.writerow([item.get("id", ""), item.get("sourceName", item.get("terminalName", "")), item.get("exhibitName", ""), item.get("exhibitorName", ""), item.get("exhibitionName", item.get("exhibitionId", "")), item.get("companyName", ""), item.get("contactName", ""), item.get("phone", "") if sensitive else _mask_phone(str(item.get("phone", ""))), item.get("email", "") if sensitive else _mask_email(str(item.get("email", ""))), item.get("status", ""), item.get("createdAt", "")])
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
    alerts = store.list_records("alerts")
    knowledge_hits = store.list_records("knowledge_hits", exhibition_id=exhibition_id)
    knowledge_misses = store.list_records("miss_pool", exhibition_id=exhibition_id)
    return {
        "exhibition_id": exhibition_id or "current",
        "interaction_count": len(store.audit_list()),
        "online_terminals": len([x for x in store.list_records("terminals") if x.get("status") == "online"]),
        "pending_knowledge": len([x for x in store.list_records("qa") if x.get("status") == "pending_review"]),
        "knowledge_hits": len(knowledge_hits),
        "knowledge_misses": sum(int(item.get("count") or 0) for item in knowledge_misses),
        "official_qa_hits": len([item for item in knowledge_hits if item.get("matchType") == "official_qa"]),
        "rag_hits": len([item for item in knowledge_hits if item.get("matchType") == "rag"]),
        "new_leads": len(store.list_records("leads", exhibition_id=exhibition_id, status="new")),
        "alerts": len([x for x in alerts if x.get("status") in {"open", "active"}]),
        "todo": [],
    }


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
    _audit(request, auth, action="clear", resource_type="audit_logs", resource_id="", before={"count": deleted}, after={"deleted": deleted})
    return {"deleted": deleted}


@router.get("/admin/alerts")
def alerts(request: Request, page: int = 1, page_size: int = 9, auth: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    store = get_store(request)
    _require(store, auth, "system:ops")
    return _paginate(collect_runtime_monitor(request, store)["alerts"], page, page_size)


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
    return collect_runtime_monitor(request, store)


@router.get("/admin/ops/services")
def services(request: Request, auth: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    store = get_store(request)
    _require(store, auth, "system:ops")
    return {"items": collect_runtime_monitor(request, store)["services"]}


@router.get("/admin/ops/terminals")
def terminals(request: Request, auth: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    _require(get_store(request), auth, "system:ops")
    return {"items": get_store(request).list_records("terminals")}


@router.patch("/admin/ops/terminals/{record_id}")
def update_terminal_status(record_id: str, request: Request, body: RecordBody, auth: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    store = get_store(request)
    _require(store, auth, "system:ops")
    status = str(body.data.get("status", ""))
    if status not in {"online", "offline", "disabled"}:
        raise HTTPException(status_code=400, detail={"code": "INVALID_STATUS", "detail": "终端状态仅支持 online / offline / disabled"})
    before = _record(store, "terminals", record_id)
    if before is None:
        raise HTTPException(status_code=404, detail={"code": "RESOURCE_NOT_FOUND", "detail": "终端不存在"})
    saved = store.save_record("terminals", {**before, "status": status}, before.get("exhibitionId"))
    _audit(request, auth, action="terminal-status", resource_type="terminal", resource_id=record_id, before={"status": before.get("status")}, after={"status": status})
    return saved


@router.post("/ops/failover")
def failover(request: Request, body: RecordBody, auth: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    _require(get_store(request), auth, "ops:failover")
    result = {"accepted": True, "service": body.data.get("service", ""), "from": body.data.get("from", ""), "to": body.data.get("to", ""), "trace_id": getattr(request.state, "trace_id", "")}
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
    exhibition = store.get_record("exhibitions", exhibition_id) or {}
    welcome_configs = sorted(
        (item for item in store.list_records("interaction_welcome", exhibition_id=exhibition_id) if item.get("status") == "active"),
        key=lambda item: str(item.get("updatedAt") or item.get("updated_at") or ""),
        reverse=True,
    )
    welcome_config = welcome_configs[0] if welcome_configs else {}
    wake_words = _welcome_wake_words(welcome_config)
    wake_enabled = "唤醒词" in _welcome_triggers(welcome_config) and bool(wake_words)
    welcome_script = store.get_record("scripts", str(welcome_config.get("scriptId") or welcome_config.get("script_id") or "")) or {}
    if (
        welcome_script.get("status", "active") != "active"
        or (
            _event_exhibition_id(welcome_script)
            and _event_exhibition_id(welcome_script) != exhibition_id
        )
    ):
        welcome_script = {}
    configured_keywords = config.get("keywords", {"navigation": [], "exhibition_content": []})
    if not isinstance(configured_keywords, dict):
        configured_keywords = {"navigation": [], "exhibition_content": []}
    route_keywords: list[str] = []
    route_fuzzy_keywords: list[str] = []
    for route in store.list_records("routes", exhibition_id=exhibition_id):
        if route.get("status") == "offline" or route.get("type", "navigation") not in {"navigation", "tour"}:
            continue
        for value in [route.get("name"), *route.get("keywords", []), *route.get("aliases", [])]:
            clean_value = str(value or "").strip()
            if clean_value:
                route_keywords.append(clean_value)
                if route.get("fuzzyMatch", route.get("fuzzy_match", True)):
                    route_fuzzy_keywords.append(clean_value)
    keywords = {
        **configured_keywords,
        "navigation": list(dict.fromkeys([*configured_keywords.get("navigation", []), *route_keywords])),
    }
    return {
        "exhibition_id": exhibition_id,
        "keywords": keywords,
        "navigation_fuzzy_keywords": list(dict.fromkeys(route_fuzzy_keywords)),
        "supports_deferred_speak": True,
        "wake_word": {
            "enabled": wake_enabled,
            "words": wake_words if wake_enabled else [],
            "active_window_seconds": _welcome_active_seconds(welcome_config),
        },
        "welcome": {
            "script_id": str(welcome_script.get("id") or ""),
            "text": str(welcome_script.get("content") or ""),
        },
        "bound_avatar_id": exhibition.get("boundAvatarId") or exhibition.get("bound_avatar_id"),
        "bound_model": exhibition.get("boundModel") or exhibition.get("bound_model"),
        "bound_voice_id": exhibition.get("boundVoiceId") or exhibition.get("bound_voice_id"),
        "bound_voice_provider": exhibition.get("boundVoiceProvider") or exhibition.get("bound_voice_provider"),
        "bound_voice_model": exhibition.get("boundVoiceModel") or exhibition.get("bound_voice_model"),
        "bound_stt_provider": exhibition.get("boundSttProvider") or exhibition.get("bound_stt_provider"),
        "bound_stt_model": exhibition.get("boundSttModel") or exhibition.get("bound_stt_model"),
        "bound_role_prompt": exhibition.get("boundRolePrompt") or exhibition.get("bound_role_prompt") or "",
    }


@public_router.get("/exhibitions")
def public_exhibitions(request: Request) -> dict[str, Any]:
    """Return only the public exhibition/runtime binding needed by the Web client."""
    store = get_store(request)
    items: list[dict[str, Any]] = []
    for item in store.list_records("exhibitions"):
        bound_stt_provider = item.get("boundSttProvider") or item.get("bound_stt_provider")
        bound_stt_status = None
        if bound_stt_provider:
            try:
                bound_stt_status = stt_provider_config(normalize_stt_provider(str(bound_stt_provider), default=None))
            except ValueError:
                bound_stt_status = {"runtime_ready": False, "availability_error": "展会绑定的语音识别服务不受支持"}
        items.append({
            "id": item["id"],
            "name": item.get("name") or item.get("code") or item["id"],
            "code": item.get("code", ""),
            "status": item.get("status", ""),
            "is_current": bool(item.get("isCurrent") or item.get("is_current")),
            "bound_avatar_id": item.get("boundAvatarId") or item.get("bound_avatar_id"),
            "bound_model": item.get("boundModel") or item.get("bound_model"),
            "bound_voice_id": item.get("boundVoiceId") or item.get("bound_voice_id"),
            "bound_voice_provider": item.get("boundVoiceProvider") or item.get("bound_voice_provider"),
            "bound_voice_model": item.get("boundVoiceModel") or item.get("bound_voice_model"),
            "bound_stt_provider": bound_stt_provider,
            "bound_stt_model": item.get("boundSttModel") or item.get("bound_stt_model"),
            "bound_role_prompt": item.get("boundRolePrompt") or item.get("bound_role_prompt") or "",
            "bound_stt_runtime_ready": bound_stt_status.get("runtime_ready") if bound_stt_status else None,
            "bound_stt_availability_error": bound_stt_status.get("availability_error") if bound_stt_status else None,
            "bound_scene": item.get("boundScene") or item.get("bound_scene"),
            "knowledge_base_ids": _knowledge_base_ids(item),
        })
    return {"items": items}


_MARKDOWN_IMAGE_RE = re.compile(r"!\[[^\]]*\]\([^)]*\)")
_MARKDOWN_LINK_RE = re.compile(r"\[([^\]]+)\]\([^)]*\)")


def _public_description(value: Any) -> str:
    text = _MARKDOWN_IMAGE_RE.sub(" ", str(value or ""))
    text = _MARKDOWN_LINK_RE.sub(r"\1", text)
    text = re.sub(r"[`#>*_~|]+", " ", text)
    return " ".join(text.split())[:1200]


def _public_image_urls(item: dict[str, Any], *fallback_items: dict[str, Any] | None) -> list[str]:
    for candidate in (item, *fallback_items):
        if not candidate:
            continue
        raw_urls = candidate.get("imageUrls") or candidate.get("image_urls") or []
        if isinstance(raw_urls, str):
            raw_urls = [raw_urls]
        urls = [str(url).strip() for url in raw_urls if str(url).strip()]
        if urls:
            return urls[:6]
    return []


@public_router.get("/exhibitions/{exhibition_id}/entities")
def public_exhibition_entities(exhibition_id: str, request: Request) -> dict[str, Any]:
    """Return display-safe event entities used by the Web keyword matcher."""
    store = get_store(request)
    if exhibition_id == "current":
        current = next((item for item in store.list_records("exhibitions") if item.get("isCurrent") or item.get("is_current")), None)
        if not current:
            raise HTTPException(status_code=404, detail={"code": "CURRENT_EXHIBITION_NOT_FOUND", "detail": "当前展会未配置"})
        exhibition_id = str(current["id"])
    exhibition = _record(store, "exhibitions", exhibition_id)

    exhibitors = {item["id"]: item for item in store.list_records("exhibitors", exhibition_id=exhibition_id)}
    exhibits = {item["id"]: item for item in store.list_records("exhibits", exhibition_id=exhibition_id)}
    venues = {item["id"]: item for item in store.list_records("venues", exhibition_id=exhibition_id)}
    points = {item["id"]: item for item in store.list_records("points", exhibition_id=exhibition_id)}
    schedules = store.list_records("schedules", exhibition_id=exhibition_id)
    items: list[dict[str, Any]] = []

    def append_entity(*, entity_id: str, kind: str, name: str, description: Any, images: list[str], details: list[tuple[str, Any]], keywords: list[Any], source: dict[str, Any], parent_id: str | None = None) -> None:
        clean_name = str(name or "").strip()
        if not clean_name:
            return
        clean_details = [{"label": label, "value": str(value).strip()} for label, value in details if str(value or "").strip()]
        configured_keywords = source.get("introductionKeywords") or source.get("introduction_keywords") or []
        aliases = source.get("aliases") or []
        clean_keywords = list(dict.fromkeys(str(value).strip() for value in [clean_name, *keywords, *configured_keywords, *aliases] if len(str(value or "").strip()) >= 2))
        items.append({
            "id": entity_id,
            "kind": kind,
            "parent_id": parent_id,
            "name": clean_name,
            "description": _public_description(description),
            "image_urls": images,
            "details": clean_details,
            "keywords": clean_keywords,
            "fuzzy_keywords": clean_keywords if source.get("fuzzyMatch", source.get("fuzzy_match", True)) else [],
            "spoken_text": str(source.get("spokenText") or source.get("spoken_text") or "").strip() or _public_description(description),
            "survey_path": (
                f"/survey/{str(source.get('surveyToken') or source.get('survey_token')).strip()}"
                if kind == "exhibit" and str(source.get("surveyToken") or source.get("survey_token") or "").strip()
                else None
            ),
        })

    append_entity(
        entity_id=str(exhibition["id"]),
        kind="exhibition",
        name=str(exhibition.get("name") or exhibition.get("code") or ""),
        description=exhibition.get("description"),
        images=_public_image_urls(exhibition),
        details=[
            ("展会编码", exhibition.get("code")),
            ("展期", " 至 ".join(value for value in [str(exhibition.get("startDate") or exhibition.get("start_date") or "").strip(), str(exhibition.get("endDate") or exhibition.get("end_date") or "").strip()] if value)),
            ("主办单位", exhibition.get("hostUnit") or exhibition.get("host_unit")),
            ("承办单位", exhibition.get("organizerUnit") or exhibition.get("organizer_unit")),
            ("协办单位", exhibition.get("coOrganizerUnits") or exhibition.get("co_organizer_units")),
            ("状态", exhibition.get("status")),
        ],
        keywords=[exhibition.get("code")],
        source=exhibition,
    )

    for item in exhibitors.values():
        append_entity(
            entity_id=str(item["id"]), kind="exhibitor", name=str(item.get("name", "")), description=item.get("description"),
            images=_public_image_urls(item),
            details=[("展位", item.get("boothCode")), ("类别", item.get("category"))],
            keywords=[item.get("boothCode")], source=item,
        )
    for item in exhibits.values():
        exhibitor = exhibitors.get(str(item.get("exhibitorId", "")))
        append_entity(
            entity_id=str(item["id"]), kind="exhibit", name=str(item.get("name", "")), description=item.get("description"),
            images=_public_image_urls(item, exhibitor),
            details=[("展商", (exhibitor or {}).get("name")), ("类别", item.get("category")), ("型号", item.get("modelNo"))],
            keywords=[item.get("modelNo")], source=item, parent_id=str(item.get("exhibitorId") or "") or None,
        )
    for item in venues.values():
        append_entity(
            entity_id=str(item["id"]), kind="venue", name=str(item.get("name", "")), description=item.get("description"),
            images=_public_image_urls(item), details=[("地址", item.get("address"))], keywords=[], source=item,
        )
    for item in points.values():
        venue = venues.get(str(item.get("venueId", "")))
        exhibit = exhibits.get(str(item.get("exhibitId", "")))
        exhibitor = exhibitors.get(str(item.get("exhibitorId", ""))) or exhibitors.get(str((exhibit or {}).get("exhibitorId", "")))
        append_entity(
            entity_id=str(item["id"]), kind="point", name=str(item.get("name", "")), description=item.get("description"),
            images=_public_image_urls(item, exhibit, exhibitor, venue),
            details=[("场地", (venue or {}).get("name")), ("楼层", item.get("floor")), ("点位编码", item.get("code"))],
            keywords=[item.get("code")], source=item,
        )
    for item in schedules:
        venue = venues.get(str(item.get("venueId", "")))
        point = points.get(str(item.get("pointId", "")))
        append_entity(
            entity_id=str(item["id"]), kind="schedule", name=str(item.get("title") or item.get("name") or ""), description=item.get("description"),
            images=_public_image_urls(item, point, venue),
            details=[("时间", " 至 ".join(value for value in [str(item.get("startAt", "")).strip(), str(item.get("endAt", "")).strip()] if value)), ("地点", item.get("location") or (point or {}).get("name") or (venue or {}).get("name")), ("主讲方", item.get("speaker")), ("类型", item.get("type"))],
            keywords=[item.get("location"), item.get("speaker")], source=item,
        )
    return {"exhibition_id": exhibition_id, "items": items}


def _exhibit_for_survey_token(store: AdminStore, token: str) -> dict[str, Any]:
    exhibit = next((item for item in store.list_records("exhibits") if secrets.compare_digest(str(item.get("surveyToken", "")), token)), None)
    if not exhibit:
        raise HTTPException(status_code=404, detail={"code": "SURVEY_NOT_FOUND", "detail": "调研表单不存在或尚未启用"})
    return exhibit


@public_router.get("/api/v1/public/exhibit-surveys/{token}")
def public_exhibit_survey(token: str, request: Request) -> dict[str, Any]:
    return _survey_payload(get_store(request), _exhibit_for_survey_token(get_store(request), token))


@public_router.post("/api/v1/public/exhibit-surveys/{token}/submissions")
def submit_exhibit_survey(token: str, request: Request, body: ExhibitSurveySubmissionBody) -> dict[str, Any]:
    store = get_store(request)
    exhibit = _exhibit_for_survey_token(store, token)
    exhibitor = store.get_record("exhibitors", str(exhibit.get("exhibitorId", ""))) or {}
    exhibition = store.get_record("exhibitions", str(exhibit.get("exhibitionId", ""))) or {}
    submitted = body.model_dump()
    lead = {
        "exhibitionId": exhibit.get("exhibitionId", ""),
        "exhibitionName": exhibition.get("name", ""),
        "terminalId": "",
        "terminalName": "展品调研二维码",
        "companyName": submitted["companyName"].strip() or "个人访客",
        "contactName": submitted["contactName"].strip(),
        "phone": submitted["phone"].strip(),
        "email": submitted["email"].strip(),
        "intentSummary": submitted["intentSummary"].strip() or f"通过二维码关注展品：{exhibit.get('name', '')}",
        "status": "new",
        "source": "exhibit_survey",
        "sourceName": "展品调研二维码",
        "exhibitName": exhibit.get("name", ""),
        "exhibitorName": exhibitor.get("name", ""),
        "interestedExhibitorIds": [exhibit.get("exhibitorId")] if exhibit.get("exhibitorId") else [],
        "interestedExhibitIds": [exhibit["id"]],
        "qrToken": token,
        "statusHistory": [{"status": "new", "operator": "调研表单", "time": utc_now(), "note": "访客扫码提交"}],
    }
    saved = store.save_record("leads", lead, str(exhibit.get("exhibitionId", "")))
    _audit(request, None, action="survey_submit", resource_type="lead", resource_id=saved["id"], before=None, after={**saved, "phone": _mask_phone(saved.get("phone", "")), "email": _mask_email(saved.get("email", ""))})
    return {"submitted": True, "leadId": saved["id"]}


_NAVIGATION_FILLER_RE = re.compile(r"(请问|麻烦|告诉我|带我去|导航到|导航去|怎么去|怎么走|如何去|如何走|路线|在哪儿|在哪里|我要去|想去|前往)")


def _normalize_navigation_text(value: Any) -> str:
    return re.sub(r"[^0-9a-z\u4e00-\u9fff]+", "", str(value or "").lower())


def _navigation_similarity(query: str, term: str) -> float:
    if not query or not term:
        return 0.0
    if term in query:
        return 1.0
    compact_query = _NAVIGATION_FILLER_RE.sub("", query)
    if term in compact_query or compact_query and compact_query in term:
        return 0.96
    ratio = SequenceMatcher(None, compact_query or query, term).ratio()
    if len(term) >= 2 and len(query) > len(term):
        sizes = range(max(2, len(term) - 2), min(len(query), len(term) + 2) + 1)
        ratio = max(ratio, *(SequenceMatcher(None, query[index:index + size], term).ratio() for size in sizes for index in range(len(query) - size + 1)))
    return ratio


def _route_match_terms(
    route: dict[str, Any],
    points: dict[str, dict[str, Any]],
    exhibitors: dict[str, dict[str, Any]],
    exhibits: dict[str, dict[str, Any]],
) -> list[str]:
    terms: list[Any] = [route.get("name"), *route.get("keywords", []), *route.get("aliases", [])]
    for point_id in route.get("pointIds", []):
        point = points.get(str(point_id), {})
        exhibit = exhibits.get(str(point.get("exhibitId", "")), {})
        exhibitor = exhibitors.get(str(point.get("exhibitorId", "")), {}) or exhibitors.get(str(exhibit.get("exhibitorId", "")), {})
        terms.extend([point.get("name"), point.get("code"), exhibit.get("name"), exhibit.get("modelNo"), exhibitor.get("name"), exhibitor.get("boothCode")])
    return list(dict.fromkeys(_normalize_navigation_text(term) for term in terms if _normalize_navigation_text(term)))


def _shopping_match_terms(
    strategy: dict[str, Any],
    exhibits: dict[str, dict[str, Any]],
    exhibitors: dict[str, dict[str, Any]],
    exhibit_ids: list[str],
) -> list[tuple[str, str]]:
    terms: list[Any] = [strategy.get("name"), *strategy.get("tags", []), *strategy.get("aliases", [])]
    for exhibit_id in exhibit_ids:
        exhibit = exhibits.get(exhibit_id, {})
        exhibitor = exhibitors.get(str(exhibit.get("exhibitorId", "")), {})
        terms.extend([
            exhibit.get("name"), exhibit.get("modelNo"), exhibit.get("category"),
            exhibitor.get("name"), exhibitor.get("boothCode"), exhibitor.get("category"),
        ])
    result: list[tuple[str, str]] = []
    seen: set[str] = set()
    for value in terms:
        original = str(value or "").strip()
        normalized = _normalize_navigation_text(original)
        if normalized and normalized not in seen:
            seen.add(normalized)
            result.append((original, normalized))
    return result


@router.post("/exhibitions/{exhibition_id}/shopping/query")
def shopping_query(exhibition_id: str, request: Request, body: ShoppingQueryBody) -> dict[str, Any]:
    """Deterministic database-backed virtual shopping match; no LLM is involved."""
    store = get_store(request)
    if exhibition_id == "current":
        current = next((item for item in store.list_records("exhibitions") if item.get("isCurrent") or item.get("is_current")), None)
        if not current:
            raise HTTPException(status_code=404, detail={"code": "CURRENT_EXHIBITION_NOT_FOUND", "detail": "当前展会未配置"})
        exhibition_id = str(current["id"])
    _record(store, "exhibitions", exhibition_id)
    query = _normalize_navigation_text(body.text)
    exhibits = {str(item["id"]): item for item in store.list_records("exhibits", exhibition_id=exhibition_id)}
    exhibitors = {str(item["id"]): item for item in store.list_records("exhibitors", exhibition_id=exhibition_id)}
    strategies = [
        item for item in store.list_records("interaction_shopping", exhibition_id=exhibition_id)
        if item.get("status", "active") == "active"
    ]
    ranked: list[tuple[float, int, dict[str, Any], str, list[str]]] = []
    for strategy in strategies:
        strategy_id = str(strategy.get("id") or "")
        exhibit_ids = [
            str(value) for value in store.get_links("interaction_shopping", strategy_id, "exhibits")
            if str(value) in exhibits
        ]
        if not exhibit_ids:
            exhibit_ids = [str(value) for value in strategy.get("exhibitIds", strategy.get("exhibit_ids", [])) if str(value) in exhibits]
        best_score, best_term = 0.0, ""
        for original, normalized in _shopping_match_terms(strategy, exhibits, exhibitors, exhibit_ids):
            score = _navigation_similarity(query, normalized)
            if score > best_score:
                best_score, best_term = score, original
        threshold = 0.66 if strategy.get("fuzzyMatch", strategy.get("fuzzy_match", True)) else 1.0
        if best_score >= threshold:
            ranked.append((best_score, len(_normalize_navigation_text(best_term)), strategy, best_term, exhibit_ids))
    ranked.sort(key=lambda item: (item[0], item[1], str(item[2].get("updatedAt") or item[2].get("updated_at") or "")), reverse=True)
    if not ranked:
        # 展品调研二维码属于展品自身配置，不应强制要求额外创建导购策略。
        # 数字人前端会使用展品规范名称查询，因此优先做名称精确匹配。
        survey_exhibit = next((
            item for item in exhibits.values()
            if _normalize_navigation_text(item.get("name")) == query
            and str(item.get("surveyToken") or item.get("survey_token") or "").strip()
        ), None)
        if not survey_exhibit:
            return {"matched": False}
        token = str(survey_exhibit.get("surveyToken") or survey_exhibit.get("survey_token") or "").strip()
        exhibit_id = str(survey_exhibit["id"])
        return {
            "language": body.language,
            "matched": True,
            "title": str(survey_exhibit.get("name") or "展品登记"),
            "spoken_text": _public_description(survey_exhibit.get("description")),
            "registration_prompt": (
                "Would you like me to display the registration QR code?"
                if body.language == "en-US"
                else "需要为您弹出登记二维码吗？"
            ),
            "confirmation_retry_prompt": (
                "Please answer yes or no to registration."
                if body.language == "en-US"
                else "请回答需要或不需要登记。"
            ),
            "confirm_keywords": (["yes", "okay", "register", "agree"] if body.language == "en-US" else ["需要", "好的", "可以", "同意", "登记", "我要登记"]),
            "decline_keywords": (["no", "not now", "cancel", "do not register"] if body.language == "en-US" else ["不需要", "不用", "不要", "暂不", "取消", "不登记"]),
            "exhibit_ids": [exhibit_id],
            "related_entity_ids": [exhibit_id],
            "survey_path": f"/survey/{token}",
        }

    _, _, strategy, matched_term, exhibit_ids = ranked[0]
    selected_exhibits = [exhibits[exhibit_id] for exhibit_id in exhibit_ids if exhibit_id in exhibits]
    spoken_text = str(strategy.get("spokenText") or strategy.get("spoken_text") or "").strip()
    if not spoken_text:
        descriptions = [_public_description(item.get("description")) for item in selected_exhibits]
        spoken_text = "；".join(value for value in descriptions if value) or f"为您找到{strategy.get('name') or '相关展品'}。"
    return {
        "language": body.language,
        "matched": True,
        "strategy_id": str(strategy.get("id") or ""),
        "matched_keyword": matched_term,
        "title": str(strategy.get("name") or "虚拟导购"),
        "spoken_text": spoken_text,
        "registration_prompt": str(strategy.get("registrationPrompt") or strategy.get("registration_prompt") or ("Would you like me to display the registration QR code?" if body.language == "en-US" else "需要为您弹出登记二维码吗？")),
        "confirmation_retry_prompt": str(strategy.get("confirmationRetryPrompt") or strategy.get("confirmation_retry_prompt") or ("Please answer yes or no to registration." if body.language == "en-US" else "请回答需要或不需要登记。")),
        "confirm_keywords": strategy.get("confirmKeywords") or strategy.get("confirm_keywords") or (["yes", "okay", "register", "agree"] if body.language == "en-US" else ["需要", "好的", "可以", "同意", "登记", "我要登记"]),
        "decline_keywords": strategy.get("declineKeywords") or strategy.get("decline_keywords") or (["no", "not now", "cancel", "do not register"] if body.language == "en-US" else ["不需要", "不用", "不要", "暂不", "取消", "不登记"]),
        "exhibit_ids": exhibit_ids,
        "related_entity_ids": exhibit_ids,
    }


@router.post("/exhibitions/{exhibition_id}/shopping/registration")
def shopping_registration(exhibition_id: str, request: Request, body: ShoppingRegistrationBody) -> dict[str, Any]:
    """Return a registration path only after the client has obtained explicit confirmation."""
    store = get_store(request)
    strategy = _record(store, "interaction_shopping", body.strategy_id)
    if exhibition_id == "current":
        exhibition_id = str(strategy.get("exhibitionId") or strategy.get("exhibition_id") or "")
    if str(strategy.get("exhibitionId") or strategy.get("exhibition_id") or "") != exhibition_id or strategy.get("status", "active") != "active":
        raise HTTPException(status_code=404, detail={"code": "SHOPPING_STRATEGY_NOT_FOUND", "detail": "导购策略不存在或未启用"})
    confirmation = _normalize_navigation_text(body.confirmation_text)
    confirm_keywords = strategy.get("confirmKeywords") or strategy.get("confirm_keywords") or (["yes", "okay", "register", "agree"] if body.language == "en-US" else ["需要", "好的", "可以", "同意", "登记", "我要登记"])
    decline_keywords = strategy.get("declineKeywords") or strategy.get("decline_keywords") or (["no", "not now", "cancel", "do not register"] if body.language == "en-US" else ["不需要", "不用", "不要", "暂不", "取消", "不登记"])

    def contains_keyword(values: list[Any]) -> bool:
        for value in values:
            keyword = _normalize_navigation_text(value)
            if keyword and (confirmation == keyword if len(keyword) == 1 else keyword in confirmation):
                return True
        return False

    if contains_keyword(decline_keywords) or not contains_keyword(confirm_keywords):
        raise HTTPException(status_code=409, detail={"code": "SHOPPING_REGISTRATION_NOT_CONFIRMED", "detail": "用户尚未明确同意登记"})
    exhibit_ids = [str(value) for value in store.get_links("interaction_shopping", body.strategy_id, "exhibits")]
    if not exhibit_ids:
        exhibit_ids = [str(value) for value in strategy.get("exhibitIds", strategy.get("exhibit_ids", []))]
    if body.exhibit_id and body.exhibit_id not in exhibit_ids:
        raise HTTPException(status_code=409, detail={"code": "SHOPPING_EXHIBIT_NOT_LINKED", "detail": "所选展品未关联当前导购策略"})
    selected_exhibit_ids = [body.exhibit_id] if body.exhibit_id else exhibit_ids
    exhibit = next((store.get_record("exhibits", exhibit_id) for exhibit_id in selected_exhibit_ids if store.get_record("exhibits", exhibit_id)), None)
    if not exhibit or str(exhibit.get("exhibitionId") or exhibit.get("exhibition_id") or "") != exhibition_id:
        raise HTTPException(status_code=409, detail={"code": "SHOPPING_EXHIBIT_REQUIRED", "detail": "导购策略尚未关联可登记展品"})
    token = str(exhibit.get("surveyToken") or "")
    if not token:
        token = secrets.token_urlsafe(18)
        exhibit = store.save_record(
            "exhibits",
            {**exhibit, "surveyToken": token, "surveyCreatedAt": utc_now()},
            exhibition_id,
        )
    return {
        "language": body.language,
        "strategy_id": body.strategy_id,
        "exhibit_id": str(exhibit["id"]),
        "title": str(exhibit.get("name") or strategy.get("name") or "登记信息"),
        "path": f"/survey/{token}",
        "spoken_text": str(strategy.get("registrationSuccessText") or strategy.get("registration_success_text") or ("The registration QR code is ready. Please scan it with your phone to complete the form." if body.language == "en-US" else "好的，登记二维码已为您打开，请使用手机扫码填写信息。")),
    }


@router.post("/exhibitions/{exhibition_id}/navigation/query")
def navigation(exhibition_id: str, request: Request, body: NavigationBody) -> dict[str, Any]:
    store = get_store(request)
    if exhibition_id == "current":
        current = next((item for item in store.list_records("exhibitions") if item.get("isCurrent")), None)
        if not current:
            raise HTTPException(status_code=404, detail={"code": "CURRENT_EXHIBITION_NOT_FOUND", "detail": "当前展会未配置"})
        exhibition_id = current["id"]
    _record(store, "exhibitions", exhibition_id)
    query = _normalize_navigation_text(body.text)
    exhibitors = {item["id"]: item for item in store.list_records("exhibitors", exhibition_id=exhibition_id)}
    exhibits = {item["id"]: item for item in store.list_records("exhibits", exhibition_id=exhibition_id)}
    points = {item["id"]: item for item in store.list_records("points", exhibition_id=exhibition_id)}
    routes = [item for item in store.list_records("routes", exhibition_id=exhibition_id) if item.get("status") != "offline" and item.get("type", "navigation") in {"navigation", "tour"}]
    ranked: list[tuple[float, int, dict[str, Any], str]] = []
    for route in routes:
        best_score = 0.0
        best_term = ""
        for term in _route_match_terms(route, points, exhibitors, exhibits):
            score = _navigation_similarity(query, term)
            if score > best_score:
                best_score, best_term = score, term
        threshold = 0.66 if route.get("fuzzyMatch", route.get("fuzzy_match", True)) else 1.0
        if best_score >= threshold:
            ranked.append((best_score, len(best_term), route, best_term))
    ranked.sort(key=lambda item: (item[0], item[1], item[2].get("status") == "published"), reverse=True)
    route = ranked[0][2] if ranked else None

    # Keep old data usable: a uniquely configured route can still serve a clearly
    # named exhibition entity even before route aliases are populated.
    fallback_destination = ""
    if route is None and len(routes) == 1:
        for item in [*exhibitors.values(), *exhibits.values()]:
            entity_terms = [item.get(field) for field in ("name", "boothCode", "modelNo")]
            if any(_normalize_navigation_text(term) in query for term in entity_terms if _normalize_navigation_text(term)):
                route = routes[0]
                fallback_destination = str(item.get("name") or "")
                break
    if route is None:
        if body.language == "en-US":
            return {"matched": False, "language": body.language, "title": "Navigation", "spoken_text": "No matching route was found. Please provide a more specific exhibitor, exhibit, booth, or facility name.", "subtitle_text": "No matching route", "route": {"from": "Current location", "to": "", "directions": [], "estimated_minutes": None}}
        return {"matched": False, "language": body.language, "title": "导航提示", "spoken_text": "暂时没有找到匹配的路线，您可以告诉我更具体的展商、展品、展位或设施名称。", "subtitle_text": "未找到匹配路线", "route": {"from": "当前位置", "to": "", "directions": [], "estimated_minutes": None}}

    route_points = [points[point_id] for point_id in map(str, route.get("pointIds", [])) if point_id in points]
    origin = route_points[0].get("name", "当前位置") if route_points else "当前位置"
    destination = fallback_destination or (route_points[-1].get("name", route.get("name", "目标位置")) if route_points else route.get("name", "目标位置"))
    directions = [str(value).strip() for value in route.get("directions", []) if str(value).strip()]
    spoken_text = str(route.get("spokenText") or route.get("spoken_text") or "").strip() or "。".join(value.rstrip("。") for value in directions)
    if not spoken_text:
        spoken_text = f"请按照现场引导前往{destination}。"
    image_urls = _public_image_urls(route, route_points[-1] if route_points else None)
    return {
        "language": body.language,
        "matched": True,
        "route_id": route.get("id"),
        "matched_keyword": ranked[0][3] if ranked else "",
        "title": route.get("name") or f"前往{destination}",
        "spoken_text": spoken_text,
        "subtitle_text": spoken_text,
        "image_url": image_urls[0] if image_urls else None,
        "image_urls": image_urls,
        "route": {"from": origin, "to": destination, "directions": directions, "estimated_minutes": route.get("estimatedMinutes")},
    }


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
public_router.add_api_route("/exhibitions/{exhibition_id}/shopping/query", shopping_query, methods=["POST"])
public_router.add_api_route("/exhibitions/{exhibition_id}/shopping/registration", shopping_registration, methods=["POST"])
