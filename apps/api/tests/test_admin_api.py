from __future__ import annotations

from io import BytesIO
from types import SimpleNamespace

from fastapi import FastAPI
from fastapi.testclient import TestClient
from PIL import Image

from apps.api.admin import AdminStore
from apps.api.admin.middleware import AdminTraceMiddleware
from apps.api.admin.routes import public_router, router
from apps.api.admin.security import password_hasher


def _client(tmp_path) -> TestClient:
    settings = SimpleNamespace(
        admin_sqlite_path=str(tmp_path / "admin.sqlite3"),
        admin_initialize_defaults=True,
        admin_jwt_secret="test-secret-that-is-long-enough-for-hs256",
        admin_access_token_minutes=30,
        admin_refresh_token_days=7,
        admin_media_root=str(tmp_path / "admin-media"),
        public_base_url="https://example.test",
    )
    app = FastAPI()
    app.state.settings = settings
    app.state.admin_store = AdminStore(settings.admin_sqlite_path, True)
    app.add_middleware(AdminTraceMiddleware)
    app.include_router(router)
    app.include_router(public_router)
    return TestClient(app)


def _login(client: TestClient) -> dict[str, str]:
    response = client.post("/api/v1/auth/login", json={"username": "admin", "password": "Admin@123456"})
    assert response.status_code == 200
    return {"Authorization": f"Bearer {response.json()['token']}"}


def test_admin_auth_permissions_and_refresh(tmp_path) -> None:
    with _client(tmp_path) as client:
        login = client.post("/api/v1/auth/login", json={"username": "admin", "password": "Admin@123456"})
        assert login.status_code == 200
        headers = {"Authorization": f"Bearer {login.json()['token']}"}
        permissions = client.get("/api/v1/auth/permissions", headers=headers)
        assert permissions.status_code == 200
        assert "event:exhibition" in permissions.json()["codes"]
        refreshed = client.post("/api/v1/auth/refresh", json={"refresh_token": login.json()["refresh_token"]})
        assert refreshed.status_code == 200
        assert refreshed.json()["token"]
        assert client.post("/api/v1/auth/logout", headers=headers).status_code == 200
        assert client.get("/api/v1/auth/me", headers=headers).status_code == 401


def test_exhibition_filter_and_relation_validation(tmp_path) -> None:
    with _client(tmp_path) as client:
        headers = _login(client)
        response = client.get("/api/v1/admin/event/exhibitions", params={"exhibition_id": "expo-2026"}, headers=headers)
        assert response.status_code == 200
        assert response.json()["total"] == 1
        invalid = client.post("/api/v1/admin/event/exhibits", headers=headers, json={"exhibitionId": "expo-2026", "exhibitorId": "missing", "name": "bad"})
        assert invalid.status_code == 404


def test_lead_masking_navigation_and_trace(tmp_path) -> None:
    with _client(tmp_path) as client:
        store = client.app.state.admin_store
        with store.connect() as conn:
            conn.execute("INSERT INTO admin_users(id,username,display_name,password_hash,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?)", ("user-viewer", "viewer", "数据查看", password_hasher.hash("Viewer@123456"), "active", "2026-01-01T00:00:00+00:00", "2026-01-01T00:00:00+00:00"))
            conn.execute("INSERT INTO admin_user_roles(user_id,role_id) SELECT 'user-viewer',id FROM admin_roles WHERE code='data_viewer'")
        admin_headers = {**_login(client), "X-Trace-Id": "trace-admin-test"}
        created_by_admin = client.post("/api/v1/admin/lead", headers=admin_headers, json={"id": "lead-1", "exhibitionId": "expo-2026", "phone": "13800138000", "email": "person@example.com", "status": "new"})
        assert created_by_admin.status_code == 200
        viewer_login = client.post("/api/v1/auth/login", json={"username": "viewer", "password": "Viewer@123456"})
        headers = {"Authorization": f"Bearer {viewer_login.json()['token']}", "X-Trace-Id": "trace-admin-test"}
        created = client.get("/api/v1/admin/lead/lead-1", headers=headers)
        assert created.status_code == 200
        listing = client.get("/api/v1/admin/lead", headers=headers).json()
        item = next(item for item in listing["items"] if item["id"] == "lead-1")
        assert item["phone"] == "138****8000"
        assert item["email"] == "p***@example.com"
        navigation = client.post("/exhibitions/current/navigation/query", json={"text": "怎么去智联科技", "session_id": "s1"})
        assert navigation.status_code == 200
        assert navigation.json()["route"]["to"] == "智联科技"
        trace = client.get("/api/v1/admin/audit/trace/trace-admin-test", headers=admin_headers)
        assert trace.status_code == 200
        assert trace.json()["spans"]


def test_shopping_strategy_uses_paginated_exhibit_ids(tmp_path) -> None:
    with _client(tmp_path) as client:
        headers = _login(client)
        response = client.get("/api/v1/admin/interaction/shopping-strategies/shopping-001/exhibits", params={"page": 1, "page_size": 1}, headers=headers)
        assert response.status_code == 200
        assert response.json()["items"][0]["selected"] is True
        saved = client.put("/api/v1/admin/interaction/shopping-strategies/shopping-001/exhibits", headers=headers, json={"ids": []})
        assert saved.status_code == 200
        assert saved.json()["selected_ids"] == []


def test_guide_material_lead_report_and_gif_upload(tmp_path) -> None:
    with _client(tmp_path) as client:
        headers = _login(client)

        guide = client.get("/exhibitions/current/guide/recommendations", params={"query": "智能导览"})
        assert guide.status_code == 200
        assert guide.json()["items"][0]["id"] == "exhibit-001"
        assert guide.json()["items"][0]["exhibitor"] == "智联科技"

        qr = client.get("/exhibitions/current/materials/qr", params={"item_id": "exhibit-001"})
        assert qr.status_code == 200
        assert qr.json()["url"].startswith("https://example.test/")
        assert qr.json()["qr_data_url"].startswith("data:image/png;base64,")
        material = client.get(f"/runtime/materials/{qr.json()['token']}")
        assert material.status_code == 200
        assert material.json()["exhibit_id"] == "exhibit-001"
        assert client.get("/exhibitions/expo-2027/materials/qr", params={"item_id": "exhibit-001"}).status_code == 404

        lead = client.post("/runtime/lead", json={
            "exhibitionId": "current",
            "companyName": "测试单位",
            "contactName": "张三",
            "phone": "13900000000",
            "email": "zhangsan@example.com",
            "intentSummary": "咨询智能导览终端",
            "interestedExhibitIds": ["exhibit-001"],
            "consent": True,
            "source": "web-guide",
        })
        assert lead.status_code == 200
        assert lead.json()["exhibitionId"] == "expo-2026"
        token_lead = client.post("/runtime/lead", json={
            "exhibitionId": "expo-2026",
            "companyName": "Token 单位",
            "contactName": "李四",
            "phone": "13900000001",
            "materialToken": qr.json()["token"],
            "consent": True,
        })
        assert token_lead.status_code == 200
        assert token_lead.json()["materialToken"] == qr.json()["token"]
        assert "exhibit-001" in token_lead.json()["interestedExhibitIds"]
        denied = client.post("/runtime/lead", json={"exhibitionId": "current", "companyName": "测试单位", "contactName": "张三", "phone": "13900000000", "consent": False})
        assert denied.status_code == 400

        image = Image.new("RGBA", (2, 2), (20, 120, 220, 255))
        payload = BytesIO()
        image.save(payload, format="GIF")
        upload = client.post(
            "/api/v1/admin/assets/gifs/upload",
            headers=headers,
            files={"file": ("guide.gif", payload.getvalue(), "image/gif")},
            data={"name": "导购动作", "scene": "guide", "tags": "导购,推荐"},
        )
        assert upload.status_code == 200
        uploaded = upload.json()
        assert uploaded["frames"] == 1
        assert uploaded["previewUrl"].startswith("/api/v1/admin/assets/gifs/")
        file_response = client.get(uploaded["previewUrl"], headers=headers)
        assert file_response.status_code == 200
        assert file_response.content.startswith(b"GIF")

        navigation = client.post("/exhibitions/current/navigation/query", json={"text": "怎么去智联科技", "session_id": "guide-test"})
        assert navigation.status_code == 200
        assert "alternatives" in navigation.json()
        operations = client.get("/api/v1/admin/report/operations", headers=headers)
        assert operations.status_code == 200
        assert operations.json()["summary"]["new_leads"] >= 2
        assert any(item["label"] == "navigation" for item in operations.json()["dimensions"]["interaction"])
        exported = client.get("/api/v1/admin/report/export", params={"format": "csv"}, headers=headers)
        assert exported.status_code == 200
        assert "interaction_count" in exported.text
        xlsx = client.get("/api/v1/admin/report/export", headers=headers)
        assert xlsx.headers["content-type"].startswith("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")

        scene = client.put("/api/v1/admin/assets/scene-bindings/guide", headers=headers, json={"scene": "guide", "assets": [{"asset_id": uploaded["id"], "is_primary": True, "order": 0}]})
        assert scene.status_code == 200
        assert client.get("/api/v1/admin/assets/scene-bindings/guide", headers=headers).json()["assets"][0]["asset_id"] == uploaded["id"]


def test_knowledge_workflow_contracts(tmp_path) -> None:
    with _client(tmp_path) as client:
        headers = _login(client)
        created = client.post("/api/v1/admin/knowledge/qa", headers=headers, json={
            "id": "qa-contract",
            "exhibitionId": "expo-2026",
            "question": "合同测试问题",
            "answer": "合同测试答案",
            "keywords": ["合同"],
            "category": "服务",
            "status": "draft",
            "version": 1,
            "history": [{"version": 1, "question": "合同测试问题", "answer": "合同测试答案", "keywords": ["合同"], "category": "服务", "reason": "创建"}],
        })
        assert created.status_code == 200
        assert client.post("/api/v1/admin/knowledge/qa/qa-contract/transition", headers=headers, json={"status": "published"}).status_code == 400
        assert client.post("/api/v1/admin/knowledge/qa/qa-contract/transition", headers=headers, json={"status": "pending_review"}).status_code == 200
        assert client.post("/api/v1/admin/knowledge/qa/qa-contract/transition", headers=headers, json={"status": "published"}).status_code == 200
        versions = client.get("/api/v1/admin/knowledge/qa/qa-contract/versions", headers=headers)
        assert versions.status_code == 200
        assert versions.json()["total"] >= 2
        rolled_back = client.post("/api/v1/admin/knowledge/qa/qa-contract/rollback", headers=headers, json={"version": 1, "reason": "恢复合同测试版本"})
        assert rolled_back.status_code == 200
        assert rolled_back.json()["status"] == "draft"

        package = client.post("/api/v1/admin/knowledge/packages", headers=headers, json={"id": "package-contract", "exhibitionId": "expo-2026", "name": "合同包", "status": "draft", "version": 1})
        assert package.status_code == 200
        assert client.post("/api/v1/admin/knowledge/packages/package-contract/submit", headers=headers, json={}).status_code == 200
        published = client.post("/api/v1/admin/knowledge/packages/package-contract/publish", headers=headers, json={})
        assert published.status_code == 200
        assert published.json()["status"] == "published"

        miss = client.get("/api/v1/admin/knowledge/miss-pool", headers=headers).json()["items"][0]
        resolved = client.post(f"/api/v1/admin/knowledge/miss-pool/{miss['id']}/resolve", headers=headers, json={"action": "ignore", "reason": "合同测试"})
        assert resolved.status_code == 200
        assert resolved.json()["status"] == "handled"
