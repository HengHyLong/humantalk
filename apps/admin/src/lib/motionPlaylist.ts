export type MotionPlaybackState = "idle" | "welcome" | "listen" | "think" | "talk" | "emphasis";

export type MotionVideoDriver = {
  listen_url?: string | null;
  think_url?: string | null;
  talk_url?: string | null;
  states?: Partial<Record<MotionPlaybackState, string[]>>;
};

export type MotionClipDriver = {
  states?: Partial<Record<MotionPlaybackState, Array<{ url: string }>>>;
};

function uniqueSources(items: Array<string | null | undefined>): string[] {
  return [...new Set(items.filter((item): item is string => Boolean(item)))];
}

export function mergeMotionDrivers(
  videoDriver?: MotionVideoDriver | null,
  motionDriver?: MotionClipDriver | null,
): MotionVideoDriver | null {
  const states = Object.fromEntries(
    (["idle", "welcome", "listen", "think", "talk", "emphasis"] as const).map((state) => [
      state,
      uniqueSources([
        ...(videoDriver?.states?.[state] ?? []),
        ...(motionDriver?.states?.[state] ?? []).map((clip) => clip.url),
      ]),
    ]).filter(([, sources]) => sources.length > 0),
  ) as Partial<Record<MotionPlaybackState, string[]>>;

  if (!videoDriver && Object.keys(states).length === 0) return null;
  return { ...videoDriver, states };
}

export function sourcePoolFor(state: MotionPlaybackState, driver?: MotionVideoDriver | null): string[] {
  const configured = driver?.states ?? {};
  const fallbackSources = () => uniqueSources([
    ...(configured.idle ?? []),
    ...(configured.listen ?? []),
    ...(configured.welcome ?? []),
    ...(configured.talk ?? []),
    ...(configured.emphasis ?? []),
    ...(configured.think ?? []),
    driver?.listen_url,
    driver?.talk_url,
    driver?.think_url,
  ]);
  if (state === "talk") {
    const sources = uniqueSources([...(configured.talk ?? []), ...(configured.emphasis ?? []), driver?.talk_url]);
    return sources.length ? sources : fallbackSources();
  }
  if (state === "emphasis") {
    const sources = uniqueSources([...(configured.emphasis ?? []), ...(configured.talk ?? []), driver?.talk_url]);
    return sources.length ? sources : fallbackSources();
  }
  if (state === "welcome") {
    const sources = uniqueSources([...(configured.welcome ?? []), ...(configured.listen ?? []), driver?.listen_url]);
    return sources.length ? sources : fallbackSources();
  }
  if (state === "idle" || state === "listen") {
    const sources = uniqueSources([...(configured[state] ?? []), ...(configured.idle ?? []), ...(configured.listen ?? []), driver?.listen_url]);
    return sources.length ? sources : fallbackSources();
  }
  const sources = uniqueSources([...(configured.think ?? []), driver?.think_url]);
  return sources.length ? sources : fallbackSources();
}

export function pickNextSource(pool: string[], current: string): string {
  const candidates = pool.length > 1 ? pool.filter((source) => source !== current) : pool;
  return candidates[Math.floor(Math.random() * candidates.length)] ?? current;
}
