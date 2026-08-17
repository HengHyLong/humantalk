import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from "react";
import type {
  AvatarSummary,
  ClientRendererDescriptor,
  NavigationResult,
  SceneBackgroundAsset,
  SceneComposition,
  VoiceIntent,
} from "../lib/api";
import { buildApiUrl } from "../lib/api";
import { isEnglishConversation, type ConversationLanguage } from "../lib/conversationLanguage";
import type { TtsProviderExtended } from "../constants/ttsBailian";
import type { ConnectionStatus, Message } from "../types";
import { ChatInput } from "./ChatInput";
import { ExhibitionEntityCard } from "./ExhibitionEntityCard";
import { SceneStage } from "./SceneStage";

const PRESENTATION_AUTO_CLOSE_MS = 45_000;
const CONVERSATION_IDLE_HIDE_MS = 45_000;

function navigationImageUrl(value: string): string {
  const url = value.trim();
  return url.startsWith("/scene-assets/") ? buildApiUrl(url) : url;
}

type DigitalHumanDisplayProps = {
  videoRef: RefObject<HTMLVideoElement>;
  videoStream?: MediaStream | null;
  scene?: SceneComposition | null;
  backgrounds: SceneBackgroundAsset[];
  subtitle?: string | null;
  avatarMaskUrl?: string | null;
  clientRenderer?: ClientRendererDescriptor | null;
  connection: ConnectionStatus;
  isSpeaking: boolean;
  avatar: AvatarSummary | null;
  modelLabel: string;
  messages: Message[];
  queueInfo?: { position: number; message: string } | null;
  onStart: () => void;
  onSend: (text: string) => void;
  onInterrupt: () => void;
  onSpeakAudio?: (blob: Blob) => void | Promise<void>;
  onSpeakAudioStreamResult?: (payload: { text: string }) => void | Promise<void>;
  onSpeakAudioStreamError?: (message: string) => void;
  streamingAsrSessionId?: string | null;
  deferSpeak?: boolean;
  onNotify?: (message: string, tone?: "info" | "success" | "error") => void;
  ttsProvider?: TtsProviderExtended;
  sttProvider?: string;
  edgeVoice?: string;
  qwenModel?: string;
  qwenVoice?: string;
  navigationResult?: NavigationResult | null;
  onCloseNavigation?: () => void;
  shoppingRegistration?: { title: string; url: string; qrDataUrl: string } | null;
  onCloseShoppingRegistration?: () => void;
  onCloseEntity?: (entityId: string) => void;
  onAutoClosePresentation?: () => void;
  voiceIntent?: VoiceIntent | null;
  exhibitionConfigNotice?: string | null;
  language: ConversationLanguage;
  onLanguageChange: (language: ConversationLanguage) => void;
};

const languages: Array<{ value: ConversationLanguage; label: string }> = [{ value: "zh-CN", label: "中文" }, { value: "en-US", label: "English" }];

export function DigitalHumanDisplay({
  videoRef,
  videoStream = null,
  scene = null,
  backgrounds,
  subtitle,
  avatarMaskUrl = null,
  clientRenderer = null,
  connection,
  isSpeaking,
  avatar,
  modelLabel,
  messages,
  queueInfo,
  onStart,
  onSend,
  onInterrupt,
  onSpeakAudio,
  onSpeakAudioStreamResult,
  onSpeakAudioStreamError,
  streamingAsrSessionId = null,
  deferSpeak = false,
  onNotify,
  ttsProvider = "edge",
  sttProvider = "",
  edgeVoice = "",
  qwenModel = "",
  qwenVoice = "",
  navigationResult = null,
  onCloseNavigation,
  shoppingRegistration = null,
  onCloseShoppingRegistration,
  onCloseEntity,
  onAutoClosePresentation,
  voiceIntent = null,
  exhibitionConfigNotice = null,
  language,
  onLanguageChange,
}: DigitalHumanDisplayProps) {
  const [draft, setDraft] = useState("");
  const [inputMode, setInputMode] = useState<"voice" | "keyboard">("voice");
  const [presentationActivity, setPresentationActivity] = useState(0);
  const [conversationActivity, setConversationActivity] = useState(0);
  const [conversationVisible, setConversationVisible] = useState(true);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const [latestRoundHeight, setLatestRoundHeight] = useState<number | null>(null);
  const chatFeedRef = useRef<HTMLDivElement>(null);
  const chatFeedContentRef = useRef<HTMLDivElement>(null);
  const latestRoundRef = useRef<HTMLDivElement>(null);
  const shouldStickToBottomRef = useRef(true);
  const live = connection === "live" || connection === "expiring";
  const busy = connection === "connecting" || connection === "queued";
  const english = isEnglishConversation(language);
  const suggestions = english ? ["Venue navigation", "Book a meeting", "Conference services", "About the exhibition"] : ["展馆导航", "预约洽谈", "会议服务", "关于展览"];
  const displaySubtitle = subtitle?.trim() || (messages.length === 0 ? (english ? "You can ask me the following questions" : "你可以问我以下问题哦") : "");
  const presentationMessages = messages.slice(-5);
  const visibleEntityPresentationKey = presentationMessages
    .flatMap((message) => message.relatedEntities ?? [])
    .map((entity) => `${entity.kind}:${entity.id}`)
    .sort()
    .join("|");
  const presentationKey = shoppingRegistration
    ? `registration:${shoppingRegistration.url}`
    : navigationResult
      ? `navigation:${navigationResult.route_id || navigationResult.title || navigationResult.spoken_text}`
      : visibleEntityPresentationKey
        ? `entities:${visibleEntityPresentationKey}`
        : "";
  const latestVisibleMessage = messages[messages.length - 1];
  const showLiveSubtitle = Boolean(
    subtitle?.trim()
      && !(latestVisibleMessage?.role === "assistant" && latestVisibleMessage.text.trim() === subtitle.trim()),
  );
  const latestConversationMessage = messages[messages.length - 1];
  const conversationRounds = messages.reduce<Message[][]>((rounds, message) => {
    if (message.role === "user" || rounds.length === 0) rounds.push([message]);
    else rounds[rounds.length - 1].push(message);
    return rounds;
  }, []);
  const conversationActivityKey = [
    messages.length,
    latestConversationMessage?.id ?? "",
    latestConversationMessage?.text ?? "",
    subtitle?.trim() ?? "",
  ].join(":");
  const chatFeedStyle = latestRoundHeight == null
    ? undefined
    : ({ "--digital-display-latest-round-height": `${latestRoundHeight}px` } as CSSProperties);

  const updateScrollToBottomVisibility = useCallback(() => {
    const feed = chatFeedRef.current;
    if (!feed) return;
    const distanceFromBottom = feed.scrollHeight - feed.scrollTop - feed.clientHeight;
    const isNearBottom = distanceFromBottom <= 36;
    shouldStickToBottomRef.current = isNearBottom;
    setShowScrollToBottom(!isNearBottom);
  }, []);

  const scrollChatToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
    const feed = chatFeedRef.current;
    if (!feed) return;
    shouldStickToBottomRef.current = true;
    feed.scrollTo({ top: feed.scrollHeight, behavior });
    setShowScrollToBottom(false);
  }, []);

  const revealConversation = useCallback(() => {
    setConversationVisible(true);
    setConversationActivity((value) => value + 1);
    window.requestAnimationFrame(() => scrollChatToBottom("smooth"));
  }, [scrollChatToBottom]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      scrollChatToBottom("smooth");
    });
    return () => window.cancelAnimationFrame(frame);
  }, [messages, navigationResult, scrollChatToBottom, shoppingRegistration, subtitle]);

  useEffect(() => {
    const feed = chatFeedRef.current;
    const content = chatFeedContentRef.current;
    if (!feed || !content || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      if (shouldStickToBottomRef.current) scrollChatToBottom("smooth");
    });
    observer.observe(content);
    return () => observer.disconnect();
  }, [scrollChatToBottom]);

  useLayoutEffect(() => {
    const latestRound = latestRoundRef.current;
    if (!latestRound) {
      setLatestRoundHeight(null);
      return;
    }
    const updateHeight = () => {
      const measuredHeight = Math.ceil(latestRound.getBoundingClientRect().height) + 4;
      setLatestRoundHeight((current) => current === measuredHeight ? current : measuredHeight);
    };
    updateHeight();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(updateHeight);
    observer.observe(latestRound);
    return () => observer.disconnect();
  }, [conversationActivityKey, showLiveSubtitle]);

  useEffect(() => {
    setConversationVisible(true);
    const timer = window.setTimeout(() => {
      setConversationVisible(false);
      setShowScrollToBottom(false);
    }, CONVERSATION_IDLE_HIDE_MS);
    return () => window.clearTimeout(timer);
  }, [conversationActivity, conversationActivityKey]);

  useEffect(() => {
    if (!presentationKey || !onAutoClosePresentation) return;
    const timer = window.setTimeout(onAutoClosePresentation, PRESENTATION_AUTO_CLOSE_MS);
    return () => window.clearTimeout(timer);
  }, [onAutoClosePresentation, presentationActivity, presentationKey]);

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

          <aside className="digital-display-languages" aria-label={english ? "Language selection" : "语言选择"}>
            {languages.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => onLanguageChange(option.value)}
                className={language === option.value ? "is-active" : ""}
                aria-pressed={language === option.value}
              >
                {option.label}
              </button>
            ))}
          </aside>

          <section className={`digital-display-chat-panel ${conversationVisible ? "" : "is-conversation-hidden"}`} aria-label={english ? "Live conversation" : "实时对话"}>
            {!conversationVisible ? (
              <button type="button" className="digital-display-chat-reveal" onClick={revealConversation}>
                {english ? "Show conversation" : "查看历史对话"}
              </button>
            ) : null}
            <div className="digital-display-chat-heading">
              <span>{english ? "LIVE CONVERSATION" : "实时对话"}</span>
              <span className="digital-display-chat-state">
                {voiceIntent === "navigation" ? (english ? "Navigation" : "导航") : voiceIntent === "shopping" ? (english ? "Shopping assistant" : "虚拟导购") : voiceIntent === "exhibition_content" ? (english ? "Exhibition Q&A" : "展品问答") : ""}
                {isSpeaking ? (english ? " · Speaking" : " · 正在播报") : ""}
              </span>
            </div>
            <div ref={chatFeedRef} className="digital-display-chat-feed" style={chatFeedStyle} aria-live="polite" onScroll={updateScrollToBottomVisibility}>
              <div ref={chatFeedContentRef} className="digital-display-chat-feed-content">
              {exhibitionConfigNotice ? (
                <div className="digital-display-chat-notice" role="status">{exhibitionConfigNotice}</div>
              ) : null}
              {navigationResult ? (
                <article className="digital-display-navigation-card" onPointerDown={() => setPresentationActivity((value) => value + 1)}>
                  <button
                    type="button"
                    className="digital-display-card-close"
                    onClick={onCloseNavigation}
                    aria-label={english ? "Close navigation directions" : "关闭路线指引"}
                    title={english ? "Close navigation directions" : "关闭路线指引"}
                  >
                    ×
                  </button>
                  {navigationResult.image_url ? (
                    <img
                      src={navigationImageUrl(navigationResult.image_url)}
                      alt={navigationResult.title || (english ? "Navigation map" : "导航示意图")}
                      loading="lazy"
                      onError={(event) => { event.currentTarget.style.display = "none"; }}
                    />
                  ) : null}
                  <div className="digital-display-navigation-copy">
                    <strong>{navigationResult.title || (english ? "Navigation directions" : "导航指引")}</strong>
                    <p className="digital-display-navigation-summary">
                      {navigationResult.subtitle_text || navigationResult.spoken_text}
                    </p>
                    {navigationResult.route?.from || navigationResult.route?.to ? (
                      <p className="digital-display-navigation-route">
                        {navigationResult.route.from || (english ? "Current location" : "当前位置")}
                        {navigationResult.route.to ? ` → ${navigationResult.route.to}` : ""}
                        {navigationResult.route.estimated_minutes != null
                          ? english
                            ? ` · About ${navigationResult.route.estimated_minutes} min`
                            : ` · 约 ${navigationResult.route.estimated_minutes} 分钟`
                          : ""}
                      </p>
                    ) : null}
                    {navigationResult.route?.directions?.length ? (
                      <ol>
                        {navigationResult.route.directions.map((direction, index) => (
                          <li key={`${index}-${direction}`}>{direction}</li>
                        ))}
                      </ol>
                    ) : null}
                  </div>
                </article>
              ) : null}
              {messages.length === 0 && displaySubtitle ? (
                <div className="digital-display-chat-empty">{displaySubtitle}</div>
              ) : null}
              {conversationRounds.map((round, roundIndex) => {
                const isLatestRound = roundIndex === conversationRounds.length - 1;
                return (
                  <div
                    key={round[0]?.id ?? roundIndex}
                    ref={isLatestRound ? latestRoundRef : undefined}
                    className={`digital-display-chat-round ${isLatestRound ? "is-latest" : ""}`}
                  >
                    {round.map((message) => (
                      <div key={message.id} className={`digital-display-chat-line ${message.role === "user" ? "is-user" : "is-assistant"} ${message.relatedEntities?.length ? "has-entities" : ""}`}>
                        <div className="digital-display-chat-line-copy">
                          <span className="digital-display-chat-role">{message.role === "user" ? (english ? "Me" : "我") : (english ? "Digital Human" : "数字人")}</span>
                          <p>{message.text || (english ? "Preparing an answer…" : "正在准备回答…")}</p>
                        </div>
                      </div>
                    ))}
                    {isLatestRound && showLiveSubtitle ? (
                      <div className="digital-display-chat-line is-assistant is-live-line">
                        <span className="digital-display-chat-role">{english ? "Digital Human" : "数字人"}</span>
                        <p>{subtitle}</p>
                      </div>
                    ) : null}
                  </div>
                );
              })}
              {conversationRounds.length === 0 && showLiveSubtitle ? (
                <div ref={latestRoundRef} className="digital-display-chat-round is-latest">
                  <div className="digital-display-chat-line is-assistant is-live-line">
                    <span className="digital-display-chat-role">{english ? "Digital Human" : "数字人"}</span>
                    <p>{subtitle}</p>
                  </div>
                </div>
              ) : null}
              </div>
              {showScrollToBottom ? (
                <button type="button" className="digital-display-scroll-bottom" onClick={() => scrollChatToBottom("smooth")}>
                  <span aria-hidden>↓</span>
                  {english ? "Back to latest" : "回到底部"}
                </button>
              ) : null}
            </div>

            <div className="digital-display-chat-suggestions" aria-label={english ? "Suggested questions" : "常见问题"}>
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
                  deferSpeak={deferSpeak}
                  onInterrupt={onInterrupt}
                  isSpeaking={isSpeaking}
                  disabled={!live}
                  onNotify={onNotify}
                  ttsProvider={ttsProvider}
                  sttProvider={sttProvider}
                  edgeVoice={edgeVoice}
                  qwenModel={qwenModel}
                  qwenVoice={qwenVoice}
                  language={language}
                />
              ) : (
                <>
                  <input
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && !event.nativeEvent.isComposing) submit();
                    }}
                    placeholder={live ? (english ? "Type what you would like to know" : "请输入您想了解的内容") : (english ? "Connect to start asking questions" : "连接后即可开始提问")}
                    disabled={!live}
                    aria-label={english ? "Ask the digital human" : "向数字人提问"}
                  />
                  {live && isSpeaking ? (
                    <button type="button" className="digital-display-stop" onClick={onInterrupt}>{english ? "Interrupt" : "打断"}</button>
                  ) : (
                    <button type="button" className="digital-display-send" onClick={submit} disabled={!draft.trim() || !live}>{english ? "Send" : "发送"}</button>
                  )}
                </>
              )}
              <button
                type="button"
                className="digital-display-mode-toggle"
                onClick={() => setInputMode((mode) => mode === "voice" ? "keyboard" : "voice")}
                aria-label={inputMode === "voice" ? (english ? "Switch to keyboard input" : "切换为键盘输入") : (english ? "Switch to voice input" : "切换为语音输入")}
              >
                {inputMode === "voice" ? (english ? "Keyboard" : "键盘输入") : (english ? "Voice" : "语音输入")}
              </button>
            </div>
          </section>

          {shoppingRegistration || navigationResult || presentationMessages.some((message) => message.relatedEntities?.length) ? (
            <section
              className={`digital-display-waist-panel ${shoppingRegistration ? "is-registration" : ""}`}
              aria-label={shoppingRegistration ? (english ? "Registration QR code" : "登记二维码") : (english ? "Exhibition content" : "展会内容展示")}
              onPointerDown={() => setPresentationActivity((value) => value + 1)}
            >
              {shoppingRegistration ? (
                <article className="digital-display-registration-card" role="dialog" aria-modal="true" aria-label={english ? "Registration QR code" : "登记二维码"}>
                  <button type="button" onClick={onCloseShoppingRegistration} aria-label={english ? "Close registration QR code" : "关闭登记二维码"}>×</button>
                  <img src={shoppingRegistration.qrDataUrl} alt={english ? `${shoppingRegistration.title} registration QR code` : `${shoppingRegistration.title}登记二维码`} />
                  <div>
                    <strong>{shoppingRegistration.title}</strong>
                    <p>{english ? "Scan with your phone to register. Your submission will be added to lead management." : "请使用手机扫码登记，提交后信息将同步至线索运营。"}</p>
                    <a href={shoppingRegistration.url} target="_blank" rel="noreferrer">{english ? "Open the registration page" : "无法扫码时打开登记页"}</a>
                  </div>
                </article>
              ) : null}
              {!shoppingRegistration && navigationResult ? (
                <article className="digital-display-navigation-card">
                  <button
                    type="button"
                    className="digital-display-card-close"
                    onClick={onCloseNavigation}
                    aria-label={english ? "Close navigation directions" : "关闭路线指引"}
                    title={english ? "Close navigation directions" : "关闭路线指引"}
                  >
                    ×
                  </button>
                  {navigationResult.image_url ? (
                    <img
                      src={navigationImageUrl(navigationResult.image_url)}
                      alt={navigationResult.title || (english ? "Navigation map" : "导航示意图")}
                      loading="lazy"
                      onError={(event) => { event.currentTarget.style.display = "none"; }}
                    />
                  ) : null}
                  <div className="digital-display-navigation-copy">
                    <strong>{navigationResult.title || (english ? "Navigation directions" : "导航指引")}</strong>
                    <p className="digital-display-navigation-summary">
                      {navigationResult.subtitle_text || navigationResult.spoken_text}
                    </p>
                    {navigationResult.route?.from || navigationResult.route?.to ? (
                      <p className="digital-display-navigation-route">
                        {navigationResult.route.from || (english ? "Current location" : "当前位置")}
                        {navigationResult.route.to ? ` → ${navigationResult.route.to}` : ""}
                        {navigationResult.route.estimated_minutes != null
                          ? english
                            ? ` · About ${navigationResult.route.estimated_minutes} min`
                            : ` · 约 ${navigationResult.route.estimated_minutes} 分钟`
                          : ""}
                      </p>
                    ) : null}
                    {navigationResult.route?.directions?.length ? (
                      <ol>
                        {navigationResult.route.directions.map((direction, index) => (
                          <li key={`${index}-${direction}`}>{direction}</li>
                        ))}
                      </ol>
                    ) : null}
                  </div>
                </article>
              ) : null}
              {!shoppingRegistration && !navigationResult ? presentationMessages.flatMap((message) =>
                (message.relatedEntities ?? []).map((entity) => (
                  <ExhibitionEntityCard
                    key={`${message.id}-${entity.kind}-${entity.id}`}
                    entity={entity}
                    immersive
                    onClose={onCloseEntity ? () => onCloseEntity(entity.id) : undefined}
                    closeLabel={english ? `Close ${entity.name}` : `关闭${entity.name}介绍`}
                  />
                )),
              ) : null}
            </section>
          ) : null}

          {!live && !busy ? (
            <div className="digital-display-start-card">
              <p className="digital-display-eyebrow">{english ? "Sichuan Expo Group Digital Human · Live" : "四川博览集团数字人 · 实时推流"}</p>
              <h1>{busy ? (english ? "Preparing the digital human" : "数字人正在准备中") : connection === "error" ? (english ? "Live connection unavailable" : "推流暂时未连接") : (english ? "Welcome to the smart exhibition hall" : "欢迎来到智能展厅")}</h1>
              <p>
                {busy
                  ? queueInfo?.position
                    ? english ? `You are number ${queueInfo.position} in the queue. Please wait.` : `当前排队第 ${queueInfo.position} 位，请稍候。`
                    : english ? "Establishing a low-latency WebRTC video channel." : "正在建立 WebRTC 低延迟视频通道。"
                  : english ? "Connect to start real-time Q&A and exhibition navigation." : "连接四川博览集团数字人视频推流，开始实时问答与展览导览。"}
              </p>
              <button type="button" className="digital-display-start-button" onClick={onStart} disabled={busy}>
                {busy ? (english ? "Connecting..." : "连接中...") : connection === "error" ? (english ? "Reconnect" : "重新连接") : (english ? "Start" : "开始体验")}
              </button>
              <div className="digital-display-start-meta">
                <span>{avatar?.name ?? (english ? "Default digital human" : "默认数字人")}</span>
                <span>{modelLabel}</span>
              </div>
            </div>
          ) : null}

          {busy ? (
            <div className="digital-display-loading" role="status" aria-live="polite">
              <span className="digital-display-loader" aria-hidden />
              <strong>{english ? "Loading digital human" : "正在加载数字人"}</strong>
              <span>{queueInfo?.position ? (english ? `Queue position: ${queueInfo.position}` : `当前排队第 ${queueInfo.position} 位，请稍候`) : (english ? "Establishing WebRTC video channel" : "正在建立 WebRTC 视频通道")}</span>
              <div className="digital-display-loading-track" aria-hidden><i /></div>
            </div>
          ) : null}

        </SceneStage>
      </div>
    </main>
  );
}
