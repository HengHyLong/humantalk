export type RegistrationDecision = "confirm" | "decline" | "unknown";

export function normalizeRegistrationText(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("zh-CN")
    .replace(/[\s\p{P}\p{S}]+/gu, "");
}

function matchesTerm(text: string, term: string): boolean {
  const normalized = normalizeRegistrationText(term);
  if (!normalized) return false;
  return normalized.length === 1 ? text === normalized : text.includes(normalized);
}

export function classifyRegistrationDecision(
  value: string,
  confirmKeywords: string[],
  declineKeywords: string[],
): RegistrationDecision {
  const text = normalizeRegistrationText(value);
  if (!text) return "unknown";
  // Negative phrases must win because terms such as “不要登记” also contain “要” and “登记”.
  if (declineKeywords.some((term) => matchesTerm(text, term))) return "decline";
  if (confirmKeywords.some((term) => matchesTerm(text, term))) return "confirm";
  return "unknown";
}
