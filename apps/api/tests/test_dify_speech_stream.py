from __future__ import annotations

import asyncio
import json
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from apps.api.routes import qa
from apps.api.services.dify_chat import DifyChatClient, ChatReply, DifyChatError, turn_key
from apps.api.services.speech_sentences import SpeechSentences
from apps.api.tests.test_dify_chat import business_store
from opentalking.core.in_memory_redis import InMemoryRedis
from opentalking.runtime.text_stream import SpeechTextStream, TextStreamError


def test_sentences_hide_fragmented_thinking_comments_and_images():
    splitter = SpeechSentences()
    assert splitter.feed("<thi") == []
    assert splitter.feed("nk>private。still") == []
    assert splitter.feed(" private</think>您好。<!--pri") == ["您好。"]
    assert splitter.feed("vate！-->![图片](https://example.test/a.png)下一句。") == ["下一句。"]
    assert splitter.feed("尾句") == []
    assert splitter.finish() == ["尾句"]


def test_numbers_codes_english_abbreviations_and_terminal_tail():
    splitter = SpeechSentences()
    assert splitter.feed("型号S-01，价格3.") == []
    assert splitter.feed("14元。Dr. Smith is here. Next") == ["型号S-01，价格3.14元。", "Dr. Smith is here."]
    assert splitter.feed(" sentence.") == []
    assert splitter.finish() == ["Next sentence."]
    assert SpeechSentences.clean("说明。![图片](unfinished") == "说明。"


async def test_transport_waits_orders_and_cancels_stale_turn():
    r = InMemoryRedis()
    await r.set(turn_key("sid"), "token")
    source = SpeechTextStream(r, "sid", "token")
    await source.start()
    iterator = source.sentences()
    pending = asyncio.create_task(anext(iterator))
    await asyncio.sleep(.03)
    assert not pending.done()
    await source.append("第一句。")
    assert await pending == "第一句。"
    await source.append("第二句。")
    assert await anext(iterator) == "第二句。"
    await r.set(turn_key("sid"), "new")
    with pytest.raises(asyncio.CancelledError):
        await anext(iterator)
    assert not await r.exists(source.key)


async def test_transport_rejects_partial_failure_and_enforces_bounds():
    r = InMemoryRedis()
    await r.set(turn_key("sid"), "token")
    source = SpeechTextStream(r, "sid", "token")
    await source.start()
    with pytest.raises(TextStreamError):
        await source.append("x" * 16001)
    await source.fail()
    with pytest.raises(TextStreamError):
        await anext(source.sentences())


async def test_transport_finishes_only_after_all_committed_sentences():
    r = InMemoryRedis()
    await r.set(turn_key("sid"), "token")
    source = SpeechTextStream(r, "sid", "token")
    await source.start()
    await source.append("完整句。")
    await source.finish()
    assert [s async for s in source.sentences()] == ["完整句。"]
    await source.start()
    await r.hset(source.key, mapping={"state": "complete", "count": "1"})
    with pytest.raises(TextStreamError):
        await anext(source.sentences())


def test_runtime_mode_switch_is_validated_and_uses_its_own_key():
    from apps.api.routes.runtime_config import RuntimeConfigPayload, _build_updates
    from pydantic import ValidationError
    assert _build_updates(RuntimeConfigPayload(dify_chat_speech_mode="complete")) == {"OPENTALKING_DIFY_CHAT_SPEECH_MODE": "complete"}
    assert _build_updates(RuntimeConfigPayload(dify_chat_speech_mode="sentences")) == {"OPENTALKING_DIFY_CHAT_SPEECH_MODE": "sentences"}
    with pytest.raises(ValidationError):
        RuntimeConfigPayload(dify_chat_speech_mode="anything")


@pytest.mark.parametrize("mode,capable,override,streamed", [("sentences", "1", None, True), ("complete", "1", None, False), ("sentences", "0", None, False), ("sentences", "1", "complete", False)])
def test_only_one_speech_task_starts_before_dify_completion(tmp_path, monkeypatch, mode, capable, override, streamed):
    app = FastAPI()
    app.state.redis = InMemoryRedis()
    app.state.admin_store = business_store(tmp_path)
    app.state.settings = SimpleNamespace(dify_chat_base_url="https://dify.test/v1", dify_chat_api_key="test", dify_chat_speech_mode=mode)
    app.include_router(qa.router)
    async def session(*args):
        return {"state": "ready", "model": "mock", "stream_speech_supported": capable}
    async def chat(self, **kwargs):
        if streamed:
            await kwargs["on_delta"]("第一句。第二")
            # Speech is already queued while Dify has not completed.
            tasks = list(app.state.redis.task_queue._queue)
            speech = [json.loads(t) for t in tasks if json.loads(t)["cmd"] == "speak"]
            assert len(speech) == 1 and speech[0]["text_stream"]
            await kwargs["on_delta"]("句。")
        else:
            assert "on_delta" not in kwargs
        return ChatReply("第一句。第二句。", "conversation")
    monkeypatch.setattr(qa.session_service, "get_session", session)
    monkeypatch.setattr(DifyChatClient, "chat", chat)
    body = {"session_id": "sid", "turn_id": "turn", "question": "你好"}
    if override:
        body["speech_mode"] = override
    response = TestClient(app).post("/exhibitions/expo/qa/query", json=body)
    assert response.status_code == 200, response.text
    assert response.json()["speech_mode"] == ("sentences" if streamed else "complete")
    tasks = [json.loads(t) for t in app.state.redis.task_queue._queue]
    assert len([t for t in tasks if t["cmd"] == "speak"]) == 1


@pytest.mark.parametrize("replace", [False, True])
def test_replacement_or_failure_does_not_replay_partial_answer(tmp_path, monkeypatch, replace):
    app = FastAPI()
    app.state.redis = InMemoryRedis()
    app.state.admin_store = business_store(tmp_path)
    app.state.settings = SimpleNamespace(dify_chat_speech_mode="sentences")
    app.include_router(qa.router)
    async def session(*args):
        return {"state": "ready", "model": "mock", "stream_speech_supported": "1"}
    async def chat(self, **kwargs):
        await kwargs["on_delta"]("先说了一句。未完成")
        if replace:
            await kwargs["on_replace"]("替换后的回答。")
            return ChatReply("替换后的回答。", "conv")
        raise DifyChatError()
    monkeypatch.setattr(qa.session_service, "get_session", session)
    monkeypatch.setattr(DifyChatClient, "chat", chat)
    response = TestClient(app).post("/exhibitions/expo/qa/query", json={"session_id": "sid", "turn_id": "turn", "question": "你好"})
    assert response.status_code == 200, response.text
    tasks = [json.loads(t) for t in app.state.redis.task_queue._queue]
    speech = [t for t in tasks if t["cmd"] == "speak"]
    assert len(speech) == (2 if replace else 1)
    if replace:
        assert speech[-1]["text"] == "刚才的回答需要更正。替换后的回答。"
        assert response.json()["speech_mode"] == "complete"
    else:
        assert response.json()["answer"] == "先说了一句。"
        assert response.json()["error_code"]
