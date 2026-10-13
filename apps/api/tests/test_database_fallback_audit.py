import json
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from apps.api.routes import qa
from apps.api.services.dify_chat import DifyChatClient, ChatReply
from apps.api.services.exhibition_lookup import LookupResult, database_answer, service_answer
from apps.api.services.exhibition_lookup import lookup
from apps.api.services.exhibition_matching import classify
from apps.api.tests.test_dify_chat import business_store
from apps.api.tests.test_exhibition_matching import Store
from opentalking.core.in_memory_redis import InMemoryRedis


@pytest.mark.parametrize("question,expected", [
    ("怎么去测试科技，门票多少钱", "compound"),
    ("怎么去测试科技，需要多久", "compound"),
    ("去测试科技需要多远", "compound"),
    ("带我去测试科技并给我二维码", "compound"),
    ("测试科技有哪些产品，在哪个展位", "compound"),
    ("介绍测试科技，并告诉我地址", "compound"),
    ("介绍智能机器人，同时展示二维码", "compound"),
    ("怎么去测试科技", "route"),
    ("介绍测试科技", "intro"),
    ("测试科技有哪些展品", "list"),
    ("测试科技在哪个展位", "location"),
])
def test_compound_questions_do_not_become_partial_direct_answers(question, expected):
    assert classify(question) == expected


@pytest.mark.parametrize("question,reason", [
    ("介绍农博会", "exhibition_scope_mismatch"),
    ("给小智登记二维码", "registration_unavailable"),
    ("怎么去测试科技和入口", "route_multiple_destinations"),
    ("介绍测试科技，并告诉我地址", "unsupported_intent"),
    ("怎么去测试科技，门票多少钱", "unsupported_intent"),
    ("测试科技有哪些产品，在哪个展位", "unsupported_intent"),
    ("测试科技在哪个展位", "answer_field_missing"),
    ("介绍小智", "answer_field_missing"),
    ("测试科技有哪些展品", "answer_field_missing"),
    ("未知公司的产品有哪些", "no_match"),
    ("给未收录的产品二维码", "no_match"),
])
def test_missing_answer_and_rule_only_matches_use_dify(tmp_path, monkeypatch, question, reason):
    store = business_store(tmp_path)
    store.save_record("exhibitions", {"id": "other", "name": "农博会", "description": "另一展会简介"})
    if question == "测试科技在哪个展位":
        store.save_record("exhibitors", {**store.get_record("exhibitors", "vendor"), "boothCode": "  ", "address": "  "}, "expo")
    if question == "测试科技有哪些展品":
        store.save_record("exhibits", {**store.get_record("exhibits", "product"), "status": "inactive"}, "expo")
    app = FastAPI()
    app.state.settings = SimpleNamespace(dify_chat_base_url="https://dify.test/v1", dify_chat_api_key="test")
    app.state.admin_store = store
    app.state.redis = InMemoryRedis()
    app.include_router(qa.router)
    calls = []

    async def session(*_):
        return {"state": "ready", "model": "mock"}

    async def chat(self, **kwargs):
        calls.append(kwargs)
        context = json.loads(kwargs["inputs"]["retrieval_context"])
        assert context["routing_reason"] == reason
        if reason == "registration_unavailable":
            assert context["items"][0]["registration_available"] is False
        if reason == "exhibition_scope_mismatch":
            assert kwargs["inputs"]["retrieval_status"] == "matched"
            assert context["total_matches"] == 1
            assert context["items"][0]["id"] == "other"
            assert context["current_exhibition"]["id"] == "expo"
        return ChatReply("由智能体按实际问题给出的回答。", "conv")

    monkeypatch.setattr(qa.session_service, "get_session", session)
    monkeypatch.setattr(DifyChatClient, "chat", chat)
    response = TestClient(app).post("/exhibitions/expo/qa/query", json={"session_id": "sid", "turn_id": "turn", "question": question})
    assert response.status_code == 200, response.text
    reply = response.json()
    assert reply["match_type"] == ("clarification" if reason == "route_multiple_destinations" else "dify")
    assert len(calls) == 1
    assert store.list_records("knowledge_hits", exhibition_id="expo")[0]["provider"] == "dify_chat"
    assert reply["answer"] == "由智能体按实际问题给出的回答。"
    assert reply["registration"] is None and reply["navigation"] is None
    if question.startswith("怎么去"):
        assert reply["related_entities"] == []
    assert reply["follow_up"] is None


def test_only_valid_route_candidates_can_short_circuit_for_origin():
    assert not service_answer(LookupResult(reason="route_origin_required"), "zh-CN")
    assert service_answer(LookupResult(reason="route_origin_required", route_ids=["route"]), "zh-CN")
    assert not service_answer(LookupResult(reason="route_origin_required", route_ids=["route"], truncated=True), "zh-CN")


def test_single_item_list_is_a_list_and_incomplete_names_fall_back():
    item = {"type": "exhibitor", "name": "测试科技", "description": "不应作为列表回答的简介"}
    result = LookupResult(status="matched", exact_hit=True, reason="exact_match", intent="list", items=[item])
    assert database_answer(result, "有哪些展商", "zh-CN") == "当前展会有：测试科技。"
    item["name"] = " "
    assert database_answer(result, "有哪些展商", "zh-CN") == ""
    item["name"] = "测试科技"
    item["exhibits"] = [{"name": " "}]
    assert database_answer(result, "测试科技有哪些展品", "zh-CN") == ""


@pytest.mark.parametrize("question", ["它附近的酒店怎么去", "这个怎么去成都大学", "这个展会在哪里", "它附近的酒店在哪里",
                                     "这个未收录公司在哪里", "这个学校在哪里", "tell me more about unknown hotels"])
def test_previous_exhibitor_cannot_replace_a_new_unmatched_target(question):
    store = Store()
    store.data["runtime_configs"] = [{"id": "expo", "terminalPointId": "east"}]
    result = lookup(store, "expo", question, previous_ids=["v"])
    assert not database_answer(result, question, "zh-CN")
    assert not service_answer(result, "zh-CN")
    assert result.entity_ids != ["v"] and result.route is None
    assert result.context()["reference_items"][0]["id"] == "v"
    assert not result.context()["route_validated"]
    previous = lookup(store, "expo", "它在哪个展位", previous_ids=["v"])
    assert database_answer(previous, "它在哪个展位", "zh-CN") == "具身科学有限公司位于02展位。"
