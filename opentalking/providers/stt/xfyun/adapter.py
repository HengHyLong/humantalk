"""iFLYTEK Spark multilingual streaming speech recognition."""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import logging
import queue
import threading
import time
import wave
from datetime import datetime, timezone
from email.utils import format_datetime
from pathlib import Path
from urllib.parse import urlencode

from websockets.sync.client import connect


HOST = "iat.cn-huabei-1.xf-yun.com"
PATH = "/v1"
_FRAME_BYTES = 1280  # 40 ms of mono 16-bit 16 kHz PCM.
_FRAME_SECONDS = 0.04
_MAX_AUDIO_BYTES = 60 * 16000 * 2
_RESULT_TIMEOUT = 20.0
_INPUT_TIMEOUT = 20.0
log = logging.getLogger(__name__)


def signed_url(api_key: str, api_secret: str, *, date: str | None = None) -> str:
    date = date or format_datetime(datetime.now(timezone.utc), usegmt=True)
    source = f"host: {HOST}\ndate: {date}\nGET {PATH} HTTP/1.1"
    signature = base64.b64encode(hmac.new(api_secret.encode(), source.encode(), hashlib.sha256).digest()).decode()
    authorization = base64.b64encode(
        f'api_key="{api_key}",algorithm="hmac-sha256",headers="host date request-line",signature="{signature}"'.encode()
    ).decode()
    return f"wss://{HOST}{PATH}?{urlencode({'authorization': authorization, 'date': date, 'host': HOST})}"


def result_text(message: dict) -> str:
    encoded = message.get("payload", {}).get("result", {}).get("text")
    if not encoded:
        return ""
    result = json.loads(base64.b64decode(encoded))
    return "".join(candidate.get("w", "") for word in result.get("ws", []) for candidate in word.get("cw", [])[:1])


class XfyunSTTAdapter:
    def __init__(self, app_id: str, api_key: str, api_secret: str) -> None:
        self.app_id = app_id
        self.api_key = api_key
        self.api_secret = api_secret

    def _transcribe(self, pcm: bytes) -> tuple[str, float]:
        if len(pcm) > _MAX_AUDIO_BYTES:
            raise ValueError("iFLYTEK STT audio must be at most 60 seconds")
        chunks: queue.Queue[bytes | None] = queue.Queue()
        chunks.put(pcm)
        chunks.put(None)
        return self.transcribe_pcm_queue(chunks)

    def transcribe_wav(self, wav_path: str | Path) -> tuple[str, float]:
        with wave.open(str(wav_path), "rb") as wav:
            if (wav.getframerate(), wav.getnchannels(), wav.getsampwidth()) != (16000, 1, 2):
                raise ValueError("iFLYTEK STT requires mono 16-bit 16 kHz WAV")
            pcm = wav.readframes(wav.getnframes())
        return self._transcribe(pcm)

    def transcribe_pcm_queue(self, chunk_queue: "queue.Queue[bytes | None]", *, sample_rate: int = 16000) -> tuple[str, float]:
        """Forward live PCM as it arrives; None ends input and awaits final text.

        A separate receiver drains recognition results during recording. File
        uploads use the same transport, but still require real-time pacing.
        """
        if sample_rate != 16000:
            raise ValueError("iFLYTEK STT requires 16 kHz PCM")
        if not all((self.app_id, self.api_key, self.api_secret)):
            raise RuntimeError("iFLYTEK STT requires APP_ID, API_KEY and API_SECRET")

        start = time.perf_counter()
        stopped = threading.Event()
        finished_sending = threading.Event()
        errors: list[Exception] = []
        parts: dict[int, str] = {}
        marks: dict[str, float] = {}

        # The final transcript is complete before the close handshake. Do not
        # hold it behind a slow provider close acknowledgement.
        with connect(signed_url(self.api_key, self.api_secret), open_timeout=10, close_timeout=0.25) as socket:
            marks["connected"] = time.perf_counter()
            def receive_results() -> None:
                # Receive while audio is still arriving. Before end-of-input,
                # a quiet recognition stream is normal; only final results time out.
                final_deadline: float | None = None
                try:
                    while not stopped.is_set():
                        if finished_sending.is_set() and final_deadline is None:
                            final_deadline = time.perf_counter() + _RESULT_TIMEOUT
                        if final_deadline is not None and time.perf_counter() >= final_deadline:
                            raise TimeoutError("iFLYTEK STT final result timed out")
                        try:
                            response = json.loads(socket.recv(timeout=0.1))
                        except TimeoutError:
                            continue
                        header = response.get("header", {})
                        if header.get("code", 0):
                            raise RuntimeError(f"iFLYTEK STT error {header['code']}: {header.get('message', '')}")
                        encoded = response.get("payload", {}).get("result", {}).get("text")
                        if encoded:
                            result = json.loads(base64.b64decode(encoded))
                            if result.get("pgs") == "rpl" and len(result.get("rg", [])) == 2:
                                first, last = result["rg"]
                                for sn in list(parts):
                                    if first <= sn <= last:
                                        del parts[sn]
                            sn = int(result.get("sn", max(parts, default=-1) + 1))
                            parts[sn] = result_text(response)
                        if header.get("status") == 2:
                            marks["final"] = time.perf_counter()
                            return
                except Exception as exc:
                    errors.append(exc)
                finally:
                    stopped.set()

            receiver = threading.Thread(target=receive_results, name="xfyun-stt-receiver")
            receiver.start()
            try:
                seq = 0
                next_send_at = 0.0

                def send_audio(chunk: bytes) -> bool:
                    nonlocal seq, next_send_at
                    # Pace packets only when they arrive faster than real time.
                    # Queue waiting already accounts for live microphone time.
                    if stopped.wait(max(0.0, next_send_at - time.perf_counter())):
                        return False
                    status = 0 if seq == 0 else 1
                    packet_started = time.perf_counter()
                    seq += 1
                    audio = {"encoding": "raw", "sample_rate": 16000, "channels": 1, "bit_depth": 16,
                             "seq": seq, "status": status, "audio": base64.b64encode(chunk).decode()}
                    frame: dict = {"header": {"app_id": self.app_id, "status": status}, "payload": {"audio": audio}}
                    if status == 0:
                        frame["parameter"] = {"iat": {"domain": "slm", "language": "mul_cn", "accent": "mandarin",
                                                      "eos": 6000, "result": {"encoding": "utf8", "compress": "raw", "format": "json"}}}
                    socket.send(json.dumps(frame))
                    next_send_at = packet_started + _FRAME_SECONDS
                    return True

                pending = bytearray()
                total_bytes = 0
                input_deadline = time.perf_counter() + _INPUT_TIMEOUT
                while not stopped.is_set():
                    try:
                        chunk = chunk_queue.get(timeout=0.1)
                    except queue.Empty:
                        if time.perf_counter() >= input_deadline:
                            raise TimeoutError("iFLYTEK STT audio input timed out")
                        continue
                    if chunk is None:
                        marks["input_end"] = time.perf_counter()
                        if len(pending) % 2:
                            raise ValueError("iFLYTEK STT requires complete 16-bit PCM samples")
                        if pending or seq == 0:
                            send_audio(bytes(pending))
                        if not stopped.is_set():
                            socket.send(json.dumps({"header": {"app_id": self.app_id, "status": 2},
                                                    "payload": {"audio": {"encoding": "raw", "sample_rate": 16000,
                                                                          "status": 2, "audio": ""}}}))
                            finished_sending.set()
                            marks["end_sent"] = time.perf_counter()
                            stopped.wait(_RESULT_TIMEOUT + 0.2)
                            if not stopped.is_set():
                                raise TimeoutError("iFLYTEK STT final result timed out")
                        break
                    if not chunk:
                        continue
                    total_bytes += len(chunk)
                    if total_bytes > _MAX_AUDIO_BYTES:
                        raise ValueError("iFLYTEK STT audio must be at most 60 seconds")
                    pending.extend(chunk)
                    while len(pending) >= _FRAME_BYTES:
                        packet = bytes(pending[:_FRAME_BYTES])
                        del pending[:_FRAME_BYTES]
                        if not send_audio(packet):
                            break
                    input_deadline = time.perf_counter() + _INPUT_TIMEOUT
                if errors:
                    raise errors[0]
            finally:
                stopped.set()
                receiver.join()
                marks["before_close"] = time.perf_counter()

        returned = time.perf_counter()
        input_end = getattr(chunk_queue, "input_ended_at", marks.get("input_end", returned))
        log.info(
            "Xfyun phases: connect_ms=%.0f input_end_to_end_sent_ms=%.0f "
            "end_sent_to_final_ms=%.0f close_ms=%.0f audio_ms=%.0f text_chars=%d",
            (marks["connected"] - start) * 1000,
            (marks.get("end_sent", input_end) - input_end) * 1000,
            (marks.get("final", returned) - marks.get("end_sent", returned)) * 1000,
            (returned - marks.get("before_close", returned)) * 1000,
            total_bytes / 32, len("".join(parts.values())),
        )
        return "".join(parts[sn] for sn in sorted(parts)).strip(), (time.perf_counter() - start) * 1000
