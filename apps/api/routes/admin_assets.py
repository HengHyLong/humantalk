from __future__ import annotations

import json
import re
import shutil
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Request, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from apps.api.routes.admin_auth import authorize_admin_request

router = APIRouter(
    prefix="/admin",
    tags=["admin-assets"],
    dependencies=[Depends(authorize_admin_request)],
)

_GIF_SIGNATURES = (b"GIF87a", b"GIF89a")
_VALID_STATUS = {"active", "inactive"}
_VALID_SCENES = {"welcome", "explain", "qa", "navigation", "shopping", "idle", "emergency"}
_COLLECTIONS = {
    "scripts": "scripts",
    "welcome-configs": "welcome_configs",
    "explain-flows": "explain_flows",
    "shopping-strategies": "shopping_strategies",
}


class SceneBindingPayload(BaseModel):
    scene: str = Field(min_length=1, max_length=100)
    assets: list[dict[str, Any]] = Field(default_factory=list)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _store(request: Request) -> "AdminContentStore":
    settings = getattr(request.app.state, "settings", None)
    root = Path(getattr(settings, "admin_data_dir", "./data/admin"))
    return AdminContentStore(root)


def _slug(value: str, fallback: str) -> str:
    normalized = re.sub(r"[^a-zA-Z0-9_-]+", "-", value.strip()).strip("-_")
    return normalized[:48] or fallback


def _read_json(path: Path, fallback: Any) -> Any:
    if not path.is_file():
        return fallback
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return fallback


def _write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(f"{path.suffix}.tmp")
    temporary.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temporary.replace(path)


def _parse_tags(raw: str | None) -> list[str]:
    value = (raw or "").strip()
    if not value:
        return []
    try:
        parsed = json.loads(value)
    except json.JSONDecodeError:
        parsed = value.split(",")
    if not isinstance(parsed, list):
        raise HTTPException(status_code=400, detail="tags must be a JSON array or comma-separated string")
    return list(dict.fromkeys(str(item).strip() for item in parsed if str(item).strip()))


def _gif_metadata(content: bytes) -> tuple[int, int, int]:
    if not content.startswith(_GIF_SIGNATURES) or len(content) < 10:
        raise HTTPException(status_code=400, detail="unsupported GIF content")
    width = int.from_bytes(content[6:8], "little")
    height = int.from_bytes(content[8:10], "little")
    frames = max(1, content.count(b"\x2c"))
    if not width or not height:
        raise HTTPException(status_code=400, detail="GIF dimensions are invalid")
    return width, height, frames


def _asset_id(value: str) -> bool:
    return bool(re.fullmatch(r"gif-[a-f0-9]{10,32}", value or ""))


def _voice_id(value: str) -> bool:
    return bool(re.fullmatch(r"[A-Za-z0-9_-]{3,120}", value or ""))


class AdminContentStore:
    def __init__(self, root: Path) -> None:
        self.root = root.expanduser().resolve()
        self.asset_dir = self.root / "gifs"
        self.gif_index = self.asset_dir / "index.json"

    def _collection_path(self, name: str) -> Path:
        return self.root / f"{name}.json"

    def list_collection(self, name: str) -> list[dict[str, Any]]:
        value = _read_json(self._collection_path(name), [])
        return [item for item in value if isinstance(item, dict)] if isinstance(value, list) else []

    def write_collection(self, name: str, items: list[dict[str, Any]]) -> None:
        _write_json(self._collection_path(name), items)

    def list_gifs(self) -> list[dict[str, Any]]:
        value = _read_json(self.gif_index, [])
        return [item for item in value if isinstance(item, dict)] if isinstance(value, list) else []

    def write_gifs(self, items: list[dict[str, Any]]) -> None:
        _write_json(self.gif_index, items)

    def gif_path(self, asset_id: str) -> Path | None:
        if not _asset_id(asset_id):
            return None
        path = (self.asset_dir / asset_id / "source.gif").resolve()
        try:
            path.relative_to(self.asset_dir.resolve())
        except ValueError:
            return None
        return path if path.is_file() else None

    def find_gif(self, asset_id: str) -> dict[str, Any] | None:
        return next((item for item in self.list_gifs() if item.get("id") == asset_id), None)

    def save_gif(self, item: dict[str, Any]) -> dict[str, Any]:
        items = [entry for entry in self.list_gifs() if entry.get("id") != item.get("id")]
        self.write_gifs([item, *items])
        return item

    def delete_gif(self, asset_id: str) -> bool:
        items = self.list_gifs()
        next_items = [item for item in items if item.get("id") != asset_id]
        if len(next_items) == len(items):
            return False
        self.write_gifs(next_items)
        shutil.rmtree(self.asset_dir / asset_id, ignore_errors=True)
        return True

    def find_item(self, collection: str, item_id: str) -> dict[str, Any] | None:
        return next((item for item in self.list_collection(collection) if item.get("id") == item_id), None)

    def save_item(self, collection: str, item: dict[str, Any]) -> dict[str, Any]:
        items = [entry for entry in self.list_collection(collection) if entry.get("id") != item.get("id")]
        self.write_collection(collection, [item, *items])
        return item

    def delete_item(self, collection: str, item_id: str) -> bool:
        items = self.list_collection(collection)
        next_items = [item for item in items if item.get("id") != item_id]
        if len(next_items) == len(items):
            return False
        self.write_collection(collection, next_items)
        return True


def _validate_voice(payload: dict[str, Any], *, item_id: str | None = None) -> dict[str, Any]:
    provider = str(payload.get("provider") or "").strip()
    voice_id = str(payload.get("voiceId") or payload.get("voice_id") or "").strip()
    name = str(payload.get("name") or payload.get("display_label") or "").strip()
    if not provider or not name or not _voice_id(voice_id):
        raise HTTPException(status_code=400, detail="provider, name and a safe voiceId are required")
    status = str(payload.get("status") or "active").strip()
    if status not in _VALID_STATUS:
        raise HTTPException(status_code=400, detail="status must be active or inactive")
    return {
        "id": item_id or str(payload.get("id") or f"voice-config-{uuid.uuid4().hex[:12]}"),
        "provider": provider,
        "targetModel": str(payload.get("targetModel") or payload.get("target_model") or "").strip() or None,
        "voiceId": voice_id,
        "name": name,
        "previewText": str(payload.get("previewText") or payload.get("preview_text") or "").strip(),
        "status": status,
        "source": str(payload.get("source") or "local").strip() or "local",
        "updatedAt": _now(),
        "createdAt": str(payload.get("createdAt") or payload.get("created_at") or _now()),
    }


def _collection_payload(payload: dict[str, Any], *, item_id: str | None = None, prefix: str) -> dict[str, Any]:
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="request body must be an object")
    item = dict(payload)
    item["id"] = item_id or str(item.get("id") or f"{prefix}-{uuid.uuid4().hex[:12]}")
    item["updatedAt"] = _now()
    item.setdefault("createdAt", item["updatedAt"])
    return item


def _filter_items(items: list[dict[str, Any]], exhibition_id: str | None) -> list[dict[str, Any]]:
    value = (exhibition_id or "").strip()
    if not value or value == "all":
        return items
    return [item for item in items if str(item.get("exhibitionId") or "") == value]


@router.get("/assets", response_model=None)
async def list_assets(request: Request, kind: str | None = Query(default=None)) -> list[dict[str, Any]]:
    if kind not in (None, "gif"):
        return []
    return _store(request).list_gifs()


@router.get("/assets/gifs", response_model=None)
async def list_gifs(request: Request) -> list[dict[str, Any]]:
    return _store(request).list_gifs()


@router.get("/assets/{asset_id}/file", response_model=None)
async def download_gif(asset_id: str, request: Request) -> FileResponse:
    path = _store(request).gif_path(asset_id)
    if path is None:
        raise HTTPException(status_code=404, detail="GIF asset not found")
    return FileResponse(path, media_type="image/gif")


@router.get("/assets/gifs/{asset_id}/file", response_model=None)
async def download_gif_alias(asset_id: str, request: Request) -> FileResponse:
    return await download_gif(asset_id, request)


async def _create_gif(
    request: Request,
    file: UploadFile | None,
    name: str,
    scene: str,
    tags: str,
    status: str,
    description: str,
    width: int | None,
    height: int | None,
    frames: int | None,
    duration_ms: int | None,
) -> dict[str, Any]:
    if file is None:
        raise HTTPException(status_code=400, detail="GIF file is required")
    clean_name = name.strip() or Path(file.filename or "animation.gif").stem
    if not clean_name:
        raise HTTPException(status_code=400, detail="name is required")
    clean_scene = scene.strip() or "welcome"
    if clean_scene not in _VALID_SCENES:
        raise HTTPException(status_code=400, detail="invalid GIF scene")
    if status not in _VALID_STATUS:
        raise HTTPException(status_code=400, detail="status must be active or inactive")
    settings = getattr(request.app.state, "settings", None)
    max_bytes = int(getattr(settings, "admin_asset_max_bytes", 20 * 1024 * 1024))
    content = await file.read(max_bytes + 1)
    if len(content) > max_bytes:
        raise HTTPException(status_code=413, detail="GIF asset exceeds size limit")
    parsed_width, parsed_height, parsed_frames = _gif_metadata(content)
    asset_id = f"gif-{uuid.uuid4().hex[:12]}"
    asset_dir = _store(request).asset_dir / asset_id
    asset_dir.mkdir(parents=True, exist_ok=False)
    (asset_dir / "source.gif").write_bytes(content)
    now = _now()
    item = {
        "id": asset_id,
        "name": clean_name,
        "kind": "gif",
        "previewUrl": f"/api/v1/admin/assets/{asset_id}/file",
        "scene": clean_scene,
        "tags": _parse_tags(tags),
        "status": status,
        "description": description.strip(),
        "width": width if width and width > 0 else parsed_width,
        "height": height if height and height > 0 else parsed_height,
        "frames": frames if frames and frames > 0 else parsed_frames,
        "durationMs": duration_ms if duration_ms and duration_ms > 0 else 0,
        "fileName": file.filename or f"{_slug(clean_name, 'animation')}.gif",
        "sizeBytes": len(content),
        "createdAt": now,
    }
    _store(request).save_gif(item)
    return item


@router.post("/assets", response_model=None)
async def create_gif(
    request: Request,
    file: UploadFile | None = File(default=None),
    name: str = Form(""),
    scene: str = Form("welcome"),
    tags: str = Form(""),
    status: str = Form("active"),
    description: str = Form(""),
    width: int | None = Form(default=None),
    height: int | None = Form(default=None),
    frames: int | None = Form(default=None),
    duration_ms: int | None = Form(default=None),
) -> dict[str, Any]:
    return await _create_gif(request, file, name, scene, tags, status, description, width, height, frames, duration_ms)


@router.post("/assets/gifs", response_model=None)
async def create_gif_alias(
    request: Request,
    file: UploadFile | None = File(default=None),
    name: str = Form(""),
    scene: str = Form("welcome"),
    tags: str = Form(""),
    status: str = Form("active"),
    description: str = Form(""),
    width: int | None = Form(default=None),
    height: int | None = Form(default=None),
    frames: int | None = Form(default=None),
    duration_ms: int | None = Form(default=None),
) -> dict[str, Any]:
    return await _create_gif(request, file, name, scene, tags, status, description, width, height, frames, duration_ms)


def _get_gif(request: Request, asset_id: str) -> dict[str, Any]:
    item = _store(request).find_gif(asset_id)
    if item is None:
        raise HTTPException(status_code=404, detail="GIF asset not found")
    return item


@router.get("/assets/gifs/{asset_id}", response_model=None)
async def get_gif_alias(asset_id: str, request: Request) -> dict[str, Any]:
    return _get_gif(request, asset_id)


def _update_gif(request: Request, asset_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    current = _get_gif(request, asset_id)
    next_item = dict(current)
    for field in ("name", "scene", "status", "description", "width", "height", "frames", "durationMs"):
        if field in payload:
            next_item[field] = payload[field]
    if "tags" in payload:
        raw_tags = payload["tags"]
        next_item["tags"] = list(dict.fromkeys(str(item).strip() for item in raw_tags if str(item).strip())) if isinstance(raw_tags, list) else _parse_tags(str(raw_tags))
    if str(next_item.get("scene")) not in _VALID_SCENES:
        raise HTTPException(status_code=400, detail="invalid GIF scene")
    if str(next_item.get("status")) not in _VALID_STATUS:
        raise HTTPException(status_code=400, detail="status must be active or inactive")
    next_item["updatedAt"] = _now()
    return _store(request).save_gif(next_item)


@router.patch("/assets/{asset_id}", response_model=None)
async def update_gif(asset_id: str, payload: dict[str, Any], request: Request) -> dict[str, Any]:
    return _update_gif(request, asset_id, payload)


@router.patch("/assets/gifs/{asset_id}", response_model=None)
async def update_gif_alias(asset_id: str, payload: dict[str, Any], request: Request) -> dict[str, Any]:
    return _update_gif(request, asset_id, payload)


def _delete_gif(request: Request, asset_id: str) -> dict[str, Any]:
    bindings = _store(request).list_collection("scene_bindings")
    if any(any(str(asset.get("assetId")) == asset_id for asset in item.get("assets", [])) for item in bindings):
        raise HTTPException(status_code=409, detail="GIF asset is referenced by a scene binding")
    if not _store(request).delete_gif(asset_id):
        raise HTTPException(status_code=404, detail="GIF asset not found")
    return {"id": asset_id, "deleted": True}


@router.delete("/assets/{asset_id}", response_model=None)
async def delete_gif(asset_id: str, request: Request) -> dict[str, Any]:
    return _delete_gif(request, asset_id)


@router.delete("/assets/gifs/{asset_id}", response_model=None)
async def delete_gif_alias(asset_id: str, request: Request) -> dict[str, Any]:
    return _delete_gif(request, asset_id)


@router.get("/assets/voice-configs", response_model=None)
async def list_voice_configs(request: Request) -> list[dict[str, Any]]:
    return _store(request).list_collection("voice_configs")


@router.post("/assets/voice-configs", response_model=None)
async def create_voice_config(payload: dict[str, Any], request: Request) -> dict[str, Any]:
    return _store(request).save_item("voice_configs", _validate_voice(payload))


@router.patch("/assets/voice-configs/{config_id}", response_model=None)
async def update_voice_config(config_id: str, payload: dict[str, Any], request: Request) -> dict[str, Any]:
    current = _store(request).find_item("voice_configs", config_id)
    if current is None:
        raise HTTPException(status_code=404, detail="voice config not found")
    return _store(request).save_item("voice_configs", _validate_voice({**current, **payload}, item_id=config_id))


@router.put("/assets/voice-configs/{config_id}", response_model=None)
async def upsert_voice_config(config_id: str, payload: dict[str, Any], request: Request) -> dict[str, Any]:
    current = _store(request).find_item("voice_configs", config_id) or {}
    return _store(request).save_item("voice_configs", _validate_voice({**current, **payload}, item_id=config_id))


@router.delete("/assets/voice-configs/{config_id}", response_model=None)
async def delete_voice_config(config_id: str, request: Request) -> dict[str, Any]:
    if not _store(request).delete_item("voice_configs", config_id):
        raise HTTPException(status_code=404, detail="voice config not found")
    return {"id": config_id, "deleted": True}


@router.get("/assets/scene-bindings", response_model=None)
async def list_scene_bindings(request: Request) -> list[dict[str, Any]]:
    return _store(request).list_collection("scene_bindings")


def _save_scene_bindings(request: Request, bindings: list[dict[str, Any]]) -> list[dict[str, Any]]:
    normalized: list[dict[str, Any]] = []
    for binding in bindings:
        scene = str(binding.get("scene") or "").strip()
        assets = binding.get("assets")
        if not scene or not isinstance(assets, list):
            raise HTTPException(status_code=400, detail="scene bindings require scene and assets")
        normalized_assets = [
            {
                "assetId": str(asset.get("assetId") or asset.get("asset_id") or "").strip(),
                "isPrimary": bool(asset.get("isPrimary", asset.get("is_primary", False))),
                "order": int(asset.get("order", index)),
            }
            for index, asset in enumerate(assets)
            if isinstance(asset, dict) and str(asset.get("assetId") or "").strip()
        ]
        normalized.append({"scene": scene, "assets": normalized_assets, "updatedAt": _now()})
    _store(request).write_collection("scene_bindings", normalized)
    return normalized


@router.put("/assets/scene-bindings/{scene}", response_model=None, operation_id="save_scene_binding_content")
async def save_scene_binding(scene: str, payload: SceneBindingPayload, request: Request) -> dict[str, Any]:
    if payload.scene != scene:
        raise HTTPException(status_code=400, detail="path scene must match body scene")
    current = _store(request).list_collection("scene_bindings")
    saved = {"scene": scene, "assets": payload.assets}
    return _save_scene_bindings(request, [saved, *[item for item in current if item.get("scene") != scene]])[0]


@router.get("/assets/scene-bindings/{scene}", include_in_schema=False)
async def reject_single_scene_binding_read(scene: str) -> None:
    raise HTTPException(status_code=405, detail="use GET /api/v1/admin/assets/scene-bindings to list scene bindings")


@router.delete("/assets/scene-bindings/{scene}", response_model=None, operation_id="delete_scene_binding_content")
async def delete_scene_binding(scene: str, request: Request) -> dict[str, Any]:
    current = _store(request).list_collection("scene_bindings")
    if not any(item.get("scene") == scene for item in current):
        raise HTTPException(status_code=404, detail="scene binding not found")
    _store(request).write_collection("scene_bindings", [item for item in current if item.get("scene") != scene])
    return {"id": f"scene-{scene}", "scene": scene, "deleted": True}


@router.get("/assets/idle-contents", response_model=None)
async def list_idle_contents(request: Request) -> list[dict[str, Any]]:
    return _store(request).list_collection("idle_contents")


def _normalize_idle(payload: dict[str, Any], *, item_id: str | None = None) -> dict[str, Any]:
    item = _collection_payload(payload, item_id=item_id, prefix="idle")
    if not str(item.get("title") or "").strip() or not str(item.get("content") or "").strip():
        raise HTTPException(status_code=400, detail="idle content title and content are required")
    try:
        interval = int(item.get("interval", 8))
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=400, detail="idle interval must be an integer") from exc
    if not 1 <= interval <= 3600:
        raise HTTPException(status_code=400, detail="idle interval must be between 1 and 3600 seconds")
    item["interval"] = interval
    item["enabled"] = bool(item.get("enabled", True))
    return item


@router.post("/assets/idle-contents", response_model=None)
async def create_idle_content(payload: dict[str, Any], request: Request) -> dict[str, Any]:
    return _store(request).save_item("idle_contents", _normalize_idle(payload))


@router.patch("/assets/idle-contents/{item_id}", response_model=None)
async def update_idle_content(item_id: str, payload: dict[str, Any], request: Request) -> dict[str, Any]:
    current = _store(request).find_item("idle_contents", item_id)
    if current is None:
        raise HTTPException(status_code=404, detail="idle content not found")
    return _store(request).save_item("idle_contents", _normalize_idle({**current, **payload}, item_id=item_id))


@router.put("/assets/idle-contents/{item_id}", response_model=None)
async def upsert_idle_content(item_id: str, payload: dict[str, Any], request: Request) -> dict[str, Any]:
    return _store(request).save_item("idle_contents", _normalize_idle(payload, item_id=item_id))


@router.delete("/assets/idle-contents/{item_id}", response_model=None)
async def delete_idle_content(item_id: str, request: Request) -> dict[str, Any]:
    if not _store(request).delete_item("idle_contents", item_id):
        raise HTTPException(status_code=404, detail="idle content not found")
    return {"id": item_id, "deleted": True}


@router.get("/interaction/{resource}", response_model=None)
async def list_interaction_resource(resource: str, request: Request, exhibition_id: str | None = Query(default=None)) -> list[dict[str, Any]]:
    collection = _COLLECTIONS.get(resource)
    if collection is None:
        raise HTTPException(status_code=404, detail="interaction resource not found")
    return _filter_items(_store(request).list_collection(collection), exhibition_id)


async def _create_interaction(resource: str, payload: dict[str, Any], request: Request) -> dict[str, Any]:
    collection = _COLLECTIONS.get(resource)
    if collection is None:
        raise HTTPException(status_code=404, detail="interaction resource not found")
    return _store(request).save_item(collection, _collection_payload(payload, prefix=resource.rstrip("s")))


@router.post("/interaction/{resource}", response_model=None)
async def create_interaction_resource(resource: str, payload: dict[str, Any], request: Request) -> dict[str, Any]:
    return await _create_interaction(resource, payload, request)


@router.put("/interaction/{resource}/{item_id}", response_model=None)
async def upsert_interaction_resource(resource: str, item_id: str, payload: dict[str, Any], request: Request) -> dict[str, Any]:
    collection = _COLLECTIONS.get(resource)
    if collection is None:
        raise HTTPException(status_code=404, detail="interaction resource not found")
    return _store(request).save_item(collection, _collection_payload(payload, item_id=item_id, prefix=resource.rstrip("s")))


@router.patch("/interaction/{resource}/{item_id}", response_model=None)
async def update_interaction_resource(resource: str, item_id: str, payload: dict[str, Any], request: Request) -> dict[str, Any]:
    collection = _COLLECTIONS.get(resource)
    if collection is None:
        raise HTTPException(status_code=404, detail="interaction resource not found")
    current = _store(request).find_item(collection, item_id)
    if current is None:
        raise HTTPException(status_code=404, detail="interaction resource item not found")
    return _store(request).save_item(collection, _collection_payload({**current, **payload}, item_id=item_id, prefix=resource.rstrip("s")))


@router.delete("/interaction/{resource}/{item_id}", response_model=None)
async def delete_interaction_resource(resource: str, item_id: str, request: Request) -> dict[str, Any]:
    collection = _COLLECTIONS.get(resource)
    if collection is None:
        raise HTTPException(status_code=404, detail="interaction resource not found")
    if not _store(request).delete_item(collection, item_id):
        raise HTTPException(status_code=404, detail="interaction resource item not found")
    return {"id": item_id, "deleted": True}


@router.get("/assets/{asset_id}", response_model=None)
async def get_gif(asset_id: str, request: Request) -> dict[str, Any]:
    return _get_gif(request, asset_id)
