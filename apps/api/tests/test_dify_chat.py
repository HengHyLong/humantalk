from __future__ import annotations

import asyncio
import json
from types import SimpleNamespace

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from apps.api.admin import AdminStore
from apps.api.routes import qa
from apps.api.services import dify_chat
from apps.api.services.dify_chat import ChatReply, DifyChatClient, DifyChatError, DifyTurns, spoken_answer
from apps.api.services.exhibition_lookup import lookup, database_answer
from opentalking.core.in_memory_redis import InMemoryRedis
from opentalking.runtime.task_consumer import handle_worker_task


def business_store(tmp_path):
    store = AdminStore(tmp_path / "admin.db", initialize_defaults=False)
    store.save_record("exhibitions", {"id": "expo", "name": "测试展会", "isCurrent": True})
    store.save_record("runtime_configs", {"id": "expo", "exhibitionId": "expo", "terminalPointId": "entry"}, "expo")
    for kind, record in [
        ("exhibitors", {"id": "vendor", "name": "测试科技", "boothCode": "A01", "status": "active", "phone": "secret-phone"}),
        ("exhibits", {"id": "product", "name": "智能机器人", "aliases": ["小智"], "exhibitorId": "vendor", "status": "published"}),
        ("points", {"id": "entry", "name": "入口", "status": "active"}),
        ("points", {"id": "booth", "name": "A01展位", "exhibitorId": "vendor", "status": "active"}),
        ("routes", {"id": "route", "name": "入口到A01", "pointIds": ["entry", "booth"], "directions": ["从入口沿主通道到A01。"], "status": "published"}),
    ]:
        store.save_record(kind, dict(record, exhibitionId="expo"), "expo")
    return store


def test_lookup_scopes_published_facts_and_never_sends_private_fields(tmp_path):
    store = business_store(tmp_path)
    store.save_record("exhibitors", {"id": "foreign", "name": "测试科技", "boothCode": "X99", "status": "active"}, "other")
    store.save_record("exhibitors", {"id": "hidden", "name": "测试科技", "boothCode": "H00", "status": "inactive"}, "expo")
    result = lookup(store, "expo", "测试科技在哪个展位？")
    assert result.status == "matched" and result.entity_ids == ["vendor"]
    assert result.items[0]["booth_code"] == "A01"
    assert "secret-phone" not in json.dumps(result.context())
    alias = lookup(store, "expo", "介绍小智")
    assert alias.entity_ids == ["product"]
    assert alias.items[0]["exhibitor"]["booth_code"] == "A01"
    with pytest.raises(ValueError):
        lookup(store, "expo", "介绍", selected_entity_id="foreign")


def test_lookup_multiple_followup_and_route_destination(tmp_path):
    store = business_store(tmp_path)
    store.save_record("exhibitors", {"id": "second", "name": "另一科技", "aliases": ["科技公司"], "status": "active"}, "expo")
    store.save_record("exhibitors", {"id": "third", "name": "其他科技", "aliases": ["科技公司"], "status": "active"}, "expo")
    ambiguous = lookup(store, "expo", "介绍科技公司")
    assert ambiguous.status == "multiple"
    selected = lookup(store, "expo", "第二个", previous_ids=ambiguous.entity_ids)
    assert selected.status == "matched" and selected.entity_ids == [ambiguous.entity_ids[1]]
    route = lookup(store, "expo", "怎么去测试科技？")
    assert route.status == "matched" and route.route["route_id"] == "route"
    # A sole route must not be assigned to any arbitrary named destination.
    missing = lookup(store, "expo", "怎么去其他科技？")
    assert missing.status == "not_found" and missing.route is None


@pytest.mark.parametrize("text,expected", [("<think>private</think>您好", "您好"),
                                          ("<think>unfinished", ""),
                                          ("<!--internal-->Hello", "Hello")])
def test_spoken_answer_filters_reasoning(text, expected):
    assert spoken_answer(text) == expected


async def test_sse_collects_only_final_answer_and_requires_message_end(monkeypatch):
    actual_client = httpx.AsyncClient
    recorded = []
    def handler(request):
        recorded.append(json.loads(request.content))
        events = [{"event": "reasoning_chunk", "text": "private"},
                  {"event": "message", "answer": "<think>hidden</think>展位", "task_id": "task", "conversation_id": "conv"},
                  {"event": "message", "answer": "A01。"}, {"event": "message_end", "conversation_id": "conv"}]
        return httpx.Response(200, text="\n\n".join("data: " + json.dumps(e) for e in events))
    monkeypatch.setattr(dify_chat.httpx, "AsyncClient", lambda **kwargs: actual_client(transport=httpx.MockTransport(handler), **kwargs))
    result = await DifyChatClient("https://dify.test/v1", "app-test").chat(
        question="展位？", inputs={"retrieval_status": "matched"}, user="user", conversation_id="previous")
    assert result.answer == "展位A01。" and result.conversation_id == "conv"
    assert recorded[0]["conversation_id"] == "previous" and recorded[0]["response_mode"] == "streaming"
    def incomplete(request):
        return httpx.Response(200, text='data: {"event":"message","answer":"partial"}')
    monkeypatch.setattr(dify_chat.httpx, "AsyncClient", lambda **kwargs: actual_client(transport=httpx.MockTransport(incomplete), **kwargs))
    with pytest.raises(DifyChatError):
        await DifyChatClient("https://dify.test/v1", "app-test").chat(question="?", inputs={}, user="u")


async def test_cancel_stops_active_dify_task(monkeypatch):
    actual_client = httpx.AsyncClient
    stopped = []
    def handler(request):
        if request.url.path.endswith("/stop"):
            stopped.append(request.url.path)
            return httpx.Response(200, json={"result": "success"})
        return httpx.Response(200, text='data: {"event":"message","task_id":"task","answer":"old"}')
    monkeypatch.setattr(dify_chat.httpx, "AsyncClient", lambda **kwargs: actual_client(transport=httpx.MockTransport(handler), **kwargs))
    async def stale():
        return False
    with pytest.raises(asyncio.CancelledError):
        await DifyChatClient("https://dify.test/v1", "app-test").chat(question="?", inputs={}, user="u", is_current=stale)
    assert stopped == ["/v1/chat-messages/task/stop"]
    turns = DifyTurns()
    started = asyncio.Event()
    async def pending():
        started.set()
        await asyncio.Event().wait()
    request = asyncio.create_task(turns.run("sid", pending()))
    await started.wait()
    await turns.cancel("sid")
    with pytest.raises(asyncio.CancelledError):
        await request


@pytest.mark.parametrize("model", ["mock", "vidu"])
def test_exact_hit_skips_dify_and_preserves_followup_context(tmp_path, monkeypatch, model):
    store = business_store(tmp_path)
    app = FastAPI()
    app.state.settings = SimpleNamespace(dify_chat_base_url="https://dify.test/v1", dify_chat_api_key="app-test")
    app.state.admin_store = store
    app.state.redis = InMemoryRedis()
    app.include_router(qa.router)
    calls, delivered = [], []
    async def get_session(*args):
        return {"state": "ready", "model": model}
    async def chat(self, **kwargs):
        pytest.fail("exact database hit must never call Dify")
    async def vidu(**kwargs):
        delivered.append(kwargs)
    monkeypatch.setattr(qa.session_service, "get_session", get_session)
    monkeypatch.setattr(DifyChatClient, "chat", chat)
    monkeypatch.setattr(qa, "_speak_vidu_answer", vidu)
    with TestClient(app) as client:
        body = {"session_id": "sid", "turn_id": "turn-1", "question": "测试科技在哪里？"}
        response = client.post("/exhibitions/expo/qa/query", json=body)
        assert response.status_code == 200, response.text
        assert response.json()["answer"] == "测试科技位于A01展位。"
        assert response.json()["speak_mode"] == "direct"
        assert response.json()["match_type"] == "database"
        assert response.json()["related_entities"][0]["id"] == "vendor"
        second = client.post("/exhibitions/expo/qa/query", json=dict(body, question="它在哪？", turn_id="turn-2"))
        assert second.status_code == 200
    assert calls == []
    assert store.list_records("knowledge_hits", exhibition_id="expo")[0]["provider"] == "database"
    if model == "vidu":
        assert delivered[0]["text"] == "测试科技位于A01展位。"
    else:
        queued = [json.loads(app.state.redis.task_queue.get_nowait()) for _ in range(app.state.redis.task_queue.qsize())]
        speech = [t for t in queued if t["cmd"] == "speak"]
        assert all(t["direct"] is True and t["language"] == "zh-CN" for t in speech)
        assert all(t["text"] == "测试科技位于A01展位。" for t in speech)


async def test_stale_worker_queue_cannot_start_speech(tmp_path):
    broker = InMemoryRedis()
    await broker.set(dify_chat.turn_key("sid"), "new")
    class Runner:
        def create_direct_speak_task(self, *args, **kwargs):
            pytest.fail("obsolete answer must not be delivered")
    await handle_worker_task({"cmd": "speak", "session_id": "sid", "direct": True,
                              "text": "obsolete", "dify_turn_token": "old"}, broker, tmp_path, "cpu", {"sid": Runner()})


def test_failure_uses_fixed_prompt_without_local_llm(tmp_path, monkeypatch):
    store = business_store(tmp_path)
    app = FastAPI()
    app.state.settings = SimpleNamespace(dify_chat_base_url="", dify_chat_api_key="")
    app.state.admin_store = store
    app.state.redis = InMemoryRedis()
    app.include_router(qa.router)
    async def session(*args):
        return {"state": "ready", "model": "mock"}
    monkeypatch.setattr(qa.session_service, "get_session", session)
    result = TestClient(app).post("/exhibitions/expo/qa/query", json={"session_id": "sid", "turn_id": "turn", "question": "你好"})
    assert result.status_code == 200
    assert result.json()["error_code"] == "DIFY_CHAT_NOT_CONFIGURED"
    assert result.json()["speak_mode"] == "direct"
    assert result.json()["answer"] == "问答服务暂时不可用，请稍后重试或咨询现场工作人员。"


def test_database_speech_uses_stored_copy_routes_and_rejects_fuzzy_or_ambiguous(tmp_path):
    store = business_store(tmp_path)
    store.save_record("exhibits", {"id": "product", "name": "智能机器人", "aliases": ["小智"],
                                  "spokenText": "小智可以提供导览服务。", "status": "published"}, "expo")
    assert database_answer(lookup(store, "expo", "介绍小智"), "介绍小智", "zh-CN") == "小智可以提供导览服务。"
    assert database_answer(lookup(store, "expo", "怎么去测试科技"), "怎么去测试科技", "zh-CN") == "从入口沿主通道到A01。"
    fuzzy = lookup(store, "expo", "介绍测试科X技")
    assert fuzzy.status == "matched" and not fuzzy.exact_hit
    assert database_answer(fuzzy, "介绍测试科X技", "zh-CN") == ""
    no_copy = lookup(store, "expo", "小智在哪")
    assert database_answer(no_copy, "小智在哪", "zh-CN") == ""
    store.save_record("exhibitors", {"id": "duplicate", "name": "测试科技", "status": "active"}, "expo")
    ambiguous = lookup(store, "expo", "测试科技在哪")
    assert ambiguous.status == "multiple"
    assert database_answer(ambiguous, "测试科技在哪", "zh-CN") == ""


def test_frontend_available_draft_route_speaks_without_dify_and_offline_route_does_not(tmp_path, monkeypatch):
    store = business_store(tmp_path)
    route = store.get_record("routes", "route")
    store.save_record("routes", dict(route, status="draft"), "expo")
    app = FastAPI()
    app.state.settings = SimpleNamespace(dify_chat_base_url="", dify_chat_api_key="")
    app.state.admin_store = store
    app.state.redis = InMemoryRedis()
    app.include_router(qa.router)
    async def session(*args):
        return {"state": "ready", "model": "mock"}
    async def chat(*args, **kwargs):
        pytest.fail("frontend-matched route must bypass Dify")
    monkeypatch.setattr(qa.session_service, "get_session", session)
    monkeypatch.setattr(DifyChatClient, "chat", chat)
    with TestClient(app) as client:
        r = client.post("/exhibitions/expo/qa/query", json={"session_id": "sid", "turn_id": "turn", "question": "入口到A01"})
        assert r.status_code == 200, r.text
        assert r.json()["match_type"] == "database"
        assert r.json()["answer"] == "从入口沿主通道到A01。"
        assert r.json()["navigation"]["route_id"] == "route"
    store.save_record("routes", dict(route, status="offline"), "expo")
    assert lookup(store, "expo", "怎么去测试科技").status == "not_found"


def test_dify_fallback_multiturn_and_database_turn_keeps_conversation(tmp_path, monkeypatch):
    app = FastAPI()
    app.state.settings = SimpleNamespace(dify_chat_base_url="https://dify.test/v1", dify_chat_api_key="app-test")
    app.state.admin_store = business_store(tmp_path)
    app.state.redis = InMemoryRedis()
    app.include_router(qa.router)
    calls = []
    async def session(*args):
        return {"state": "ready", "model": "mock"}
    async def chat(self, **kwargs):
        calls.append(kwargs)
        return ChatReply("智能体回答。", "conversation-one")
    monkeypatch.setattr(qa.session_service, "get_session", session)
    monkeypatch.setattr(DifyChatClient, "chat", chat)
    with TestClient(app) as client:
        def ask(question):
            response = client.post("/exhibitions/expo/qa/query", json={"session_id": "sid", "turn_id": "turn", "question": question})
            assert response.status_code == 200, response.text
            return response.json()
        assert ask("你好")["match_type"] == "dify"
        assert ask("测试科技在哪")["match_type"] == "database"
        assert ask("介绍测试科X技")["match_type"] == "dify"
    assert len(calls) == 2
    assert calls[1]["conversation_id"] == "conversation-one"
    assert json.loads(calls[1]["inputs"]["retrieval_context"])["items"][0]["booth_code"] == "A01"


def test_missing_database_route_reaches_dify(tmp_path, monkeypatch):
    app = FastAPI()
    app.state.settings = SimpleNamespace(dify_chat_base_url="https://dify.test/v1", dify_chat_api_key="app-test")
    app.state.admin_store = business_store(tmp_path)
    app.state.redis = InMemoryRedis()
    app.include_router(qa.router)
    calls = []

    async def session(*args):
        return {"state": "ready", "model": "mock"}

    async def chat(self, **kwargs):
        calls.append(kwargs)
        return ChatReply("请按知识库中的科技馆导览指引前往。", "conversation-one")

    monkeypatch.setattr(qa.session_service, "get_session", session)
    monkeypatch.setattr(DifyChatClient, "chat", chat)
    question = "科技馆怎么走"
    assert lookup(app.state.admin_store, "expo", question).reason == "route_missing"

    response = TestClient(app).post("/exhibitions/expo/qa/query", json={
        "session_id": "sid", "turn_id": "turn", "question": question,
    })
    assert response.status_code == 200, response.text
    assert response.json()["match_type"] == "dify"
    assert response.json()["answer"] == "请按知识库中的科技馆导览指引前往。"
    assert response.json()["navigation"] is None
    assert len(calls) == 1
    assert calls[0]["question"] == question
    assert json.loads(calls[0]["inputs"]["retrieval_context"])["routing_reason"] == "route_missing"


def test_conflicting_database_route_reaches_dify(tmp_path, monkeypatch):
    store = business_store(tmp_path)
    route = store.get_record("routes", "route")
    store.save_record("routes", dict(route, name="入口到测试科技", pointIds=["entry", "entry"]), "expo")
    question = "怎么去测试科技"
    assert lookup(store, "expo", question).reason == "route_config_conflict"

    app = FastAPI()
    app.state.settings = SimpleNamespace(dify_chat_base_url="https://dify.test/v1", dify_chat_api_key="app-test")
    app.state.admin_store = store
    app.state.redis = InMemoryRedis()
    app.include_router(qa.router)
    calls = []

    async def session(*args):
        return {"state": "ready", "model": "mock"}

    async def chat(self, **kwargs):
        calls.append(kwargs)
        return ChatReply("知识库已提供路线信息。", "conversation-one")

    monkeypatch.setattr(qa.session_service, "get_session", session)
    monkeypatch.setattr(DifyChatClient, "chat", chat)
    response = TestClient(app).post("/exhibitions/expo/qa/query", json={
        "session_id": "sid", "turn_id": "turn", "question": question,
    })
    assert response.status_code == 200, response.text
    assert response.json()["match_type"] == "dify"
    assert response.json()["answer"] == "知识库已提供路线信息。"
    assert response.json()["navigation"] is None
    assert len(calls) == 1
    assert json.loads(calls[0]["inputs"]["retrieval_context"])["routing_reason"] == "route_config_conflict"


@pytest.mark.parametrize("question,locale,reason", [("测试科技多少钱", "zh-CN", "unsupported_intent"), ("测试科技在哪", "en-US", "translation_required")])
def test_unsupported_intent_and_translation_reach_dify_with_current_facts(tmp_path, monkeypatch, question, locale, reason):
    app = FastAPI()
    app.state.settings = SimpleNamespace(dify_chat_base_url="https://dify.test/v1", dify_chat_api_key="app-test")
    app.state.admin_store = business_store(tmp_path)
    app.state.redis = InMemoryRedis()
    app.include_router(qa.router)
    async def session(*args):
        return {"state": "ready", "model": "mock"}
    async def chat(self, **kwargs):
        context = json.loads(kwargs["inputs"]["retrieval_context"])
        assert context["routing_reason"] == reason
        assert context["current_exhibition"]["id"] == "expo"
        assert context["items"][0]["booth_code"] == "A01"
        return ChatReply("validated answer", "conversation")
    monkeypatch.setattr(qa.session_service, "get_session", session)
    monkeypatch.setattr(DifyChatClient, "chat", chat)
    r = TestClient(app).post("/exhibitions/expo/qa/query", json={"session_id": "sid", "turn_id": "turn", "question": question, "locale": locale})
    assert r.status_code == 200 and r.json()["match_type"] == "dify"
    assert r.json()["routing_reason"] == reason


def test_route_configuration_clarification_skips_dify(tmp_path, monkeypatch):
    app = FastAPI()
    app.state.settings = SimpleNamespace(dify_chat_base_url="", dify_chat_api_key="")
    app.state.admin_store = business_store(tmp_path)
    app.state.redis = InMemoryRedis()
    app.include_router(qa.router)
    async def session(*args):
        return {"state": "ready", "model": "mock"}
    async def chat(*args, **kwargs):
        pytest.fail("invalid route must not call Dify")
    monkeypatch.setattr(qa.session_service, "get_session", session)
    monkeypatch.setattr(DifyChatClient, "chat", chat)
    r = TestClient(app).post("/exhibitions/expo/qa/query", json={"session_id": "sid", "turn_id": "turn", "question": "从酒店到测试科技"})
    assert r.status_code == 200
    assert r.json()["routing_reason"] == "route_origin_unknown"
    assert r.json()["need_clarification"] and r.json()["navigation"] is None
