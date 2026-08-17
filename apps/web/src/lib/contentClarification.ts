export type ContentClarificationChoice = "entity" | "route" | "unknown";

function normalizeChoiceText(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("zh-CN")
    .replace(/[\s\p{P}\p{S}]+/gu, "");
}

export function classifyContentClarification(
  value: string,
  entityName: string,
  routeDestination: string,
): ContentClarificationChoice {
  const text = normalizeChoiceText(value);
  if (!text) return "unknown";

  const entitySignals = [
    "了解展品", "介绍展品", "展品介绍", "商品介绍", "产品介绍", "介绍商品",
    "介绍产品", "了解商品", "了解产品", "展商介绍", "介绍展商", "展品", "商品", "产品",
    "展商", "展区介绍", "场馆介绍", "点位介绍", "了解", "介绍", "第一个", "前者",
    "entity", "product", "exhibit", "exhibitor", "introduction", "first",
  ];
  const routeSignals = [
    "查看路线", "路线", "导航", "怎么走", "怎么去", "带我去", "前往", "去那里",
    "到那里", "去", "到", "至", "第二个", "后者", "route", "navigation", "directions", "go", "second",
  ];
  const entityMatched = entitySignals.some((signal) => text.includes(normalizeChoiceText(signal)));
  const routeMatched = routeSignals.some((signal) => text.includes(normalizeChoiceText(signal)));

  if (entityMatched !== routeMatched) return entityMatched ? "entity" : "route";
  if (entityMatched && routeMatched) return "unknown";

  const normalizedEntityName = normalizeChoiceText(entityName);
  const normalizedDestination = normalizeChoiceText(routeDestination);
  const namesAreDifferent = normalizedEntityName && normalizedEntityName !== normalizedDestination;
  if (namesAreDifferent && text.includes(normalizedEntityName)) return "entity";
  if (namesAreDifferent && normalizedDestination && text.includes(normalizedDestination)) return "route";
  return "unknown";
}
