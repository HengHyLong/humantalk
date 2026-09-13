from __future__ import annotations

import asyncio

import numpy as np
import pytest

from opentalking.core.types.frames import AudioChunk
from opentalking.providers.tts.edge import adapter


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
