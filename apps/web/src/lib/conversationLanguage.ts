export type ConversationLanguage = "zh-CN" | "en-US";

export const DEFAULT_CONVERSATION_LANGUAGE: ConversationLanguage = "zh-CN";

export function normalizeConversationLanguage(value: unknown): ConversationLanguage {
  return value === "en-US" ? "en-US" : DEFAULT_CONVERSATION_LANGUAGE;
}

export function isEnglishConversation(language: ConversationLanguage): boolean {
  return language === "en-US";
}
