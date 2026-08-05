import { useState, type RefObject } from "react";
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
import { ChatInput } from "./ChatInput";
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
}: DigitalHumanDisplayProps) {
  const [activeLanguage, setActiveLanguage] = useState("中文");
  const [draft, setDraft] = useState("");
  const [inputMode, setInputMode] = useState<"voice" | "keyboard">("voice");
  const live = connection === "live" || connection === "expiring";
  const busy = connection === "connecting" || connection === "queued";
  const phaseLabel = conversationPhaseLabel(conversationPhase);
  const visibleMessages = messages.slice(-5);
  const latestVisibleMessage = visibleMessages[visibleMessages.length - 1];
  const showLiveSubtitle = Boolean(
    subtitle?.trim()
      && !(latestVisibleMessage?.role === "assistant" && latestVisibleMessage.text.trim() === subtitle.trim()),
  );

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

          <aside className="digital-display-languages" aria-label="语言选择">
            {languages.map((language) => (
              <button
                key={language}
                type="button"
                onClick={() => setActiveLanguage(language)}
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
            </div>
            <div className="digital-display-chat-feed" aria-live="polite">
              {exhibitionConfigNotice ? (
                <div className="digital-display-chat-notice" role="status">{exhibitionConfigNotice}</div>
              ) : null}
              {navigationResult ? (
                <NavigationGuideCard
                  navigationResult={navigationResult}
                  isSpeaking={isSpeaking}
                  onSpeakStep={onSpeakNavigationStep}
                />
              ) : null}
              {visibleMessages.length === 0 && !navigationResult ? (
                <WelcomeOverviewCard
                  phase={welcomePhase}
                  replayDisabled={welcomeReplayDisabled}
                  onReplay={onReplayWelcome}
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
                <button key={suggestion} type="button" onClick={() => live && onSend(suggestion)} disabled={!live}>
                  {suggestion}
                </button>
              ))}
            </div>

            <div className="digital-display-chat-input">
              {inputMode === "voice" ? (
                <ChatInput
                  compact
                  onSend={onSend}
                  onSpeakAudio={onSpeakAudio}
                  onSpeakAudioStreamResult={onSpeakAudioStreamResult}
                  onSpeakAudioStreamError={onSpeakAudioStreamError}
                  streamingAsrSessionId={streamingAsrSessionId}
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
