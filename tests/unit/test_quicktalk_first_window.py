import asyncio
from types import SimpleNamespace

import numpy as np
import pytest

from opentalking.pipeline.speak.synthesis_runner import FlashTalkRunner
from opentalking.providers.synthesis.audio2video_client import LocalAudio2VideoClient


@pytest.mark.asyncio
@pytest.mark.parametrize('local', [True, False])
async def test_quicktalk_partial_window_preserves_pcm_and_remote_contract(local):
    class Local(LocalAudio2VideoClient):
        def __init__(self): self.audio_chunk_samples = 7680
        async def generate(self, pcm):
            self.pcm = pcm.copy()
            return list(range(len(pcm) // 640))
    client = Local()
    if not local:
        client = SimpleNamespace(audio_chunk_samples=7680, generate=client.generate)
    runner = FlashTalkRunner.__new__(FlashTalkRunner)
    runner.model_type = 'quicktalk'
    runner.flashtalk = client
    runner._generate_lock = asyncio.Lock()
    runner.webrtc = None
    pcm = np.arange(5120, dtype=np.int16)
    frames = await runner._generate_flashtalk_frames(pcm)
    assert len(frames) == 8
    if local:
        assert np.array_equal(client.pcm, pcm)
    else:
        assert len(client.generate.__self__.pcm) == 7680
        assert np.array_equal(client.generate.__self__.pcm[:5120], pcm)
