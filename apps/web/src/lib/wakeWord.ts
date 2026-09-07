import { normalizeVoiceText } from "./exhibitionVoiceConfig";

export type WakeWordMatch = {
  word: string;
  remainder: string;
};

export type WakeWordGateResult = {
  accepted: boolean;
  wakeOnly: boolean;
  text: string;
  matchedWord: string | null;
  awakeUntil: number;
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

/**
 * Apply the post-STT wake gate. While sleeping, only speech containing a
 * configured wake word is accepted. Every accepted utterance refreshes the
 * same inactivity deadline used to return to sleep.
 */
export function evaluateWakeWordGate({
  text,
  words,
  now,
  awakeUntil,
  sleepTimeoutSeconds,
}: {
  text: string;
  words: string[];
  now: number;
  awakeUntil: number;
  sleepTimeoutSeconds: number;
}): WakeWordGateResult {
  const matched = matchWakeWord(text, words);
  const isAwake = now < awakeUntil;

  if (!matched && !isAwake) {
    return {
      accepted: false,
      wakeOnly: false,
      text: "",
      matchedWord: null,
      awakeUntil,
    };
  }

  return {
    accepted: true,
    wakeOnly: Boolean(matched && !matched.remainder),
    text: matched ? matched.remainder : text.trim(),
    matchedWord: matched?.word ?? null,
    awakeUntil: now + sleepTimeoutSeconds * 1000,
  };
}
