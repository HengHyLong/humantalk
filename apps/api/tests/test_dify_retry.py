from __future__ import annotations

import asyncio
import json
from types import SimpleNamespace

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from apps.api.routes import qa
from apps.api.services import dify_chat, dify_retry
from apps.api.services.dify_chat import ChatReply, DifyChatClient, DifyChatError, DifyTurns
from apps.api.services.dify_retry import chat_with_retries
from apps.api.tests.test_dify_chat import business_store
from opentalking.core.in_memory_redis import InMemoryRedis


async def current():
    return True


@pytest.fixture(autouse=True)
def no_jitter(monkeypatch):
    monkeypatch.setattr(dify_retry.random, "uniform", lambda *_: 0)


async def test_empty_reasoning_answers_retry_three_times_then_succeed():
    calls, attempts = [], []

    async def call(remaining):
        calls.append(remaining)
        return ChatReply("<think>只有思考</think>" if len(calls) < 4 else "有效回答。", "conv", "msg")

    result = await chat_with_retries(call, is_current=current, can_retry=lambda: True,
                                     reset=lambda: None, attempts=attempts, backoff_base=0)
    assert result.answer == "有效回答。"
    assert len(calls) == 4 and [r["status"] for r in attempts] == ["failed"] * 3 + ["succeeded"]
    assert all(r["error_code"] == "DIFY_CHAT_EMPTY_ANSWER" for r in attempts[:3])


@pytest.mark.parametrize("retries,committed,permanent,expected", [(3, False, False, 4), (0, False, False, 1),
                                                               (3, True, False, 1), (3, False, True, 1)])
async def test_retry_limit_switch_and_speech_gate(retries, committed, permanent, expected):
    attempts = []

    async def call(_):
        raise DifyChatError("DIFY_CHAT_HTTP_ERROR" if permanent else "DIFY_CHAT_EMPTY_ANSWER",
                            retryable=not permanent, http_status=401 if permanent else None)

    with pytest.raises(DifyChatError) as exc:
        await chat_with_retries(call, is_current=current, can_retry=lambda: not committed,
                                reset=lambda: None, max_retries=retries, attempts=attempts, backoff_base=0)
    assert len(attempts) == expected and exc.value.attempts == attempts


async def test_budget_bounds_hung_request_and_retry_after():
    async def hung(_):
        await asyncio.Event().wait()

    attempts = []
    with pytest.raises(DifyChatError) as exc:
        await chat_with_retries(hung, is_current=current, can_retry=lambda: True,
                                reset=lambda: None, budget_sec=.03, attempts=attempts)
    assert exc.value.code == "DIFY_CHAT_TIMEOUT" and len(attempts) == 1
    assert attempts[0]["budget_exhausted"]

    async def throttled(_):
        raise DifyChatError("DIFY_CHAT_HTTP_ERROR", retryable=True, http_status=429, retry_after=10)

    attempts = []
    with pytest.raises(DifyChatError):
        await chat_with_retries(throttled, is_current=current, can_retry=lambda: True,
                                reset=lambda: None, budget_sec=1, attempts=attempts)
    assert len(attempts) == 1 and attempts[0]["budget_exhausted"]


async def test_new_question_cancels_retry_backoff():
    turns, attempts, called = DifyTurns(), [], asyncio.Event()

    async def call(_):
        called.set()
        raise DifyChatError("DIFY_CHAT_EMPTY_ANSWER")

    task = asyncio.create_task(turns.run("sid", chat_with_retries(
        call, is_current=current, can_retry=lambda: True, reset=lambda: None,
        attempts=attempts, backoff_base=10)))
    await called.wait()
    await asyncio.sleep(.01)
    await turns.cancel("sid")
    with pytest.raises(asyncio.CancelledError):
        await task
    assert len(attempts) == 1 and "sid" not in turns.active


async def test_stale_turn_after_response_cannot_commit_answer():
    active = True

    async def still_current():
        return active

    async def call(_):
        nonlocal active
        active = False
        return ChatReply("旧问题答案。")

    with pytest.raises(asyncio.CancelledError):
        await chat_with_retries(call, is_current=still_current, can_retry=lambda: True, reset=lambda: None)


@pytest.mark.parametrize("response,expected", [("incomplete", "DIFY_CHAT_INCOMPLETE"),
                                              ("bad-json", "DIFY_CHAT_INVALID_RESPONSE"),
                                              ("timeout", "DIFY_CHAT_TIMEOUT")])
async def test_stream_errors_are_retryable(monkeypatch, response, expected):
    actual = httpx.AsyncClient

    def handler(request):
        if response == "timeout":
            raise httpx.ReadTimeout("upstream timeout", request=request)
        return httpx.Response(200, text='data: {"event":"message","answer":"尾句"}' if response == "incomplete" else "data: bad")

    monkeypatch.setattr(dify_chat.httpx, "AsyncClient", lambda **kw: actual(transport=httpx.MockTransport(handler), **kw))
    with pytest.raises(DifyChatError) as exc:
        await DifyChatClient("https://dify.test/v1", "app-test").chat(question="问题", inputs={}, user="u")
    assert exc.value.code == expected and exc.value.retryable


@pytest.mark.parametrize("status,retryable", [(400, False), (401, False), (403, False), (404, False),
                                            (408, True), (429, True), (500, True), (503, True)])
async def test_http_classification_and_retry_after(monkeypatch, status, retryable):
    actual = httpx.AsyncClient
    transport = httpx.MockTransport(lambda _: httpx.Response(status, headers={"Retry-After": "2"}))
    monkeypatch.setattr(dify_chat.httpx, "AsyncClient", lambda **kw: actual(transport=transport, **kw))
    with pytest.raises(DifyChatError) as exc:
        await DifyChatClient("https://dify.test/v1", "app-test").chat(question="问题", inputs={}, user="u")
    assert exc.value.http_status == status and exc.value.retryable == retryable
    assert exc.value.retry_after == 2


async def test_sse_success_empty_is_invalid_and_preserves_diagnostics(monkeypatch):
    actual = httpx.AsyncClient
    events = [{"event": "message", "answer": "<think>思考</think>", "task_id": "task", "message_id": "msg", "conversation_id": "conv"},
              {"event": "message_end"}]
    stopped = []

    def handler(request):
        if request.url.path.endswith("/stop"):
            stopped.append(request.url.path)
            return httpx.Response(200, json={})
        return httpx.Response(200, text="\n\n".join("data: " + json.dumps(e) for e in events))

    monkeypatch.setattr(dify_chat.httpx, "AsyncClient", lambda **kw: actual(transport=httpx.MockTransport(handler), **kw))
    client = DifyChatClient("https://dify.test/v1", "app-test")
    with pytest.raises(DifyChatError) as exc:
        await client.chat(question="问题", inputs={}, user="u")
    assert exc.value.code == "DIFY_CHAT_EMPTY_ANSWER"
    assert (exc.value.conversation_id, exc.value.message_id, exc.value.task_id) == ("conv", "msg", "task")
    await client.stop("u")
    assert len(stopped) == 1


@pytest.mark.parametrize("failures,partial,expected_calls", [(1, False, 2), (4, False, 4), (4, True, 1)])
def test_route_retries_discard_uncommitted_fragments_and_queue_one_answer(tmp_path, monkeypatch, failures, partial, expected_calls):
    app = FastAPI()
    app.state.redis = InMemoryRedis()
    app.state.admin_store = business_store(tmp_path)
    app.state.settings = SimpleNamespace(dify_chat_speech_mode="sentences", dify_chat_base_url="https://dify.test/v1", dify_chat_api_key="test")
    app.include_router(qa.router)
    calls = []

    async def session(*_):
        return {"state": "ready", "model": "mock", "stream_speech_supported": "1"}

    async def fast_retry(*args, **kwargs):
        return await chat_with_retries(*args, **kwargs, backoff_base=0)

    async def chat(self, **kwargs):
        calls.append(kwargs)
        if len(calls) <= failures:
            await kwargs["on_delta"]("已提交的句子。" if partial else "未完成的片段")
            raise DifyChatError("DIFY_CHAT_EMPTY_ANSWER")
        await kwargs["on_delta"]("重试后的回答。")
        return ChatReply("重试后的回答。", "success-conv", "success-msg")

    monkeypatch.setattr(qa.session_service, "get_session", session)
    monkeypatch.setattr(DifyChatClient, "chat", chat)
    monkeypatch.setattr(dify_retry, "chat_with_retries", fast_retry)
    response = TestClient(app).post("/exhibitions/expo/qa/query", json={"session_id": "sid", "turn_id": "turn", "question": "你好"})
    assert response.status_code == 200, response.text
    assert len(calls) == expected_calls
    tasks = [json.loads(t) for t in app.state.redis.task_queue._queue]
    speech = [t for t in tasks if t["cmd"] == "speak"]
    assert len(speech) == 1
    answer = response.json()["answer"]
    assert "未完成的片段" not in answer
    assert answer == ("已提交的句子。" if partial else "问答功能暂不可用，请联系现场工作人员。" if failures == 4 else "重试后的回答。")
    hit = app.state.admin_store.list_records("knowledge_hits", exhibition_id="expo")[0]
    assert hit["difyAttemptCount"] == expected_calls
    # Failed attempts cannot advance the application's normal conversation cache.
    contexts = [v for k, v in app.state.redis._kv.items() if ":context:" in k]
    if failures == 4:
        assert not contexts
    else:
        assert len(contexts) == 1 and json.loads(contexts[0])["conversation_id"] == "success-conv"
    assert all(c["conversation_id"] == "" for c in calls)


def test_runtime_retry_controls_validate_and_persist_separately():
    from apps.api.routes.runtime_config import RuntimeConfigPayload, _build_updates
    from pydantic import ValidationError

    assert _build_updates(RuntimeConfigPayload(dify_chat_max_retries=0, dify_chat_retry_budget_sec=30)) == {
        "OPENTALKING_DIFY_CHAT_MAX_RETRIES": "0", "OPENTALKING_DIFY_CHAT_RETRY_BUDGET_SEC": "30.0",
    }
    for kwargs in [{"dify_chat_max_retries": 4}, {"dify_chat_max_retries": -1}, {"dify_chat_retry_budget_sec": 4}]:
        with pytest.raises(ValidationError):
            RuntimeConfigPayload(**kwargs)
