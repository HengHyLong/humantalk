import { useState, type FormEvent, type RefObject } from "react";
import type {
  AvatarSummary,
  ClientRendererDescriptor,
  GuideRecommendation,
  MaterialQrResponse,
  NavigationResult,
  SceneBackgroundAsset,
  SceneComposition,
  VoiceIntent,
} from "../lib/api";
import type { TtsProviderExtended } from "../constants/ttsBailian";
import type { ConnectionStatus, Message } from "../types";
import { ChatInput } from "./ChatInput";
import { SceneStage } from "./SceneStage";

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
  guideItems?: GuideRecommendation[];
  onRequestMaterial?: (itemId: string) => Promise<MaterialQrResponse>;
  onSubmitLead?: (input: { companyName: string; contactName: string; phone: string; email: string; intentSummary: string; interestedExhibitIds: string[]; consent: boolean }) => Promise<void>;
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
  guideItems = [],
  onRequestMaterial,
  onSubmitLead,
}: DigitalHumanDisplayProps) {
  const [activeLanguage, setActiveLanguage] = useState("中文");
  const [draft, setDraft] = useState("");
  const [inputMode, setInputMode] = useState<"voice" | "keyboard">("voice");
  const [leadItem, setLeadItem] = useState<GuideRecommendation | null>(null);
  const [materialQr, setMaterialQr] = useState<MaterialQrResponse | null>(null);
  const [leadSaving, setLeadSaving] = useState(false);
  const [leadMessage, setLeadMessage] = useState("");
  const [leadForm, setLeadForm] = useState({ companyName: "", contactName: "", phone: "", email: "", consent: false });
  const live = connection === "live" || connection === "expiring";
  const busy = connection === "connecting" || connection === "queued";
  const displaySubtitle = subtitle?.trim() || (messages.length === 0 ? "你可以问我以下问题哦" : "");
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

  const submitLead = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!leadItem || !onSubmitLead || !leadForm.companyName.trim() || !leadForm.contactName.trim() || !leadForm.phone.trim() || !leadForm.consent) {
      setLeadMessage("请填写单位、联系人、手机号并同意授权。 ");
      return;
    }
    setLeadSaving(true);
    setLeadMessage("");
    try {
      await onSubmitLead({ ...leadForm, companyName: leadForm.companyName.trim(), contactName: leadForm.contactName.trim(), phone: leadForm.phone.trim(), email: leadForm.email.trim(), intentSummary: `咨询${leadItem.name}`, interestedExhibitIds: [leadItem.id] });
      setLeadMessage("已提交，我们会尽快与您联系。 ");
      setLeadForm({ companyName: "", contactName: "", phone: "", email: "", consent: false });
    } catch (error) {
      setLeadMessage(error instanceof Error ? error.message : "提交失败，请稍后重试。 ");
    } finally {
      setLeadSaving(false);
    }
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
                {voiceIntent === "navigation" ? "导航" : voiceIntent === "shopping" ? "导购" : voiceIntent === "exhibition_content" ? "展品问答" : ""}
                {isSpeaking ? " · 正在播报" : ""}
              </span>
            </div>
            <div className="digital-display-chat-feed" aria-live="polite">
              {exhibitionConfigNotice ? (
                <div className="digital-display-chat-notice" role="status">{exhibitionConfigNotice}</div>
              ) : null}
              {navigationResult ? (
                <article className="digital-display-navigation-card">
                  {navigationResult.image_url ? (
                    <img
                      src={navigationResult.image_url}
                      alt={navigationResult.title || "导航示意图"}
                      loading="lazy"
                      onError={(event) => { event.currentTarget.style.display = "none"; }}
                    />
                  ) : null}
                  <div className="digital-display-navigation-copy">
                    <strong>{navigationResult.title || "导航指引"}</strong>
                    <p className="digital-display-navigation-summary">
                      {navigationResult.subtitle_text || navigationResult.spoken_text}
                    </p>
                    {navigationResult.route?.from || navigationResult.route?.to ? (
                      <p className="digital-display-navigation-route">
                        {navigationResult.route.from || "当前位置"}
                        {navigationResult.route.to ? ` → ${navigationResult.route.to}` : ""}
                        {navigationResult.route.estimated_minutes != null
                          ? ` · 约 ${navigationResult.route.estimated_minutes} 分钟`
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
                          <img
                            src={item.image_url}
                            alt={item.name}
                            loading="lazy"
                            onError={(event) => { event.currentTarget.style.display = "none"; }}
                          />
                        ) : null}
                        <div className="digital-display-guide-copy">
                          <strong>{item.name}</strong>
                          <p>{[item.exhibitor, item.booth_code].filter(Boolean).join(" · ") || "展品推荐"}</p>
                          {item.description ? <p>{item.description}</p> : null}
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
                            >
                              资料二维码
                            </button>
                            <button type="button" onClick={() => { setLeadMessage(""); setLeadItem(item); }} disabled={!onSubmitLead}>
                              预约洽谈
                            </button>
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
              {visibleMessages.length === 0 && displaySubtitle ? (
                <div className="digital-display-chat-empty">{displaySubtitle}</div>
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
