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
  onReady,
}: {
  state: VideoDriverState;
  videoDriver?: VideoDriver | null;
  className?: string;
  fallbackToDefault?: boolean;
  onReady?: () => void;
}) {
  const fallbackSource = defaultSourceFor(state);
  const sourcePool = useMemo(() => {
    const configured = sourcePoolFor(state, videoDriver, (source) => source.startsWith("/") ? buildApiUrl(source) : source);
    return configured.length ? configured : fallbackToDefault ? [fallbackSource] : [];
  }, [fallbackSource, fallbackToDefault, state, videoDriver]);
  const sourcePoolKey = sourcePool.join("\n");
  const initialSource = sourcePool[0] ?? fallbackSource;
  const videoRef0 = useRef<HTMLVideoElement>(null);
  const videoRef1 = useRef<HTMLVideoElement>(null);
  const videoRefs = [videoRef0, videoRef1] as const;
  const [activeSlot, setActiveSlot] = useState<VideoSlot>(0);
  const [slotSources, setSlotSources] = useState<[string, string]>(() => [
    initialSource,
    pickNextSource(sourcePool, initialSource) || initialSource,
  ]);
  const activeSlotRef = useRef<VideoSlot>(0);
  const currentSourceRef = useRef(initialSource);
  const sourcePoolRef = useRef(sourcePool);
  const transitionIdRef = useRef(0);
  const cleanupTransitionRef = useRef<() => void>(() => undefined);
  const readyReportedRef = useRef(false);
  const cleanupReadyCallbackRef = useRef<() => void>(() => undefined);
  const preloadTimerRef = useRef<number | null>(null);
  const rolloverPendingRef = useRef(false);

  const reportReadyAfterFrame = useCallback((video: HTMLVideoElement, slot: VideoSlot) => {
    if (!onReady || readyReportedRef.current) return;
    cleanupReadyCallbackRef.current();
    const frameReadyVideo = video as HTMLVideoElement & {
      requestVideoFrameCallback?: (callback: () => void) => number;
      cancelVideoFrameCallback?: (id: number) => void;
    };
    const finish = () => {
      cleanupReadyCallbackRef.current = () => undefined;
      if (slot !== activeSlotRef.current || readyReportedRef.current) return;
      readyReportedRef.current = true;
      onReady();
    };
    if (frameReadyVideo.requestVideoFrameCallback) {
      const callbackId = frameReadyVideo.requestVideoFrameCallback(finish);
      cleanupReadyCallbackRef.current = () => frameReadyVideo.cancelVideoFrameCallback?.(callbackId);
    } else {
      const animationId = requestAnimationFrame(finish);
      cleanupReadyCallbackRef.current = () => cancelAnimationFrame(animationId);
    }
  }, [onReady]);

  const startTransition = useCallback((nextSource: string, fallback?: string, forceSlot = false) => {
    cleanupTransitionRef.current();
    const currentSlot = activeSlotRef.current;
    const currentVideo = videoRefs[currentSlot].current;
    if (!currentVideo) return;

    if (nextSource === currentSourceRef.current && !forceSlot) {
      if (fallback && fallback !== nextSource) {
        const onError = () => {
          currentVideo.removeEventListener("error", onError);
          if (cleanupTransitionRef.current === cleanup) cleanupTransitionRef.current = () => undefined;
          startTransition(fallback);
        };
        const cleanup = () => currentVideo.removeEventListener("error", onError);
        cleanupTransitionRef.current();
        cleanupTransitionRef.current = cleanup;
        currentVideo.addEventListener("error", onError, { once: true });
      }
      void currentVideo.play()
        .then(() => reportReadyAfterFrame(currentVideo, currentSlot))
        .catch(() => undefined);
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
      activeSlotRef.current = nextSlot;
      setActiveSlot(nextSlot);
      rolloverPendingRef.current = false;
      if (!readyReportedRef.current) {
        readyReportedRef.current = true;
        onReady?.();
      }
      if (preloadTimerRef.current !== null) window.clearTimeout(preloadTimerRef.current);
      // Wait until the opacity crossfade has completed before repurposing the
      // old slot as the decoder buffer for the following clip.
      preloadTimerRef.current = window.setTimeout(() => {
        preloadTimerRef.current = null;
        if (activeSlotRef.current !== nextSlot) return;
        const followingSource = pickNextSource(sourcePoolRef.current, nextSource) || nextSource;
        setSlotSources((sources) => {
          const prepared = [...sources] as [string, string];
          prepared[currentSlot] = followingSource;
          return prepared;
        });
        currentVideo.pause();
        currentVideo.loop = false;
        currentVideo.currentTime = 0;
        currentVideo.src = followingSource;
        currentVideo.load();
      }, 180);
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
      rolloverPendingRef.current = false;
      if (fallback && fallback !== nextSource) startTransition(fallback);
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
    nextVideo.loop = false;
    nextVideo.currentTime = 0;
    const resolvedNextSource = new URL(nextSource, window.location.href).href;
    const sourceAlreadyAssigned = nextVideo.currentSrc === resolvedNextSource;
    if (!sourceAlreadyAssigned) {
      nextVideo.src = nextSource;
      nextVideo.load();
    }
    if (nextVideo.readyState >= 3) queueMicrotask(onCanPlay);
  }, [onReady, reportReadyAfterFrame]);

  const handleVideoEnded = useCallback((slot: VideoSlot) => {
    if (slot !== activeSlotRef.current) return;
    if (rolloverPendingRef.current) return;
    rolloverPendingRef.current = true;
    const nextSource = pickNextSource(sourcePoolRef.current, currentSourceRef.current);
    startTransition(nextSource, fallbackToDefault ? fallbackSource : undefined, true);
  }, [fallbackSource, fallbackToDefault, startTransition]);

  const handleVideoTimeUpdate = useCallback((slot: VideoSlot) => {
    if (slot !== activeSlotRef.current || rolloverPendingRef.current) return;
    const video = videoRefs[slot].current;
    if (!video || !Number.isFinite(video.duration) || video.duration <= 0) return;
    // Begin decoding / crossfading just before the final frame. This prevents
    // an ended-frame or black-frame gap at both playlist and loop boundaries.
    if (video.duration - video.currentTime > 0.2) return;
    rolloverPendingRef.current = true;
    const nextSource = pickNextSource(sourcePoolRef.current, currentSourceRef.current);
    startTransition(nextSource, fallbackToDefault ? fallbackSource : undefined, true);
  }, [fallbackSource, fallbackToDefault, startTransition]);

  useEffect(() => {
    readyReportedRef.current = false;
    cleanupReadyCallbackRef.current();
    sourcePoolRef.current = sourcePool;
    const nextSource = sourcePool.includes(currentSourceRef.current)
      ? currentSourceRef.current
      : sourcePool[0] ?? fallbackSource;
    rolloverPendingRef.current = false;
    startTransition(nextSource, !fallbackToDefault || nextSource === fallbackSource ? undefined : fallbackSource);
    return () => {
      cleanupTransitionRef.current();
      cleanupReadyCallbackRef.current();
      if (preloadTimerRef.current !== null) {
        window.clearTimeout(preloadTimerRef.current);
        preloadTimerRef.current = null;
      }
    };
  }, [fallbackSource, fallbackToDefault, sourcePoolKey, startTransition]);

  // Both video elements form a double buffer and must always occupy the same
  // layer.  Callers may add sizing / object-position classes, but must not be
  // able to put the two slots back into normal flex/grid flow.
  const resolvedClassName = `absolute inset-0 h-full w-full object-contain ${className ?? ""}`;
  return (
    <>
      {([0, 1] as const).map((slot) => (
        <video
          key={slot}
          ref={videoRefs[slot]}
          src={slotSources[slot] || undefined}
          muted
          playsInline
          preload="auto"
          loop={false}
          onPlaying={() => reportReadyAfterFrame(videoRefs[slot].current!, slot)}
          onTimeUpdate={() => handleVideoTimeUpdate(slot)}
          onEnded={() => handleVideoEnded(slot)}
          aria-hidden={slot !== activeSlot}
          aria-label={slot === activeSlot ? (state === "talk" || state === "emphasis" ? "数字人讲话" : state === "think" ? "数字人思考" : state === "welcome" ? "数字人欢迎" : "数字人聆听") : undefined}
          className={`${resolvedClassName} transition-opacity duration-150 ${slot === activeSlot ? "opacity-100" : "pointer-events-none opacity-0"}`}
        />
      ))}
    </>
  );
}
