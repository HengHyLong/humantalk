"""PCM audio helpers (fades, trim) for the speak pipeline.

Extracted from synthesis_runner.py to keep that file focused on orchestration.
"""
from __future__ import annotations

import numpy as np


class StreamingSilenceTail:
    """Hold near-silent TTS tails without delaying voiced audio.

    A subsequent voiced chunk releases the held pause intact. At end of the
    sentence the held suffix can be discarded; a short quiet margin has already
    been emitted to protect the last phoneme.
    """

    def __init__(self, sample_rate: int, *, threshold: int = 64, keep_ms: float = 60.0) -> None:
        self.threshold = threshold
        self.keep_samples = max(1, round(sample_rate * keep_ms / 1000.0))
        self._pending = np.zeros(0, dtype=np.int16)
        self._quiet_emitted = 0

    def push(self, pcm: np.ndarray) -> np.ndarray:
        arr = np.asarray(pcm, dtype=np.int16).reshape(-1)
        combined = np.concatenate([self._pending, arr]) if self._pending.size else arr
        voiced = np.flatnonzero(np.abs(combined.astype(np.int32)) > self.threshold)
        if voiced.size:
            last_voiced = int(voiced[-1]) + 1
            end = min(combined.size, last_voiced + self.keep_samples)
            self._quiet_emitted = end - last_voiced
        else:
            end = min(combined.size, max(0, self.keep_samples - self._quiet_emitted))
            self._quiet_emitted += end
        self._pending = combined[end:]
        return combined[:end]


def fade_edges_i16(pcm: np.ndarray, sample_rate: int, fade_ms: float) -> np.ndarray:
    """Apply a tiny sentence-boundary fade to reduce TTS splice clicks."""
    arr = np.asarray(pcm, dtype=np.int16)
    fade_samples = int(sample_rate * max(0.0, fade_ms) / 1000.0)
    if arr.size == 0 or fade_samples <= 1:
        return arr
    fade_samples = min(fade_samples, arr.size // 2)
    if fade_samples <= 1:
        return arr
    out = arr.astype(np.float32, copy=True)
    out[:fade_samples] *= np.linspace(0.0, 1.0, fade_samples, dtype=np.float32)
    out[-fade_samples:] *= np.linspace(1.0, 0.0, fade_samples, dtype=np.float32)
    return np.clip(out, -32768, 32767).astype(np.int16)


def fade_head_i16(pcm: np.ndarray, sample_rate: int, fade_ms: float) -> np.ndarray:
    """Fade the first samples of a streamed sentence."""
    arr = np.asarray(pcm, dtype=np.int16)
    fade_samples = int(sample_rate * max(0.0, fade_ms) / 1000.0)
    if arr.size == 0 or fade_samples <= 1:
        return arr
    fade_samples = min(fade_samples, arr.size)
    out = arr.astype(np.float32, copy=True)
    out[:fade_samples] *= np.linspace(0.0, 1.0, fade_samples, dtype=np.float32)
    return np.clip(out, -32768, 32767).astype(np.int16)


def fade_tail_i16(pcm: np.ndarray, sample_rate: int, fade_ms: float) -> np.ndarray:
    """Fade the remaining tail before padding with silence."""
    arr = np.asarray(pcm, dtype=np.int16)
    fade_samples = int(sample_rate * max(0.0, fade_ms) / 1000.0)
    if arr.size == 0 or fade_samples <= 1:
        return arr
    fade_samples = min(fade_samples, arr.size)
    out = arr.astype(np.float32, copy=True)
    out[-fade_samples:] *= np.linspace(1.0, 0.0, fade_samples, dtype=np.float32)
    return np.clip(out, -32768, 32767).astype(np.int16)


def trim_trailing_silence_i16(
    pcm: np.ndarray,
    sample_rate: int,
    *,
    threshold: int = 300,
    min_tail_ms: float = 60.0,
) -> np.ndarray:
    """Remove trailing near-silence from PCM, keeping at least *min_tail_ms* ms."""
    if pcm.size == 0:
        return pcm
    min_keep = max(1, int(sample_rate * min_tail_ms / 1000.0))
    abs_pcm = np.abs(pcm)
    indices = np.nonzero(abs_pcm > threshold)[0]
    if indices.size == 0:
        return pcm[:min_keep]
    last_loud = int(indices[-1])
    end = max(last_loud + 1 + min_keep, min_keep)
    return pcm[: min(end, pcm.size)]
