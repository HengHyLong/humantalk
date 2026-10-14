from __future__ import annotations

import asyncio

from fastapi import FastAPI
from fastapi.testclient import TestClient

from apps.api.admin import AdminStore
from apps.api.routes.remote_questions import router
from opentalking.core.in_memory_redis import InMemoryRedis
from opentalking.core.session_store import session_key


def _client(tmp_path):
    store = AdminStore(tmp_path / "admin.sqlite3", initialize_defaults=False)
    store.save_record("exhibitions", {"id": "expo-test", "name": "测试展会"})
    redis_client = InMemoryRedis()
    asyncio.run(redis_client.hset(session_key("sess-test"), mapping={"session_id": "sess-test", "state": "ready"}))
    app = FastAPI()
    app.state.admin_store = store
    app.state.redis = redis_client
    app.include_router(router)
    return TestClient(app), redis_client


def test_phone_can_submit_but_only_display_can_take_questions(tmp_path):
    client, _ = _client(tmp_path)
    pair_response = client.post("/remote-questions/pair", json={"session_id": "sess-test", "exhibition_id": "expo-test"})
    assert pair_response.status_code == 200
    pair = pair_response.json()
    token = pair["token"]
    assert len(token) == 32
    assert client.get(f"/remote-questions/{token}").json() == {"exhibition_name": "测试展会", "online": True}
    assert client.post(f"/remote-questions/{token}/questions", json={"question": "  科技展台怎么走？  "}).json() == {"status": "queued", "position": 1}
    assert client.post(f"/remote-questions/{token}/questions", json={"question": "还有什么展品？"}).json()["position"] == 2
    assert client.post(f"/remote-questions/{token}/next", json={"display_key": "0" * 64}).status_code == 403
    assert client.post(f"/remote-questions/{token}/next", json={"display_key": pair["display_key"]}).json() == {"question": "科技展台怎么走？"}
    assert client.post(f"/remote-questions/{token}/next", json={"display_key": pair["display_key"]}).json() == {"question": "还有什么展品？"}
    assert client.post(f"/remote-questions/{token}/next", json={"display_key": pair["display_key"]}).json() == {"question": None}


def test_pair_rejects_closed_sessions_and_limits_anonymous_submissions(tmp_path):
    client, redis_client = _client(tmp_path)
    pair = client.post("/remote-questions/pair", json={"session_id": "sess-test", "exhibition_id": "expo-test"}).json()
    token = pair["token"]
    for index in range(12):
        assert client.post(f"/remote-questions/{token}/questions", json={"question": f"问题 {index}"}).status_code == 200
    assert client.post(f"/remote-questions/{token}/questions", json={"question": "问题 13"}).status_code == 429
    asyncio.run(redis_client.hset(session_key("sess-test"), mapping={"state": "closed"}))
    assert client.get(f"/remote-questions/{token}").status_code == 410
    assert client.post(f"/remote-questions/{token}/questions", json={"question": "还有问题"}).status_code == 410
    assert client.post(f"/remote-questions/{token}/next", json={"display_key": pair["display_key"]}).status_code == 410
