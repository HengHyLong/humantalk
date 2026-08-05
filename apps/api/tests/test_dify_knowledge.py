from __future__ import annotations

import json

import httpx
import pytest
from fastapi import FastAPI

from apps.api.routes import dify_knowledge as dify_routes
from apps.api.services.dify_knowledge import DifyKnowledgeClient
from opentalking.core.config import Settings


@pytest.mark.asyncio
async def test_dify_client_keeps_key_server_side_and_maps_core_endpoints() -> None:
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        if request.url.path.endswith("/indexing-status"):
            return httpx.Response(200, json={"data": [{"indexing_status": "completed"}]})
        return httpx.Response(200, json={"ok": True, "path": request.url.path})

    client = DifyKnowledgeClient(
        Settings(
            dify_api_base_url="https://dify.test/v1/",
            dify_dataset_api_key="dataset-secret",
        ),
        transport=httpx.MockTransport(handler),
    )

    await client.request("GET", "/datasets", params={"page": 1, "keyword": None})
    await client.request(
        "POST", "/datasets/kb-1/retrieve", json={"query": "展会在哪里"}
    )
    status = await client.request(
        "GET", "/datasets/kb-1/documents/batch-1/indexing-status"
    )

    assert [request.url.path for request in requests] == [
        "/v1/datasets",
        "/v1/datasets/kb-1/retrieve",
        "/v1/datasets/kb-1/documents/batch-1/indexing-status",
    ]
    assert requests[0].headers["Authorization"] == "Bearer dataset-secret"
    assert "dataset-secret" not in str(requests[0].url)
    assert requests[0].url.query == b"page=1"
    assert json.loads(requests[1].content) == {"query": "展会在哪里"}
    assert status["data"][0]["indexing_status"] == "completed"


@pytest.mark.asyncio
async def test_dify_proxy_reports_unconfigured_without_exposing_secret(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    settings = Settings(dify_api_base_url="", dify_dataset_api_key="")
    monkeypatch.delenv("DIFY_API_BASE_URL", raising=False)
    monkeypatch.delenv("DIFY_DATASET_API_KEY", raising=False)
    monkeypatch.setattr(dify_routes, "get_settings", lambda: settings)
    app = FastAPI()
    app.include_router(dify_routes.router)

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://testserver"
    ) as client:
        status = await client.get("/api/v1/admin/knowledge/dify/status")
        datasets = await client.get("/api/v1/admin/knowledge/dify/datasets")

    assert status.status_code == 200
    assert status.json() == {"configured": False}
    assert datasets.status_code == 503
    assert datasets.json()["detail"]["code"] == "DIFY_NOT_CONFIGURED"
