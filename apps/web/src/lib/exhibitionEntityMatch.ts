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

export function matchExhibitionEntities(text: string, entities: ExhibitionEntityCard[]): ExhibitionEntityCard[] {
  const normalizedText = normalizeEntityKeyword(text);
  if (!normalizedText) return [];
  return entities
    .map((entity) => {
      const exactLength = entity.keywords.reduce((length, keyword) => {
        const normalizedKeyword = normalizeEntityKeyword(keyword);
        return normalizedKeyword.length >= 2 && normalizedText.includes(normalizedKeyword)
          ? Math.max(length, normalizedKeyword.length)
          : length;
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
