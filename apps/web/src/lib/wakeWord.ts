import { normalizeVoiceText } from "./exhibitionVoiceConfig";

export type WakeWordMatch = {
  word: string;
  remainder: string;
};

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function matchWakeWord(text: string, words: string[]): WakeWordMatch | null {
  const normalizedText = normalizeVoiceText(text);
  if (!normalizedText) return null;

  const candidates = [...words]
    .map((word) => word.trim())
    .filter(Boolean)
    .sort((a, b) => normalizeVoiceText(b).length - normalizeVoiceText(a).length);

  for (const word of candidates) {
    const normalizedWord = normalizeVoiceText(word);
    if (!normalizedWord || !normalizedText.includes(normalizedWord)) continue;
    const pattern = [...normalizedWord].map(escapeRegExp).join("[\\s\\p{P}\\p{S}]*");
    const matched = new RegExp(pattern, "iu").exec(text);
    const remainder = matched
      ? `${text.slice(0, matched.index)} ${text.slice(matched.index + matched[0].length)}`
          .replace(/^[\s\p{P}\p{S}]+/u, "")
          .replace(/[\s\p{P}\p{S}]+$/u, "")
          .trim()
      : normalizedText === normalizedWord ? "" : text.trim();
    return { word, remainder };
  }
  return null;
}
