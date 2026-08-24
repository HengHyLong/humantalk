from __future__ import annotations

from types import SimpleNamespace

import numpy as np
import pytest

import opentalking.providers.rtc.aiortc.adapter as aiortc_adapter
from opentalking.core.types.frames import VideoFrameData
from opentalking.providers.rtc.aiortc.adapter import WebRTCSession


def test_configure_aiortc_video_bitrate_from_environment(monkeypatch: pytest.MonkeyPatch) -> None:
    from aiortc.codecs import h264, vpx

    originals = {
        "h264_default": h264.DEFAULT_BITRATE,
        "h264_max": h264.MAX_BITRATE,
        "vpx_default": vpx.DEFAULT_BITRATE,
        "vpx_max": vpx.MAX_BITRATE,
    }
    monkeypatch.setenv("OPENTALKING_WEBRTC_VIDEO_START_BITRATE", "3000000")
    monkeypatch.setenv("OPENTALKING_WEBRTC_VIDEO_MAX_BITRATE", "6000000")
    try:
        aiortc_adapter._configure_aiortc_video_bitrate()

        assert h264.DEFAULT_BITRATE == 3000000
        assert h264.MAX_BITRATE == 6000000
        assert vpx.DEFAULT_BITRATE == 3000000
        assert vpx.MAX_BITRATE == 6000000
    finally:
        h264.DEFAULT_BITRATE = originals["h264_default"]
        h264.MAX_BITRATE = originals["h264_max"]
        vpx.DEFAULT_BITRATE = originals["vpx_default"]
        vpx.MAX_BITRATE = originals["vpx_max"]


def test_configure_nvenc_encoder_factory_and_restore(monkeypatch: pytest.MonkeyPatch) -> None:
    from aiortc import rtcrtpsender

    original = aiortc_adapter._ORIGINAL_AIORTC_GET_ENCODER
    codec = SimpleNamespace(mimeType="video/H264")
    try:
        monkeypatch.setenv("OPENTALKING_WEBRTC_VIDEO_ENCODER", "nvenc")
        aiortc_adapter._configure_aiortc_video_encoder()

        encoder = rtcrtpsender.get_encoder(codec)
        assert isinstance(encoder, aiortc_adapter._NvencH264Encoder)
        assert aiortc_adapter._preferred_video_codec() == "h264"

        monkeypatch.setenv("OPENTALKING_WEBRTC_VIDEO_ENCODER", "auto")
        aiortc_adapter._configure_aiortc_video_encoder()
        assert rtcrtpsender.get_encoder is original
    finally:
        monkeypatch.setenv("OPENTALKING_WEBRTC_VIDEO_ENCODER", "auto")
        aiortc_adapter._configure_aiortc_video_encoder()


def test_nvenc_encoder_builds_low_latency_codec(monkeypatch: pytest.MonkeyPatch) -> None:
    class FakeCodec:
        width = 0
        height = 0
        bit_rate = 0
        pix_fmt = ""
        framerate = None
        time_base = None
        options: dict[str, str] = {}
        opened = False

        def open(self) -> None:
            self.opened = True

    fake_codec = FakeCodec()
    monkeypatch.setenv("OPENTALKING_WEBRTC_NVENC_DEVICE", "1")
    monkeypatch.setenv("OPENTALKING_WEBRTC_NVENC_PRESET", "p2")
    monkeypatch.setattr(
        aiortc_adapter.av.CodecContext,
        "create",
        lambda name, mode: fake_codec if (name, mode) == ("h264_nvenc", "w") else None,
    )

    encoder = aiortc_adapter._NvencH264Encoder()
    codec = encoder._create_nvenc_codec(SimpleNamespace(width=1080, height=1920))

    assert codec is fake_codec
    assert fake_codec.opened is True
    assert fake_codec.width == 1080
    assert fake_codec.height == 1920
    assert fake_codec.options["gpu"] == "1"
    assert fake_codec.options["preset"] == "p2"
    assert fake_codec.options["tune"] == "ull"
    assert fake_codec.options["zerolatency"] == "1"
    assert fake_codec.options["bf"] == "0"


def test_nvenc_encoder_falls_back_to_libx264(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        aiortc_adapter._NvencH264Encoder,
        "_create_nvenc_codec",
        lambda self, frame: (_ for _ in ()).throw(RuntimeError("NVENC unavailable")),
    )
    monkeypatch.setattr(
        aiortc_adapter.H264Encoder,
        "_encode_frame",
        lambda self, frame, force_keyframe: iter([b"software-frame"]),
    )
    encoder = aiortc_adapter._NvencH264Encoder()

    encoded = list(
        encoder._encode_frame(SimpleNamespace(width=1080, height=1920), False)
    )

    assert encoded == [b"software-frame"]
    assert encoder._nvenc_failed is True
    assert encoder._active_codec_name == "libx264"


def test_configure_video_codec_preferences_selects_h264(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class FakeTransceiver:
        kind = "video"

        def __init__(self) -> None:
            self.codecs = []

        def setCodecPreferences(self, codecs) -> None:
            self.codecs = codecs

    transceiver = FakeTransceiver()
    pc = SimpleNamespace(getTransceivers=lambda: [transceiver])
    monkeypatch.setenv("OPENTALKING_WEBRTC_VIDEO_ENCODER", "nvenc")
    monkeypatch.setenv("OPENTALKING_WEBRTC_VIDEO_CODEC", "h264")

    aiortc_adapter._configure_video_codec_preferences(pc)

    assert transceiver.codecs
    assert all(codec.mimeType.lower() == "video/h264" for codec in transceiver.codecs)


def test_buffered_reset_clocks_resets_timeline_without_rewinding_pts() -> None:
    session = WebRTCSession(fps=25.0, sample_rate=16000, mode="buffered")
    try:
        session.video._timeline_start = 12.3
        session.video._timeline_base_ms = 480.0
        session.video._prev_source_ts_ms = 440.0
        session.video._next_pts_ms = 960
        session.audio._start_time = 45.6
        session.audio._clock_start_pts = 32000
        session.audio._next_pts = 32640

        session.reset_clocks()

        assert session.video._timeline_start is None
        assert session.video._timeline_base_ms is None
        assert session.video._prev_source_ts_ms is None
        assert session.video._next_pts_ms == 960
        assert session._shared_clock.start_time is None
        assert session.audio._start_time is None
        assert session.audio._clock_start_pts == 32640
        assert session.audio._next_pts == 32640
    finally:
        session._put_close_sentinel(session.video._queue)
        session._put_close_sentinel(session.audio._queue)


@pytest.mark.asyncio
async def test_buffered_reset_clock_anchors_to_first_media(monkeypatch: pytest.MonkeyPatch) -> None:
    session = WebRTCSession(fps=25.0, sample_rate=16000, mode="buffered")
    monkeypatch.setattr(aiortc_adapter.time, "monotonic", lambda: 200.0)
    try:
        session.reset_clocks()

        assert session._shared_clock.start_time is None

        await session.video.put(
            VideoFrameData(
                data=np.zeros((4, 4, 3), dtype=np.uint8),
                width=4,
                height=4,
                timestamp_ms=0.0,
            )
        )
        await session.video.recv()

        assert session._shared_clock.start_time == 200.0
    finally:
        session._put_close_sentinel(session.video._queue)
        session._put_close_sentinel(session.audio._queue)


def test_clear_media_queues_drops_buffered_audio_and_video_without_rewinding_pts() -> None:
    session = WebRTCSession(fps=25.0, sample_rate=16000, mode="buffered")
    try:
        session.video._queue.put_nowait(
            VideoFrameData(
                data=np.zeros((4, 4, 3), dtype=np.uint8),
                width=4,
                height=4,
                timestamp_ms=120.0,
            )
        )
        session.audio._queue.put_nowait(np.ones((320,), dtype=np.int16))
        session.audio._buffer = np.ones((160,), dtype=np.int16)
        session.audio._next_pts = 640
        session.audio._start_time = 1.23
        session.audio._seen_audio = True

        session.clear_media_queues()

        assert session.video._queue.qsize() == 0
        assert session.audio._queue.qsize() == 0
        assert session.audio._buffer.size == 0
        assert session.audio._next_pts == 640
        assert session.audio._start_time == 1.23
        assert session.audio._seen_audio is True
    finally:
        session._put_close_sentinel(session.video._queue)
        session._put_close_sentinel(session.audio._queue)


def test_buffered_audio_duration_counts_track_buffer_and_pending_queue() -> None:
    session = WebRTCSession(fps=25.0, sample_rate=16000, mode="buffered")
    try:
        session.audio._buffer = np.ones((160,), dtype=np.int16)
        session.audio._queue.put_nowait(np.ones((320,), dtype=np.int16))
        session.audio._queue.put_nowait(np.ones((160,), dtype=np.int16))

        assert session.buffered_audio_duration_ms() == pytest.approx(40.0)
    finally:
        session._put_close_sentinel(session.video._queue)
        session._put_close_sentinel(session.audio._queue)


def test_legacy_reset_clocks_rewinds_per_utterance_timeline() -> None:
    session = WebRTCSession(fps=25.0, sample_rate=16000, mode="legacy")
    try:
        session.video._frame_count = 12
        session.audio._timestamp = 32000

        session.reset_clocks()

        assert session.video._frame_count == 0
        assert session.audio._timestamp == 0
    finally:
        session._put_close_sentinel(session.video._queue)
        session._put_close_sentinel(session.audio._queue)
