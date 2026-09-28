"""iFLYTEK Spark multilingual streaming speech recognition."""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import queue
import time
import wave
from datetime import datetime, timezone
from email.utils import format_datetime
from pathlib import Path
from urllib.parse import urlencode

from websockets.sync.client import connect


HOST = "iat.cn-huabei-1.xf-yun.com"
PATH = "/v1"


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
        if not all((self.app_id, self.api_key, self.api_secret)):
            raise RuntimeError("iFLYTEK STT requires APP_ID, API_KEY and API_SECRET")
        if len(pcm) > 60 * 16000 * 2:
            raise ValueError("iFLYTEK STT audio must be at most 60 seconds")
        start = time.perf_counter()
        chunks = [pcm[i:i + 1280] for i in range(0, len(pcm), 1280)] or [b""]
        parts: list[str] = []
        with connect(signed_url(self.api_key, self.api_secret), open_timeout=10, close_timeout=5) as socket:
            for index, chunk in enumerate(chunks):
                status = 0 if index == 0 else 1
                audio = {"encoding": "raw", "sample_rate": 16000, "channels": 1, "bit_depth": 16,
                         "seq": index + 1, "status": status, "audio": base64.b64encode(chunk).decode()}
                frame: dict = {"header": {"app_id": self.app_id, "status": status}, "payload": {"audio": audio}}
                if index == 0:
                    frame["parameter"] = {"iat": {"domain": "slm", "language": "mul_cn", "accent": "mandarin",
                                                  "eos": 6000, "result": {"encoding": "utf8", "compress": "raw", "format": "json"}}}
                socket.send(json.dumps(frame))
                time.sleep(0.04)
            socket.send(json.dumps({"header": {"app_id": self.app_id, "status": 2},
                                    "payload": {"audio": {"encoding": "raw", "sample_rate": 16000,
                                                          "status": 2, "audio": ""}}}))
            while True:
                response = json.loads(socket.recv(timeout=20))
                header = response.get("header", {})
                if header.get("code", 0):
                    raise RuntimeError(f"iFLYTEK STT error {header['code']}: {header.get('message', '')}")
                part = result_text(response)
                if part:
                    parts.append(part)
                if header.get("status") == 2:
                    break
        return "".join(parts).strip(), (time.perf_counter() - start) * 1000

    def transcribe_wav(self, wav_path: str | Path) -> tuple[str, float]:
        with wave.open(str(wav_path), "rb") as wav:
            if (wav.getframerate(), wav.getnchannels(), wav.getsampwidth()) != (16000, 1, 2):
                raise ValueError("iFLYTEK STT requires mono 16-bit 16 kHz WAV")
            pcm = wav.readframes(wav.getnframes())
        return self._transcribe(pcm)

    def transcribe_pcm_queue(self, chunk_queue: "queue.Queue[bytes | None]", *, sample_rate: int = 16000) -> tuple[str, float]:
        if sample_rate != 16000:
            raise ValueError("iFLYTEK STT requires 16 kHz PCM")
        chunks: list[bytes] = []
        while (chunk := chunk_queue.get()) is not None:
            chunks.append(chunk)
        return self._transcribe(b"".join(chunks))
