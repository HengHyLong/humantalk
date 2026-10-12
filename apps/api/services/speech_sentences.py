"""Commit complete visible sentences; keep unclosed reasoning and markup private."""
from __future__ import annotations

import re

from apps.api.services.dify_chat import spoken_answer


class SpeechSentences:
    def __init__(self):
        self.buffer = ""

    @staticmethod
    def clean(text: str) -> str:
        text = re.sub(r"<!--.*?(?:-->|$)", "", text, flags=re.S)
        text = re.sub(r"!\[[^\]]*(?:$|\]\([^)]*(?:\)|$))", "", text)
        text = re.sub(r"<[^>]*$", "", text)
        return spoken_answer(text)

    @staticmethod
    def protected(text: str) -> bool:
        if re.search(r"<think\b[^>]*>(?:(?!</think\s*>).)*$", text, re.S | re.I):
            return True
        if re.search(r"<!--(?:(?!-->).)*$|<[^>]*$", text, re.S):
            return True
        # A split Markdown URL/image must not become a spoken label or URL.
        return bool(re.search(r"!?\[[^\]]*$|!?\[[^\]]*\]\([^)]*$", text))

    def feed(self, delta: str) -> list[str]:
        self.buffer += delta
        if len(self.buffer) > 16000:
            raise ValueError("sentence buffer limit")
        sentences = []
        consumed = 0
        for match in re.finditer(r"[。！？!?；;\n]|\.(?=\s)", self.buffer):
            end = match.end()
            if match.group() == "!" and (end == len(self.buffer) or self.buffer[end] == "["):
                continue
            prefix = self.buffer[consumed:end]
            if self.protected(prefix):
                continue
            if match.group() == "." and re.search(r"\b(?:Mr|Mrs|Ms|Dr|Prof|vs|e\.g|i\.e)\.$", prefix, re.I):
                continue
            text = self.clean(prefix)
            if text:
                sentences.append(text)
            consumed = end
        self.buffer = self.buffer[consumed:]
        return sentences

    def finish(self) -> list[str]:
        # Only a verified message_end may commit an unpunctuated final remainder.
        text = self.clean(self.buffer)
        self.buffer = ""
        return [text] if text else []
