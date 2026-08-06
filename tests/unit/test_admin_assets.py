from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace

from fastapi import FastAPI
from fastapi.testclient import TestClient

from apps.api.routes import admin_assets, admin_ops


GIF_BYTES = b"GIF89a\x01\x00\x01\x00\x00\x00\x00\x00\x00\x00;"


def _client(tmp_path: Path) -> TestClient:
    app = FastAPI()
    app.state.settings = SimpleNamespace(admin_data_dir=str(tmp_path / "admin"), admin_asset_max_bytes=1024)
    app.include_router(admin_assets.router, prefix="/api/v1")
    app.include_router(admin_ops.router, prefix="/api/v1")
    client = TestClient(app)
    login = client.post("/api/v1/admin/auth/login", json={"username": "admin", "password": "Admin@123456"})
    assert login.status_code == 200
    client.headers.update({"Authorization": f"Bearer {login.json()['token']}"})
    return client


def test_admin_gif_upload_update_preview_and_delete(tmp_path: Path) -> None:
    with _client(tmp_path) as client:
        response = client.post(
            "/api/v1/admin/assets",
            data={"name": "欢迎动作", "scene": "welcome", "tags": '["欢迎", "微笑"]'},
            files={"file": ("welcome.gif", GIF_BYTES, "image/gif")},
        )
        assert response.status_code == 200
        item = response.json()
        assert item["kind"] == "gif"
        assert item["width"] == 1
        assert item["height"] == 1
        assert item["fileName"] == "welcome.gif"
        assert "filename" not in item
        assert item["tags"] == ["欢迎", "微笑"]

        listed = client.get("/api/v1/admin/assets?kind=gif")
        assert listed.status_code == 200
        assert listed.json()[0]["id"] == item["id"]

        preview = client.get(item["previewUrl"])
        assert preview.status_code == 200
        assert preview.headers["content-type"].startswith("image/gif")
        assert preview.content == GIF_BYTES

        updated = client.patch(
            f"/api/v1/admin/assets/{item['id']}",
            json={"name": "更新后的动作", "status": "inactive", "tags": ["待机"]},
        )
        assert updated.status_code == 200
        assert updated.json()["name"] == "更新后的动作"
        assert updated.json()["status"] == "inactive"

        deleted = client.delete(f"/api/v1/admin/assets/{item['id']}")
        assert deleted.status_code == 200
        assert deleted.json()["deleted"] is True
        assert client.get(f"/api/v1/admin/assets/{item['id']}").status_code == 404


def test_admin_gif_delete_rejects_scene_binding_reference(tmp_path: Path) -> None:
    with _client(tmp_path) as client:
        item = client.post(
            "/api/v1/admin/assets/gifs",
            data={"name": "待机动作"},
            files={"file": ("idle.gif", GIF_BYTES, "image/gif")},
        ).json()
        saved = client.put(
            "/api/v1/admin/assets/scene-bindings/idle",
            json={"scene": "idle", "assets": [{"assetId": item["id"], "isPrimary": True, "order": 0}]},
        )
        assert saved.status_code == 200
        deleted = client.delete(f"/api/v1/admin/assets/{item['id']}")
        assert deleted.status_code == 409


def test_scene_binding_uses_collection_read_and_item_write_contract(tmp_path: Path) -> None:
    with _client(tmp_path) as client:
        saved = client.put(
            "/api/v1/admin/assets/scene-bindings/welcome",
            json={"scene": "welcome", "assets": []},
        )
        assert saved.status_code == 200
        assert saved.json()["scene"] == "welcome"
        fetched = client.get("/api/v1/admin/assets/scene-bindings/welcome")
        assert fetched.status_code == 200
        assert fetched.json()["scene"] == "welcome"
        assert fetched.json()["status"] == "active"
        listed = client.get("/api/v1/admin/assets/scene-bindings")
        assert listed.status_code == 200
        assert any(item["scene"] == "welcome" for item in listed.json())

        deleted = client.delete("/api/v1/admin/assets/scene-bindings/welcome")
        assert deleted.status_code == 200
        assert deleted.json() == {"id": "scene-welcome", "scene": "welcome", "deleted": True}
        assert client.delete("/api/v1/admin/assets/scene-bindings/welcome").status_code == 404


def test_admin_voice_idle_and_interaction_resources_persist(tmp_path: Path) -> None:
    with _client(tmp_path) as client:
        voice = client.put(
            "/api/v1/admin/assets/voice-configs/voice-local-test",
            json={
                "provider": "edge",
                "voiceId": "zh-CN-XiaoxiaoNeural",
                "name": "中文女声",
                "previewText": "欢迎",
            },
        )
        assert voice.status_code == 200
        assert client.get("/api/v1/admin/assets/voice-configs").json()[0]["voiceId"] == "zh-CN-XiaoxiaoNeural"

        idle = client.put(
            "/api/v1/admin/assets/idle-contents/idle-test",
            json={"type": "标语轮播", "title": "欢迎语", "content": "欢迎参观", "interval": 8, "enabled": True},
        )
        assert idle.status_code == 200
        assert client.get("/api/v1/admin/assets/idle-contents").json()[0]["id"] == "idle-test"

        flow = client.put(
            "/api/v1/admin/interaction/explain-flows/explain-test",
            json={"name": "机器人讲解", "exhibitionId": "exhibition-1", "keywords": ["机器人"]},
        )
        assert flow.status_code == 200
        assert client.get("/api/v1/admin/interaction/explain-flows?exhibition_id=exhibition-1").json()[0]["id"] == "explain-test"

        deleted = client.delete("/api/v1/admin/interaction/explain-flows/explain-test")
        assert deleted.status_code == 200
        assert client.get("/api/v1/admin/interaction/explain-flows").json() == []
