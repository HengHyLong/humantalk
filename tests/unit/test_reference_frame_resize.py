from __future__ import annotations

import asyncio
import io
from types import SimpleNamespace

import numpy as np
from PIL import Image
import pytest

import opentalking.pipeline.speak.synthesis_runner as synthesis_runner
from opentalking.core.config import get_settings
from opentalking.core.model_config import clear_model_config_cache
from opentalking.media.frame_avatar import resize_reference_image_to_video
from opentalking.pipeline.speak.synthesis_runner import FlashTalkRunner


def test_reference_resize_matches_video_dimensions_without_letterbox() -> None:
    image = Image.new("RGB", (100, 50), (255, 255, 255))
    resized = resize_reference_image_to_video(image, width=80, height=80)

    assert resized.size == (80, 80)
    arr = np.asarray(resized)
    assert arr[0, 0].tolist() == [255, 255, 255]


def test_reference_resize_cover_crops_without_distorting_aspect_ratio() -> None:
    image = Image.new("RGB", (200, 100), (255, 0, 0))
    pixels = image.load()
    for x in range(50, 150):
        for y in range(25, 75):
            pixels[x, y] = (0, 255, 0)

    resized = resize_reference_image_to_video(image, width=100, height=100)

    assert resized.size == (100, 100)
    arr = np.asarray(resized)
    green_mask = (arr[:, :, 1] > 200) & (arr[:, :, 0] < 40) & (arr[:, :, 2] < 40)
    ys, xs = np.where(green_mask)
    assert xs.max() - xs.min() >= 90
    assert ys.max() - ys.min() >= 45


def test_flashtalk_idle_frames_continue_from_speech_timeline() -> None:
    runner = FlashTalkRunner.__new__(FlashTalkRunner)
    runner.flashtalk = SimpleNamespace(fps=20)
    runner.webrtc = SimpleNamespace(draining=False)
    runner._playback_draining = False
    runner._quicktalk_idle_video = None
    runner._idle_frames = [np.full((4, 5, 3), 9, dtype=np.uint8)]
    runner._idle_playback_indices = []
    runner._idle_frame_idx = 0
    runner._last_frame = None
    runner._media_clock_started = True
    runner._av_ts_ms = 61_800.0
    queued = []

    async def fake_video_put(frame) -> None:
        queued.append(frame)

    runner._video_put_safe = fake_video_put

    asyncio.run(runner._idle_tick())
    asyncio.run(runner._idle_tick())

    assert [frame.timestamp_ms for frame in queued] == [61_800.0, 61_850.0]
    assert runner._av_ts_ms == 61_900.0


def test_flashtalk_idle_frames_wait_for_speech_tail_to_drain() -> None:
    runner = FlashTalkRunner.__new__(FlashTalkRunner)
    runner.webrtc = SimpleNamespace(draining=False)
    runner._playback_draining = True
    queued = []

    async def fake_video_put(frame) -> None:
        queued.append(frame)

    runner._video_put_safe = fake_video_put

    asyncio.run(runner._idle_tick())

    assert queued == []


def test_idle_tick_keeps_audio_and_video_timelines_advancing() -> None:
    runner = FlashTalkRunner.__new__(FlashTalkRunner)
    runner.webrtc = SimpleNamespace(draining=False, audio=SimpleNamespace(sample_rate=16000))
    runner._playback_draining = False
    runner._quicktalk_idle_video = None
    runner._idle_frames = [np.zeros((4, 4, 3), dtype=np.uint8)]
    runner._idle_playback_indices = [0]
    runner._idle_frame_idx = 0
    runner._av_ts_ms = 0.0
    runner.flashtalk = SimpleNamespace(fps=25.0)
    runner._ensure_media_clock_started = lambda: None
    frames, audio = [], []

    async def video_put(frame):
        frames.append(frame)

    async def audio_put(samples):
        audio.append(samples)

    runner._video_put_safe = video_put
    runner._audio_put_safe = audio_put
    asyncio.run(runner._idle_tick())
    asyncio.run(runner._idle_tick())

    assert [frame.timestamp_ms for frame in frames] == [0.0, 40.0]
    assert sum(samples.size for samples in audio) == 1280
    assert all(not np.any(samples) for samples in audio)


def test_quicktalk_idle_prefers_configured_idle_clip_over_talk_template(tmp_path) -> None:
    idle = tmp_path / "idle.mp4"
    talk = tmp_path / "talk.mp4"
    idle.touch()
    talk.touch()
    runner = FlashTalkRunner.__new__(FlashTalkRunner)
    runner._quicktalk_manifest_metadata = lambda: {
        "motion_clips": {"idle": [{"path": "idle.mp4"}], "talk": [{"path": "talk.mp4"}]}
    }
    runner._resolve_avatar_relative_path = lambda path: tmp_path / path
    runner._quicktalk_template_video = lambda: talk

    assert runner._quicktalk_idle_video_path() == idle


def test_initial_video_frame_uses_configured_idle_playback() -> None:
    runner = FlashTalkRunner.__new__(FlashTalkRunner)
    runner.webrtc = SimpleNamespace(draining=False)
    runner._quicktalk_idle_video = object()
    ticks = []

    async def idle_tick():
        ticks.append(True)

    runner._idle_tick = idle_tick
    asyncio.run(runner._queue_initial_video_frame())

    assert ticks == [True]


@pytest.mark.parametrize("samples", [0, 7680, 7701, 19680])
def test_quicktalk_tail_preserves_audio_without_playing_model_padding(samples) -> None:
    runner = FlashTalkRunner.__new__(FlashTalkRunner)
    runner.model_type = "quicktalk"
    runner.webrtc = None
    pcm = np.ones(samples, dtype=np.int16)
    chunks = runner._speech_tail_chunks(
        pcm, sample_rate=16000, chunk_samples=7680, trailing_silence_ms=320,
    )
    if samples == 0:
        assert chunks == []
        return
    playback = np.concatenate(chunks)
    assert np.array_equal(playback[:samples], pcm)
    assert playback.size % 320 == 0
    assert 0 <= playback.size - samples < 320
    assert not np.any(playback[samples:])


def test_other_models_keep_their_silence_and_complete_model_blocks() -> None:
    runner = FlashTalkRunner.__new__(FlashTalkRunner)
    runner.model_type = "flashtalk"
    chunks = runner._speech_tail_chunks(
        np.ones(7701, dtype=np.int16), sample_rate=16000,
        chunk_samples=7680, trailing_silence_ms=320,
    )
    assert len(chunks) == 2
    assert all(chunk.size == 7680 for chunk in chunks)


@pytest.mark.asyncio
async def test_quicktalk_model_padding_does_not_extend_playback_frames() -> None:
    runner = FlashTalkRunner.__new__(FlashTalkRunner)
    runner.model_type = "quicktalk"
    runner.session_id = "tail-test"
    runner.webrtc = None
    runner._generate_lock = asyncio.Lock()
    inputs = []

    async def generate(pcm):
        inputs.append(pcm)
        return list(range(12))

    runner.flashtalk = SimpleNamespace(audio_chunk_samples=7680, generate=generate)
    frames = await runner._generate_flashtalk_frames(np.ones(960, dtype=np.int16))
    assert inputs[0].size == 7680
    assert np.all(inputs[0][:960] == 1)
    assert not np.any(inputs[0][960:])
    assert frames == [0, 1]


def test_streaming_tts_tail_keeps_last_phoneme_and_only_short_silence_margin() -> None:
    voice = np.full(3200, 1000, dtype=np.int16)
    source = np.concatenate([voice, np.zeros(8000, dtype=np.int16)])
    tail = synthesis_runner._StreamingSilenceTail(16000)
    output = np.concatenate([tail.push(source[start:start + 277]) for start in range(0, source.size, 277)])
    assert np.array_equal(output[:voice.size], voice)
    assert output.size == voice.size + 960
    assert not np.any(output[voice.size:])


def test_streaming_tts_tail_preserves_internal_pauses_and_does_not_delay_voice() -> None:
    tail = synthesis_runner._StreamingSilenceTail(16000)
    first = np.full(1600, -32768, dtype=np.int16)
    pause = np.zeros(16000, dtype=np.int16)
    last = np.full(1600, 1000, dtype=np.int16)
    a = tail.push(first)
    assert np.array_equal(a, first)
    output = np.concatenate([a, tail.push(pause), tail.push(last)])
    assert np.array_equal(output, np.concatenate([first, pause, last]))


def test_speech_ended_keeps_idle_blocked_until_playback_is_drained(monkeypatch) -> None:
    runner = FlashTalkRunner.__new__(FlashTalkRunner)
    runner.session_id = "sess_drain"
    runner.redis = object()
    runner._speech_started = True
    runner._speech_media_active = False
    runner._playback_draining = True
    runner._webrtc_started = SimpleNamespace(is_set=lambda: True)
    runner._interrupt = SimpleNamespace(is_set=lambda: False)
    observed: list[bool] = []
    events: list[tuple[str, dict[str, str]]] = []

    async def wait_for_playback_drain() -> None:
        observed.append(runner._playback_draining)

    async def fake_publish_event(_redis, _session_id, event, payload) -> None:
        events.append((event, payload))

    runner.webrtc = SimpleNamespace(wait_for_playback_drain=wait_for_playback_drain)
    monkeypatch.setattr(synthesis_runner, "publish_event", fake_publish_event)

    asyncio.run(runner._publish_speech_ended("完成"))

    assert observed == [True]
    assert runner._playback_draining is False
    assert runner._speech_started is False
    assert events == [("speech.ended", {"session_id": "sess_drain", "text": "完成"})]


def test_fasterliveportrait_idle_frames_keep_reference_still() -> None:
    runner = FlashTalkRunner.__new__(FlashTalkRunner)
    runner.model_type = "fasterliveportrait"
    base = np.zeros((64, 64, 3), dtype=np.uint8)
    base[20:44, 24:40] = 255

    frames = runner._build_fasterliveportrait_idle_frames(base)

    assert len(frames) == 1
    assert np.array_equal(frames[0], base)


@pytest.mark.asyncio
async def test_fasterliveportrait_queues_reference_rest_frame_after_speech() -> None:
    runner = FlashTalkRunner.__new__(FlashTalkRunner)
    runner.model_type = "fasterliveportrait"
    runner.session_id = "sess_rest_frame"
    runner._reference_frame = np.full((4, 5, 3), 7, dtype=np.uint8)
    runner._last_frame = np.full((4, 5, 3), 200, dtype=np.uint8)
    runner._av_ts_ms = 1234.0
    runner._speech_media_active = True
    runner._webrtc_started = SimpleNamespace(is_set=lambda: True)
    runner.webrtc = SimpleNamespace(
        video=SimpleNamespace(_queue=asyncio.Queue(maxsize=4)),
        draining=False,
    )

    await runner._queue_fasterliveportrait_rest_frame()

    queued = await runner.webrtc.video._queue.get()
    assert queued.timestamp_ms == 1234.0
    assert queued.width == 5
    assert queued.height == 4
    assert np.array_equal(queued.data, runner._reference_frame)
    assert queued.data is not runner._reference_frame
    assert np.array_equal(runner._last_frame, runner._reference_frame)
    assert runner._last_frame is not runner._reference_frame


def test_fasterliveportrait_uses_single_chunk_prebuffer_even_for_long_text(
    monkeypatch,
) -> None:
    monkeypatch.delenv("FLASHTALK_PREBUFFER_CHUNKS", raising=False)
    runner = FlashTalkRunner.__new__(FlashTalkRunner)
    runner.model_type = "fasterliveportrait"
    runner.flashtalk = SimpleNamespace(audio_chunk_samples=16000)

    chunks = runner._prebuffer_chunks(
        speech_text="请连续说一段比较长的中文，用来测试实时数字人的首帧和播放队列稳定性。",
    )

    assert chunks == 1


def test_fasterliveportrait_playback_backpressure_defaults(monkeypatch) -> None:
    monkeypatch.delenv("FLP_PLAYBACK_TARGET_QUEUE_FRAMES", raising=False)
    monkeypatch.delenv("FLP_PLAYBACK_MAX_QUEUE_FRAMES", raising=False)
    monkeypatch.delenv("FLP_PLAYBACK_MAX_WAIT_MS", raising=False)
    runner = FlashTalkRunner.__new__(FlashTalkRunner)
    runner.model_type = "fasterliveportrait"

    assert runner._playback_backpressure_config() == (8, 24, 900.0)


def test_wav2lip_and_quicktalk_playback_backpressure_defaults(monkeypatch) -> None:
    monkeypatch.delenv("AUDIO2VIDEO_PLAYBACK_TARGET_QUEUE_FRAMES", raising=False)
    monkeypatch.delenv("AUDIO2VIDEO_PLAYBACK_MAX_QUEUE_FRAMES", raising=False)
    monkeypatch.delenv("AUDIO2VIDEO_PLAYBACK_MAX_WAIT_MS", raising=False)

    for model_type in ("wav2lip", "quicktalk"):
        runner = FlashTalkRunner.__new__(FlashTalkRunner)
        runner.model_type = model_type

        assert runner._playback_backpressure_config() == (8, 64, 1200.0)


def test_wav2lip_and_quicktalk_playback_backpressure_accept_env(monkeypatch) -> None:
    monkeypatch.setenv("AUDIO2VIDEO_PLAYBACK_TARGET_QUEUE_FRAMES", "3")
    monkeypatch.setenv("AUDIO2VIDEO_PLAYBACK_MAX_QUEUE_FRAMES", "7")
    monkeypatch.setenv("AUDIO2VIDEO_PLAYBACK_MAX_WAIT_MS", "80")

    runner = FlashTalkRunner.__new__(FlashTalkRunner)
    runner.model_type = "quicktalk"

    assert runner._playback_backpressure_config() == (3, 7, 80.0)


@pytest.mark.parametrize(
    ("model_type", "fps", "chunk_samples", "expected_reserve_ms"),
    [
        ("quicktalk", 20, 9600, 1800.0),
        ("wav2lip", 25, 7680, 1440.0),
    ],
)
def test_low_latency_chunks_get_adaptive_jitter_reserve(
    monkeypatch,
    model_type: str,
    fps: int,
    chunk_samples: int,
    expected_reserve_ms: float,
) -> None:
    monkeypatch.delenv("AUDIO2VIDEO_PLAYBACK_AUDIO_RESERVE_MS", raising=False)
    monkeypatch.delenv("AUDIO2VIDEO_PLAYBACK_MAX_QUEUE_FRAMES", raising=False)
    runner = FlashTalkRunner.__new__(FlashTalkRunner)
    runner.model_type = model_type
    runner.flashtalk = SimpleNamespace(
        fps=fps,
        slice_len=12,
        sample_rate=16000,
        audio_chunk_samples=chunk_samples,
    )

    assert runner._playback_audio_reserve_ms() == expected_reserve_ms
    assert runner._playback_backpressure_config() == (8, 48, 1200.0)


def test_wav2lip_and_quicktalk_audio_reserve_defaults_and_accepts_env(monkeypatch) -> None:
    monkeypatch.delenv("AUDIO2VIDEO_PLAYBACK_AUDIO_RESERVE_MS", raising=False)
    runner = FlashTalkRunner.__new__(FlashTalkRunner)
    runner.model_type = "quicktalk"

    assert runner._playback_audio_reserve_ms() == 2400.0

    monkeypatch.setenv("AUDIO2VIDEO_PLAYBACK_AUDIO_RESERVE_MS", "1200")
    assert runner._playback_audio_reserve_ms() == 1200.0


def test_audio2video_backpressure_stops_before_audio_reserve_is_drained(
    monkeypatch,
) -> None:
    monkeypatch.setenv("AUDIO2VIDEO_PLAYBACK_AUDIO_RESERVE_MS", "1000")
    sleeps: list[float] = []

    async def fake_sleep(seconds: float) -> None:
        sleeps.append(seconds)

    monkeypatch.setattr(asyncio, "sleep", fake_sleep)
    queue = asyncio.Queue()
    for item in range(40):
        queue.put_nowait(item)

    runner = FlashTalkRunner.__new__(FlashTalkRunner)
    runner.model_type = "quicktalk"
    runner.webrtc = SimpleNamespace(
        video=SimpleNamespace(_queue=queue),
        draining=False,
        buffered_audio_duration_ms=lambda: 900.0,
    )
    runner._speech_media_active = True
    runner._webrtc_started = SimpleNamespace(is_set=lambda: True)
    runner._interrupt = SimpleNamespace(is_set=lambda: False)

    waited_ms = asyncio.run(
        runner._wait_for_playback_capacity(
            n_frames=28,
            first_media_this_speak=False,
        )
    )

    assert waited_ms == 0.0
    assert sleeps == []


def test_quicktalk_waits_then_interleaves_matching_video_and_audio() -> None:
    calls: list[tuple[str, int]] = []
    video_queue = asyncio.Queue()
    audio_queue = asyncio.Queue()

    runner = FlashTalkRunner.__new__(FlashTalkRunner)
    runner.model_type = "quicktalk"
    runner.session_id = "sess_audio_first"
    runner.flashtalk = SimpleNamespace(sample_rate=16000, fps=20)
    runner.webrtc = SimpleNamespace(
        video=SimpleNamespace(_queue=video_queue),
        audio=SimpleNamespace(_queue=audio_queue),
        buffered_audio_duration_ms=lambda: 1400.0,
    )
    runner._interrupt = SimpleNamespace(is_set=lambda: False)
    runner._av_ts_ms = 0.0
    runner._last_frame = None
    runner._debug_frame_trace = False

    async def fake_append(frames) -> None:
        return None

    async def fake_audio_put(pcm) -> None:
        calls.append(("audio", int(np.asarray(pcm).size)))

    async def fake_wait(**kwargs) -> float:
        assert calls == []
        calls.append(("wait", int(kwargs["n_frames"])))
        return 0.0

    async def fake_video_put(frame) -> None:
        calls.append(("video", 1))

    runner._append_recording_frames_if_enabled = fake_append
    runner._audio_put_safe = fake_audio_put
    runner._wait_for_playback_capacity = fake_wait
    runner._video_put_safe = fake_video_put
    runner._trace_queued_video_frame = lambda frame: None

    pcm = np.ones((22400,), dtype=np.int16)
    frames = [
        SimpleNamespace(
            data=np.zeros((2, 2, 3), dtype=np.uint8),
            timestamp_ms=0.0,
        )
        for _ in range(28)
    ]

    asyncio.run(runner._queue_av_chunk(pcm, frames))

    assert calls[:3] == [("wait", 28), ("video", 1), ("audio", 800)]
    assert [name for name, _ in calls].count("audio") == 28
    assert sum(size for name, size in calls if name == "audio") == 22400
    assert [name for name, _ in calls].count("video") == 28


@pytest.mark.asyncio
async def test_fasterliveportrait_waits_when_playback_queue_is_high(monkeypatch) -> None:
    monkeypatch.setenv("FLP_PLAYBACK_TARGET_QUEUE_FRAMES", "1")
    monkeypatch.setenv("FLP_PLAYBACK_MAX_QUEUE_FRAMES", "4")
    monkeypatch.setenv("FLP_PLAYBACK_MAX_WAIT_MS", "60")
    sleeps: list[float] = []

    async def fake_sleep(seconds: float) -> None:
        sleeps.append(seconds)

    monkeypatch.setattr(asyncio, "sleep", fake_sleep)
    queue = asyncio.Queue()
    for item in range(6):
        queue.put_nowait(item)

    runner = FlashTalkRunner.__new__(FlashTalkRunner)
    runner.model_type = "fasterliveportrait"
    runner.webrtc = SimpleNamespace(
        video=SimpleNamespace(_queue=queue),
        draining=False,
    )
    runner._speech_media_active = True
    runner._webrtc_started = SimpleNamespace(is_set=lambda: True)
    runner._interrupt = SimpleNamespace(is_set=lambda: False)

    waited_ms = await runner._wait_for_playback_capacity(
        n_frames=25,
        first_media_this_speak=False,
    )

    assert waited_ms >= 60.0
    assert len(sleeps) >= 3


def test_fasterliveportrait_enables_tts_opener_by_default(
    monkeypatch,
) -> None:
    monkeypatch.delenv("FLASHTALK_TTS_OPENER_ENABLE", raising=False)
    monkeypatch.delenv("OPENTALKING_FLASHTALK_TTS_OPENER_ENABLE", raising=False)
    runner = FlashTalkRunner.__new__(FlashTalkRunner)
    runner.model_type = "fasterliveportrait"

    assert runner._tts_opener_enabled_for_model() is True


def test_flashtalk_keeps_tts_opener_disabled_by_default(
    monkeypatch,
) -> None:
    monkeypatch.delenv("FLASHTALK_TTS_OPENER_ENABLE", raising=False)
    monkeypatch.delenv("OPENTALKING_FLASHTALK_TTS_OPENER_ENABLE", raising=False)
    runner = FlashTalkRunner.__new__(FlashTalkRunner)
    runner.model_type = "flashtalk"

    assert runner._tts_opener_enabled_for_model() is False


def test_fasterliveportrait_preloads_tts_openers_for_default_voice(
    monkeypatch,
) -> None:
    monkeypatch.delenv("FLASHTALK_TTS_OPENER_PRELOAD", raising=False)
    monkeypatch.delenv("OPENTALKING_FLASHTALK_TTS_OPENER_PRELOAD", raising=False)
    runner = FlashTalkRunner.__new__(FlashTalkRunner)
    runner.model_type = "fasterliveportrait"

    assert runner._tts_opener_preload_voice() == "zh-CN-XiaoxiaoNeural"


def test_fasterliveportrait_tts_opener_preload_uses_edge_voice_when_tts_voice_changes(
    monkeypatch,
) -> None:
    monkeypatch.setenv("OPENTALKING_TTS_VOICE", "alloy")
    monkeypatch.setenv("OPENTALKING_TTS_EDGE_VOICE", "zh-CN-XiaoxiaoNeural")
    get_settings.cache_clear()
    runner = FlashTalkRunner.__new__(FlashTalkRunner)
    runner.model_type = "fasterliveportrait"

    try:
        assert runner._tts_opener_preload_voice() == "zh-CN-XiaoxiaoNeural"
    finally:
        get_settings.cache_clear()


def test_fasterliveportrait_video_config_preserves_reference_aspect_ratio(
    tmp_path,
    monkeypatch,
) -> None:
    monkeypatch.setenv("OPENTALKING_CONFIG_FILE", str(tmp_path / "missing.yaml"))
    clear_model_config_cache()
    ref_image = tmp_path / "reference.png"
    Image.new("RGB", (830, 1108), (255, 255, 255)).save(ref_image)

    runner = FlashTalkRunner.__new__(FlashTalkRunner)
    runner.model_type = "fasterliveportrait"

    config = runner._fasterliveportrait_video_config(ref_image)

    assert config is not None
    assert config["width"] == 448
    assert config["height"] == 598

    clear_model_config_cache()


def test_fasterliveportrait_reference_payload_uses_live_video_dimensions(tmp_path) -> None:
    ref_image = tmp_path / "reference.png"
    Image.new("RGB", (830, 1108), (255, 255, 255)).save(ref_image)

    runner = FlashTalkRunner.__new__(FlashTalkRunner)
    runner.model_type = "fasterliveportrait"

    payload = runner._fasterliveportrait_ref_image_payload(
        ref_image,
        {"width": 448, "height": 598},
    )

    assert Image.open(io.BytesIO(payload)).size == (448, 598)
