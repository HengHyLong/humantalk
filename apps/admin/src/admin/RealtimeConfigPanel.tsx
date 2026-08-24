import { useMemo, useState, type ReactNode } from "react";
import type { AvatarSummary, KnowledgeBaseSummary, VoiceCatalogItem } from "../lib/api";
import { EDGE_ZH_VOICES } from "../constants/edgeZhVoices";
import {
  COSYVOICE_MODEL_OPTIONS,
  COSYVOICE_VOICE_OPTIONS,
  LOCAL_COSYVOICE_MODEL_OPTIONS,
  LOCAL_F5_TTS_MODEL_OPTIONS,
  LOCAL_INDEXTTS_MODEL_OPTIONS,
  SAMBERT_MODEL_OPTIONS,
  XIAOMI_MIMO_MODEL_OPTIONS,
  XIAOMI_MIMO_VOICE_OPTIONS,
  type TtsProviderExtended,
} from "../constants/ttsBailian";
import { QWEN_TTS_MODEL_OPTIONS, QWEN_TTS_VOICE_OPTIONS, QWEN_VOICE_CLONE_TARGET_OPTIONS } from "../constants/ttsQwen";
import type { MemoryLibrary } from "../types";
import type { AgentConfig } from "../components/AvatarSelectionStage";
import type { ModelStatus } from "../lib/modelStatus";
import { modelLabel } from "../lib/modelLabels";

export type RuntimeProviderStatus = {
  key_set?: boolean;
  service_url_set?: boolean;
  model?: string;
};

export type RuntimeHealth = {
  tts_provider?: string;
  tts_default_provider?: string;
  tts_enabled_providers?: string[];
  tts_key_set?: boolean;
  tts_service_url_set?: boolean;
  stt_key_set?: boolean;
  tts_providers?: Record<string, RuntimeProviderStatus>;
  stt_providers?: Record<string, RuntimeProviderStatus>;
};

type Option = { id: string; label: string; targetModel?: string | null };

export type RealtimeConfigPanelProps = {
  avatar: AvatarSummary | null;
  models: ModelStatus[];
  model: string;
  onModelChange: (model: string) => void;
  knowledgeBases: KnowledgeBaseSummary[];
  agentConfig: AgentConfig;
  onAgentConfigChange: (config: AgentConfig) => void;
  memoryLibraries: MemoryLibrary[];
  selectedMemoryLibraryId: string | null;
  memoryEnabled: boolean;
  onMemoryLibrarySelect: (id: string | null) => void;
  onMemoryEnabledChange: (enabled: boolean) => void;
  asrProvider: string;
  onAsrProviderChange: (provider: string) => void;
  asrModel: string;
  ttsProvider: TtsProviderExtended;
  onTtsProviderChange: (provider: TtsProviderExtended) => void;
  ttsModel: string;
  onTtsModelChange: (model: string) => void;
  ttsVoice: string;
  onTtsVoiceChange: (voice: string) => void;
  voiceCatalog: VoiceCatalogItem[];
  onOpenVoiceClone?: () => void;
  health: RuntimeHealth | null;
  disabled?: boolean;
};

const PROVIDERS: Array<{ id: TtsProviderExtended; label: string; subtitle: string }> = [
  { id: "edge", label: "Edge", subtitle: "Neural" },
  { id: "dashscope", label: "Qwen", subtitle: "百炼 API" },
  { id: "cosyvoice", label: "CosyVoice", subtitle: "百炼" },
  { id: "sambert", label: "Sambert", subtitle: "百炼" },
  { id: "local_cosyvoice", label: "Local CosyVoice", subtitle: "本地模型" },
  { id: "indextts", label: "Local IndexTTS", subtitle: "本地部署" },
  { id: "local_f5_tts", label: "Local F5-TTS", subtitle: "本地模型" },
  { id: "xiaomi_mimo", label: "小米 MiMo", subtitle: "兼容 API" },
  { id: "openai_compatible", label: "OpenAI API", subtitle: "兼容接口" },
];

const ASR_PROVIDERS = [
  { id: "sensevoice", label: "SenseVoiceSmall", model: "iic/SenseVoiceSmall", local: true },
  { id: "dashscope", label: "API 语音识别", model: "paraformer-realtime-v2", local: false },
  { id: "xiaomi_mimo", label: "小米 MiMo 识别", model: "mimo-v2.5-asr", local: false },
  { id: "openai_compatible", label: "OpenAI API 识别", model: "OpenAI-compatible ASR", local: false },
];

export function realtimeTtsModels(provider: TtsProviderExtended): Option[] {
  if (provider === "dashscope") {
    const ids = new Set(QWEN_TTS_MODEL_OPTIONS.map((item) => item.id));
    return [...QWEN_TTS_MODEL_OPTIONS, ...QWEN_VOICE_CLONE_TARGET_OPTIONS.filter((item) => !ids.has(item.id))];
  }
  if (provider === "cosyvoice") return COSYVOICE_MODEL_OPTIONS;
  if (provider === "sambert") return SAMBERT_MODEL_OPTIONS;
  if (provider === "local_cosyvoice") return LOCAL_COSYVOICE_MODEL_OPTIONS;
  if (provider === "indextts") return LOCAL_INDEXTTS_MODEL_OPTIONS;
  if (provider === "local_f5_tts") return LOCAL_F5_TTS_MODEL_OPTIONS;
  if (provider === "xiaomi_mimo") return XIAOMI_MIMO_MODEL_OPTIONS;
  return [];
}

function staticVoicesForProvider(provider: TtsProviderExtended): Option[] {
  if (provider === "edge") return EDGE_ZH_VOICES;
  if (provider === "dashscope") return QWEN_TTS_VOICE_OPTIONS;
  if (provider === "cosyvoice") return COSYVOICE_VOICE_OPTIONS;
  if (provider === "xiaomi_mimo") return XIAOMI_MIMO_VOICE_OPTIONS;
  return [];
}

function catalogProvider(provider: TtsProviderExtended): string | null {
  if (["dashscope", "cosyvoice", "local_cosyvoice", "indextts", "local_f5_tts", "xiaomi_mimo"].includes(provider)) return provider;
  return null;
}

export function realtimeTtsVoices(provider: TtsProviderExtended, model: string, catalog: VoiceCatalogItem[]): Option[] {
  const base = staticVoicesForProvider(provider);
  const key = catalogProvider(provider);
  if (!key) return base;
  const ids = new Set(base.map((voice) => voice.id));
  const extras = catalog
    .filter((voice) => voice.provider === key && (!voice.target_model || voice.target_model === model))
    .filter((voice) => !ids.has(voice.voice_id))
    .map((voice) => ({ id: voice.voice_id, label: voice.source === "clone" ? `复刻 · ${voice.display_label}` : voice.display_label, targetModel: voice.target_model }));
  return [...base, ...extras];
}

function statusLabel(configured: boolean | undefined): { label: string; className: string } {
  if (configured === true) return { label: "已配置", className: "border-emerald-200 bg-emerald-50 text-emerald-700" };
  if (configured === false) return { label: "未配置", className: "border-rose-200 bg-rose-50 text-rose-700" };
  return { label: "待检测", className: "border-slate-200 bg-slate-50 text-slate-500" };
}

function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  const collapsible = title === "知识库" || title === "记忆库" || title === "驱动模型";
  const [open, setOpen] = useState(!collapsible);
  return <section className="rounded-xl border border-slate-200 bg-white shadow-sm"><div className="flex items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">{collapsible ? <button type="button" aria-expanded={open} onClick={() => setOpen((current) => !current)} className="flex min-w-0 items-center gap-2 text-left text-sm font-semibold text-slate-900"><span className="w-3 text-xs text-slate-400">{open ? "⌄" : "›"}</span><span>{title}</span></button> : <h3 className="text-sm font-semibold text-slate-900">{title}</h3>}{action}</div>{open ? <div className="p-3">{children}</div> : null}</section>;
}

function SelectField({ label, value, onChange, children, disabled = false }: { label: string; value: string; onChange: (value: string) => void; children: ReactNode; disabled?: boolean }) {
  return <label className="block text-xs font-semibold text-slate-600">{label}<select value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} className="mt-1.5 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs font-normal text-slate-700 outline-none focus:border-cyan-400 disabled:cursor-not-allowed disabled:bg-slate-50">{children}</select></label>;
}

export function RealtimeConfigPanel({
  avatar,
  models,
  model,
  onModelChange,
  knowledgeBases,
  agentConfig,
  onAgentConfigChange,
  memoryLibraries,
  selectedMemoryLibraryId,
  memoryEnabled,
  onMemoryLibrarySelect,
  onMemoryEnabledChange,
  asrProvider,
  onAsrProviderChange,
  asrModel,
  ttsProvider,
  onTtsProviderChange,
  ttsModel,
  onTtsModelChange,
  ttsVoice,
  onTtsVoiceChange,
  voiceCatalog,
  onOpenVoiceClone,
  health,
  disabled = false,
}: RealtimeConfigPanelProps) {
  const ttsModels = useMemo(() => realtimeTtsModels(ttsProvider), [ttsProvider]);
  const ttsVoices = useMemo(() => realtimeTtsVoices(ttsProvider, ttsModel, voiceCatalog), [ttsModel, ttsProvider, voiceCatalog]);
  const selectedAsr = ASR_PROVIDERS.find((provider) => provider.id === asrProvider) ?? ASR_PROVIDERS[0];
  const selectedTts = PROVIDERS.find((provider) => provider.id === ttsProvider) ?? PROVIDERS[0];
  const selectedModel = models.find((item) => item.id === model);
  const apiTtsStatus = health?.tts_providers?.[ttsProvider];
  const apiSttStatus = health?.stt_providers?.[asrProvider];
  const ttsProviderEnabled = !health?.tts_enabled_providers?.length || health.tts_enabled_providers.includes(ttsProvider);
  const ttsConfigured = !ttsProviderEnabled
    ? false
    : ttsProvider === "edge" || ttsProvider.startsWith("local_") || ttsProvider === "indextts"
      ? true
    : apiTtsStatus ? apiTtsStatus.key_set === true && (ttsProvider === "xiaomi_mimo" || ttsProvider === "openai_compatible" ? apiTtsStatus.service_url_set === true : true) : undefined;
  const sttConfigured = selectedAsr.local ? true : apiSttStatus ? apiSttStatus.key_set === true && (asrProvider === "xiaomi_mimo" || asrProvider === "openai_compatible" ? apiSttStatus.service_url_set === true : true) : undefined;
  const ttsBadge = statusLabel(ttsConfigured);
  const sttBadge = statusLabel(sttConfigured);

  return <aside className="flex min-h-0 w-full shrink-0 flex-col border-r border-slate-200 bg-slate-50/80 lg:w-[320px] lg:overflow-y-auto"><div className="shrink-0 border-b border-slate-200 bg-white px-4 py-4"><p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-cyan-600">实时测试配置</p><h2 className="mt-1 text-lg font-semibold text-slate-950">实时对话</h2><p className="mt-1 text-xs leading-5 text-slate-500">启动前确认模型、语音和知识能力均已完成后端配置。</p></div><div className="space-y-3 p-3">
    <Section title="数字人形象"><div className="rounded-lg border border-cyan-200 bg-cyan-50 px-3 py-2.5"><p className="truncate text-sm font-semibold text-slate-900">{avatar?.name || avatar?.id || "未选择形象"}</p><p className="mt-1 text-[11px] text-cyan-700">avatar_id：{avatar?.id || "-"}</p></div></Section>
    <Section title="知识库" action={<span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-semibold text-slate-500">{knowledgeBases.length} 个知识库</span>}><div className="space-y-1.5">{knowledgeBases.map((item) => { const selected = agentConfig.knowledgeBaseIds.includes(item.id); const ready = item.ready_document_count > 0; return <button key={item.id} type="button" disabled={disabled || !ready} onClick={() => { const ids = selected ? agentConfig.knowledgeBaseIds.filter((id) => id !== item.id) : [...agentConfig.knowledgeBaseIds, item.id]; onAgentConfigChange({ ...agentConfig, knowledgeEnabled: ids.length > 0, knowledgeBaseIds: ids }); }} className={`flex w-full items-center justify-between rounded-lg border px-2.5 py-2 text-left text-xs font-semibold ${selected ? "border-cyan-300 bg-cyan-50 text-cyan-800" : ready ? "border-slate-200 bg-white text-slate-700 hover:border-cyan-300" : "border-slate-100 bg-slate-50 text-slate-400"}`}><span className="min-w-0 truncate">{item.name}</span><span className="ml-2 shrink-0 text-[11px]">{selected ? "已选" : ready ? "已就绪" : item.error_document_count ? "异常" : "准备中"}</span></button>; })}{!knowledgeBases.length ? <p className="rounded-lg border border-dashed border-slate-200 bg-white px-3 py-2 text-xs text-slate-500">暂无知识库</p> : null}</div>{knowledgeBases.length ? <p className="mt-2 text-[11px] leading-4 text-slate-400">只会挂载已完成解析且有可用切片的知识库。</p> : null}</Section>
    <Section title="记忆库" action={<span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-semibold text-slate-500">{memoryLibraries.length} 个记忆库</span>}><div className="space-y-1.5">{memoryLibraries.map((item) => { const selected = memoryEnabled && selectedMemoryLibraryId === item.id; const ready = item.memory_count > 0; return <button key={item.id} type="button" disabled={disabled || !ready} onClick={() => { const next = selected ? null : item.id; onMemoryLibrarySelect(next); onMemoryEnabledChange(Boolean(next)); }} className={`flex w-full items-center justify-between rounded-lg border px-2.5 py-2 text-left text-xs font-semibold ${selected ? "border-cyan-300 bg-cyan-50 text-cyan-800" : ready ? "border-slate-200 bg-white text-slate-700 hover:border-cyan-300" : "border-slate-100 bg-slate-50 text-slate-400"}`}><span className="min-w-0 truncate">{item.name || item.id}</span><span className="ml-2 shrink-0 text-[11px]">{selected ? "已挂载" : ready ? `${item.memory_count} 条` : "空库"}</span></button>; })}{!memoryLibraries.length ? <p className="rounded-lg border border-dashed border-slate-200 bg-white px-3 py-2 text-xs text-slate-500">暂无记忆库</p> : null}</div></Section>
    <Section title="驱动模型" action={<span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${selectedModel?.connected || model === "mock" || model === "video" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-rose-200 bg-rose-50 text-rose-700"}`}>{model === "mock" ? "无需连接" : model === "video" ? "浏览器播放" : selectedModel?.connected ? "已连接" : "未连接"}</span>}><div className="space-y-1.5">{models.map((item) => <button type="button" key={item.id} disabled={disabled} onClick={() => onModelChange(item.id)} className={`flex w-full items-center justify-between rounded-lg border px-2.5 py-2 text-left text-xs font-semibold ${item.id === model ? "border-cyan-300 bg-cyan-50 text-cyan-800" : "border-slate-200 bg-white text-slate-700 hover:border-cyan-300"}`}><span>{modelLabel(item.id)}</span><span className={`text-[11px] ${item.id === "mock" || item.id === "video" || item.connected ? "text-emerald-600" : "text-rose-600"}`}>{item.id === "mock" ? "无需连接" : item.id === "video" ? "内置视频" : item.connected ? "已连接" : "未连接"}</span></button>)}{!models.length ? <p className="text-xs text-slate-500">暂无驱动模型</p> : null}</div></Section>
    <Section title="语音识别" action={<span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${sttBadge.className}`}>{sttBadge.label}</span>}><SelectField label="识别服务" value={asrProvider} onChange={onAsrProviderChange} disabled={disabled}>{ASR_PROVIDERS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</SelectField><div className="mt-2 rounded-lg bg-slate-50 px-2.5 py-2"><p className="text-[11px] text-slate-400">当前模型</p><p className="mt-0.5 text-xs font-semibold text-slate-700">{asrModel || selectedAsr.model}</p></div><p className="mt-2 text-[11px] leading-4 text-slate-400">连续语音和麦克风识别共用此 STT 配置。</p></Section>
    <Section title="语音合成" action={<div className="flex items-center gap-2"><span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${ttsBadge.className}`}>{ttsBadge.label}</span>{onOpenVoiceClone ? <button type="button" onClick={onOpenVoiceClone} className="text-xs font-semibold text-cyan-700 hover:text-cyan-600">复刻音色</button> : null}</div>}><SelectField label="TTS 服务" value={ttsProvider} onChange={(value) => onTtsProviderChange(value as TtsProviderExtended)} disabled={disabled}>{PROVIDERS.map((item) => <option key={item.id} value={item.id}>{item.label} · {item.subtitle}</option>)}</SelectField>{ttsModels.length ? <div className="mt-2"><SelectField label="模型" value={ttsModel} onChange={onTtsModelChange} disabled={disabled}>{ttsModels.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</SelectField></div> : null}{ttsVoices.length ? <div className="mt-2"><SelectField label="音色" value={ttsVoice} onChange={onTtsVoiceChange} disabled={disabled}>{ttsVoices.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</SelectField></div> : <p className="mt-2 rounded-lg border border-dashed border-amber-200 bg-amber-50 px-2.5 py-2 text-[11px] leading-4 text-amber-700">当前服务暂无可用音色，请先配置后端或完成音色复刻。</p>}<p className="mt-2 text-[11px] leading-4 text-slate-400">当前：{selectedTts.label} · {ttsVoice || "使用后端默认音色"}</p></Section>
  </div></aside>;
}
