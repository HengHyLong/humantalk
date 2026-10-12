from __future__ import annotations

import asyncio

import numpy as np
import pytest

from opentalking.core.types.frames import AudioChunk
from opentalking.providers.tts.edge import adapter
from types import SimpleNamespace


@pytest.mark.parametrize("env_proxy,settings_proxy,expected", [
    ("", "", None),
    ("", "http://127.0.0.1:7890", "http://127.0.0.1:7890"),
    ("http://127.0.0.1:8080", "http://127.0.0.1:7890", "http://127.0.0.1:8080"),
])
async def test_edge_proxy_is_scoped_and_respects_configuration(monkeypatch, env_proxy, settings_proxy, expected):
    from opentalking.core import config
    calls = []
    monkeypatch.setenv("OPENTALKING_TTS_EDGE_PROXY", env_proxy)
    monkeypatch.setattr(config, "get_settings", lambda: SimpleNamespace(tts_edge_proxy=settings_proxy))
    class Communicate:
        def __init__(self, text, voice, **kwargs):
            calls.append((text, voice, kwargs))
        async def stream(self):
            yield {"type": "audio", "data": b"mp3"}
    monkeypatch.setattr(adapter.edge_tts, "Communicate", Communicate)
    assert [data async for data in adapter._edge_audio_stream("hello", "zh-CN-XiaoxiaoNeural")] == [b"mp3"]
    assert calls == [("hello", "zh-CN-XiaoxiaoNeural", {"proxy": expected} if expected else {})]


def test_ffmpeg_bin_empty_env_falls_back_to_command_name(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("OPENTALKING_FFMPEG_BIN", "")
    assert adapter._ffmpeg_bin() == "ffmpeg"


def test_synthesize_stream_prefers_streaming_decode(monkeypatch: pytest.MonkeyPatch) -> None:
    streamed = [
        AudioChunk(data=np.array([1, 2, 3], dtype=np.int16), sample_rate=16000, duration_ms=0.1875),
        AudioChunk(data=np.array([4, 5], dtype=np.int16), sample_rate=16000, duration_ms=0.125),
    ]

    async def fake_stream_decode(*_args, **_kwargs):
        for chunk in streamed:
            yield chunk

    monkeypatch.setattr(adapter, "_env_bool", lambda *_args, **_kwargs: True)
    monkeypatch.setattr(adapter, "_edge_audio_stream", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(adapter, "_stream_decode_mp3_to_pcm_chunks", fake_stream_decode)

    async def collect() -> list[AudioChunk]:
        out: list[AudioChunk] = []
        async for chunk in adapter.EdgeTTSAdapter().synthesize_stream("hello"):
            out.append(chunk)
        return out

    out = asyncio.run(collect())
    assert out == streamed


def test_synthesize_stream_uses_buffered_fallback_when_streaming_decode_fails(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def fake_stream_decode(*_args, **_kwargs):
        raise FileNotFoundError("ffmpeg")
        yield

    monkeypatch.setattr(adapter, "_env_bool", lambda *_args, **_kwargs: True)
    monkeypatch.setattr(adapter, "_stream_decode_mp3_to_pcm_chunks", fake_stream_decode)

    async def fake_audio_stream(*_args, **_kwargs):
        yield b"complete-mp3"

    monkeypatch.setattr(adapter, "_edge_audio_stream", fake_audio_stream)
    monkeypatch.setattr(
        adapter,
        "_decode_mp3_to_pcm16_mono",
        lambda *_args, **_kwargs: (np.array([10, 20, 30], dtype=np.int16), 16000),
    )

    async def collect() -> list[AudioChunk]:
        out: list[AudioChunk] = []
        async for chunk in adapter.EdgeTTSAdapter().synthesize_stream("hello"):
            out.append(chunk)
        return out

    out = asyncio.run(collect())
    assert np.array_equal(out[0].data, np.array([10, 20, 30], dtype=np.int16))
