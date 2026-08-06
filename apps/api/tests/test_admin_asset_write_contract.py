from __future__ import annotations

import time
from io import BytesIO
from types import SimpleNamespace

from fastapi import FastAPI
from fastapi.testclient import TestClient
from PIL import Image

from apps.api.admin import AdminStore
from apps.api.admin.middleware import AdminTraceMiddleware
from apps.api.admin.routes import public_router, router


def _client(tmp_path) -> TestClient:
    settings = SimpleNamespace(
        admin_sqlite_path=str(tmp_path / "admin.sqlite3"),
        admin_initialize_defaults=True,
        admin_jwt_secret="test-secret-that-is-long-enough-for-hs256",
        admin_access_token_minutes=30,
        admin_refresh_token_days=7,
        admin_media_root=str(tmp_path / "admin-media"),
    )
    app = FastAPI()
    app.state.settings = settings
    app.state.admin_store = AdminStore(settings.admin_sqlite_path, True)
    app.state.admin_tokens = {
        "asset-token": {
            "expiresAt": int(time.time()) + 3600,
            "user": {
                "id": "user-content",
                "username": "content.operator",
                "displayName": "内容运营",
                "role": "content_ops",
                "permissions": ["asset:gif", "asset:gif:write"],
            },
        }
    }
    app.add_middleware(AdminTraceMiddleware)
    app.include_router(router)
    app.include_router(public_router)
    return TestClient(app)


def _login(client: TestClient, username: str = "admin") -> dict[str, str]:
    response = client.post("/api/v1/auth/login", json={"username": username, "password": "Admin@123456"})
    assert response.status_code == 200
    return {"Authorization": f"Bearer {response.json()['token']}"}


def _gif_bytes() -> bytes:
    image = Image.new("RGBA", (2, 2), (20, 120, 220, 255))
    payload = BytesIO()
    image.save(payload, format="GIF")
    return payload.getvalue()


def test_asset_write_contract_supports_bearer_tokens_dual_gifs_and_scene_binding(tmp_path) -> None:
    with _client(tmp_path) as client:
        headers = _login(client)
        waiting = client.post(
            "/api/v1/admin/assets/gifs",
            headers=headers,
            files={"file": ("waiting.gif", _gif_bytes(), "image/gif")},
            data={"name": "等待动画", "scene": "welcome", "tags": '["欢迎"]'},
        )
        speaking = client.post(
            "/api/v1/admin/assets/gifs/upload",
            headers=headers,
            files={"file": ("speaking.gif", _gif_bytes(), "image/gif")},
            data={"name": "讲话动画", "scene": "welcome", "tags": "讲话"},
        )
        assert waiting.status_code == 200
        assert speaking.status_code == 200
        waiting_item = waiting.json()
        speaking_item = speaking.json()
        assert waiting_item["preview_url"] == waiting_item["previewUrl"]
        assert waiting_item["duration_ms"] == waiting_item["durationMs"]
        assert waiting_item["size_bytes"] == waiting_item["sizeBytes"]
        assert waiting_item["tags"] == ["欢迎"]

        scene = client.put(
            "/api/v1/admin/assets/scene-bindings/welcome",
            headers=headers,
            json={
                "scene": "welcome",
                "assets": [{"asset_id": waiting_item["id"], "is_primary": True, "order": 0}],
                "waiting_gif_id": waiting_item["id"],
                "speaking_gif_id": speaking_item["id"],
                "voice_config_id": "voice-default",
                "idle_content_id": "idle-welcome",
                "status": "active",
            },
        )
        assert scene.status_code == 200
        assert scene.json()["assets"][0]["asset_id"] == waiting_item["id"]
        assert scene.json()["waiting_gif_id"] == waiting_item["id"]
        fetched = client.get("/api/v1/admin/assets/scene-bindings/welcome", headers=headers)
        assert fetched.status_code == 200
        assert fetched.json()["speaking_gif_id"] == speaking_item["id"]
        assert fetched.json()["voice_config_id"] == "voice-default"

        avatar = client.post(
            "/api/v1/admin/assets/avatars",
            headers=headers,
            json={
                "id": "avatar-contract",
                "name": "合同数字人",
                "status": "draft",
                "waiting_gif": waiting_item["id"],
                "speaking_gif": speaking_item["id"],
            },
        )
        assert avatar.status_code == 200
        assert avatar.json()["waiting_gif_url"] == waiting_item["preview_url"]
        listed = client.get("/api/v1/admin/assets/avatars", headers=headers)
        assert listed.status_code == 200
        listed_avatar = next(item for item in listed.json()["items"] if item["id"] == "avatar-contract")
        assert listed_avatar["speaking_gif_url"] == speaking_item["preview_url"]

        missing = client.post(
            "/api/v1/admin/assets/avatars",
            headers=headers,
            json={"id": "avatar-invalid", "waiting_gif": waiting_item["id"]},
        )
        assert missing.status_code == 400
        assert missing.json()["detail"]["code"] == "ASSET_DUAL_GIF_REQUIRED"

        compatibility = client.post(
            "/api/v1/admin/assets/gifs",
            headers={"Authorization": "Bearer asset-token"},
            files={"file": ("compat.gif", _gif_bytes(), "image/gif")},
        )
        assert compatibility.status_code == 200


def test_asset_write_permission_denial_has_traceable_contract(tmp_path) -> None:
    with _client(tmp_path) as client:
        response = client.post(
            "/api/v1/admin/assets/gifs",
            headers=_login(client, "readonly.viewer"),
            files={"file": ("denied.gif", _gif_bytes(), "image/gif")},
        )
        assert response.status_code == 403
        detail = response.json()["detail"]
        assert detail["code"] == "ASSET_PERMISSION_DENIED"
        assert detail["detail"] == "当前用户无 GIF 写入权限"
        assert detail["trace_id"]
