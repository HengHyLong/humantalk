import type { ExhibitionEntityCard } from "../types";

export type RegistrationDecision = "confirm" | "decline" | "unknown";
export type RegistrationFollowupDecision = Exclude<RegistrationDecision, "unknown"> | "new_topic";

export function selectShoppingPresentationEntities(
  preferredEntity: ExhibitionEntityCard | undefined,
  strategyEntities: ExhibitionEntityCard[],
): ExhibitionEntityCard[] {
  if (!preferredEntity || preferredEntity.kind !== "exhibit") return strategyEntities;
  return strategyEntities.some((entity) => entity.id === preferredEntity.id)
    ? [preferredEntity]
    : strategyEntities;
}

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

export function classifyProductInterestDecision(
  value: string,
  confirmKeywords: string[],
  declineKeywords: string[],
  hasDifferentEntity = false,
): RegistrationDecision {
  const text = normalizeRegistrationText(value);
  if (!text || hasDifferentEntity) return "unknown";

  const productSignals = ["产品", "展品", "商品", "products", "product", "exhibits", "exhibit"];
  const positiveSignals = ["了解", "看看", "想看", "介绍", "讲", "需要", "有兴趣", "learn", "show", "introduce", "interested"];
  const mentionsProduct = productSignals.some((signal) => text.includes(normalizeRegistrationText(signal)));
  if (mentionsProduct) {
    const productDecision = classifyRegistrationDecision(value, confirmKeywords, declineKeywords);
    if (productDecision === "decline") return "decline";
    if (positiveSignals.some((signal) => text.includes(normalizeRegistrationText(signal)))) return "confirm";
  }

  const exactDecision = classifyRegistrationDecision(
    value,
    confirmKeywords.filter((term) => text === normalizeRegistrationText(term)),
    declineKeywords.filter((term) => text === normalizeRegistrationText(term)),
  );
  if (exactDecision !== "unknown") return exactDecision;
  if (["我想了解一下", "想了解一下", "我想看看", "想看看"].some((term) => text === normalizeRegistrationText(term))) {
    return "confirm";
  }

  // A polite acknowledgement may prefix a completely new question, for
  // example “好的，请问卫生间在哪里”. Do not let “好的” consume that turn.
  const newTopicSignals = [
    "请问", "想问", "想知道", "了解", "告诉我", "介绍", "讲", "帮我", "查询", "查一下", "怎么", "如何", "什么",
    "哪里", "在哪", "哪儿", "为什么", "为何", "多少", "几个", "几点", "多久",
    "谁", "是否", "能否", "有没有", "路线", "导航", "天气", "help", "tellme",
    "what", "where", "when", "why", "how", "which", "who", "route", "weather",
  ];
  if (/[?？]/u.test(value) || newTopicSignals.some((signal) => text.includes(normalizeRegistrationText(signal)))) {
    return "unknown";
  }
  return classifyRegistrationDecision(value, confirmKeywords, declineKeywords);
}

export function classifyRegistrationFollowupDecision(
  value: string,
  confirmKeywords: string[],
  declineKeywords: string[],
  hasDifferentEntity = false,
): RegistrationFollowupDecision {
  const text = normalizeRegistrationText(value);
  if (!text || hasDifferentEntity) return "new_topic";

  const exactDecision = classifyRegistrationDecision(
    value,
    confirmKeywords.filter((term) => text === normalizeRegistrationText(term)),
    declineKeywords.filter((term) => text === normalizeRegistrationText(term)),
  );
  if (exactDecision !== "unknown") return exactDecision;

  const newTopicSignals = [
    "请问", "想问", "想知道", "了解", "告诉我", "介绍", "讲", "帮我", "查询", "查一下",
    "怎么", "如何", "什么", "哪里", "在哪", "哪儿", "为什么", "为何", "多少", "几个",
    "几点", "多久", "谁", "是否", "能否", "有没有", "路线", "导航", "天气", "会议", "卫生间",
    "help", "tellme", "what", "where", "when", "why", "how", "which", "who", "route", "weather",
  ];
  if (newTopicSignals.some((signal) => text.includes(normalizeRegistrationText(signal)))) {
    return "new_topic";
  }

  const decision = classifyRegistrationDecision(value, confirmKeywords, declineKeywords);
  if (decision !== "unknown") return decision;

  const registrationSignals = ["登记", "二维码", "扫码", "register", "registration", "qrcode", "scan"];
  const positiveSignals = ["打开", "展示", "弹出", "需要", "想要", "可以", "同意", "open", "show", "want", "need"];
  if (
    registrationSignals.some((signal) => text.includes(normalizeRegistrationText(signal)))
    && positiveSignals.some((signal) => text.includes(normalizeRegistrationText(signal)))
  ) {
    return "confirm";
  }
  return "new_topic";
}
