const ALIRTC_SDK_URL = "https://g.alicdn.com/apsara-media-box/imp-web-rtc/7.1.9/aliyun-rtc-sdk.js";

export type ViduRtcConfig = {
  app_id: string;
  channel_id: string;
  user_id: string;
  token: string;
  token_expire_at?: number | string | null;
};

type AliRtcEngineInstance = {
  on(event: string, callback: (...args: unknown[]) => void): void;
  joinChannel(token: string, displayName: string): Promise<void>;
  leaveChannel(): Promise<void>;
  destroy(): void;
  setRemoteViewConfig(element: HTMLVideoElement | null, userId: string, streamType: number): void;
  setChannelProfile?(profile: string): Promise<void> | void;
  setDefaultPublishLocalAudioStream?(enabled: boolean): Promise<void> | void;
  setDefaultPublishLocalVideoStream?(enabled: boolean): Promise<void> | void;
  setDefaultSubscribeAllRemoteAudioStreams?(enabled: boolean): Promise<void> | void;
  setDefaultSubscribeAllRemoteVideoStreams?(enabled: boolean): Promise<void> | void;
  setLocalViewConfig?(elementId: string, streamType: number): Promise<void> | void;
  startPreview?(streamType?: number): Promise<void> | void;
  stopPreview?(): Promise<void> | void;
  publishLocalAudioStream?(enabled: boolean): Promise<void> | void;
  publishLocalVideoStream?(enabled: boolean): Promise<void> | void;
};

type AliRtcEngineFactory = {
  isSupported(): Promise<{ support: boolean; reason?: string }>;
  setLogLevel(level: number): void;
  getInstance(): AliRtcEngineInstance;
};

declare global {
  interface Window {
    AliRtcEngine?: AliRtcEngineFactory;
  }
}

export type ViduPlaybackHandle = {
  close: () => Promise<void>;
};

export type StartViduPlaybackOptions = {
  onRemoteStream?: (stream: MediaStream) => void;
};

let sdkPromise: Promise<AliRtcEngineFactory> | null = null;

function loadAliRtcSdk(): Promise<AliRtcEngineFactory> {
  if (window.AliRtcEngine) return Promise.resolve(window.AliRtcEngine);
  if (sdkPromise) return sdkPromise;
  const pending = new Promise<AliRtcEngineFactory>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${ALIRTC_SDK_URL}"]`);
    const script = existing ?? document.createElement("script");
    const onLoad = () => {
      if (window.AliRtcEngine) resolve(window.AliRtcEngine);
      else reject(new Error("Vidu RTC SDK 加载失败"));
    };
    script.addEventListener("load", onLoad, { once: true });
    script.addEventListener("error", () => reject(new Error("Vidu RTC SDK 加载失败")), { once: true });
    if (!existing) {
      script.src = ALIRTC_SDK_URL;
      script.async = true;
      script.crossOrigin = "anonymous";
      document.head.appendChild(script);
    }
  }).catch((error) => {
    sdkPromise = null;
    throw error;
  });
  sdkPromise = pending;
  return pending;
}

async function callOptional(
  engine: AliRtcEngineInstance,
  method: keyof AliRtcEngineInstance,
  ...args: unknown[]
): Promise<void> {
  const candidate = engine[method];
  if (typeof candidate !== "function") return;
  await Promise.resolve((candidate as (...values: unknown[]) => unknown).apply(engine, args));
}

export async function startViduPlayback(
  rtc: ViduRtcConfig,
  videoEl: HTMLVideoElement,
  options: StartViduPlaybackOptions = {},
  timeoutMs = 60_000,
): Promise<ViduPlaybackHandle> {
  if (!rtc?.token || !rtc.user_id || !rtc.channel_id) {
    throw new Error("Vidu RTC 会话信息不完整");
  }
  const sdk = await loadAliRtcSdk();
  const support = await sdk.isSupported();
  if (!support.support) {
    throw new Error(`当前浏览器不支持 Vidu RTC${support.reason ? `：${support.reason}` : ""}`);
  }

  sdk.setLogLevel(0);
  const engine = sdk.getInstance();
  // The provider's reference client starts a local camera preview before it
  // publishes video. AliRTC uses this binding to initialize the capture track;
  // publishing directly can join successfully while never producing a video
  // track, leaving the remote digital human in its waiting state.
  const localPreview = document.createElement("video");
  localPreview.id = `vidu-local-preview-${rtc.user_id.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
  localPreview.autoplay = true;
  localPreview.playsInline = true;
  localPreview.muted = true;
  localPreview.setAttribute("aria-hidden", "true");
  Object.assign(localPreview.style, {
    position: "fixed",
    left: "-9999px",
    top: "0",
    width: "1px",
    height: "1px",
    opacity: "0",
    pointerEvents: "none",
  });
  document.body.appendChild(localPreview);
  videoEl.autoplay = true;
  videoEl.playsInline = true;
  // Start muted so browser autoplay policy cannot block the first frame. The
  // caller restores audio after the stream is live.
  videoEl.muted = true;

  let remoteUserId = "";
  let remoteStreamType = 1;
  let settled = false;
  let closed = false;
  let resolveRemote: (() => void) | null = null;
  let rejectRemote: ((reason?: unknown) => void) | null = null;
  const remoteReady = new Promise<void>((resolve, reject) => {
    resolveRemote = resolve;
    rejectRemote = reject;
  });

  const markRemoteReady = (event?: Event) => {
    if (settled) return;
    const stream = videoEl.srcObject;
    const hasMediaStream = stream instanceof MediaStream && stream.getVideoTracks().length > 0;
    // AliRTC normally exposes a MediaStream through srcObject, but some SDK
    // builds render internally. Media readiness events are therefore also a
    // valid first-frame signal and must not leave the UI loading forever.
    const hasRenderableFrame = videoEl.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA
      || event?.type === "loadedmetadata"
      || event?.type === "loadeddata"
      || event?.type === "playing";
    if (!hasMediaStream && !hasRenderableFrame) return;
    settled = true;
    if (hasMediaStream) options.onRemoteStream?.(stream);
    resolveRemote?.();
  };

  const removeVideoListeners = () => {
    videoEl.removeEventListener("loadedmetadata", markRemoteReady);
    videoEl.removeEventListener("loadeddata", markRemoteReady);
    videoEl.removeEventListener("playing", markRemoteReady);
  };

  const bindRemoteVideo = (userId: string, streamType: number) => {
    if (!userId) return;
    remoteUserId = userId;
    remoteStreamType = streamType;
    engine.setRemoteViewConfig(videoEl, userId, streamType);
    void videoEl.play().catch(() => undefined);
    window.requestAnimationFrame(() => markRemoteReady());
  };

  const isSubscribed = (state: unknown) => state === 3 || String(state).toLowerCase() === "subscribed";

  videoEl.addEventListener("loadedmetadata", markRemoteReady);
  videoEl.addEventListener("loadeddata", markRemoteReady);
  videoEl.addEventListener("playing", markRemoteReady);

  engine.on("remoteUserOnLineNotify", (...args: unknown[]) => {
    const userId = String(args[0] ?? "");
    console.info("[Vidu RTC] remote user online", userId);
  });

  engine.on("videoSubscribeStateChanged", (...args: unknown[]) => {
    const userId = String(args[0] ?? "");
    const newState = args[2];
    console.info("[Vidu RTC] camera subscription", userId, String(newState ?? ""));
    if (!userId || !isSubscribed(newState)) return;
    bindRemoteVideo(userId, 1);
  });
  engine.on("screenShareSubscribeStateChanged", (...args: unknown[]) => {
    const userId = String(args[0] ?? "");
    const newState = args[2];
    console.info("[Vidu RTC] screen subscription", userId, String(newState ?? ""));
    if (!userId || !isSubscribed(newState)) return;
    bindRemoteVideo(userId, 2);
  });
  engine.on("bye", (...args: unknown[]) => {
    if (!settled) {
      settled = true;
      rejectRemote?.(new Error(`Vidu RTC 已断开（${String(args[0] ?? "unknown")}）`));
    }
  });

  const cleanupEngine = async () => {
    if (closed) return;
    closed = true;
    removeVideoListeners();
    if (remoteUserId) {
      try {
        engine.setRemoteViewConfig(null, remoteUserId, remoteStreamType);
      } catch {
        // The remote view may already have been removed by the RTC SDK.
      }
    }
    videoEl.pause();
    try {
      await callOptional(engine, "stopPreview");
    } catch {
      // Continue leaving the channel even if camera preview cleanup fails.
    }
    try {
      await engine.leaveChannel();
    } catch {
      // Joining can fail before a channel exists; destroy still releases media.
    } finally {
      engine.destroy();
      localPreview.remove();
    }
  };

  try {
    await callOptional(engine, "setChannelProfile", "communication");
    await callOptional(engine, "setDefaultPublishLocalAudioStream", true);
    // Vidu only publishes the digital-human picture for call_mode=video. Its
    // protocol requires the participant to publish both microphone and camera.
    await callOptional(engine, "setDefaultPublishLocalVideoStream", true);
    await callOptional(engine, "setDefaultSubscribeAllRemoteAudioStreams", true);
    await callOptional(engine, "setDefaultSubscribeAllRemoteVideoStreams", true);
    await engine.joinChannel(rtc.token, rtc.user_id);
    console.info("[Vidu RTC] joined", rtc.channel_id, rtc.user_id);
    await callOptional(engine, "setLocalViewConfig", localPreview.id, 1);
    await callOptional(engine, "startPreview", 1);
    await callOptional(engine, "publishLocalVideoStream", true);
    await callOptional(engine, "publishLocalAudioStream", true);
    await Promise.race([
      remoteReady,
      new Promise<never>((_, reject) => {
        window.setTimeout(() => reject(new Error("等待 Vidu 数字人视频流超时")), timeoutMs);
      }),
    ]);
  } catch (error) {
    await cleanupEngine();
    throw error;
  }

  return {
    close: async () => {
      await cleanupEngine();
    },
  };
}
