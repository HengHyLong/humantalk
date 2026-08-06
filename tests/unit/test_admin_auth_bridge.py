from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace

from fastapi import FastAPI
from fastapi.testclient import TestClient

from apps.api.admin import AdminStore
from apps.api.admin.routes import router as admin_router
from apps.api.routes import admin_assets, admin_ops


def _client(tmp_path: Path) -> TestClient:
    settings = SimpleNamespace(
        admin_sqlite_path=str(tmp_path / "admin.sqlite3"),
        admin_initialize_defaults=True,
        admin_jwt_secret="test-secret-that-is-long-enough-for-hs256",
        admin_access_token_minutes=30,
        admin_refresh_token_days=7,
        admin_username="admin",
        admin_password="Admin@123456",
        admin_role="sys_admin",
        admin_token_ttl_sec=3600,
        admin_data_dir=str(tmp_path / "content"),
    )
    app = FastAPI()
    app.state.settings = settings
    app.state.admin_store = AdminStore(settings.admin_sqlite_path, True)
    app.include_router(admin_router)
    app.include_router(admin_assets.router, prefix="/api/v1")
    app.include_router(admin_ops.router, prefix="/api/v1")
    return TestClient(app)


def test_jwt_and_compat_admin_tokens_work_across_asset_routers(tmp_path: Path) -> None:
    with _client(tmp_path) as client:
        jwt_login = client.post("/api/v1/auth/login", json={"username": "admin", "password": "Admin@123456"})
        assert jwt_login.status_code == 200
        jwt_headers = {"Authorization": f"Bearer {jwt_login.json()['token']}"}
        assert client.get("/api/v1/admin/assets", headers=jwt_headers).status_code == 200
        assert client.get("/api/v1/admin/assets/scene-bindings", headers=jwt_headers).status_code == 200

        compat_login = client.post("/api/v1/admin/auth/login", json={"username": "admin", "password": "Admin@123456"})
        assert compat_login.status_code == 200
        compat_headers = {"Authorization": f"Bearer {compat_login.json()['token']}"}
        assert client.get("/api/v1/admin/assets", headers=compat_headers).status_code == 200
        saved = client.put(
            "/api/v1/admin/assets/scene-bindings/auth-bridge",
            headers=compat_headers,
            json={"scene": "auth-bridge", "assets": []},
        )
        assert saved.status_code == 200

        assert client.post("/api/v1/auth/logout", headers=compat_headers).status_code == 200
        assert client.get("/api/v1/admin/assets", headers=compat_headers).status_code == 401
