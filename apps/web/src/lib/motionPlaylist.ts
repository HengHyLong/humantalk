export type MotionPlaybackState = "idle" | "welcome" | "listen" | "think" | "talk" | "emphasis";

export type MotionVideoDriver = {
  listen_url?: string | null;
  think_url?: string | null;
  talk_url?: string | null;
  states?: Partial<Record<MotionPlaybackState, string[]>>;
};

function uniqueSources(
  items: Array<string | null | undefined>,
  resolveSource: (source: string) => string,
): string[] {
  return [...new Set(items.filter((item): item is string => Boolean(item)).map(resolveSource))];
}

export function sourcePoolFor(
  state: MotionPlaybackState,
  driver?: MotionVideoDriver | null,
  resolveSource: (source: string) => string = (source) => source,
): string[] {
  const configured = driver?.states ?? {};
  if (state === "talk") {
    return uniqueSources([...(configured.talk ?? []), ...(configured.emphasis ?? []), driver?.talk_url], resolveSource);
  }
  if (state === "emphasis") {
    return uniqueSources([...(configured.emphasis ?? []), ...(configured.talk ?? []), driver?.talk_url], resolveSource);
  }
  if (state === "welcome") {
    return uniqueSources([...(configured.welcome ?? []), ...(configured.listen ?? []), driver?.listen_url], resolveSource);
  }
  if (state === "idle" || state === "listen") {
    return uniqueSources([...(configured[state] ?? []), ...(configured.idle ?? []), ...(configured.listen ?? []), driver?.listen_url], resolveSource);
  }
  return uniqueSources([...(configured.think ?? []), driver?.think_url], resolveSource);
}

export function pickNextSource(pool: string[], current: string): string {
  const candidates = pool.length > 1 ? pool.filter((source) => source !== current) : pool;
  return candidates[Math.floor(Math.random() * candidates.length)] ?? current;
}

export function shouldLoopSourcePool(pool: string[]): boolean {
  return pool.length === 1;
}
