from __future__ import annotations

from types import SimpleNamespace

from fastapi import FastAPI
from fastapi.testclient import TestClient

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
