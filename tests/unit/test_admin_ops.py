from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI
from fastapi.testclient import TestClient

from apps.api.routes import admin_ops
from opentalking.core.config import Settings
from opentalking.core.in_memory_redis import InMemoryRedis


def _client(tmp_path: Path) -> TestClient:
    app = FastAPI()
    app.state.settings = Settings(
        cors_origins="*",
        admin_data_dir=str(tmp_path / "admin"),
        redis_url="redis://localhost:6379/0",
    )
    app.state.redis = InMemoryRedis()
    app.include_router(admin_ops.router, prefix="/api/v1")
    client = TestClient(app)
    login = client.post("/api/v1/admin/auth/login", json={"username": "admin", "password": "Admin@123456"})
    assert login.status_code == 200
    client.headers.update({"Authorization": f"Bearer {login.json()['token']}"})
    return client


def test_admin_login_and_runtime_monitor_use_real_backend_state(tmp_path: Path) -> None:
    with _client(tmp_path) as client:
        unauthorized = client.post("/api/v1/admin/auth/login", json={"username": "admin", "password": "wrong"})
        assert unauthorized.status_code == 401

        login = client.post("/api/v1/admin/auth/login", json={"username": "admin", "password": "Admin@123456"})
        assert login.status_code == 200
        assert login.json()["user"]["role"] == "sys_admin"

        queue = client.get("/api/v1/admin/queue/status")
        assert queue.status_code == 200
        assert queue.json()["queue_size"] == 0

        monitor = client.get("/api/v1/admin/ops/monitor")
        assert monitor.status_code == 200
        payload = monitor.json()
        assert payload["queue"]["queue_size"] == 0
        assert payload["services"]
        assert isinstance(payload["cpuPercent"], float)

        report = client.get("/api/v1/admin/report")
        assert report.status_code == 200
        assert report.json()["metrics"]


def test_admin_report_aggregates_ingested_events(tmp_path: Path) -> None:
    with _client(tmp_path) as client:
        first = client.post(
            "/api/v1/admin/report/events",
            json={
                "eventType": "interaction",
                "exhibitionId": "exhibition-1",
                "terminalId": "terminal-a",
                "scene": "qa",
                "question": "机器人如何巡检？",
                "durationMs": 1200,
                "hit": True,
                "strongQaHit": True,
                "provider": "edge",
                "model": "edge",
            },
        )
        assert first.status_code == 200
        client.post(
            "/api/v1/admin/report/events",
            json={
                "eventType": "lead",
                "exhibitionId": "exhibition-1",
                "terminalId": "terminal-a",
                "scene": "shopping",
                "leadStatus": "converted",
                "durationMs": 800,
                "provider": "edge",
                "model": "edge",
            },
        )

        operations = client.get("/api/v1/admin/report/operations?exhibition_id=exhibition-1")
        assert operations.status_code == 200
        payload = operations.json()
        assert payload["interaction"]["total"] == 2
        assert payload["hit"]["strongQaHit"] == 1
        assert payload["lead"]["converted"] == 1
        assert payload["hotspot"]["items"][0]["key"] == "机器人如何巡检？"

        exported = client.get("/api/v1/admin/report/export?format=csv")
        assert exported.status_code == 200
        assert "eventType" in exported.text
