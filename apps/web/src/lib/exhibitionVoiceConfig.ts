import type { ExhibitionVoiceConfig, ExhibitionVoiceConfigResponse, VoiceIntent } from "./api";

export type VoiceIntentMatch = {
  intent: VoiceIntent;
  keyword: string | null;
};

export function getConfiguredExhibitionId(): string | null {
  if (typeof window !== "undefined") {
    const fromUrl = new URLSearchParams(window.location.search).get("exhibitionId")?.trim();
    if (fromUrl) return fromUrl;
  }
  const fromEnv = import.meta.env.VITE_EXHIBITION_ID?.trim();
  return fromEnv || null;
}

export function normalizeVoiceText(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, "");
}

function cleanKeywords(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return values
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.trim())
    .filter(Boolean)
    .sort((a, b) => normalizeVoiceText(b).length - normalizeVoiceText(a).length);
}

export function normalizeExhibitionVoiceConfig(
  raw: ExhibitionVoiceConfigResponse,
  fallbackExhibitionId: string | null = null,
): ExhibitionVoiceConfig {
  const groups = raw.keyword_groups ?? {};
  return {
    exhibition_id: raw.exhibition_id?.trim() || raw.exhibitionId?.trim() || fallbackExhibitionId || "current",
    navigation_fuzzy_keywords: cleanKeywords(raw.navigation_fuzzy_keywords),
    keywords: {
      navigation: cleanKeywords(raw.keywords?.navigation ?? groups.navigation),
      exhibition_content: cleanKeywords(
        raw.keywords?.exhibition_content ?? groups.exhibition_content ?? groups.exhibitionContent,
      ),
    },
    supports_deferred_speak: raw.supports_deferred_speak,
    wake_word: {
      enabled: Boolean(raw.wake_word?.enabled ?? raw.wakeWord?.enabled),
      words: cleanKeywords(raw.wake_word?.words ?? raw.wakeWord?.words),
      active_window_seconds: (() => {
        const seconds = Number(raw.wake_word?.active_window_seconds ?? raw.wakeWord?.activeWindowSeconds ?? 30);
        return Number.isInteger(seconds) && seconds >= 10 && seconds <= 600 ? seconds : 30;
      })(),
    },
    welcome: {
      script_id: String(raw.welcome?.script_id || ""),
      text: String(raw.welcome?.text || ""),
    },
  };
}

function editDistance(left: string, right: string): number {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      current[rightIndex] = Math.min(
        current[rightIndex - 1] + 1,
        previous[rightIndex] + 1,
        previous[rightIndex - 1] + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1),
      );
    }
    previous.splice(0, previous.length, ...current);
  }
  return previous[right.length];
}

function fuzzyContains(text: string, keyword: string): boolean {
  if (!text || keyword.length < 3) return false;
  const minimumSize = Math.max(2, keyword.length - 1);
  const maximumSize = Math.min(text.length, keyword.length + 1);
  for (let size = minimumSize; size <= maximumSize; size += 1) {
    for (let index = 0; index <= text.length - size; index += 1) {
      const candidate = text.slice(index, index + size);
      const similarity = 1 - editDistance(candidate, keyword) / Math.max(candidate.length, keyword.length);
      if (similarity >= 0.66) return true;
    }
  }
  return false;
}

export function matchVoiceIntent(text: string, config: ExhibitionVoiceConfig): VoiceIntentMatch {
  const normalized = normalizeVoiceText(text);
  if (!normalized) return { intent: "exhibition_content", keyword: null };

  const matchedNavigation = config.keywords.navigation.find((keyword) => {
    const normalizedKeyword = normalizeVoiceText(keyword);
    return normalizedKeyword.length > 0 && normalized.includes(normalizedKeyword);
  });
  if (matchedNavigation) return { intent: "navigation", keyword: matchedNavigation };

  const fuzzyNavigation = config.navigation_fuzzy_keywords?.find((keyword) => {
    const normalizedKeyword = normalizeVoiceText(keyword);
    return fuzzyContains(normalized, normalizedKeyword);
  });
  if (fuzzyNavigation) return { intent: "navigation", keyword: fuzzyNavigation };

  const matchedContent = config.keywords.exhibition_content.find((keyword) => {
    const normalizedKeyword = normalizeVoiceText(keyword);
    return normalizedKeyword.length > 0 && normalized.includes(normalizedKeyword);
  });
  return { intent: "exhibition_content", keyword: matchedContent ?? null };
}
