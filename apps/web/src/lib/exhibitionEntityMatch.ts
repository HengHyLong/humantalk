import type { ExhibitionEntityCard } from "../types";

export function normalizeEntityKeyword(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("zh-CN")
    .replace(/[\s\p{P}\p{S}]+/gu, "");
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

function fuzzyScore(text: string, keyword: string): number {
  if (!text || keyword.length < 3) return 0;
  let best = 0;
  for (let size = Math.max(2, keyword.length - 1); size <= Math.min(text.length, keyword.length + 1); size += 1) {
    for (let index = 0; index <= text.length - size; index += 1) {
      const candidate = text.slice(index, index + size);
      best = Math.max(best, 1 - editDistance(candidate, keyword) / Math.max(candidate.length, keyword.length));
    }
  }
  return best;
}

function normalizeEntityQuery(value: string): string {
  let text = normalizeEntityKeyword(value);
  const requestSignals = [
    "介绍一下", "了解一下", "讲解一下", "认识一下", "给我介绍", "帮我介绍",
    "我想了解", "想要了解", "介绍", "了解", "讲解", "讲一讲", "讲讲", "看看",
    "请", "麻烦", "一下",
  ].map(normalizeEntityKeyword).sort((left, right) => right.length - left.length);
  for (const signal of requestSignals) text = text.replaceAll(signal, "");
  return text;
}

export function matchExhibitionEntities(text: string, entities: ExhibitionEntityCard[]): ExhibitionEntityCard[] {
  const normalizedText = normalizeEntityKeyword(text);
  if (!normalizedText) return [];
  const normalizedQuery = normalizeEntityQuery(text);
  return entities
    .map((entity) => {
      const exactTerms = [entity.name, ...entity.keywords];
      const exactLength = exactTerms.reduce((length, keyword) => {
        const normalizedKeyword = normalizeEntityKeyword(keyword);
        if (normalizedKeyword.length < 2) return length;
        if (normalizedText.includes(normalizedKeyword)) return Math.max(length, normalizedKeyword.length);
        if (normalizedQuery.length >= 4 && normalizedKeyword.includes(normalizedQuery)) {
          return Math.max(length, normalizedQuery.length);
        }
        return length;
      }, 0);
      const fuzzy = exactLength > 0 ? 0 : (entity.fuzzy_keywords ?? []).reduce((score, keyword) => {
        const normalizedKeyword = normalizeEntityKeyword(keyword);
        return Math.max(score, fuzzyScore(normalizedText, normalizedKeyword));
      }, 0);
      return { entity, score: exactLength > 0 ? 1 + exactLength / 100 : fuzzy };
    })
    .filter((candidate) => candidate.score >= 0.66)
    .sort((left, right) => right.score - left.score)
    .slice(0, 3)
    .map((candidate) => candidate.entity);
}

/**
 * 在“请选择哪一个展品”的追问中支持名称、型号和第一个/第二个等自然表达。
 */
export function selectExhibitionEntity(text: string, entities: ExhibitionEntityCard[]): ExhibitionEntityCard | undefined {
  const matched = matchExhibitionEntities(text, entities)[0];
  if (matched) return matched;

  const normalized = normalizeEntityKeyword(text);
  const ordinal = normalized.match(/(?:第)?([一二三四五六七八九十]|[1-9])个?/);
  if (ordinal) {
    const indexMap: Record<string, number> = { 一: 0, 二: 1, 三: 2, 四: 3, 五: 4, 六: 5, 七: 6, 八: 7, 九: 8, 十: 9 };
    const index = indexMap[ordinal[1]] ?? Number(ordinal[1]) - 1;
    if (Number.isInteger(index) && index >= 0 && index < entities.length) return entities[index];
  }
  return undefined;
}
