from __future__ import annotations

import asyncio
import fractions
import json
import logging
import os
import time
from dataclasses import dataclass
from typing import Any, Iterator

import numpy as np
try:
    import av
    from aiortc import (
        RTCConfiguration,
        RTCIceServer,
        RTCPeerConnection,
        RTCRtpSender,
        RTCSessionDescription,
    )
    from aiortc import rtcrtpsender as aiortc_rtcrtpsender
    from aiortc.codecs import h264 as aiortc_h264
    from aiortc.codecs.h264 import H264Encoder
    from aiortc.contrib.media import MediaBlackhole
    from av import AudioFrame, VideoFrame
    WEBRTC_AVAILABLE = True
except ImportError:  # Admin/API-only startup can run without video wheels installed.
    WEBRTC_AVAILABLE = False

    @dataclass
    class RTCIceServer:  # type: ignore[no-redef]
        urls: str | list[str]
        username: str | None = None
        credential: str | None = None
        credentialType: str = "password"

    class RTCConfiguration:  # type: ignore[no-redef]
        def __init__(self, *, iceServers: list[RTCIceServer]) -> None:
            self.iceServers = iceServers

    class RTCSessionDescription:  # type: ignore[no-redef]
        def __init__(self, *, sdp: str, type: str) -> None:
            self.sdp = sdp
            self.type = type

    class RTCPeerConnection:  # type: ignore[no-redef]
        def __init__(self, *_args: Any, **_kwargs: Any) -> None:
            raise RuntimeError("WebRTC dependencies are not installed; install av and aiortc to start a digital-human session.")

    class MediaBlackhole:  # type: ignore[no-redef]
        pass

    RTCRtpSender = Any  # type: ignore[misc,assignment]
    AudioFrame = Any  # type: ignore[misc,assignment]
    VideoFrame = Any  # type: ignore[misc,assignment]
    H264Encoder = object  # type: ignore[misc,assignment]

from opentalking.core.types.frames import VideoFrameData

log = logging.getLogger(__name__)

_ORIGINAL_AIORTC_GET_ENCODER = (
    aiortc_rtcrtpsender.get_encoder if WEBRTC_AVAILABLE else None
)
_AIORTC_ENCODER_FACTORY_MODE = "default"


def _create_codec_context(name: str, mode: str) -> Any:
    """Create an FFmpeg codec context behind a patchable module boundary."""
    return av.CodecContext.create(name, mode)


def _rtc_max_catchup_seconds() -> float:
    raw = os.environ.get("OPENTALKING_RTC_MAX_CATCHUP_MS", "120").strip()
    try:
        value_ms = float(raw)
    except ValueError:
        log.warning("Ignoring invalid OPENTALKING_RTC_MAX_CATCHUP_MS=%r", raw)
        value_ms = 120.0
    return max(0.0, value_ms) / 1000.0


def _normalized_video_encoder() -> str:
    raw = os.environ.get("OPENTALKING_WEBRTC_VIDEO_ENCODER", "auto").strip().lower()
    aliases = {
        "": "auto",
        "software": "libx264",
        "cpu": "libx264",
        "h264_nvenc": "nvenc",
    }
    normalized = aliases.get(raw, raw)
    if normalized not in {"auto", "libx264", "nvenc"}:
        log.warning(
            "Ignoring invalid OPENTALKING_WEBRTC_VIDEO_ENCODER=%r; "
            "expected auto, libx264, or nvenc",
            raw,
        )
        return "auto"
    return normalized


class _NvencH264Encoder(H264Encoder):
    """aiortc H.264 packetizer backed by FFmpeg's NVIDIA NVENC encoder."""

    def __init__(self) -> None:
        super().__init__()
        self._nvenc_failed = False
        self._active_codec_name: str | None = None

    def _create_nvenc_codec(self, frame: "av.VideoFrame") -> Any:
        codec = _create_codec_context("h264_nvenc", "w")
        codec.width = frame.width
        codec.height = frame.height
        codec.bit_rate = self.target_bitrate
        codec.pix_fmt = "yuv420p"
        codec.framerate = fractions.Fraction(aiortc_h264.MAX_FRAME_RATE, 1)
        codec.time_base = fractions.Fraction(1, aiortc_h264.MAX_FRAME_RATE)
        codec.options = {
            "preset": os.environ.get("OPENTALKING_WEBRTC_NVENC_PRESET", "p1").strip() or "p1",
            "tune": os.environ.get("OPENTALKING_WEBRTC_NVENC_TUNE", "ull").strip() or "ull",
            "zerolatency": "1",
            "bf": "0",
            "gpu": os.environ.get("OPENTALKING_WEBRTC_NVENC_DEVICE", "0").strip() or "0",
        }
        codec.open()
        self._active_codec_name = "h264_nvenc"
        log.info(
            "WebRTC H.264 encoder active: codec=h264_nvenc device=%s preset=%s "
            "resolution=%dx%d bitrate=%d",
            codec.options.get("gpu", "0"),
            codec.options.get("preset", "p1"),
            frame.width,
            frame.height,
            self.target_bitrate,
        )
        return codec

    def _should_recreate_codec(self, frame: "av.VideoFrame") -> bool:
        if self.codec is None:
            return True
        current_bitrate = int(self.codec.bit_rate or 0)
        return (
            frame.width != self.codec.width
            or frame.height != self.codec.height
            or current_bitrate <= 0
            or abs(self.target_bitrate - current_bitrate) / current_bitrate > 0.1
        )

    def _encode_frame(
        self,
        frame: "av.VideoFrame",
        force_keyframe: bool,
    ) -> Iterator[bytes]:
        if self._nvenc_failed:
            yield from super()._encode_frame(frame, force_keyframe)
            return

        try:
            if self._should_recreate_codec(frame):
                self.buffer_data = b""
                self.buffer_pts = None
                self.codec = self._create_nvenc_codec(frame)

            frame.pict_type = (
                av.video.frame.PictureType.I
                if force_keyframe
                else av.video.frame.PictureType.NONE
            )
            data_to_send = b""
            assert self.codec is not None
            for package in self.codec.encode(frame):
                data_to_send += bytes(package)
            if data_to_send:
                yield from self._split_bitstream(data_to_send)
        except Exception as exc:
            self.codec = None
            self.buffer_data = b""
            self.buffer_pts = None
            self._nvenc_failed = True
            self._active_codec_name = "libx264"
            log.warning(
                "NVENC initialization or encoding failed; falling back to libx264: %s: %s",
                type(exc).__name__,
                exc,
            )
            # The software encoder starts a new bitstream and therefore needs a keyframe.
            yield from super()._encode_frame(frame, True)


def _configure_aiortc_video_encoder() -> None:
    """Install the requested H.264 encoder factory before RTP sending starts."""
    global _AIORTC_ENCODER_FACTORY_MODE
    if not WEBRTC_AVAILABLE or _ORIGINAL_AIORTC_GET_ENCODER is None:
        return

    encoder = _normalized_video_encoder()
    if encoder == "nvenc":
        if _AIORTC_ENCODER_FACTORY_MODE == "nvenc":
            return

        def get_encoder(codec: Any) -> Any:
            if str(codec.mimeType).lower() == "video/h264":
                return _NvencH264Encoder()
            return _ORIGINAL_AIORTC_GET_ENCODER(codec)

        aiortc_rtcrtpsender.get_encoder = get_encoder
        _AIORTC_ENCODER_FACTORY_MODE = "nvenc"
        log.info("Configured WebRTC video encoder: requested=nvenc codec=h264")
        return

    if _AIORTC_ENCODER_FACTORY_MODE != "default":
        aiortc_rtcrtpsender.get_encoder = _ORIGINAL_AIORTC_GET_ENCODER
    _AIORTC_ENCODER_FACTORY_MODE = "default"


def _preferred_video_codec() -> str:
    raw = os.environ.get("OPENTALKING_WEBRTC_VIDEO_CODEC", "auto").strip().lower()
    if raw in {"h264", "vp8"}:
        if _normalized_video_encoder() == "nvenc" and raw != "h264":
            log.warning("NVENC requires H.264; overriding requested WebRTC codec %s", raw)
            return "h264"
        return raw
    if raw not in {"", "auto"}:
        log.warning(
            "Ignoring invalid OPENTALKING_WEBRTC_VIDEO_CODEC=%r; expected auto, h264, or vp8",
            raw,
        )
    return "h264" if _normalized_video_encoder() == "nvenc" else "auto"


def _configure_video_codec_preferences(pc: Any) -> None:
    preferred = _preferred_video_codec()
    if not WEBRTC_AVAILABLE or preferred == "auto":
        return
    capabilities = RTCRtpSender.getCapabilities("video").codecs
    codecs = [codec for codec in capabilities if codec.mimeType.lower() == f"video/{preferred}"]
    if not codecs:
        log.warning("Requested WebRTC video codec is unavailable: %s", preferred)
        return
    configured = 0
    for transceiver in pc.getTransceivers():
        if transceiver.kind == "video":
            transceiver.setCodecPreferences(codecs)
            configured += 1
    log.info("Configured WebRTC video codec preference: codec=%s tracks=%d", preferred, configured)


def _positive_env_int(name: str) -> int | None:
    raw = os.environ.get(name, "").strip()
    if not raw:
        return None
    try:
        value = int(raw)
    except ValueError:
        log.warning("Ignoring invalid %s=%r; expected a positive integer", name, raw)
        return None
    if value <= 0:
        log.warning("Ignoring invalid %s=%r; expected a positive integer", name, raw)
        return None
    return value


def _configure_aiortc_video_bitrate() -> None:
    """Apply optional process-wide bitrate limits before aiortc creates an encoder.

    aiortc currently has no public sender-encoding bitrate API. Its VP8 and H.264
    encoders read module-level defaults when they are constructed, so update those
    defaults before offer/answer negotiation starts. No values are changed unless
    the deployment explicitly opts in through environment variables.
    """
    start_bitrate = _positive_env_int("OPENTALKING_WEBRTC_VIDEO_START_BITRATE")
    max_bitrate = _positive_env_int("OPENTALKING_WEBRTC_VIDEO_MAX_BITRATE")
    if not WEBRTC_AVAILABLE or (start_bitrate is None and max_bitrate is None):
        return

    from aiortc.codecs import h264, vpx

    configured: list[str] = []
    for name, codec_module in (("VP8", vpx), ("H264", h264)):
        codec_min = int(codec_module.MIN_BITRATE)
        codec_start = int(start_bitrate or codec_module.DEFAULT_BITRATE)
        codec_max = int(max_bitrate or max(codec_module.MAX_BITRATE, codec_start))
        codec_max = max(codec_min, codec_max)
        codec_start = max(codec_min, min(codec_start, codec_max))
        codec_module.DEFAULT_BITRATE = codec_start
        codec_module.MAX_BITRATE = codec_max
        configured.append(f"{name}={codec_start}/{codec_max}")

    log.info("Configured aiortc video bitrate start/max (bps): %s", ", ".join(configured))


def _split_ice_urls(value: str) -> list[str]:
    return [item.strip() for item in value.replace(";", ",").split(",") if item.strip()]


def _ice_server_from_mapping(value: dict[str, object]) -> RTCIceServer | None:
    urls = value.get("urls") or value.get("url")
    if isinstance(urls, str):
        normalized_urls: str | list[str] = urls.strip()
    elif isinstance(urls, list):
        normalized_urls = [str(item).strip() for item in urls if str(item).strip()]
    else:
        return None
    if not normalized_urls:
        return None

    username = value.get("username")
    credential = value.get("credential")
    credential_type = value.get("credentialType") or value.get("credential_type") or "password"
    return RTCIceServer(
        urls=normalized_urls,
        username=str(username) if username is not None else None,
        credential=str(credential) if credential is not None else None,
        credentialType=str(credential_type),
    )


def _ice_server_urls(server: RTCIceServer) -> list[str]:
    if isinstance(server.urls, list):
        return [str(item) for item in server.urls]
    return [str(server.urls)]


def _has_turn_server(servers: list[RTCIceServer]) -> bool:
    return any(url.startswith(("turn:", "turns:")) for server in servers for url in _ice_server_urls(server))


def _parse_ice_servers(raw_config: str, *, config_name: str) -> list[RTCIceServer]:
    servers: list[RTCIceServer] = []
    if not raw_config:
        return servers
    if raw_config[0] not in "[{":
        return [RTCIceServer(urls=url) for url in _split_ice_urls(raw_config)]

    try:
        parsed = json.loads(raw_config)
    except Exception:
        log.exception("Ignoring invalid %s", config_name)
        return servers
    if isinstance(parsed, list):
        for item in parsed:
            if isinstance(item, str) and item.strip():
                servers.append(RTCIceServer(urls=item.strip()))
            elif isinstance(item, dict):
                server = _ice_server_from_mapping(item)
                if server is not None:
                    servers.append(server)
    elif isinstance(parsed, dict):
        server = _ice_server_from_mapping(parsed)
        if server is not None:
            servers.append(server)
    return servers


def get_webrtc_ice_transport_policy() -> str:
    configured = os.environ.get("OPENTALKING_WEBRTC_ICE_TRANSPORT_POLICY", "").strip().lower()
    if configured in {"all", "relay"}:
        return configured
    return "relay" if _has_turn_server(get_webrtc_ice_servers()) else "all"


def get_webrtc_ice_servers() -> list[RTCIceServer]:
    """Return ICE servers exposed to browser clients."""
    raw_config = os.environ.get("OPENTALKING_WEBRTC_ICE_SERVERS", "").strip()
    servers = _parse_ice_servers(raw_config, config_name="OPENTALKING_WEBRTC_ICE_SERVERS")

    if not servers:
        stun_urls = _split_ice_urls(
            os.environ.get("OPENTALKING_WEBRTC_STUN_URLS", "")
            or os.environ.get("OPENTALKING_WEBRTC_STUN_URL", "")
            or "stun:stun.l.google.com:19302"
        )
        servers.extend(RTCIceServer(urls=url) for url in stun_urls)

    turn_urls = _split_ice_urls(
        os.environ.get("OPENTALKING_WEBRTC_TURN_URLS", "")
        or os.environ.get("OPENTALKING_WEBRTC_TURN_URL", "")
    )
    if turn_urls and not _has_turn_server(servers):
        servers.append(
            RTCIceServer(
                urls=turn_urls if len(turn_urls) > 1 else turn_urls[0],
                username=os.environ.get("OPENTALKING_WEBRTC_TURN_USERNAME") or None,
                credential=os.environ.get("OPENTALKING_WEBRTC_TURN_CREDENTIAL") or None,
            )
        )

    return servers


def get_webrtc_server_ice_servers() -> list[RTCIceServer]:
    """Return ICE servers used by the server-side aiortc peer."""
    raw_config = os.environ.get("OPENTALKING_WEBRTC_SERVER_ICE_SERVERS", "").strip()
    if not raw_config:
        return get_webrtc_ice_servers()
    return _parse_ice_servers(raw_config, config_name="OPENTALKING_WEBRTC_SERVER_ICE_SERVERS")


def get_webrtc_ice_config_payload() -> dict[str, object]:
    ice_servers: list[dict[str, object]] = []
    for server in get_webrtc_ice_servers():
        item: dict[str, object] = {"urls": server.urls}
        if server.username:
            item["username"] = server.username
        if server.credential:
            item["credential"] = server.credential
        ice_servers.append(item)
    return {
        "iceServers": ice_servers,
        "iceTransportPolicy": get_webrtc_ice_transport_policy(),
    }


if WEBRTC_AVAILABLE:
    from aiortc.mediastreams import MediaStreamTrack
else:
    class MediaStreamTrack:  # type: ignore[no-redef]
        kind = ""

        def __init__(self, *_args: Any, **_kwargs: Any) -> None:
            pass


@dataclass
class _SharedWallClock:
    start_time: float | None = None


class _LegacyNumpyVideoTrack(MediaStreamTrack):
    kind = "video"

    def __init__(self, fps: float = 25.0) -> None:
        super().__init__()
        self._fps = fps
        self._interval = 1.0 / fps
        self._queue: asyncio.Queue[VideoFrameData | None] = asyncio.Queue(maxsize=256)
        self._frame_count = 0
        self._next_send: float = 0.0
        self._pacing = False

    async def put(self, frame: VideoFrameData | None) -> None:
        await self._queue.put(frame)

    def reset_clock(self) -> None:
        self._frame_count = 0
        self._next_send = time.monotonic()
        self._pacing = True

    def clear_pending(self) -> None:
        return

    async def recv(self) -> VideoFrame:
        item = await self._queue.get()
        if item is None:
            raise asyncio.CancelledError

        if self._pacing:
            now = time.monotonic()
            if now < self._next_send:
                await asyncio.sleep(self._next_send - now)
            self._next_send += self._interval
            now2 = time.monotonic()
            if self._next_send < now2 - self._interval * 2:
                self._next_send = now2

        vf = VideoFrame.from_ndarray(item.data, format="bgr24")
        self._frame_count += 1
        vf.pts = self._frame_count
        vf.time_base = fractions.Fraction(1, int(max(1, round(self._fps))))
        return vf


class _BufferedNumpyVideoTrack(MediaStreamTrack):
    kind = "video"

    def __init__(self, fps: float = 25.0, *, shared_clock: _SharedWallClock | None = None) -> None:
        super().__init__()
        self._fps = fps
        self._queue: asyncio.Queue[VideoFrameData | None] = asyncio.Queue(maxsize=256)
        self._timeline_start: float | None = None
        self._timeline_base_ms: float | None = None
        self._prev_source_ts_ms: float | None = None
        self._next_pts_ms = 0
        self._shared_clock = shared_clock
        self._debug_frames = os.environ.get("OPENTALKING_RTC_DEBUG_FRAMES", "").strip().lower() in {"1", "true", "yes", "on"}
        self._debug_recv_count = 0
        self._debug_prev_mean: float | None = None

    async def put(self, frame: VideoFrameData | None) -> None:
        await self._queue.put(frame)

    def reset_clock(self) -> None:
        self._timeline_start = None
        self._timeline_base_ms = None
        self._prev_source_ts_ms = None

    def clear_pending(self) -> None:
        return

    async def recv(self) -> VideoFrame:
        item = await self._queue.get()
        if item is None:
            raise asyncio.CancelledError

        frame_ts_ms = max(0.0, float(item.timestamp_ms))
        if self._timeline_start is None or self._timeline_base_ms is None:
            shared_start = self._shared_clock.start_time if self._shared_clock is not None else None
            if shared_start is None:
                shared_start = time.monotonic()
                if self._shared_clock is not None:
                    self._shared_clock.start_time = shared_start
            self._timeline_start = shared_start
            self._timeline_base_ms = frame_ts_ms

        shared_start = self._shared_clock.start_time if self._shared_clock is not None else None
        if shared_start is not None and self._timeline_start != shared_start:
            self._timeline_start = shared_start

        target = self._timeline_start + max(
            0.0,
            (frame_ts_ms - self._timeline_base_ms) / 1000.0,
        )
        now = time.monotonic()
        max_catchup_s = _rtc_max_catchup_seconds()
        lateness_s = now - target
        if max_catchup_s > 0.0 and lateness_s > max_catchup_s:
            self._timeline_start += lateness_s
            if self._shared_clock is not None:
                self._shared_clock.start_time = self._timeline_start
            target = now
            log.warning(
                "RTC video underrun recovered without burst catch-up: late_ms=%.1f queue=%d",
                lateness_s * 1000.0,
                self._queue.qsize(),
            )
        if now < target:
            await asyncio.sleep(target - now)

        vf = VideoFrame.from_ndarray(item.data, format="bgr24")
        vf.pts = self._next_pts_ms
        vf.time_base = fractions.Fraction(1, 1000)
        if self._debug_frames:
            arr = np.asarray(item.data)
            mean = float(arr.mean()) if arr.size else 0.0
            delta = 0.0 if self._debug_prev_mean is None else abs(mean - self._debug_prev_mean)
            self._debug_prev_mean = mean
            self._debug_recv_count += 1
            if self._debug_recv_count <= 12 or self._debug_recv_count % 32 == 0:
                log.info(
                    "RTC video recv: n=%d ts=%.1f pts=%d q=%d shape=%s mean=%.2f dmean=%.2f",
                    self._debug_recv_count,
                    frame_ts_ms,
                    self._next_pts_ms,
                    self._queue.qsize(),
                    tuple(arr.shape),
                    mean,
                    delta,
                )

        if self._prev_source_ts_ms is None:
            delta_ms = int(round(1000.0 / max(1.0, self._fps)))
        else:
            delta_ms = int(round(frame_ts_ms - self._prev_source_ts_ms))
            if delta_ms <= 0:
                delta_ms = int(round(1000.0 / max(1.0, self._fps)))
        self._prev_source_ts_ms = frame_ts_ms
        self._next_pts_ms += max(1, delta_ms)
        return vf


class _LegacyPCM16AudioTrack(MediaStreamTrack):
    kind = "audio"

    def __init__(self, sample_rate: int = 16000) -> None:
        super().__init__()
        self.sample_rate = sample_rate
        self._queue: asyncio.Queue[np.ndarray | None] = asyncio.Queue(maxsize=512)
        self._timestamp = 0
        self._time_base = fractions.Fraction(1, sample_rate)
        self._next_send: float = 0.0
        self._pacing = False

    async def put_pcm(self, samples: np.ndarray | None) -> None:
        await self._queue.put(samples)

    def reset_clock(self) -> None:
        self._timestamp = 0
        self._next_send = time.monotonic()
        self._pacing = True

    def clear_pending(self) -> None:
        return

    async def recv(self) -> AudioFrame:
        samples = await self._queue.get()
        if samples is None:
            raise asyncio.CancelledError
        if samples.dtype != np.int16:
            samples = samples.astype(np.int16)
        n = int(samples.shape[0])

        if self._pacing:
            chunk_duration = n / self.sample_rate
            now = time.monotonic()
            if now < self._next_send:
                await asyncio.sleep(self._next_send - now)
            self._next_send += chunk_duration
            now2 = time.monotonic()
            if self._next_send < now2 - chunk_duration * 2:
                self._next_send = now2

        frame = AudioFrame(format="s16", layout="mono", samples=n)
        frame.planes[0].update(samples.tobytes())
        frame.sample_rate = self.sample_rate
        frame.pts = self._timestamp
        frame.time_base = self._time_base
        self._timestamp += n
        return frame


class _BufferedPCM16AudioTrack(MediaStreamTrack):
    kind = "audio"

    def __init__(self, sample_rate: int = 16000, *, shared_clock: _SharedWallClock | None = None) -> None:
        super().__init__()
        self.sample_rate = sample_rate
        self._queue: asyncio.Queue[np.ndarray | None] = asyncio.Queue(maxsize=512)
        self._time_base = fractions.Fraction(1, sample_rate)
        self._next_pts = 0
        frame_ms = float(os.environ.get("OPENTALKING_RTC_AUDIO_FRAME_MS", "20.0"))
        self._frame_samples = max(1, int(round(self.sample_rate * frame_ms / 1000.0)))
        self._buffer = np.zeros((0,), dtype=np.int16)
        self._start_time: float | None = None
        self._clock_start_pts = 0
        self._seen_audio = False
        self._eof = False
        self._shared_clock = shared_clock

    async def put_pcm(self, samples: np.ndarray | None) -> None:
        await self._queue.put(samples)

    def reset_clock(self) -> None:
        self._start_time = None
        self._clock_start_pts = self._next_pts
        self._seen_audio = False

    def clear_pending(self) -> None:
        self._buffer = np.zeros((0,), dtype=np.int16)
        self._eof = False

    async def _fill_buffer(self) -> None:
        while self._buffer.size < self._frame_samples and not self._eof:
            samples = await self._queue.get()
            if samples is None:
                self._eof = True
                break
            arr = np.asarray(samples, dtype=np.int16).reshape(-1)
            if arr.size == 0:
                continue
            if self._buffer.size == 0:
                self._buffer = arr.copy()
            else:
                self._buffer = np.concatenate((self._buffer, arr)).astype(np.int16, copy=False)

    async def recv(self) -> AudioFrame:
        await self._fill_buffer()
        if self._buffer.size == 0 and self._eof:
            raise asyncio.CancelledError
        if self._buffer.size == 0:
            return await self.recv()

        n = min(self._frame_samples, int(self._buffer.shape[0]))
        samples = self._buffer[:n]
        self._buffer = self._buffer[n:]

        pts = self._next_pts
        if self._start_time is None:
            shared_start = self._shared_clock.start_time if self._shared_clock is not None else None
            if shared_start is None:
                shared_start = time.monotonic()
                if self._shared_clock is not None:
                    self._shared_clock.start_time = shared_start
            self._start_time = shared_start
            self._clock_start_pts = pts
            self._seen_audio = True

        assert self._start_time is not None
        shared_start = self._shared_clock.start_time if self._shared_clock is not None else None
        if shared_start is not None and self._start_time != shared_start:
            self._start_time = shared_start
        target = self._start_time + ((pts - self._clock_start_pts) / self.sample_rate)
        now = time.monotonic()
        max_catchup_s = _rtc_max_catchup_seconds()
        lateness_s = now - target
        if max_catchup_s > 0.0 and lateness_s > max_catchup_s:
            self._start_time += lateness_s
            if self._shared_clock is not None:
                self._shared_clock.start_time = self._start_time
            target = now
            log.warning(
                "RTC audio underrun recovered without burst catch-up: late_ms=%.1f queue=%d",
                lateness_s * 1000.0,
                self._queue.qsize(),
            )
        if now < target:
            await asyncio.sleep(target - now)

        frame = AudioFrame(format="s16", layout="mono", samples=n)
        frame.planes[0].update(samples.tobytes())
        frame.sample_rate = self.sample_rate
        frame.pts = pts
        frame.time_base = self._time_base
        self._next_pts += n
        return frame


class WebRTCSession:
    """Wraps RTCPeerConnection with numpy video/audio queues."""

    def __init__(
        self,
        *,
        fps: float = 25.0,
        sample_rate: int = 16000,
        mode: str = "buffered",
    ) -> None:
        try:
            asyncio.get_event_loop()
        except RuntimeError:
            asyncio.set_event_loop(asyncio.new_event_loop())
        _configure_aiortc_video_bitrate()
        _configure_aiortc_video_encoder()
        self.pc = RTCPeerConnection(RTCConfiguration(iceServers=get_webrtc_server_ice_servers()))
        normalized_mode = mode.strip().lower()
        self._shared_clock = _SharedWallClock()
        if normalized_mode == "legacy":
            self.video = _LegacyNumpyVideoTrack(fps=fps)
            self.audio = _LegacyPCM16AudioTrack(sample_rate=sample_rate)
        else:
            self.video = _BufferedNumpyVideoTrack(fps=fps, shared_clock=self._shared_clock)
            self.audio = _BufferedPCM16AudioTrack(sample_rate=sample_rate, shared_clock=self._shared_clock)
        self.mode = normalized_mode
        self.pc.addTrack(self.video)
        self.pc.addTrack(self.audio)
        self.draining = False  # True while clearing queues for speech start

    def reset_clocks(self) -> None:
        """Reset pacing wall-clock so next frame/audio is sent immediately.
        Does NOT reset PTS counters — keeps the RTP stream continuous."""
        self._shared_clock.start_time = None
        self.video.reset_clock()
        self.audio.reset_clock()
        self.draining = False

    def clear_media_queues(self) -> None:
        while True:
            try:
                self.video._queue.get_nowait()
            except asyncio.QueueEmpty:
                break
        while True:
            try:
                self.audio._queue.get_nowait()
            except asyncio.QueueEmpty:
                break
        self.video.clear_pending()
        self.audio.clear_pending()

    def buffered_audio_duration_ms(self) -> float:
        """Return queued plus track-local PCM duration waiting for playback."""
        sample_rate = max(1, int(getattr(self.audio, "sample_rate", 16000) or 16000))
        buffered = getattr(self.audio, "_buffer", None)
        samples = int(getattr(buffered, "size", 0) or 0)
        queue = getattr(self.audio, "_queue", None)
        pending = tuple(getattr(queue, "_queue", ()))
        for item in pending:
            if item is None:
                continue
            samples += int(np.asarray(item).size)
        return samples * 1000.0 / sample_rate

    async def wait_for_playback_drain(self) -> None:
        """Wait until queued audio has been handed to the WebRTC sender.

        Producers can finish synthesizing before the browser has consumed the
        audio queue.  Publishing ``speech.ended`` at that point makes clients
        switch their speaking UI back to idle while audio is still audible.
        This only waits for the already-queued media and has a bounded timeout
        so a disconnected peer cannot block a session forever.
        """
        audio_queue = self.audio._queue
        buffered = getattr(self.audio, "_buffer", None)
        queue_duration = audio_queue.qsize() * 0.02
        timeout = min(15.0, max(1.0, queue_duration + 2.0))
        deadline = asyncio.get_running_loop().time() + timeout
        while asyncio.get_running_loop().time() < deadline:
            buffered_samples = int(getattr(buffered, "size", 0) or 0)
            if audio_queue.empty() and buffered_samples == 0:
                # Let the sender take the final frame before the event is
                # observed by the browser.
                await asyncio.sleep(0.08)
                if audio_queue.empty() and int(getattr(buffered, "size", 0) or 0) == 0:
                    return
            await asyncio.sleep(0.02)

    async def handle_offer(self, sdp: str, type_: str) -> RTCSessionDescription:
        await self.pc.setRemoteDescription(RTCSessionDescription(sdp=sdp, type=type_))
        _configure_video_codec_preferences(self.pc)
        answer = await self.pc.createAnswer()
        await self.pc.setLocalDescription(answer)
        return self.pc.localDescription  # type: ignore[return-value]

    @staticmethod
    def _put_close_sentinel(q: asyncio.Queue) -> None:
        try:
            q.put_nowait(None)
            return
        except asyncio.QueueFull:
            pass

        while True:
            try:
                q.get_nowait()
            except asyncio.QueueEmpty:
                break

        try:
            q.put_nowait(None)
        except asyncio.QueueFull:
            pass

    async def close(self) -> None:
        self._put_close_sentinel(self.video._queue)
        self._put_close_sentinel(self.audio._queue)
        await self.pc.close()


def attach_blackhole(pc: RTCPeerConnection) -> MediaBlackhole:
    return MediaBlackhole()
