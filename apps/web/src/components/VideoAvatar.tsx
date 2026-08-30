import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { buildApiUrl } from "../lib/api";
import {
  pickNextSource,
  sourcePoolFor,
  type MotionPlaybackState,
  type MotionVideoDriver,
} from "../lib/motionPlaylist";

const LISTEN_VIDEO_URL = new URL("../../../../examples/avatars/video/listen.mp4", import.meta.url).href;
const THINK_VIDEO_URL = new URL("../../../../examples/avatars/video/think.mp4", import.meta.url).href;
const TALK_VIDEO_URL = new URL("../../../../examples/avatars/video/talk.mp4", import.meta.url).href;

export type VideoDriverState = MotionPlaybackState;
type VideoSlot = 0 | 1;
export type VideoDriver = MotionVideoDriver;

function defaultSourceFor(state: VideoDriverState): string {
  if (state === "talk" || state === "emphasis") return TALK_VIDEO_URL;
  if (state === "think") return THINK_VIDEO_URL;
  return LISTEN_VIDEO_URL;
}

export function VideoAvatar({
  state,
  videoDriver,
  className,
  fallbackToDefault = true,
}: {
  state: VideoDriverState;
  videoDriver?: VideoDriver | null;
  className?: string;
  fallbackToDefault?: boolean;
}) {
  const fallbackSource = defaultSourceFor(state);
  const sourcePool = useMemo(() => {
    const configured = sourcePoolFor(state, videoDriver, (source) => source.startsWith("/") ? buildApiUrl(source) : source);
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
    const cleanup = () => {
      nextVideo.removeEventListener("canplay", onCanPlay);
      nextVideo.removeEventListener("error", onError);
      if (cleanupTransitionRef.current === cleanup) cleanupTransitionRef.current = () => undefined;
    };
    const finish = () => {
      if (settled || transitionId !== transitionIdRef.current) return;
      settled = true;
      cleanup();
      nextVideo.loop = nextLoop;
      nextVideo.currentTime = 0;
      void nextVideo.play().catch(() => undefined);
      currentVideo.pause();
      currentSourceRef.current = nextSource;
      currentLoopRef.current = nextLoop;
      activeSlotRef.current = nextSlot;
      setActiveSlot(nextSlot);
    };
    const onCanPlay = () => finish();
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

  const resolvedClassName = className ?? "absolute inset-0 h-full w-full object-contain";
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
          aria-label={slot === activeSlot ? (state === "talk" || state === "emphasis" ? "数字人讲话" : state === "think" ? "数字人思考" : state === "welcome" ? "数字人欢迎" : "数字人聆听") : undefined}
          className={`${resolvedClassName} transition-opacity duration-75 ${slot === activeSlot ? "opacity-100" : "pointer-events-none opacity-0"}`}
        />
      ))}
    </>
  );
}
