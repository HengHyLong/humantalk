from __future__ import annotations

import re
import time


class SentenceSplitter:
    """Accumulates streaming text deltas and yields complete sentences.

    Splits on Chinese punctuation: \u3002 \uff01 \uff1f
    Splits on English punctuation followed by space or end: .  !  ?
    """

    # Chinese sentence-ending punctuation: split immediately after them.
    # English sentence-ending punctuation: split when followed by a space.
    _SPLIT_RE = re.compile(
        r"("                                          # whole sentence boundary
        r"[\u3002\uff01\uff1f][”’」』）》】〕〉）\]\"']*"  # Chinese punct + optional closers
        r"|[.!?][”’」』）》】〕〉）\]\"']*(?:\s|$)"        # English punct + closers + whitespace/end
        r")"
    )

    def __init__(
        self, *, first_segment_min_chars: int = 8, first_segment_max_chars: int = 0,
        first_segment_wait_ms: int = 600,
    ) -> None:
        self._buffer: str = ""
        self._first = True
        self._min = max(1, first_segment_min_chars)
        self._max = max(self._min, first_segment_max_chars) if first_segment_max_chars > 0 else 0
        self._wait = max(0, first_segment_wait_ms) / 1000.0
        self._started: float | None = None

    def _first_end(self) -> int | None:
        if not self._first or not self._max:
            return None
        elapsed = time.monotonic() - self._started if self._started is not None else 0.0
        # Prefer a clause boundary. Otherwise split between Chinese characters
        # or after whitespace; never inside an English word, number or URL.
        for end in range(self._min, len(self._buffer) + 1):
            previous = self._buffer[end - 1]
            following = self._buffer[end] if end < len(self._buffer) else ""
            if previous in "，、；：,;" and following and not following.isdigit():
                return end
            safe = previous.isspace() or bool(re.fullmatch(r"[\u3400-\u9fff]{2}", previous + following))
            if safe and (end >= self._max or elapsed >= self._wait):
                return end
        return None

    def feed(self, delta: str) -> list[str]:
        """Feed a text delta, return a list of complete sentences (may be empty)."""
        self._buffer += delta
        if self._started is None and self._buffer.strip():
            self._started = time.monotonic()
        sentences: list[str] = []

        while True:
            m = self._SPLIT_RE.search(self._buffer)
            early = self._first_end()
            if m is None and early is None:
                break
            end = min(m.end(), early) if m is not None and early is not None else (m.end() if m else early)
            assert end is not None
            sentence = self._buffer[:end].strip()
            if sentence:
                sentences.append(sentence)
                self._first = False
            self._buffer = self._buffer[end:]

        return sentences

    def flush(self) -> str | None:
        """Return any remaining text in the buffer (call at end of stream)."""
        if self._buffer.strip():
            text = self._buffer.strip()
            self._buffer = ""
            return text
        self._buffer = ""
        return None
