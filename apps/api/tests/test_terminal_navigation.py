import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from types import SimpleNamespace

from apps.api.routes import qa
from apps.api.services.exhibition_lookup import lookup, database_answer
from apps.api.tests.test_exhibition_matching import Store
from apps.api.tests.test_dify_chat import business_store
from opentalking.core.in_memory_redis import InMemoryRedis


def route_store():
    store = Store()
    store.data["points"][-1] = {"id": "booth", "name": "机器人展台"}
    store.data["routes"][0].update(name="终端至机器人展台", spokenText="从东门出发，直走到机器人展台。", imageUrls=["/route-map.png"])
    return store


@pytest.mark.parametrize("question", ["我想去机器人展台", "去机器人展台", "从终端去机器人展台", "从终端出发去机器人展台", "我想从这里到机器人展台"])
def test_terminal_route_uses_its_validated_start_and_route_image(question):
    result = lookup(route_store(), "expo", question)
    assert result.reason == "route_valid" and result.origin_id == "east"
    assert result.route["image_urls"] == ["/route-map.png"]
    assert result.route["image_url"] == "/route-map.png"
    assert result.route["title"] == "终端至机器人展台"
    assert database_answer(result, question, "zh-CN") == "从东门出发，直走到机器人展台。"


def test_terminal_origin_followup_retains_destination():
    result = lookup(route_store(), "expo", "从终端出发", pending_destination_id="booth")
    assert result.reason == "route_valid" and result.destination_id == "booth"
    assert lookup(route_store(), "expo", "从这里出发", pending_destination_id="booth").reason == "route_valid"


def test_terminal_inference_does_not_override_config_or_explicit_origin():
    store = route_store()
    assert lookup(store, "expo", "从不存在的地方去机器人展台").reason == "route_origin_unknown"
    assert lookup(store, "expo", "从西门去机器人展台").reason == "route_missing_from_origin"
    store.data["runtime_configs"] = [{"id": "expo", "terminalPointId": "west"}]
    assert lookup(store, "expo", "我想去机器人展台").reason == "route_missing_from_origin"
    store.data["runtime_configs"][0]["terminalPointId"] = "missing"
    assert lookup(store, "expo", "从终端去机器人展台").reason == "route_origin_unknown"


def test_conflicting_or_multiple_terminal_origins_are_not_guessed():
    store = route_store()
    store.data["routes"][0]["pointIds"] = ["east", "west"]
    assert lookup(store, "expo", "去机器人展台").reason == "route_config_conflict"
    store = route_store()
    store.data["routes"].append({"id": "r2", "name": "终端至机器人展台", "pointIds": ["west", "booth"], "spokenText": "从西门到机器人展台。"})
    assert lookup(store, "expo", "去机器人展台").reason == "route_origin_required"


def test_qa_route_popup_and_followup_are_navigation_not_entity_cards(tmp_path, monkeypatch):
    store = business_store(tmp_path)
    route = store.get_record("routes", "route")
    store.save_record("routes", {**route, "name": "终端至A01展位", "imageUrls": ["/route-map.png"]}, "expo")
    store.save_record("runtime_configs", {"id": "expo", "terminalPointId": ""}, "expo")
    app = FastAPI()
    app.state.redis = InMemoryRedis()
    app.state.admin_store = store
    app.state.settings = SimpleNamespace(dify_chat_base_url="", dify_chat_api_key="")
    app.include_router(qa.router)
    async def session(*args):
        return {"state": "ready", "model": "mock"}
    monkeypatch.setattr(qa.session_service, "get_session", session)
    client = TestClient(app)
    for question in ["我想去A01展位", "从终端出发"]:
        response = client.post("/exhibitions/expo/qa/query", json={"session_id": "sid", "turn_id": question, "question": question})
        assert response.status_code == 200
        result = response.json()
        assert result["match_type"] == "database" and result["routing_reason"] == "route_valid"
        assert result["navigation"]["image_urls"] == ["/route-map.png"]
        assert result["navigation"]["image_url"] == "/route-map.png"
        assert result["related_entities"] == []
    store.save_record("routes", {**route, "name": "入口至A01展位"}, "expo")
    response = client.post("/exhibitions/expo/qa/query", json={"session_id": "other", "turn_id": "t", "question": "去A01展位"})
    assert response.json()["routing_reason"] == "route_origin_required"
    assert response.json()["navigation"] is None and response.json()["related_entities"] == []
