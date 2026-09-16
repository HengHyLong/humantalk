from __future__ import annotations

import asyncio
import json

import numpy as np
import pytest

from opentalking.core.in_memory_redis import InMemoryRedis
from opentalking.core.redis_keys import events_channel
from opentalking.core.types.frames import VideoFrameData
from opentalking.pipeline.session.runner import SessionRunner


class _FakeVideoTrack:
    def __init__(self) -> None:
        self.frames: list[VideoFrameData] = []

    async def put(self, frame: VideoFrameData) -> None:
        self.frames.append(frame)


class _FakeWebRTC:
    def __init__(self) -> None:
        self.video = _FakeVideoTrack()


def test_quicktalk_disables_static_idle_cache_by_default(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("OPENTALKING_IDLE_CACHE_FRAMES", raising=False)
    monkeypatch.delenv("OPENTALKING_QUICKTALK_IDLE_CACHE_FRAMES", raising=False)
    runner = object.__new__(SessionRunner)
    runner.model_type = "quicktalk"

    assert runner._resolve_idle_cache_frames() == 0


def test_video_sink_publishes_media_started_once_per_speech_turn() -> None:
    asyncio.run(_video_sink_publishes_media_started_once_per_speech_turn())


async def _video_sink_publishes_media_started_once_per_speech_turn() -> None:
    redis = InMemoryRedis()
    pubsub = redis.pubsub()
    await pubsub.subscribe(events_channel("sess_media_started"))

    runner = object.__new__(SessionRunner)
    runner.session_id = "sess_media_started"
    runner.redis = redis
    runner.webrtc = _FakeWebRTC()
    runner._last_speech_frame = None
    runner._speech_started = True
    runner._speech_media_started = False
    runner._closed = False
    runner._video_write_lock = asyncio.Lock()

    frame = VideoFrameData(
        data=np.zeros((2, 2, 3), dtype=np.uint8),
        width=2,
        height=2,
        timestamp_ms=0.0,
    )

    await runner._video_sink(frame)
    assert runner.webrtc.video.frames == [frame]

    message = await pubsub.get_message(timeout=1.0)
    assert message is not None
    payload = json.loads(message["data"])
    assert payload == {
        "event": "speech.media_started",
        "data": {"session_id": "sess_media_started"},
    }

    await runner._video_sink(frame)
    with pytest.raises(asyncio.TimeoutError):
        await asyncio.wait_for(pubsub.incoming.get(), timeout=0.05)

    await pubsub.aclose()
