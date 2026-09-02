import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { buildApiUrl } from "../lib/api";

// Keep the source files in examples/avatars/video so the browser build uses
// the same default assets as the rest of the repository.
const LISTEN_VIDEO_URL = new URL("../../../../examples/avatars/video/listen.mp4", import.meta.url).href;
const THINK_VIDEO_URL = new URL("../../../../examples/avatars/video/think.mp4", import.meta.url).href;
const TALK_VIDEO_URL = new URL("../../../../examples/avatars/video/talk.mp4", import.meta.url).href;

export type VideoDriverState = "idle" | "welcome" | "listen" | "think" | "talk" | "emphasis";
type VideoSlot = 0 | 1;
type VideoDriver = {
  listen_url?: string | null;
  think_url?: string | null;
  talk_url?: string | null;
  states?: Partial<Record<VideoDriverState, string[]>>;
};

type VideoAvatarProps = {
  state: VideoDriverState;
  videoDriver?: VideoDriver | null;
  className?: string;
  style?: CSSProperties;
  fallbackToDefault?: boolean;
};

function defaultSourceFor(state: VideoDriverState): string {
  if (state === "talk" || state === "emphasis") return TALK_VIDEO_URL;
  if (state === "think") return THINK_VIDEO_URL;
  return LISTEN_VIDEO_URL;
}

function uniqueSources(items: Array<string | null | undefined>): string[] {
  return [...new Set(items.filter((item): item is string => Boolean(item)).map((item) => (
    item.startsWith("/") ? buildApiUrl(item) : item
  )))];
}

function sourcePoolFor(state: VideoDriverState, driver?: VideoDriver | null): string[] {
  const configured = driver?.states ?? {};
  if (state === "talk") {
    return uniqueSources([...(configured.talk ?? []), ...(configured.emphasis ?? []), driver?.talk_url]);
  }
  if (state === "emphasis") {
    return uniqueSources([...(configured.emphasis ?? []), ...(configured.talk ?? []), driver?.talk_url]);
  }
  if (state === "welcome") {
    return uniqueSources([...(configured.welcome ?? []), ...(configured.listen ?? []), driver?.listen_url]);
  }
  if (state === "idle" || state === "listen") {
    return uniqueSources([...(configured[state] ?? []), ...(configured.idle ?? []), ...(configured.listen ?? []), driver?.listen_url]);
  }
  return uniqueSources([...(configured.think ?? []), driver?.think_url]);
}

function pickNextSource(pool: string[], current: string): string {
  const candidates = pool.length > 1 ? pool.filter((source) => source !== current) : pool;
  return candidates[Math.floor(Math.random() * candidates.length)] ?? current;
}

export function VideoAvatar({ state, videoDriver, className, style, fallbackToDefault = true }: VideoAvatarProps) {
  const fallbackSource = defaultSourceFor(state);
  const sourcePool = useMemo(() => {
    const configured = sourcePoolFor(state, videoDriver);
    return configured.length ? configured : fallbackToDefault ? [fallbackSource] : [];
  }, [fallbackSource, fallbackToDefault, state, videoDriver]);
  const sourcePoolKey = sourcePool.join("\n");
  const loop = false;
  const videoRef0 = useRef<HTMLVideoElement>(null);
  const videoRef1 = useRef<HTMLVideoElement>(null);
  const videoRefs = [videoRef0, videoRef1] as const;
  const [activeSlot, setActiveSlot] = useState<VideoSlot>(0);
  const [slotSources, setSlotSources] = useState<[string, string]>(() => [sourcePool[0] ?? fallbackSource, ""]);
  const activeSlotRef = useRef<VideoSlot>(0);
  const currentSourceRef = useRef(sourcePool[0] ?? fallbackSource);
  const sourcePoolRef = useRef(sourcePool);
  const currentLoopRef = useRef(loop);
  const transitionIdRef = useRef(0);
  const cleanupTransitionRef = useRef<() => void>(() => undefined);

  const startTransition = useCallback((nextSource: string, nextLoop: boolean, fallback?: string) => {
    cleanupTransitionRef.current();
    const currentSlot = activeSlotRef.current;
    const currentVideo = videoRefs[currentSlot].current;
    if (!currentVideo) return;

    if (nextSource === currentSourceRef.current) {
      currentVideo.loop = nextLoop;
      if (currentLoopRef.current !== nextLoop) currentVideo.currentTime = 0;
      currentLoopRef.current = nextLoop;
      if (fallback && fallback !== nextSource) {
        const onError = () => {
          currentVideo.removeEventListener("error", onError);
          if (cleanupTransitionRef.current === cleanup) cleanupTransitionRef.current = () => undefined;
          startTransition(fallback, nextLoop);
        };
        const cleanup = () => currentVideo.removeEventListener("error", onError);
        cleanupTransitionRef.current();
        cleanupTransitionRef.current = cleanup;
        currentVideo.addEventListener("error", onError, { once: true });
      }
      void currentVideo.play().catch(() => undefined);
      return;
    }

    const nextSlot: VideoSlot = currentSlot === 0 ? 1 : 0;
    const nextVideo = videoRefs[nextSlot].current;
    if (!nextVideo) return;
    const transitionId = ++transitionIdRef.current;
    let settled = false;
    let playbackRequested = false;
    let frameCallbackId: number | null = null;
    let animationFrameId: number | null = null;
    const frameReadyVideo = nextVideo as HTMLVideoElement & {
      requestVideoFrameCallback?: (callback: () => void) => number;
      cancelVideoFrameCallback?: (id: number) => void;
    };
    const cleanup = () => {
      nextVideo.removeEventListener("canplay", onCanPlay);
      nextVideo.removeEventListener("error", onError);
      if (frameCallbackId !== null) frameReadyVideo.cancelVideoFrameCallback?.(frameCallbackId);
      if (animationFrameId !== null) cancelAnimationFrame(animationFrameId);
      if (cleanupTransitionRef.current === cleanup) cleanupTransitionRef.current = () => undefined;
    };
    const commit = () => {
      if (settled || transitionId !== transitionIdRef.current) return;
      settled = true;
      cleanup();
      currentVideo.pause();
      currentSourceRef.current = nextSource;
      currentLoopRef.current = nextLoop;
      activeSlotRef.current = nextSlot;
      setActiveSlot(nextSlot);
    };
    const onCanPlay = () => {
      if (playbackRequested || settled || transitionId !== transitionIdRef.current) return;
      playbackRequested = true;
      void nextVideo.play().then(() => {
        if (settled || transitionId !== transitionIdRef.current) return;
        if (frameReadyVideo.requestVideoFrameCallback) {
          frameCallbackId = frameReadyVideo.requestVideoFrameCallback(commit);
        } else {
          animationFrameId = requestAnimationFrame(commit);
        }
      }).catch(onError);
    };
    const onError = () => {
      if (settled || transitionId !== transitionIdRef.current) return;
      settled = true;
      cleanup();
      if (fallback && fallback !== nextSource) startTransition(fallback, nextLoop);
    };

    cleanupTransitionRef.current = cleanup;
    setSlotSources((current) => {
      const next = [...current] as [string, string];
      next[nextSlot] = nextSource;
      return next;
    });
    nextVideo.addEventListener("canplay", onCanPlay);
    nextVideo.addEventListener("error", onError);
    nextVideo.pause();
    nextVideo.preload = "auto";
    nextVideo.loop = nextLoop;
    nextVideo.currentTime = 0;
    nextVideo.src = nextSource;
    nextVideo.load();
    if (nextVideo.readyState >= 3) queueMicrotask(onCanPlay);
  }, []);

  const handleVideoEnded = useCallback((slot: VideoSlot) => {
    if (slot !== activeSlotRef.current) return;
    const nextSource = pickNextSource(sourcePoolRef.current, currentSourceRef.current);
    startTransition(nextSource, false, fallbackToDefault ? fallbackSource : undefined);
  }, [fallbackSource, fallbackToDefault, startTransition]);

  useEffect(() => {
    sourcePoolRef.current = sourcePool;
    const nextSource = pickNextSource(sourcePool, currentSourceRef.current);
    startTransition(nextSource, loop, !fallbackToDefault || nextSource === fallbackSource ? undefined : fallbackSource);
    return () => cleanupTransitionRef.current();
  }, [fallbackSource, fallbackToDefault, loop, sourcePoolKey, startTransition]);

  // Both video elements form a double buffer and must always occupy the same
  // layer.  Callers may add sizing / object-position classes, but must not be
  // able to put the two slots back into normal flex/grid flow.
  const resolvedClassName = `absolute inset-0 h-full w-full object-contain ${className ?? ""}`;
  const ariaLabel = state === "talk" || state === "emphasis" ? "数字人讲话" : state === "think" ? "数字人思考" : state === "welcome" ? "数字人欢迎" : "数字人聆听";
  return (
    <>
      {([0, 1] as const).map((slot) => (
        <video
          key={slot}
          ref={videoRefs[slot]}
          src={slotSources[slot] || undefined}
          autoPlay
          muted
          playsInline
          preload="auto"
          loop={false}
          onEnded={() => handleVideoEnded(slot)}
          aria-hidden={slot !== activeSlot}
          aria-label={slot === activeSlot ? ariaLabel : undefined}
          className={`${resolvedClassName} transition-opacity duration-150 ${slot === activeSlot ? "opacity-100" : "pointer-events-none opacity-0"}`}
          style={style}
        />
      ))}
    </>
  );
}

export { LISTEN_VIDEO_URL, TALK_VIDEO_URL };
