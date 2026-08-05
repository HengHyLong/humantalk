from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI
from fastapi.testclient import TestClient

from apps.api.routes import admin_assets, admin_ops
from opentalking.core.config import Settings
from opentalking.core.in_memory_redis import InMemoryRedis


def _client(tmp_path: Path, role: str = "sys_admin") -> TestClient:
    app = FastAPI()
    app.state.settings = Settings(
        cors_origins="*",
        admin_data_dir=str(tmp_path / role),
        admin_role=role,
        redis_url="redis://localhost:6379/0",
    )
    app.state.redis = InMemoryRedis()
    app.include_router(admin_assets.router, prefix="/api/v1")
    app.include_router(admin_ops.router, prefix="/api/v1")
    return TestClient(app)


def _login(client: TestClient) -> None:
    response = client.post(
        "/api/v1/admin/auth/login",
        json={"username": "admin", "password": "Admin@123456"},
    )
    assert response.status_code == 200
    client.headers.update({"Authorization": f"Bearer {response.json()['token']}"})


def test_admin_routes_require_authentication(tmp_path: Path) -> None:
    with _client(tmp_path) as client:
        assert client.get("/api/v1/admin/assets").status_code == 401
        assert client.get("/api/v1/admin/ops/monitor").status_code == 401
        _login(client)
        assert client.get("/api/v1/admin/auth/me").json()["role"] == "sys_admin"
        assert client.get("/api/v1/admin/assets").status_code == 200


def test_rbac_denies_operations_outside_role(tmp_path: Path) -> None:
    with _client(tmp_path, role="data_viewer") as client:
        _login(client)
        assert client.get("/api/v1/admin/report").status_code == 200
        assert client.get("/api/v1/admin/report/interaction").status_code == 200
        assert client.get("/api/v1/admin/assets").status_code == 403

        # A report viewer can export and read reports, but cannot mutate assets.
        assert client.get("/api/v1/admin/report/export").status_code == 200
        assert client.post("/api/v1/admin/report/events", json={"eventType": "interaction"}).status_code == 403


def test_logout_revokes_token(tmp_path: Path) -> None:
    with _client(tmp_path) as client:
        _login(client)
        assert client.get("/api/v1/admin/health").status_code == 200
        assert client.post("/api/v1/admin/auth/logout").status_code == 200
        assert client.get("/api/v1/admin/health").status_code == 401
