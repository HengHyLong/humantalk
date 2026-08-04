import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiDelete, apiGet, apiPost, apiPostForm, buildApiUrl, getMemoryLibraries, type AvatarSummary, type KnowledgeBaseSummary, type VoiceCatalogItem } from "../lib/api";
import { connectSse } from "../lib/sse";
import { startPlayback, type PlaybackHandle } from "../lib/webrtc";
import { ChatInput } from "../components/ChatInput";
import { ChatMessages } from "../components/ChatMessages";
import { BailianVoiceClone } from "../components/BailianVoiceClone";
import { RealtimeConfigPanel, realtimeTtsModels, realtimeTtsVoices, type RuntimeHealth } from "./RealtimeConfigPanel";
import { adminApi } from "./api";
import type { AgentConfig } from "../components/AvatarSelectionStage";
import type { TtsProviderExtended } from "../constants/ttsBailian";
import type { VoiceCloneApplication } from "../lib/voiceCloneApply";
import type { MemoryLibrary, Message } from "../types";
import type { ModelStatus } from "../lib/modelStatus";

type ConnectionState = "idle" | "connecting" | "queued" | "live" | "error";
type ChatMessage = Message;
const MAX_CONVERSATION_MESSAGES = 36;

function keepRecentConversation(messages: ChatMessage[]): ChatMessage[] {
  return messages.length > MAX_CONVERSATION_MESSAGES
    ? messages.slice(-MAX_CONVERSATION_MESSAGES)
    : messages;
}

const ASR_MODELS: Record<string, string> = {
  dashscope: "paraformer-realtime-v2",
  xiaomi_mimo: "mimo-v2.5-asr",
  openai_compatible: "OpenAI-compatible ASR",
  sensevoice: "iic/SenseVoiceSmall",
};

const SUPPORTED_TTS_PROVIDERS: TtsProviderExtended[] = ["edge", "dashscope", "cosyvoice", "sambert", "local_cosyvoice", "indextts", "local_f5_tts", "xiaomi_mimo", "openai_compatible"];

function audioProviderConfigError({
  asrProvider,
  ttsProvider,
  health,
}: {
  asrProvider: string;
  ttsProvider: TtsProviderExtended;
  health: RuntimeHealth | null;
}): string | null {
  const missing: string[] = [];
  const sttStatus = health?.stt_providers?.[asrProvider];
  const ttsStatus = health?.tts_providers?.[ttsProvider];
  const apiStt = ["dashscope", "xiaomi_mimo", "openai_compatible"].includes(asrProvider);
  const apiTts = ["dashscope", "cosyvoice", "sambert", "xiaomi_mimo", "openai_compatible"].includes(ttsProvider);
  const enabledTtsProviders = health?.tts_enabled_providers;
  if (enabledTtsProviders?.length && !enabledTtsProviders.includes(ttsProvider)) {
    missing.push(`${ttsProvider} TTS 后端未配置或未启用`);
  }
  const sttConfigured = sttStatus?.key_set ?? health?.stt_key_set;
  const ttsConfigured = ttsStatus?.key_set ?? health?.tts_key_set;
  if (apiStt && (sttConfigured !== true || (["xiaomi_mimo", "openai_compatible"].includes(asrProvider) && sttStatus?.service_url_set !== true))) {
    missing.push(asrProvider === "dashscope" ? "API 语音识别" : asrProvider === "xiaomi_mimo" ? "小米 MiMo 语音识别" : "OpenAI API 语音识别");
  }
  if (apiTts && (ttsConfigured !== true || (["xiaomi_mimo", "openai_compatible"].includes(ttsProvider) && ttsStatus?.service_url_set !== true))) {
    missing.push(ttsProvider === "dashscope" ? "Qwen TTS" : ttsProvider === "cosyvoice" ? "CosyVoice TTS" : ttsProvider === "sambert" ? "Sambert TTS" : ttsProvider === "xiaomi_mimo" ? "小米 MiMo TTS" : "OpenAI API TTS");
  }
  return missing.length ? `${missing.join("、")}尚未完成后端配置，请先配置服务后再启动实时测试。` : null;
}

function isSttProviderReady(provider: string, health: RuntimeHealth | null): boolean {
  if (provider === "sensevoice") return true;
  const status = health?.stt_providers?.[provider];
  return status?.key_set === true
    && (!["xiaomi_mimo", "openai_compatible"].includes(provider) || status.service_url_set === true);
}

function textFromEvent(data: unknown): string | null {
  if (typeof data === "string") return data;
  if (!data || typeof data !== "object") return null;
  const record = data as Record<string, unknown>;
  for (const key of ["text", "content", "subtitle", "message", "detail"]) {
    if (typeof record[key] === "string" && record[key]) return record[key] as string;
  }
  return null;
}

export function RealtimeTestWorkspace({ initialAvatarId = "" }: { initialAvatarId?: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const playbackRef = useRef<PlaybackHandle | null>(null);
  const closeEventsRef = useRef<(() => void) | null>(null);
  const sessionRef = useRef<string | null>(null);
  const exhibitionSttModelRef = useRef<string | null>(null);
  const [avatars, setAvatars] = useState<AvatarSummary[]>([]);
  const [models, setModels] = useState<ModelStatus[]>([]);
  const [avatarId, setAvatarId] = useState("");
  const [model, setModel] = useState("mock");
  const [ttsProvider, setTtsProvider] = useState<TtsProviderExtended>("edge");
  const [ttsModel, setTtsModel] = useState("");
  const [ttsVoice, setTtsVoice] = useState("zh-CN-XiaoxiaoNeural");
  const [asrProvider, setAsrProvider] = useState("dashscope");
  const [asrModel, setAsrModel] = useState("paraformer-realtime-v2");
  const [health, setHealth] = useState<RuntimeHealth | null>(null);
  const [knowledgeBases, setKnowledgeBases] = useState<KnowledgeBaseSummary[]>([]);
  const [agentConfig, setAgentConfig] = useState<AgentConfig>({ memoryEnabled: false, knowledgeEnabled: false, knowledgeBaseIds: [] });
  const [memoryLibraries, setMemoryLibraries] = useState<MemoryLibrary[]>([]);
  const [memoryLibraryId, setMemoryLibraryId] = useState<string | null>(null);
  const [memoryEnabled, setMemoryEnabled] = useState(false);
  const [voiceCatalog, setVoiceCatalog] = useState<VoiceCatalogItem[]>([]);
  const [voiceCloneOpen, setVoiceCloneOpen] = useState(false);
  const [connection, setConnection] = useState<ConnectionState>("idle");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [events, setEvents] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [panelTab, setPanelTab] = useState<"chat" | "status" | "export">("chat");
  const requestedAvatarId = initialAvatarId || new URLSearchParams(window.location.search).get("avatarId") || "";
  const requestedExhibitionId = new URLSearchParams(window.location.search).get("exhibitionId") || "";
  const isAvatarDebug = Boolean(requestedAvatarId);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      apiGet<AvatarSummary[]>("/avatars"),
      apiGet<{ models: string[]; statuses?: ModelStatus[]; default_model?: string | null }>("/models"),
      apiGet<{ knowledge_base_summaries?: KnowledgeBaseSummary[]; knowledge_bases?: Array<string | KnowledgeBaseSummary> }>("/agent/knowledge-bases"),
      apiGet<RuntimeHealth>("/health"),
      apiGet<{ items: VoiceCatalogItem[] }>("/voices"),
    ]).then(([avatarResponse, modelResponse, knowledgeResponse, healthResponse, voiceResponse]) => {
      if (cancelled) return;
      setAvatars(avatarResponse);
      const statuses = modelResponse.statuses ?? (modelResponse.models ?? []).map((id) => ({ id, connected: true }));
      setModels(statuses);
      setAvatarId((current) => current || requestedAvatarId || avatarResponse[0]?.id || "");
      setModel((current) => current || modelResponse.default_model || statuses[0]?.id || "mock");
      const summaries = knowledgeResponse.knowledge_base_summaries ?? (knowledgeResponse.knowledge_bases ?? []).map((item) => typeof item === "string" ? { id: item, name: item, document_count: 0, ready_document_count: 0, error_document_count: 0, created_at: "", updated_at: "" } : item);
      setKnowledgeBases(summaries);
      setHealth(healthResponse);
      const enabledTtsProviders = healthResponse.tts_enabled_providers ?? [];
      const defaultTtsProvider = healthResponse.tts_default_provider;
      if (!requestedExhibitionId && defaultTtsProvider && SUPPORTED_TTS_PROVIDERS.includes(defaultTtsProvider as TtsProviderExtended) && (!enabledTtsProviders.length || enabledTtsProviders.includes(defaultTtsProvider))) {
        setTtsProvider(defaultTtsProvider as TtsProviderExtended);
      }
      setVoiceCatalog(voiceResponse.items ?? []);
    }).catch((caught) => {
      if (!cancelled) setError(caught instanceof Error ? caught.message : "无法连接 OpenTalking API，请确认 Unified 服务已启动。");
    });
    return () => { cancelled = true; };
  }, [requestedAvatarId]);

  useEffect(() => {
    if (!requestedExhibitionId) return;
    let cancelled = false;
    void adminApi.listExhibitions().then((exhibitions) => {
      if (cancelled) return;
      const exhibition = exhibitions.find((item) => item.id === requestedExhibitionId);
      if (!exhibition) return;
      if (exhibition.boundAvatarId) setAvatarId(exhibition.boundAvatarId);
      if (exhibition.boundModel) setModel(exhibition.boundModel);
      if (exhibition.boundVoiceProvider && SUPPORTED_TTS_PROVIDERS.includes(exhibition.boundVoiceProvider as TtsProviderExtended)) setTtsProvider(exhibition.boundVoiceProvider as TtsProviderExtended);
      if (exhibition.boundVoiceModel) setTtsModel(exhibition.boundVoiceModel);
      if (exhibition.boundVoiceId) setTtsVoice(exhibition.boundVoiceId);
      if (exhibition.boundSttProvider) setAsrProvider(exhibition.boundSttProvider);
      if (exhibition.boundSttModel) {
        exhibitionSttModelRef.current = exhibition.boundSttModel;
        setAsrModel(exhibition.boundSttModel);
      }
      if (exhibition.knowledgeBaseIds.length) setAgentConfig((current) => ({ ...current, knowledgeEnabled: true, knowledgeBaseIds: exhibition.knowledgeBaseIds }));
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [requestedExhibitionId]);

  useEffect(() => {
    if (!avatarId) {
      setMemoryLibraries([]);
      setMemoryLibraryId(null);
      setMemoryEnabled(false);
      return;
    }
    void getMemoryLibraries("default", avatarId).then((response) => {
      setMemoryLibraries(response.items ?? []);
      setMemoryLibraryId((current) => current && response.items.some((item) => item.id === current) ? current : null);
      setMemoryEnabled((current) => Boolean(current && response.items.some((item) => item.id === memoryLibraryId)));
    }).catch(() => {
      setMemoryLibraries([]);
      setMemoryLibraryId(null);
      setMemoryEnabled(false);
    });
  }, [avatarId]);

  useEffect(() => {
    const configuredModel = exhibitionSttModelRef.current;
    exhibitionSttModelRef.current = null;
    setAsrModel(configuredModel || ASR_MODELS[asrProvider] || "");
  }, [asrProvider]);

  useEffect(() => {
    const options = realtimeTtsModels(ttsProvider);
    if (ttsProvider === "edge" || ttsProvider === "openai_compatible") {
      setTtsModel("");
      return;
    }
    setTtsModel((current) => options.some((item) => item.id === current) ? current : options[0]?.id ?? "");
  }, [ttsProvider]);

  useEffect(() => {
    const voices = realtimeTtsVoices(ttsProvider, ttsModel, voiceCatalog);
    setTtsVoice((current) => voices.some((item) => item.id === current) ? current : voices[0]?.id ?? "");
  }, [ttsModel, ttsProvider, voiceCatalog]);

  const appendEvent = useCallback((event: string, data: unknown) => {
    const detail = textFromEvent(data);
    setEvents((current) => [`${new Date().toLocaleTimeString()} · ${event}${detail ? ` · ${detail}` : ""}`, ...current].slice(0, 24));
    if (event === "speech.ended" || event === "session.stopped" || event === "error") setIsSpeaking(false);
    if (detail && (event === "subtitle.chunk" || event === "speech.ended" || event === "message")) {
      setMessages((current) => {
        const last = current[current.length - 1];
        if (last?.role === "assistant" && last.text === "正在生成回答…") {
          return keepRecentConversation([...current.slice(0, -1), { ...last, text: detail }]);
        }
        return keepRecentConversation([...current, { id: `${Date.now()}-${Math.random()}`, role: "assistant", text: detail, timestamp: Date.now() }]);
      });
    }
  }, []);

  const stopSession = useCallback(async () => {
    closeEventsRef.current?.();
    closeEventsRef.current = null;
    playbackRef.current?.pc.close();
    playbackRef.current = null;
    const sid = sessionRef.current;
    sessionRef.current = null;
    setSessionId(null);
    setConnection("idle");
    if (sid) {
      try { await apiDelete(`/sessions/${encodeURIComponent(sid)}`); } catch { /* session may already be gone */ }
    }
  }, []);

  useEffect(() => () => { void stopSession(); }, [stopSession]);

  const startSession = useCallback(async () => {
    if (!avatarId || !videoRef.current) {
      setError("请先选择一个数字人形象。");
      return;
    }
    const mockCanSkipStt = model === "mock" && !isSttProviderReady(asrProvider, health);
    const configError = audioProviderConfigError({ asrProvider: mockCanSkipStt ? "sensevoice" : asrProvider, ttsProvider, health });
    if (configError) {
      setError(configError);
      setConnection("idle");
      return;
    }
    setError("");
    setConnection("connecting");
    try {
      const created = await apiPost<{ session_id: string; status: string }>("/sessions", {
        avatar_id: avatarId,
        model,
        tts_provider: ttsProvider,
        stt_provider: mockCanSkipStt ? undefined : asrProvider,
        tts_voice: ttsVoice || undefined,
        tts_model: ttsModel || undefined,
        user_id: "admin-test-user",
        agent_enabled: agentConfig.memoryEnabled || agentConfig.knowledgeEnabled || (memoryEnabled && Boolean(memoryLibraryId)),
        memory_enabled: agentConfig.memoryEnabled || (memoryEnabled && Boolean(memoryLibraryId)),
        memory_profile_id: "default",
        memory_library_id: memoryEnabled && memoryLibraryId ? memoryLibraryId : undefined,
        knowledge_enabled: agentConfig.knowledgeEnabled,
        knowledge_base_ids: agentConfig.knowledgeBaseIds,
        knowledge_base_id: agentConfig.knowledgeBaseIds[0] || "",
        character_id: avatarId,
      });
      sessionRef.current = created.session_id;
      setSessionId(created.session_id);
      if (created.status === "queued") setConnection("queued");
      const playback = await startPlayback(created.session_id, videoRef.current);
      playbackRef.current = playback;
      closeEventsRef.current = connectSse(buildApiUrl(`/sessions/${created.session_id}/events`), appendEvent);
      await apiPost(`/sessions/${created.session_id}/start`, {});
      setConnection("live");
      setEvents((current) => [`${new Date().toLocaleTimeString()} · session.live`, ...current]);
    } catch (caught) {
      setConnection("error");
      setError(caught instanceof Error ? caught.message : "实时会话启动失败，请查看服务日志。");
      await stopSession();
    }
  }, [agentConfig, appendEvent, asrProvider, avatarId, health, memoryEnabled, memoryLibraryId, model, stopSession, ttsModel, ttsProvider, ttsVoice]);

  const sendMessage = useCallback(async (message: string) => {
    const text = message.trim();
    const sid = sessionRef.current;
    if (!text || !sid || connection !== "live") return;
    setIsSpeaking(true);
    setMessages((current) => keepRecentConversation([
      ...current,
      { id: `${Date.now()}-user`, role: "user", text, timestamp: Date.now() },
      { id: `${Date.now()}-pending`, role: "assistant", text: "正在生成回答…", timestamp: Date.now() },
    ]));
    try {
      await apiPost(`/sessions/${encodeURIComponent(sid)}/speak`, { text, tts_provider: ttsProvider, voice: ttsVoice, tts_model: ttsModel || undefined });
    } catch {
      setIsSpeaking(false);
      setMessages((current) => keepRecentConversation([...current, { id: `${Date.now()}-error`, role: "assistant", text: "发送失败，请检查当前会话状态。", timestamp: Date.now() }]));
    }
  }, [connection, ttsModel, ttsProvider, ttsVoice]);

  const speakAudio = useCallback(async (blob: Blob) => {
    const sid = sessionRef.current;
    if (!sid || connection !== "live") return;
    const form = new FormData();
    form.set("file", blob, "speech.webm");
    form.set("voice", ttsVoice);
    form.set("tts_provider", ttsProvider);
    form.set("stt_provider", asrProvider);
    if (ttsModel) form.set("tts_model", ttsModel);
    try {
      const result = await apiPostForm<{ text?: string }>(`/sessions/${encodeURIComponent(sid)}/speak_audio`, form);
      const recognizedText = result.text;
      if (typeof recognizedText === "string" && recognizedText) setMessages((current) => keepRecentConversation([...current, { id: `${Date.now()}-audio`, role: "user", text: recognizedText, timestamp: Date.now() }]));
    } catch {
      setError("语音识别失败，请检查当前会话和语音服务状态。");
    }
  }, [asrProvider, connection, ttsModel, ttsProvider, ttsVoice]);

  const interruptSession = useCallback(() => {
    const sid = sessionRef.current;
    setIsSpeaking(false);
    if (sid) void apiPost(`/sessions/${encodeURIComponent(sid)}/interrupt`, {}).catch(() => {});
  }, []);

  const selectedAvatar = useMemo(() => avatars.find((avatar) => avatar.id === avatarId), [avatarId, avatars]);
  const applyClonedVoice = useCallback(async (application: VoiceCloneApplication) => {
    setVoiceCatalog((current) => current.some((item) => item.provider === application.provider && item.voice_id === application.voice) ? current : [...current, { id: Date.now(), user_id: 1, provider: application.provider, voice_id: application.voice, display_label: application.displayLabel, target_model: application.model, source: "clone" }]);
    setTtsProvider(application.provider);
    setTtsModel(application.model);
    setTtsVoice(application.voice);
    setVoiceCloneOpen(false);
  }, []);
  const startupLoading = connection === "connecting" || connection === "queued";
  const startupLabel = connection === "queued" ? "实时会话排队中" : "正在连接实时数字人";

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-[#f3f7f9] lg:flex-row">
      <RealtimeConfigPanel
        avatar={selectedAvatar ?? null}
        models={models}
        model={model}
        onModelChange={setModel}
        knowledgeBases={knowledgeBases}
        agentConfig={agentConfig}
        onAgentConfigChange={setAgentConfig}
        memoryLibraries={memoryLibraries}
        selectedMemoryLibraryId={memoryLibraryId}
        memoryEnabled={memoryEnabled}
        onMemoryLibrarySelect={setMemoryLibraryId}
        onMemoryEnabledChange={setMemoryEnabled}
        asrProvider={asrProvider}
        onAsrProviderChange={(provider) => {
          setAsrProvider(provider);
          setAsrModel(ASR_MODELS[provider] ?? provider);
        }}
        asrModel={asrModel}
        ttsProvider={ttsProvider}
        onTtsProviderChange={(provider) => {
          setTtsProvider(provider);
          const nextModel = realtimeTtsModels(provider)[0]?.id ?? "";
          setTtsModel(nextModel);
          setTtsVoice(realtimeTtsVoices(provider, nextModel, voiceCatalog)[0]?.id ?? "");
        }}
        ttsModel={ttsModel}
        onTtsModelChange={setTtsModel}
        ttsVoice={ttsVoice}
        onTtsVoiceChange={setTtsVoice}
        voiceCatalog={voiceCatalog}
        onOpenVoiceClone={() => setVoiceCloneOpen(true)}
        health={health}
        disabled={Boolean(sessionId)}
      />
      <main className="min-w-0 flex-1 overflow-auto p-5">
        <div className="flex flex-col gap-5">
          <section className="relative flex min-h-[420px] max-h-[780px] items-center justify-center overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="absolute left-5 right-5 top-5 z-20 flex flex-wrap items-start justify-between gap-3">
              <div className="flex min-w-0 flex-wrap gap-2">
                <span className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-sm font-semibold text-slate-700 shadow-sm"><span className={`h-2 w-2 rounded-full ${connection === "live" ? "bg-emerald-500" : connection === "error" ? "bg-rose-500" : "bg-slate-300"}`} />{connection === "live" ? "已连接" : connection === "connecting" ? "连接中" : connection === "queued" ? "排队中" : connection === "error" ? "连接错误" : "未连接"}</span>
                <span className="inline-flex items-center rounded-full border border-cyan-200 bg-cyan-50 px-3 py-1.5 text-sm font-semibold text-cyan-700 shadow-sm">WebRTC 舞台</span>
                <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm font-semibold text-slate-600 shadow-sm">{model || "未选模型"}</span>
                <span className="inline-flex max-w-[14rem] truncate rounded-full border border-slate-200 bg-white px-3 py-1.5 text-sm font-semibold text-slate-600 shadow-sm">{selectedAvatar?.name || avatarId || "未选形象"}</span>
              </div>
              {isAvatarDebug ? <button type="button" onClick={() => window.history.back()} className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm transition hover:border-cyan-300 hover:text-cyan-700">更换形象</button> : null}
            </div>
            {selectedAvatar && !sessionId ? <img src={buildApiUrl(`/avatars/${encodeURIComponent(selectedAvatar.id)}/preview`)} alt={selectedAvatar.name || selectedAvatar.id} className="max-h-[720px] max-w-full object-contain" /> : null}
            <video ref={videoRef} autoPlay playsInline className={`max-h-[720px] max-w-full object-contain ${sessionId ? "opacity-100" : "pointer-events-none absolute opacity-0"}`} />
            {startupLoading ? <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-white/85 backdrop-blur-[2px]" role="status" aria-live="polite"><div className="flex h-14 w-14 items-center justify-center rounded-full border border-cyan-100 bg-cyan-50 shadow-sm"><span className="h-7 w-7 animate-spin rounded-full border-[3px] border-cyan-200 border-t-cyan-600" /></div><p className="mt-4 text-sm font-semibold text-slate-800">{startupLabel}</p><p className="mt-1 text-xs text-slate-500">数字人舞台正在准备，请稍候…</p></div> : null}
            {!selectedAvatar && !sessionId ? <div className="text-center text-slate-400"><p className="text-lg font-semibold text-slate-700">请选择数字人形象</p><p className="mt-2 text-sm">选择后即可启动实时测试。</p></div> : null}
            {sessionId ? <button type="button" onClick={() => void stopSession()} className="absolute bottom-5 right-5 z-20 rounded-xl border border-rose-200 bg-white px-4 py-2.5 text-sm font-semibold text-rose-600 shadow-sm hover:bg-rose-50">停止会话</button> : null}
          </section>

          {!sessionId ? <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-sm font-semibold text-slate-800">启动前配置</p><p className="mt-1 text-xs text-slate-500">请在左侧完成知识库、记忆库、驱动模型及语音服务选择。</p></div><div className="flex items-center gap-2"><label className="text-xs font-semibold text-slate-600">数字人<select value={avatarId} disabled={isAvatarDebug || startupLoading} onChange={(event) => setAvatarId(event.target.value)} className="ml-2 rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs font-normal disabled:bg-slate-50"><option value="">请选择形象</option>{avatars.map((avatar) => <option key={avatar.id} value={avatar.id}>{avatar.name || avatar.id}</option>)}</select></label><button type="button" disabled={startupLoading} onClick={() => void startSession()} className="rounded-xl bg-cyan-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-cyan-700 disabled:cursor-not-allowed disabled:bg-cyan-300">{startupLoading ? "正在启动…" : "启动测试"}</button></div></div>{error ? <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-600">{error}</p> : null}</section> : null}

          {sessionId ? <ChatInput onSend={(text) => void sendMessage(text)} onSpeakAudio={speakAudio} onSpeakFlashtalkAudioFile={speakAudio} onInterrupt={interruptSession} isSpeaking={isSpeaking} disabled={connection !== "live"} onNotify={(message) => setError(message)} ttsProvider={ttsProvider} sttProvider={asrProvider} edgeVoice={ttsProvider === "edge" ? ttsVoice : ""} qwenModel={ttsModel} qwenVoice={ttsProvider === "edge" ? "" : ttsVoice} /> : null}
        </div>
      </main>

      <aside className="flex min-h-0 max-h-[560px] w-full min-w-0 flex-col border-t border-slate-200 bg-white lg:h-[calc(100vh-72px)] lg:max-h-none lg:w-[360px] lg:border-l lg:border-t-0">
        <div className="border-b border-slate-200 px-5 pb-4 pt-5"><h2 className="text-xl font-semibold text-slate-700">会话面板</h2><div className="mt-4 grid grid-cols-3 gap-1 rounded-xl bg-slate-100 p-1">{([["chat", "对话"], ["status", "状态"], ["export", "导出"]] as const).map(([id, label]) => <button key={id} type="button" onClick={() => setPanelTab(id)} className={`rounded-lg px-3 py-2 text-sm font-semibold ${panelTab === id ? "bg-white text-cyan-700 shadow-sm" : "text-slate-500 hover:text-slate-800"}`}>{label}</button>)}</div></div>
        <div className="min-h-0 flex-1 overflow-hidden p-5">
          {panelTab === "chat" ? <ChatMessages messages={messages} maxVisible={MAX_CONVERSATION_MESSAGES} /> : null}
          {panelTab === "status" ? <div className="space-y-3 text-sm"><div className="rounded-xl bg-slate-50 p-3"><p className="text-xs text-slate-400">连接状态</p><p className="mt-1 font-semibold text-slate-800">{connection === "live" ? "已连接" : connection === "queued" ? "排队中" : connection === "connecting" ? "连接中" : connection === "error" ? "连接错误" : "未连接"}</p></div><div className="rounded-xl bg-slate-50 p-3"><p className="text-xs text-slate-400">当前形象</p><p className="mt-1 font-semibold text-slate-800">{selectedAvatar?.name || avatarId || "未选择"}</p></div><div className="rounded-xl bg-slate-50 p-3"><p className="text-xs text-slate-400">会话 ID</p><p className="mt-1 break-all font-mono text-xs text-slate-700">{sessionId || "未创建"}</p></div><div className="rounded-xl bg-slate-50 p-3"><p className="text-xs text-slate-400">实时事件</p><div className="mt-2 max-h-56 space-y-2 overflow-auto text-xs text-slate-500">{events.length ? events.map((event, index) => <p key={`${event}-${index}`}>{event}</p>) : <p>等待事件</p>}</div></div></div> : null}
          {panelTab === "export" ? <div className="flex h-full min-h-[260px] flex-col items-center justify-center rounded-xl border border-slate-200 bg-gradient-to-b from-white to-slate-50 p-6 text-center"><p className="text-sm font-semibold text-slate-800">暂无可导出内容</p><p className="mt-2 text-xs leading-5 text-slate-500">启动会话并完成对话后，可在这里接入录制和对话导出。</p></div> : null}
        </div>
      </aside>
      {voiceCloneOpen ? <><button type="button" aria-label="关闭音色复刻" onClick={() => setVoiceCloneOpen(false)} className="fixed inset-0 z-50 cursor-default bg-slate-950/30 backdrop-blur-sm" /><aside className="fixed inset-y-0 right-0 z-[51] flex w-[min(100vw,28rem)] shadow-2xl"><div className="h-full w-full overflow-y-auto border-l border-slate-200 bg-slate-50 p-4"><BailianVoiceClone onSuccess={applyClonedVoice} onClose={() => setVoiceCloneOpen(false)} /></div></aside></> : null}
    </div>
  );
}
