import { useEffect, useMemo, useState, type FormEvent, type RefObject } from "react";
import type {
  AvatarSummary,
  ClientRendererDescriptor,
  GuideRecommendation,
  MaterialQrResponse,
  MaterialTokenResponse,
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
import type { MediaPlaybackState, MediaPlaybackStatus } from "../lib/mediaPlayback";
import { createInputCaptureEvent, type InputCaptureEvent } from "../lib/inputCapture";
import { createLiveInteractionAdapter } from "../lib/interactionAdapter";
import { useInteractionController } from "../lib/useInteractionController";
import { F02_DEVELOPMENT_PREVIEW } from "../lib/multimodalPreview";
import { useMultimodalController } from "../lib/useMultimodalController";
import { ChatInput } from "./ChatInput";
import { FeatureDrawer } from "./FeatureDrawer";
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
  navigationResult?: NavigationResult | null;
  voiceIntent?: VoiceIntent | null;
  exhibitionConfigNotice?: string | null;
  welcomePhase?: WelcomePhase;
  welcomeReplayDisabled?: boolean;
  onReplayWelcome?: () => void;
  onSpeakNavigationStep?: (step: NavigationStep) => void;
  onInputEvent?: (event: InputCaptureEvent) => void;
  terminalId?: string;
  mediaPlayback?: MediaPlaybackState;
  guideItems?: GuideRecommendation[];
  materialContext?: MaterialTokenResponse | null;
  onRequestMaterial?: (itemId: string) => Promise<MaterialQrResponse>;
  onSubmitLead?: (input: { companyName: string; contactName: string; phone: string; email: string; intentSummary: string; interestedExhibitIds: string[]; consent: boolean; materialToken?: string }) => Promise<void>;
};

const languages = ["中文", "English"];
const suggestions = ["展馆导航", "预约洽谈", "会议服务", "关于展览"];
type FeatureDrawerKey = "navigation" | "primary" | "supporting" | "detail" | "action";
type MultimodalDrawerSlot = Exclude<FeatureDrawerKey, "navigation">;
const FEATURE_RAIL_ITEMS: ReadonlyArray<{ key: FeatureDrawerKey; label: string }> = [
  { key: "navigation", label: "展馆导航" },
  { key: "primary", label: "展会概览" },
  { key: "supporting", label: "参观推荐" },
  { key: "detail", label: "展品介绍" },
  { key: "action", label: "资料二维码" },
];
const MEDIA_PLAYBACK_LABELS: Record<MediaPlaybackStatus, string> = {
  idle: "媒体待机",
  negotiating: "媒体协商",
  buffering: "等待首帧",
  playing: "媒体播放中",
  stalled: "媒体卡顿",
  reconnecting: "媒体重连",
  degraded: "媒体降级",
  ended: "媒体结束",
  error: "媒体异常",
};

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
  navigationResult = null,
  voiceIntent = null,
  exhibitionConfigNotice = null,
  welcomePhase = "idle",
  welcomeReplayDisabled = true,
  onReplayWelcome,
  onSpeakNavigationStep,
  onInputEvent,
  terminalId = "web-terminal",
  mediaPlayback,
  guideItems = [],
  materialContext = null,
  onRequestMaterial,
  onSubmitLead,
}: DigitalHumanDisplayProps) {
  const [activeLanguage, setActiveLanguage] = useState("中文");
  const [draft, setDraft] = useState("");
  const [inputMode, setInputMode] = useState<"voice" | "keyboard">("voice");
  const [featureRailExpanded, setFeatureRailExpanded] = useState(false);
  const [selectedFeatureKey, setSelectedFeatureKey] = useState<FeatureDrawerKey>("primary");
  const [activeFeatureDrawer, setActiveFeatureDrawer] = useState<FeatureDrawerKey | null>(null);
  const [leadItem, setLeadItem] = useState<GuideRecommendation | null>(null);
  const [materialQr, setMaterialQr] = useState<MaterialQrResponse | null>(null);
  const [leadSaving, setLeadSaving] = useState(false);
  const [leadMessage, setLeadMessage] = useState("");
  const [leadForm, setLeadForm] = useState({ companyName: "", contactName: "", phone: "", email: "", consent: false });
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
  const liveInteraction = useInteractionController(liveInteractionAdapter);
  const multimodal = useMultimodalController();

  useEffect(() => {
    if (!materialContext) return;
    setLeadMessage("");
    setLeadItem({
      id: materialContext.exhibit_id || "",
      name: materialContext.exhibit_name || "展会资料",
      category: "资料领取",
      description: "扫码进入资料领取或预约洽谈表单。",
      tags: ["资料二维码"],
      image_url: null,
      exhibitor: "",
      booth_code: "",
      score: 0,
      compare: {},
    });
  }, [materialContext]);

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

  const openMultimodalPreview = (focusSlot: MultimodalDrawerSlot = "primary") => {
    multimodal.reset();
    multimodal.publishMany(F02_DEVELOPMENT_PREVIEW);
    setSelectedFeatureKey(focusSlot);
    setFeatureRailExpanded(true);
    setActiveFeatureDrawer(focusSlot);
    emitTouch("multimodal_drawer_open", focusSlot);
  };

  const openNavigationDrawer = () => {
    setSelectedFeatureKey("navigation");
    setFeatureRailExpanded(true);
    setActiveFeatureDrawer("navigation");
    emitTouch("navigation_drawer_open");
  };

  const closeFeatureDrawer = () => {
    if (!activeFeatureDrawer) return;
    emitTouch("feature_drawer_close", activeFeatureDrawer);
    setActiveFeatureDrawer(null);
  };

  const submit = () => {
    const text = draft.trim();
    if (!text || !live) return;
    onSend(text);
    setDraft("");
  };

  const submitLead = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!leadItem || !onSubmitLead || !leadForm.companyName.trim() || !leadForm.contactName.trim() || !leadForm.phone.trim() || !leadForm.consent) {
      setLeadMessage("请填写单位、联系人、手机号并同意授权。");
      return;
    }
    setLeadSaving(true);
    setLeadMessage("");
    try {
      await onSubmitLead({
        ...leadForm,
        companyName: leadForm.companyName.trim(),
        contactName: leadForm.contactName.trim(),
        phone: leadForm.phone.trim(),
        email: leadForm.email.trim(),
        intentSummary: `咨询${leadItem.name}`,
        interestedExhibitIds: leadItem.id ? [leadItem.id] : [],
        materialToken: materialContext?.token,
      });
      setLeadMessage("已提交，我们会尽快与您联系。");
      setLeadForm({ companyName: "", contactName: "", phone: "", email: "", consent: false });
    } catch (error) {
      setLeadMessage(error instanceof Error ? error.message : "提交失败，请稍后重试。");
    } finally {
      setLeadSaving(false);
    }
  };

  useEffect(() => {
    if (!activeFeatureDrawer) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeFeatureDrawer();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeFeatureDrawer]);

  useEffect(() => {
    if (live) return;
    setActiveFeatureDrawer(null);
    setFeatureRailExpanded(false);
  }, [live]);

  const showConversationSurface = live;
  const visibleFeatureItems = featureRailExpanded ? FEATURE_RAIL_ITEMS : [FEATURE_RAIL_ITEMS[0]];

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

          {showConversationSurface && activeFeatureDrawer === "navigation" ? (
            <FeatureDrawer
              eyebrow="路线指引"
              title="展馆导航"
              description={navigationResult ? "地图、字幕和播报会跟随当前路线步骤更新。" : "连接数字人并提出目的地后，这里会显示真实路线。"}
              onClose={closeFeatureDrawer}
            >
              {navigationResult ? (
                <NavigationGuideCard
                  navigationResult={navigationResult}
                  isSpeaking={isSpeaking}
                  onSpeakStep={onSpeakNavigationStep ? (step) => {
                    emitTouch("navigation_step", step.id);
                    onSpeakNavigationStep(step);
                  } : undefined}
                />
              ) : (
                <div className="digital-display-feature-drawer-empty" role="status">
                  <strong>等待导航路线</strong>
                  <p>可以先点击“展馆导航”快捷问题，或在输入框中告诉数字人你的目的地。</p>
                </div>
              )}
            </FeatureDrawer>
          ) : null}

          {showConversationSurface && activeFeatureDrawer && activeFeatureDrawer !== "navigation" ? (
            <FeatureDrawer
              eyebrow="展会服务"
              title={activeFeatureDrawer === "primary" ? "展馆概览" : activeFeatureDrawer === "supporting" ? "参观推荐" : activeFeatureDrawer === "detail" ? "展品介绍" : "资料二维码"}
              description="地图、列表、卡片和二维码按功能独立打开，不阻塞当前会话。"
              onClose={closeFeatureDrawer}
            >
              <MultimodalPanel
                view={multimodal.view}
                onClose={closeFeatureDrawer}
                embedded
                focusSlot={activeFeatureDrawer}
              />
            </FeatureDrawer>
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

          {showConversationSurface ? (
            <nav className={`digital-display-feature-rail${featureRailExpanded ? " is-expanded" : ""}`} aria-label="展会功能入口">
              <div className="digital-display-feature-rail-items">
                {visibleFeatureItems.map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    aria-label={item.label}
                    aria-current={selectedFeatureKey === item.key ? "page" : undefined}
                    onClick={() => item.key === "navigation" ? openNavigationDrawer() : openMultimodalPreview(item.key)}
                    className={selectedFeatureKey === item.key ? "is-active" : ""}
                  >
                    <strong>{item.label}</strong>
                  </button>
                ))}
              </div>
              <button
                type="button"
                className="digital-display-feature-rail-toggle"
                aria-expanded={featureRailExpanded}
                aria-label={featureRailExpanded ? "收起展会功能" : "展开展会功能"}
                onClick={() => setFeatureRailExpanded((expanded) => !expanded)}
              >
                <span aria-hidden="true">{featureRailExpanded ? "⌃" : "⌄"}</span>
              </button>
            </nav>
          ) : null}

          {showConversationSurface ? <section className="digital-display-chat-panel" aria-label="实时对话">
            <div className="digital-display-chat-heading">
              <span>{activeLanguage === "中文" ? "实时对话" : "LIVE CONVERSATION"}</span>
              <span className="digital-display-chat-state">
                {voiceIntent === "navigation" ? "导航" : voiceIntent === "shopping" ? "导购" : voiceIntent === "exhibition_content" ? "展品问答" : ""}
                {isSpeaking ? " · 正在播报" : ""}
              </span>
              <span className="digital-display-chat-state">{phaseLabel}</span>
              {mediaPlayback ? (
                <span className={`digital-display-media-status is-${mediaPlayback.status}`} role="status">
                  {MEDIA_PLAYBACK_LABELS[mediaPlayback.status]}
                  {mediaPlayback.status === "reconnecting" && mediaPlayback.reconnectAttempt > 0 ? ` · ${mediaPlayback.reconnectAttempt}` : ""}
                </span>
              ) : null}
            </div>
            <div className="digital-display-chat-feed" aria-live="polite">
              {exhibitionConfigNotice ? (
                <div className="digital-display-chat-notice" role="status">{exhibitionConfigNotice}</div>
              ) : null}
              {materialContext ? (
                <div className="digital-display-material-context" role="status">
                  资料表单：{materialContext.exhibit_name || "展会资料"} · 链接有效期至 {new Date(materialContext.expires_at).toLocaleString("zh-CN")}
                </div>
              ) : null}
              {guideItems.length ? (
                <section className="digital-display-guide" aria-label="导购推荐">
                  <div className="digital-display-guide-header">
                    <strong>为您推荐</strong>
                    <span>可查看资料或预约洽谈</span>
                  </div>
                  <div className="digital-display-guide-grid">
                    {guideItems.map((item) => (
                      <article key={item.id} className="digital-display-guide-item">
                        {item.image_url ? (
                          <img src={item.image_url} alt={item.name} loading="lazy" onError={(event) => { event.currentTarget.style.display = "none"; }} />
                        ) : null}
                        <div className="digital-display-guide-copy">
                          <strong>{item.name}</strong>
                          <p>{[item.exhibitor, item.booth_code].filter(Boolean).join(" · ") || "展品推荐"}</p>
                          {item.description ? <p>{item.description}</p> : null}
                          {Object.entries(item.compare).some(([, value]) => value) ? (
                            <div className="digital-display-guide-compare">
                              {Object.entries(item.compare).filter(([, value]) => value).map(([label, value]) => <span key={`${item.id}-${label}`}><b>{label}</b>{value}</span>)}
                            </div>
                          ) : null}
                          <div className="digital-display-guide-actions">
                            <button
                              type="button"
                              onClick={async () => {
                                if (!onRequestMaterial) return;
                                try {
                                  setMaterialQr(await onRequestMaterial(item.id));
                                } catch (error) {
                                  onNotify?.(error instanceof Error ? error.message : "资料二维码生成失败", "error");
                                }
                              }}
                              disabled={!onRequestMaterial}
                            >资料二维码</button>
                            <button type="button" onClick={() => { setLeadMessage(""); setLeadItem(item); }} disabled={!onSubmitLead}>预约洽谈</button>
                          </div>
                        </div>
                      </article>
                    ))}
                  </div>
                  {materialQr ? (
                    <div className="digital-display-guide-qr">
                      <div>
                        <strong>扫码获取资料</strong>
                        <p>二维码有效期至 {new Date(materialQr.expires_at).toLocaleString("zh-CN")}</p>
                        <a href={materialQr.url} target="_blank" rel="noreferrer">打开资料链接</a>
                      </div>
                      {materialQr.qr_data_url ? <img src={materialQr.qr_data_url} alt="资料二维码" /> : null}
                      <button type="button" onClick={() => setMaterialQr(null)}>关闭</button>
                    </div>
                  ) : null}
                </section>
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
                    if (suggestion === "预约洽谈" && guideItems[0] && onSubmitLead) {
                      setLeadMessage("");
                      setLeadItem(guideItems[0]);
                      return;
                    }
                    emitTouch("suggestion", suggestion);
                    onSend(suggestion);
                  }}
                  disabled={!live}
                >
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
          </section> : null}

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
              <strong>正在加载数字人</strong>
              <span>{queueInfo?.position ? `当前排队第 ${queueInfo.position} 位，请稍候` : "正在建立 WebRTC 视频通道"}</span>
              <div className="digital-display-loading-track" aria-hidden><i /></div>
            </div>
          ) : null}

          {leadItem ? (
            <div className="digital-display-lead-modal" role="dialog" aria-modal="true" aria-label="预约洽谈">
              <form className="digital-display-lead-form" onSubmit={submitLead}>
                <div className="digital-display-lead-heading">
                  <div>
                    <span>预约洽谈</span>
                    <strong>{leadItem.name}</strong>
                  </div>
                  <button type="button" onClick={() => setLeadItem(null)} aria-label="关闭预约表单">×</button>
                </div>
                <label>单位<input value={leadForm.companyName} onChange={(event) => setLeadForm((form) => ({ ...form, companyName: event.target.value }))} placeholder="请输入单位名称" /></label>
                <label>联系人<input value={leadForm.contactName} onChange={(event) => setLeadForm((form) => ({ ...form, contactName: event.target.value }))} placeholder="请输入联系人" /></label>
                <label>手机号<input value={leadForm.phone} onChange={(event) => setLeadForm((form) => ({ ...form, phone: event.target.value }))} placeholder="请输入手机号" inputMode="tel" /></label>
                <label>邮箱（选填）<input value={leadForm.email} onChange={(event) => setLeadForm((form) => ({ ...form, email: event.target.value }))} placeholder="请输入邮箱" type="email" /></label>
                <label className="digital-display-lead-consent"><input type="checkbox" checked={leadForm.consent} onChange={(event) => setLeadForm((form) => ({ ...form, consent: event.target.checked }))} />同意授权展会方联系我</label>
                {leadMessage ? <p className="digital-display-lead-message" role="status">{leadMessage}</p> : null}
                <button className="digital-display-lead-submit" type="submit" disabled={leadSaving}>{leadSaving ? "提交中..." : "提交预约"}</button>
              </form>
            </div>
          ) : null}

        </SceneStage>
      </div>
    </main>
  );
}
