import type { ExhibitionEntityCard } from "../types";

const DB_NAME = "opentalking-web-cache";
const DB_VERSION = 1;
const STORE_NAME = "exhibition-entities";
const LOCAL_STORAGE_PREFIX = "opentalking:exhibition-entities:";

export type ExhibitionEntityCache = {
  exhibitionId: string;
  items: ExhibitionEntityCard[];
  cachedAt: number;
};

function cacheKey(exhibitionId: string): string {
  return `${LOCAL_STORAGE_PREFIX}${exhibitionId}`;
}

function canUseIndexedDb(): boolean {
  return typeof window !== "undefined" && "indexedDB" in window;
}

function readLocalStorage(exhibitionId: string): ExhibitionEntityCache | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(cacheKey(exhibitionId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ExhibitionEntityCache>;
    if (parsed.exhibitionId !== exhibitionId || !Array.isArray(parsed.items)) return null;
    return {
      exhibitionId,
      items: parsed.items as ExhibitionEntityCard[],
      cachedAt: Number(parsed.cachedAt) || 0,
    };
  } catch {
    return null;
  }
}

function writeLocalStorage(value: ExhibitionEntityCache): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(cacheKey(value.exhibitionId), JSON.stringify(value));
  } catch {
    // localStorage 配额不足时不影响在线数据加载。
  }
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: "exhibitionId" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB open failed"));
  });
}

export async function readExhibitionEntityCache(exhibitionId: string): Promise<ExhibitionEntityCache | null> {
  const id = exhibitionId.trim();
  if (!id) return null;
  if (!canUseIndexedDb()) return readLocalStorage(id);

  try {
    const database = await openDatabase();
    const value = await new Promise<ExhibitionEntityCache | null>((resolve, reject) => {
      const request = database.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get(id);
      request.onsuccess = () => resolve(request.result ?? null);
      request.onerror = () => reject(request.error ?? new Error("IndexedDB read failed"));
    });
    database.close();
    return value && Array.isArray(value.items) ? value : readLocalStorage(id);
  } catch {
    return readLocalStorage(id);
  }
}

export async function writeExhibitionEntityCache(exhibitionId: string, items: ExhibitionEntityCard[]): Promise<void> {
  const id = exhibitionId.trim();
  if (!id || !items.length) return;
  const value: ExhibitionEntityCache = { exhibitionId: id, items, cachedAt: Date.now() };
  writeLocalStorage(value);
  if (!canUseIndexedDb()) return;

  try {
    const database = await openDatabase();
    await new Promise<void>((resolve, reject) => {
      const request = database.transaction(STORE_NAME, "readwrite").objectStore(STORE_NAME).put(value);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error ?? new Error("IndexedDB write failed"));
    });
    database.close();
  } catch {
    // localStorage 已完成降级写入，不阻塞主流程。
  }
}
