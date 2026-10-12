import json
from types import SimpleNamespace

from fastapi import FastAPI
from fastapi.testclient import TestClient

from apps.api.routes import qa
from apps.api.services.dify_chat import ChatReply, DifyChatClient
from apps.api.tests.test_dify_chat import business_store
from opentalking.core.in_memory_redis import InMemoryRedis


def flow_client(tmp_path, monkeypatch):
    app = FastAPI()
    app.state.redis = InMemoryRedis()
    store = app.state.admin_store = business_store(tmp_path)
    store.save_record("exhibitors", {**store.get_record("exhibitors", "vendor"), "description": "测试科技是一家科技展商。"}, "expo")
    store.save_record("exhibits", {**store.get_record("exhibits", "product"), "description": "机器人可以自主行走。", "surveyToken": "real-survey"}, "expo")
    store.save_record("exhibits", {"id": "product2", "name": "智慧终端", "description": "终端可以交互。", "exhibitorId": "vendor", "status": "published"}, "expo")
    app.state.settings = SimpleNamespace(dify_chat_base_url="https://dify.test/v1", dify_chat_api_key="test")
    app.include_router(qa.router)
    async def session(*args):
        return {"state": "ready", "model": "mock"}
    async def chat(self, **kwargs):
        return ChatReply("智能体回答新的问题。", "conversation")
    monkeypatch.setattr(qa.session_service, "get_session", session)
    monkeypatch.setattr(DifyChatClient, "chat", chat)
    return TestClient(app), store


def ask(client, question, selected=None, session="sid"):
    body = {"session_id": session, "turn_id": question, "question": question}
    if selected:
        body["selected_entity_id"] = selected
    response = client.post("/exhibitions/expo/qa/query", json=body)
    assert response.status_code == 200, response.text
    return response.json()


def test_exhibitor_products_selection_qr_full_flow(tmp_path, monkeypatch):
    client, _ = flow_client(tmp_path, monkeypatch)
    intro = ask(client, "介绍测试科技")
    assert intro["match_type"] == "database"
    assert "是否需要了解测试科技的展品" in intro["answer"]
    assert intro["follow_up"]["stage"] == "exhibitor_products"
    products = ask(client, "需要")
    assert products["match_type"] == "database"
    assert products["follow_up"]["stage"] == "product_selection"
    assert [c["id"] for c in products["related_entities"]] == ["product", "product2"]
    chosen = ask(client, "第一个")
    assert chosen["match_type"] == "database" and "机器人可以自主行走" in chosen["answer"]
    assert chosen["follow_up"]["stage"] == "registration"
    assert chosen["registration"] is None
    qr = ask(client, "需要二维码")
    assert qr["match_type"] == "database" and qr["registration"]["path"] == "/survey/real-survey"
    assert qr["follow_up"] is None
    queued = [json.loads(t) for t in client.app.state.redis.task_queue._queue]
    assert len([t for t in queued if t["cmd"] == "speak"]) == 4


def test_card_selection_decline_new_topic_and_session_isolation(tmp_path, monkeypatch):
    client, _ = flow_client(tmp_path, monkeypatch)
    ask(client, "介绍测试科技")
    assert ask(client, "好的，天气怎么样")["match_type"] == "dify"
    assert ask(client, "需要")["registration"] is None
    ask(client, "介绍测试科技")
    declined = ask(client, "暂时不用")
    assert declined["match_type"] == "database" and declined["follow_up"] is None
    ask(client, "介绍测试科技")
    assert ask(client, "需要", session="other")["follow_up"] is None
    chosen = ask(client, "请介绍智能机器人", "product")
    assert chosen["follow_up"]["stage"] == "registration"
    assert ask(client, "我需要这个展品的二维码")["registration"]["exhibit_id"] == "product"


def test_missing_qr_ambiguous_choice_and_unavailable_products(tmp_path, monkeypatch):
    client, store = flow_client(tmp_path, monkeypatch)
    ask(client, "介绍测试科技")
    ask(client, "想了解相关展品")
    assert ask(client, "它")["follow_up"]["stage"] == "product_selection"
    assert ask(client, "第九个")["registration"] is None
    chosen = ask(client, "第二个")
    assert chosen["follow_up"] is None and chosen["registration"] is None
    ask(client, "介绍测试科技")
    store.save_record("exhibits", {**store.get_record("exhibits", "product2"), "status": "inactive"}, "expo")
    listed = ask(client, "需要")
    assert [c["id"] for c in listed["related_entities"]] == ["product"]
    ask(client, "第一个")
    store.save_record("exhibits", {**store.get_record("exhibits", "product"), "surveyToken": ""}, "expo")
    assert ask(client, "需要")["registration"] is None
