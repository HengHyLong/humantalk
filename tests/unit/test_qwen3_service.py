from __future__ import annotations

import io
import threading
import time
from concurrent.futures import ThreadPoolExecutor

import numpy as np
import pytest

sf = pytest.importorskip("soundfile")
pytest.importorskip("torch")

from scripts.local_qwen3_tts_service import Qwen3TTSService, SynthesizeRequest  # noqa: E402


def test_shared_qwen_service_serializes_generation_and_returns_complete_wav():
    service = Qwen3TTSService(
        model_dir="unused-test-model", device="cpu", dtype="float32",
        ref_audio="reference.wav", ref_text="参考文本", language="Chinese", max_new_tokens=1024,
    )
    class Model:
        def __init__(self):
            self.active = 0
            self.maximum = 0
            self.calls = []
        def generate_voice_clone(self, **kwargs):
            self.active += 1
            self.maximum = max(self.maximum, self.active)
            self.calls.append(kwargs)
            time.sleep(0.02)
            self.active -= 1
            return [np.full(2400, 0.25, dtype=np.float32)], 24000
    model = Model()
    service._model = model
    barrier = threading.Barrier(2)
    def run(text):
        barrier.wait(timeout=5)
        return service.synthesize_wav(SynthesizeRequest(text=text))
    with ThreadPoolExecutor(max_workers=2) as pool:
        futures = [pool.submit(run, text) for text in ("欢迎参观", "请查看路线")]
        results = [future.result(timeout=10) for future in futures]
    assert model.maximum == 1
    assert {call["text"] for call in model.calls} == {"欢迎参观", "请查看路线"}
    for data, rate, elapsed in results:
        audio, decoded_rate = sf.read(io.BytesIO(data))
        assert decoded_rate == rate == 24000
        assert len(audio) == 2400
        assert np.allclose(audio, 0.25)
        assert elapsed > 0

def test_qwen_preload_finishes_before_serving_health(monkeypatch):
    from fastapi.testclient import TestClient
    from scripts.local_qwen3_tts_service import create_app
    class Service:
        model_dir = "test-model"
        device = "cpu"
        _model = None
        def model(self):
            self._model = object()
        def synthesize_wav(self, request):
            assert self._model is not None
            self.warmup_text = request.text
            return b"", 24000, 0.0
    service = Service()
    monkeypatch.setenv("OPENTALKING_LOCAL_QWEN3_TTS_PRELOAD", "1")
    monkeypatch.setenv("OPENTALKING_LOCAL_QWEN3_TTS_WARMUP_TEXT", "欢迎参观")
    with TestClient(create_app(service)) as client:
        assert client.get("/health").json()["loaded"] is True
        assert service.warmup_text == "欢迎参观"
