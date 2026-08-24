import { useCallback, useEffect, useRef, useState } from "react";
import { buildApiUrl } from "../lib/api";

const LISTEN_VIDEO_URL = new URL("../../../../examples/avatars/video/listen.mp4", import.meta.url).href;
const THINK_VIDEO_URL = new URL("../../../../examples/avatars/video/think.mp4", import.meta.url).href;
const TALK_VIDEO_URL = new URL("../../../../examples/avatars/video/talk.mp4", import.meta.url).href;

export type VideoDriverState = "listen" | "think" | "talk";
type VideoSlot = 0 | 1;
type VideoDriver = { listen_url: string; think_url?: string | null; talk_url: string };

function defaultSourceFor(state: VideoDriverState): string {
  if (state === "talk") return TALK_VIDEO_URL;
  if (state === "think") return THINK_VIDEO_URL;
  return LISTEN_VIDEO_URL;
}

export function VideoAvatar({
  state,
  videoDriver,
  className,
}: {
  state: VideoDriverState;
  videoDriver?: VideoDriver | null;
  className?: string;
}) {
  const source = state === "talk"
    ? (videoDriver?.talk_url ? buildApiUrl(videoDriver.talk_url) : TALK_VIDEO_URL)
    : state === "think"
      ? (videoDriver?.think_url ? buildApiUrl(videoDriver.think_url) : THINK_VIDEO_URL)
      : (videoDriver?.listen_url ? buildApiUrl(videoDriver.listen_url) : LISTEN_VIDEO_URL);
  const fallbackSource = defaultSourceFor(state);
  // The ended handler restarts the same state from a random position. Native
  // looping always jumps to frame zero and makes short clips look repetitive.
  // State changes still come from the speech lifecycle, never from video end.
  const loop = false;
  const videoRef0 = useRef<HTMLVideoElement>(null);
  const videoRef1 = useRef<HTMLVideoElement>(null);
  const videoRefs = [videoRef0, videoRef1] as const;
  const [activeSlot, setActiveSlot] = useState<VideoSlot>(0);
  const [slotSources, setSlotSources] = useState<[string, string]>(() => [source, ""]);
  const activeSlotRef = useRef<VideoSlot>(0);
  const currentSourceRef = useRef(source);
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
    const video = videoRefs[slot].current;
    if (!video) return;
    const duration = Number.isFinite(video.duration) ? video.duration : 0;
    const randomWindow = Math.max(0, duration - Math.min(1.2, duration * 0.35));
    const randomTime = randomWindow > 0 ? Math.random() * randomWindow : 0;
    try {
      video.currentTime = randomTime;
    } catch {
      // The source may have been replaced by a state transition.
    }
    void video.play().catch(() => undefined);
  }, []);

  useEffect(() => {
    startTransition(source, loop, source === fallbackSource ? undefined : fallbackSource);
    return () => cleanupTransitionRef.current();
  }, [fallbackSource, loop, source, startTransition]);

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
          aria-label={slot === activeSlot ? (state === "talk" ? "数字人讲话" : state === "think" ? "数字人思考" : "数字人聆听") : undefined}
          className={`${resolvedClassName} transition-opacity duration-75 ${slot === activeSlot ? "opacity-100" : "pointer-events-none opacity-0"}`}
        />
      ))}
    </>
  );
}
