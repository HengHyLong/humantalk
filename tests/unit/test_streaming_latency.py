from __future__ import annotations

from types import SimpleNamespace

import httpx
import pytest

from opentalking.agent.context_builder import AgentSessionConfig, build_agent_context
from opentalking.providers.llm.openai_compatible import adapter as llm_module
from opentalking.providers.llm.openai_compatible.sentence_splitter import SentenceSplitter


def test_latency_options_load_from_environment_and_dotenv(monkeypatch, tmp_path):
    from opentalking.core.config import Settings

    monkeypatch.setenv("OPENTALKING_LLM_EXTRA_BODY", '{"enable_thinking":false}')
    monkeypatch.setenv("OPENTALKING_FLASHTALK_FIRST_SEGMENT_MAX_CHARS", "16")
    settings = Settings(_env_file=None)
    assert settings.llm_extra_body == {"enable_thinking": False}
    assert settings.flashtalk_first_segment_max_chars == 16
    monkeypatch.delenv("OPENTALKING_FLASHTALK_FIRST_SEGMENT_MAX_CHARS")
    dotenv = tmp_path / ".env"
    dotenv.write_text("OPENTALKING_FLASHTALK_FIRST_SEGMENT_MAX_CHARS=0\n", encoding="utf-8")
    assert Settings(_env_file=dotenv).flashtalk_first_segment_max_chars == 0


async def test_runtime_llm_refresh_keeps_pool_and_updates_future_requests():
    from apps.api.routes.runtime_config import _refresh_live_runners

    existing = llm_module.OpenAICompatibleLLMClient("https://old.test/v1", "old", reuse_connections=True)
    runner = SimpleNamespace(llm=existing)
    generic_client = llm_module.OpenAICompatibleLLMClient("https://old.test/v1", "old", reuse_connections=True)
    generic = SimpleNamespace(_llm_base_url="", _llm_client=generic_client)
    request = SimpleNamespace(app=SimpleNamespace(state=SimpleNamespace(session_runners={"a": runner, "b": generic})))
    settings = SimpleNamespace(llm_base_url="https://new.test/v1/", llm_api_key="new",
                               llm_model="new-model", llm_system_prompt="voice",
                               llm_extra_body={"max_tokens": 256})
    assert _refresh_live_runners(request, settings) == 2
    assert runner.llm is existing
    assert generic._llm_client is generic_client
    for client in (existing, generic_client):
        assert client.base_url == "https://new.test/v1"
        assert client.model == "new-model"
        assert client.extra_body == {"max_tokens": 256}
        await client.aclose()


@pytest.mark.parametrize("context", ["可信展会资料", "知识库未命中，请勿编造", ""])
async def test_supplied_knowledge_skips_retrieval_and_preserves_memory(context):
    class Memory:
        async def list_memories(self, **kwargs):
            assert kwargs["user_id"] == "user-1"
            assert kwargs["avatar_id"] == "avatar-1"
            return [SimpleNamespace(content="用户喜欢简洁回答")]

    class Knowledge:
        async def query_many(self, **kwargs):
            pytest.fail("must not repeat completed retrieval")

    result = await build_agent_context(
        config=AgentSessionConfig(user_id="user-1", agent_enabled=True,
                                  memory_enabled=True, knowledge_enabled=True,
                                  knowledge_base_ids=["a", "b", "c"]),
        avatar_id="avatar-1", query="大会在哪里举办", store=Memory(),
        knowledge_store=Knowledge(), knowledge_context=context,
    )
    assert "用户喜欢简洁回答" in result
    if context:
        assert result.count(context) == 1


def test_first_clause_is_early_but_later_sentences_stay_complete():
    text = "本届大会将在成都举行，详细会场和报名安排请查看官方公告。请提前规划行程。"
    splitter = SentenceSplitter(first_segment_max_chars=20)
    output = []
    emitted_at = None
    for index, char in enumerate(text):
        fragments = splitter.feed(char)
        if fragments and emitted_at is None:
            emitted_at = index
        output.extend(fragments)
    assert emitted_at < text.index("。")
    assert output[0] == "本届大会将在成都举行，"
    assert "".join(output) == text
    assert output[-1] == "请提前规划行程。"


def test_long_chinese_opener_and_single_large_delta_have_no_loss():
    text = "计算机大会为大家提供交流技术与研究成果的机会并欢迎各界参与。"
    splitter = SentenceSplitter(first_segment_max_chars=20)
    output = splitter.feed(text)
    assert len(output[0]) == 20
    assert "".join(output) == text


def test_first_segment_timer_waits_for_safe_boundary(monkeypatch):
    now = [0.0]
    monkeypatch.setattr("opentalking.providers.llm.openai_compatible.sentence_splitter.time.monotonic", lambda: now[0])
    splitter = SentenceSplitter(first_segment_max_chars=20, first_segment_wait_ms=600)
    assert splitter.feed("大会欢迎所有参会人员") == []
    now[0] = 0.7
    output = splitter.feed("前来交流")
    assert output and len(output[0]) >= 8
    assert "".join(output) + splitter.flush() == "大会欢迎所有参会人员前来交流"


@pytest.mark.parametrize("text", ["Supercalifragilisticexpialidocious.", "2026年10月8日09:30在成都举办。", "https://example.com/1234567890/path"])
def test_first_segment_does_not_cut_inside_words_numbers_or_urls(text):
    splitter = SentenceSplitter(first_segment_min_chars=3, first_segment_max_chars=6)
    output = []
    for char in text:
        output.extend(splitter.feed(char))
    remainder = splitter.flush()
    if remainder:
        output.append(remainder)
    assert "".join(output) == text
    assert not any(part.endswith("09:") or part == "Superc" or part == "https:" for part in output)


def test_default_splitter_preserves_sentence_behavior():
    splitter = SentenceSplitter()
    assert splitter.feed("很长的介绍，尚未结束") == []
    assert splitter.feed("。下一句") == ["很长的介绍，尚未结束。"]
    assert splitter.flush() == "下一句"


async def test_llm_pool_reuse_options_sse_and_cleanup(monkeypatch):
    import json

    requests = []
    clients = []
    original = httpx.AsyncClient

    def handle(request):
        requests.append(json.loads(request.content))
        return httpx.Response(200, text='data: {"choices":[{"delta":{"reasoning_content":"thinking"}}]}\n\n'
                              'data: {"choices":[{"delta":{"content":"你好"}}]}\n\n'
                              'data: [DONE]\n\n')

    def create(**kwargs):
        client = original(transport=httpx.MockTransport(handle), **kwargs)
        clients.append(client)
        return client

    monkeypatch.setattr(llm_module.httpx, "AsyncClient", create)
    llm = llm_module.OpenAICompatibleLLMClient(
        "https://llm.test/v1", "test", "voice-model", reuse_connections=True,
        extra_body={"enable_thinking": False, "stream": False, "model": "wrong"},
    )
    for _ in range(2):
        assert [piece async for piece in llm.chat_stream([{"role": "user", "content": "你好"}])] == ["你好"]
    assert len(clients) == 1
    assert not clients[0].is_closed
    assert requests[0]["enable_thinking"] is False
    assert requests[0]["stream"] is True
    assert requests[0]["model"] == "voice-model"
    await llm.aclose()
    assert clients[0].is_closed


async def test_llm_nonpooled_error_closes_client(monkeypatch):
    clients = []
    original = httpx.AsyncClient

    def create(**kwargs):
        client = original(transport=httpx.MockTransport(lambda request: httpx.Response(503)), **kwargs)
        clients.append(client)
        return client

    monkeypatch.setattr(llm_module.httpx, "AsyncClient", create)
    llm = llm_module.OpenAICompatibleLLMClient("https://llm.test/v1", "")
    with pytest.raises(httpx.HTTPStatusError):
        _ = [piece async for piece in llm.chat_stream([])]
    assert clients[0].is_closed
