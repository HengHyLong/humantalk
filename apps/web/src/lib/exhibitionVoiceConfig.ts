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
    keywords: {
      navigation: cleanKeywords(raw.keywords?.navigation ?? groups.navigation),
      exhibition_content: cleanKeywords(
        raw.keywords?.exhibition_content ?? groups.exhibition_content ?? groups.exhibitionContent,
      ),
      shopping: cleanKeywords(raw.keywords?.shopping ?? groups.shopping),
    },
    supports_deferred_speak: raw.supports_deferred_speak,
  };
}

export function matchVoiceIntent(text: string, config: ExhibitionVoiceConfig): VoiceIntentMatch {
  const normalized = normalizeVoiceText(text);
  if (!normalized) return { intent: "exhibition_content", keyword: null };

  const matchedNavigation = config.keywords.navigation.find((keyword) => {
    const normalizedKeyword = normalizeVoiceText(keyword);
    return normalizedKeyword.length > 0 && normalized.includes(normalizedKeyword);
  });
  if (matchedNavigation) return { intent: "navigation", keyword: matchedNavigation };

  const matchedContent = config.keywords.exhibition_content.find((keyword) => {
    const normalizedKeyword = normalizeVoiceText(keyword);
    return normalizedKeyword.length > 0 && normalized.includes(normalizedKeyword);
  });
  if (matchedContent) return { intent: "exhibition_content", keyword: matchedContent };

  const matchedShopping = config.keywords.shopping.find((keyword) => {
    const normalizedKeyword = normalizeVoiceText(keyword);
    return normalizedKeyword.length > 0 && normalized.includes(normalizedKeyword);
  });
  return matchedShopping ? { intent: "shopping", keyword: matchedShopping } : { intent: "exhibition_content", keyword: null };
}
