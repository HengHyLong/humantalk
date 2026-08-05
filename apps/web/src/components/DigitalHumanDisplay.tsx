import { useEffect, useMemo, useState, type RefObject } from "react";
import type {
  AvatarSummary,
  ClientRendererDescriptor,
  NavigationResult,
  SceneBackgroundAsset,
  SceneComposition,
  VoiceIntent,
} from "../lib/api";
import type { TtsProviderExtended } from "../constants/ttsBailian";
import type { ConnectionStatus, Message } from "../types";
import {
  conversationPhaseLabel,
  type ConversationPhase,
} from "../lib/sessionStateMachine";
import type { WelcomePhase } from "../lib/welcomeExperience";
import type { NavigationStep } from "../lib/navigationPresentation";
import { createInputCaptureEvent, type InputCaptureEvent } from "../lib/inputCapture";
import { createLiveInteractionAdapter, createInteractionPreviewAdapter } from "../lib/interactionAdapter";
import { useInteractionController } from "../lib/useInteractionController";
import { F02_DEVELOPMENT_PREVIEW, F02_UPDATED_PREVIEW_CARD } from "../lib/multimodalPreview";
import { useMultimodalController } from "../lib/useMultimodalController";
import { ChatInput } from "./ChatInput";
import { InteractionControlPanel } from "./InteractionControlPanel";
import { MultimodalPanel } from "./MultimodalPanel";
import { NavigationGuideCard } from "./NavigationGuideCard";
import { SceneStage } from "./SceneStage";
import { WelcomeOverviewCard } from "./WelcomeOverviewCard";

type DigitalHumanDisplayProps = {
  videoRef: RefObject<HTMLVideoElement>;
  videoStream?: MediaStream | null;
  scene?: SceneComposition | null;
  backgrounds: SceneBackgroundAsset[];
  subtitle?: string | null;
  avatarMaskUrl?: string | null;
  clientRenderer?: ClientRendererDescriptor | null;
  connection: ConnectionStatus;
  conversationPhase: ConversationPhase;
  isSpeaking: boolean;
  avatar: AvatarSummary | null;
  modelLabel: string;
  messages: Message[];
  queueInfo?: { position: number; message: string } | null;
  onStart: () => void;
  onSend: (text: string) => void;
  onInterrupt: () => void;
  onChangeAvatar: () => void;
  onSpeakAudio?: (blob: Blob) => void | Promise<void>;
  onSpeakAudioStreamResult?: (payload: { text: string }) => void | Promise<void>;
  onSpeakAudioStreamError?: (message: string) => void;
  streamingAsrSessionId?: string | null;
  onNotify?: (message: string, tone?: "info" | "success" | "error") => void;
  ttsProvider?: TtsProviderExtended;
  sttProvider?: string;
  edgeVoice?: string;
  qwenModel?: string;
  qwenVoice?: string;
  deferSpeak?: boolean;
  navigationResult?: NavigationResult | null;
  voiceIntent?: VoiceIntent | null;
  exhibitionConfigNotice?: string | null;
  welcomePhase?: WelcomePhase;
  welcomeReplayDisabled?: boolean;
  onReplayWelcome?: () => void;
  onSpeakNavigationStep?: (step: NavigationStep) => void;
  onInputEvent?: (event: InputCaptureEvent) => void;
  terminalId?: string;
};

const languages = ["中文", "English"];
const suggestions = ["展馆导航", "预约洽谈", "会议服务", "关于展览"];

export function DigitalHumanDisplay({
  videoRef,
  videoStream = null,
  scene = null,
  backgrounds,
  subtitle,
  avatarMaskUrl = null,
  clientRenderer = null,
  connection,
  conversationPhase,
  isSpeaking,
  avatar,
  modelLabel,
  messages,
  queueInfo,
  onStart,
  onSend,
  onInterrupt,
  onChangeAvatar,
  onSpeakAudio,
  onSpeakAudioStreamResult,
  onSpeakAudioStreamError,
  streamingAsrSessionId = null,
  onNotify,
  ttsProvider = "edge",
  sttProvider = "",
  edgeVoice = "",
  qwenModel = "",
  qwenVoice = "",
  deferSpeak = false,
  navigationResult = null,
  voiceIntent = null,
  exhibitionConfigNotice = null,
  welcomePhase = "idle",
  welcomeReplayDisabled = true,
  onReplayWelcome,
  onSpeakNavigationStep,
  onInputEvent,
  terminalId = "web-terminal",
}: DigitalHumanDisplayProps) {
  const [activeLanguage, setActiveLanguage] = useState("中文");
  const [draft, setDraft] = useState("");
  const [inputMode, setInputMode] = useState<"voice" | "keyboard">("voice");
  const [interactionPreviewOpen, setInteractionPreviewOpen] = useState(false);
  const [multimodalPreviewOpen, setMultimodalPreviewOpen] = useState(false);
  const live = connection === "live" || connection === "expiring";
  const busy = connection === "connecting" || connection === "queued";
  const phaseLabel = conversationPhaseLabel(conversationPhase);
  const visibleMessages = messages.slice(-5);
  const latestVisibleMessage = visibleMessages[visibleMessages.length - 1];
  const showLiveSubtitle = Boolean(
    subtitle?.trim()
      && !(latestVisibleMessage?.role === "assistant" && latestVisibleMessage.text.trim() === subtitle.trim()),
  );

  const liveInteractionAdapter = useMemo(
    () => createLiveInteractionAdapter({ requestInterrupt: async () => onInterrupt() }),
    [onInterrupt],
  );
  const previewInteractionAdapter = useMemo(createInteractionPreviewAdapter, []);
  const liveInteraction = useInteractionController(liveInteractionAdapter);
  const previewInteraction = useInteractionController(previewInteractionAdapter);
  const multimodal = useMultimodalController();

  useEffect(() => {
    if (isSpeaking) {
      liveInteraction.startActivity("当前数字人播报", `session-${streamingAsrSessionId ?? "unknown"}`);
    } else {
      liveInteraction.completeActivity();
    }
  }, [isSpeaking, liveInteraction.completeActivity, liveInteraction.startActivity, streamingAsrSessionId]);

  const emitTouch = (control: string, value?: string) => {
    onInputEvent?.(createInputCaptureEvent({
      sessionId: streamingAsrSessionId,
      terminalId,
      source: "touch",
      kind: "touch",
      payload: { control, value: value ?? null },
    }));
  };

  const openInteractionPreview = () => {
    previewInteraction.reset();
    previewInteraction.startActivity("展会概览播报（开发预览）");
    setInteractionPreviewOpen(true);
    emitTouch("interaction_preview_open");
  };

  const closeInteractionPreview = () => {
    previewInteraction.reset();
    setInteractionPreviewOpen(false);
    emitTouch("interaction_preview_close");
  };

  const openMultimodalPreview = () => {
    multimodal.reset();
    multimodal.publishMany(F02_DEVELOPMENT_PREVIEW);
    setMultimodalPreviewOpen(true);
    emitTouch("multimodal_preview_open");
  };

  const closeMultimodalPreview = () => {
    multimodal.reset();
    setMultimodalPreviewOpen(false);
    emitTouch("multimodal_preview_close");
  };

  const updateMultimodalPreview = () => {
    multimodal.publish("detail", F02_UPDATED_PREVIEW_CARD);
    emitTouch("multimodal_revision_update");
  };

  const toggleMultimodalSupporting = () => {
    const slot = multimodal.view.slots.find((item) => item.slotKey === "supporting");
    const contentKey = slot?.presentation?.contentKey;
    if (!contentKey) return;
    if (slot.status === "hidden") multimodal.show("supporting", contentKey);
    else if (slot.status === "visible") multimodal.hide("supporting", contentKey);
  };

  const degradeMultimodalQr = () => {
    const slot = multimodal.view.slots.find((item) => item.slotKey === "action");
    const contentKey = slot?.presentation?.contentKey;
    if (contentKey) multimodal.degrade("action", contentKey);
    emitTouch("multimodal_degrade", contentKey);
  };

  const clearMultimodal = () => {
    for (const slot of multimodal.view.slots) {
      if (slot.status !== "empty") multimodal.clear(slot.slotKey);
    }
    emitTouch("multimodal_clear");
  };

  const submit = () => {
    const text = draft.trim();
    if (!text || !live) return;
    onSend(text);
    setDraft("");
  };

  return (
    <main className="digital-display-root">
      <div className="digital-display-shell">
        <SceneStage
          videoRef={videoRef}
          videoStream={videoStream}
          scene={scene}
          backgrounds={backgrounds}
          subtitle={null}
          avatarMaskUrl={avatarMaskUrl}
          clientRenderer={clientRenderer}
          fullBleed
          videoFit="cover"
          backgroundColorOverride="#062b66"
          className="digital-display-stage"
        >
          <div className="digital-display-grid" aria-hidden />
          <div className="digital-display-orbit digital-display-orbit-one" aria-hidden />
          <div className="digital-display-orbit digital-display-orbit-two" aria-hidden />

          {multimodalPreviewOpen ? (
            <MultimodalPanel
              view={multimodal.view}
              onUpdatePreview={updateMultimodalPreview}
              onToggleSupporting={toggleMultimodalSupporting}
              onClear={clearMultimodal}
              onDegrade={degradeMultimodalQr}
              onClose={closeMultimodalPreview}
            />
          ) : null}

          <aside className="digital-display-languages" aria-label="语言选择">
            {languages.map((language) => (
              <button
                key={language}
                type="button"
                onClick={() => {
                  emitTouch("language", language);
                  setActiveLanguage(language);
                }}
                className={activeLanguage === language ? "is-active" : ""}
              >
                {language}
              </button>
            ))}
          </aside>

          <section className="digital-display-chat-panel" aria-label="实时对话">
            <div className="digital-display-chat-heading">
              <span>{activeLanguage === "中文" ? "实时对话" : "LIVE CONVERSATION"}</span>
              <span className="digital-display-chat-state">
                {voiceIntent === "navigation" ? "导航" : voiceIntent === "exhibition_content" ? "展品问答" : ""}
                {isSpeaking ? " · 正在播报" : ""}
              </span>
              <span className="digital-display-chat-state">{phaseLabel}</span>
              <button type="button" className="digital-display-multimodal-trigger" onClick={openMultimodalPreview}>
                F02 联动
              </button>
            </div>
            <div className="digital-display-chat-feed" aria-live="polite">
              {exhibitionConfigNotice ? (
                <div className="digital-display-chat-notice" role="status">{exhibitionConfigNotice}</div>
              ) : null}
              {navigationResult ? (
                <NavigationGuideCard
                  navigationResult={navigationResult}
                  isSpeaking={isSpeaking}
                  onSpeakStep={onSpeakNavigationStep ? (step) => {
                    emitTouch("navigation_step", step.id);
                    onSpeakNavigationStep(step);
                  } : undefined}
                />
              ) : null}
              {visibleMessages.length === 0 && !navigationResult ? (
                <WelcomeOverviewCard
                  phase={welcomePhase}
                  replayDisabled={welcomeReplayDisabled}
                  onReplay={onReplayWelcome ? () => {
                    emitTouch("welcome_replay");
                    onReplayWelcome();
                  } : undefined}
                  onOpenMultimodalPreview={openMultimodalPreview}
                />
              ) : null}
              {visibleMessages.map((message) => (
                <div key={message.id} className={`digital-display-chat-line ${message.role === "user" ? "is-user" : "is-assistant"}`}>
                  <span className="digital-display-chat-role">{message.role === "user" ? "我" : "数字人"}</span>
                  <p>{message.text || "正在准备回答…"}</p>
                </div>
              ))}
              {showLiveSubtitle ? (
                <div className="digital-display-chat-line is-assistant is-live-line">
                  <span className="digital-display-chat-role">数字人</span>
                  <p>{subtitle}</p>
                </div>
              ) : null}
            </div>

            <div className="digital-display-chat-suggestions" aria-label="常见问题">
              {suggestions.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  onClick={() => {
                    if (!live) return;
                    emitTouch("suggestion", suggestion);
                    onSend(suggestion);
                  }}
                  disabled={!live}
                >
                  {suggestion}
                </button>
              ))}
            </div>

            {live || interactionPreviewOpen ? (
              <InteractionControlPanel
                view={interactionPreviewOpen ? previewInteraction.view : liveInteraction.view}
                onPause={() => void (interactionPreviewOpen ? previewInteraction.pause() : liveInteraction.pause())}
                onResume={() => void (interactionPreviewOpen ? previewInteraction.resume() : liveInteraction.resume())}
                onInterrupt={() => void (interactionPreviewOpen ? previewInteraction.interrupt() : liveInteraction.interrupt())}
                onRepeat={() => void (interactionPreviewOpen ? previewInteraction.repeat() : liveInteraction.repeat())}
                onSetSpeed={(speed) => void (interactionPreviewOpen ? previewInteraction.setSpeed(speed) : liveInteraction.setSpeed(speed))}
                onSetLanguage={(language) => void (interactionPreviewOpen ? previewInteraction.setLanguage(language) : liveInteraction.setLanguage(language))}
                onOpenPreview={interactionPreviewOpen ? undefined : openInteractionPreview}
                onClosePreview={interactionPreviewOpen ? closeInteractionPreview : undefined}
              />
            ) : null}

            <div className="digital-display-chat-input">
              {inputMode === "voice" ? (
                <ChatInput
                  compact
                  onSend={onSend}
                  onSpeakAudio={onSpeakAudio}
                  onSpeakAudioStreamResult={onSpeakAudioStreamResult}
                  onSpeakAudioStreamError={onSpeakAudioStreamError}
                  streamingAsrSessionId={streamingAsrSessionId}
                  onInputEvent={onInputEvent}
                  terminalId={terminalId}
                  onInterrupt={onInterrupt}
                  isSpeaking={isSpeaking}
                  disabled={!live}
                  onNotify={onNotify}
                  ttsProvider={ttsProvider}
                  sttProvider={sttProvider}
                  edgeVoice={edgeVoice}
                  qwenModel={qwenModel}
                  qwenVoice={qwenVoice}
                  deferSpeak={deferSpeak}
                />
              ) : (
                <>
                  <input
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && !event.nativeEvent.isComposing) submit();
                    }}
                    placeholder={live ? "请输入您想了解的内容" : "连接后即可开始提问"}
                    disabled={!live}
                    aria-label="向数字人提问"
                  />
                  {live && isSpeaking ? (
                    <button type="button" className="digital-display-stop" onClick={onInterrupt}>打断</button>
                  ) : (
                    <button type="button" className="digital-display-send" onClick={submit} disabled={!draft.trim() || !live}>发送</button>
                  )}
                </>
              )}
              <button
                type="button"
                className="digital-display-mode-toggle"
                onClick={() => setInputMode((mode) => mode === "voice" ? "keyboard" : "voice")}
                aria-label={inputMode === "voice" ? "切换为键盘输入" : "切换为语音输入"}
              >
                {inputMode === "voice" ? "键盘输入" : "语音输入"}
              </button>
            </div>
          </section>

          {!live && !busy ? (
            <div className="digital-display-start-card">
              <p className="digital-display-eyebrow">四川博览集团数字人 · 实时推流</p>
              <h1>{busy ? "数字人正在准备中" : connection === "error" ? "推流暂时未连接" : "欢迎来到智能展厅"}</h1>
              <p>
                {busy
                  ? queueInfo?.position
                    ? `当前排队第 ${queueInfo.position} 位，请稍候。`
                    : "正在建立 WebRTC 低延迟视频通道。"
                  : "连接四川博览集团数字人视频推流，开始实时问答与展览导览。"}
              </p>
              <button type="button" className="digital-display-start-button" onClick={onStart} disabled={busy}>
                {busy ? "连接中..." : connection === "error" ? "重新连接" : "开始体验"}
              </button>
              <div className="digital-display-start-meta">
                <span>{avatar?.name ?? "默认数字人"}</span>
                <span>{modelLabel}</span>
                <button type="button" onClick={onChangeAvatar}>更换形象</button>
              </div>
            </div>
          ) : null}

          {busy ? (
            <div className="digital-display-loading" role="status" aria-live="polite">
              <span className="digital-display-loader" aria-hidden />
              <strong>{conversationPhase === "reconnecting" ? "正在重连数字人" : "正在加载数字人"}</strong>
              <span>{queueInfo?.position ? `当前排队第 ${queueInfo.position} 位，请稍候` : "正在建立 WebRTC 视频通道"}</span>
              <div className="digital-display-loading-track" aria-hidden><i /></div>
            </div>
          ) : null}

        </SceneStage>
      </div>
    </main>
  );
}
