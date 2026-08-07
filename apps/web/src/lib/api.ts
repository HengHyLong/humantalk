import type { MemoryItem, MemoryLibrary, MemoryTurn, WeChatImportCommitResult, WeChatImportJob } from "../types";

export const API_BASE = import.meta.env.VITE_API_BASE ?? "api";
export const BUSINESS_API_BASE = import.meta.env.VITE_BUSINESS_API_BASE ?? "/business-api";
export const KNOWLEDGE_API_BASE = import.meta.env.VITE_KNOWLEDGE_API_BASE ?? "/knowledge-api";
export const DIFY_EXHIBITION_DATASET_ID = import.meta.env.VITE_DIFY_EXHIBITION_DATASET_ID
  ?? "7f264c49-557c-414b-9de6-833eb7eede08";
export const DIFY_NAMESPACE_ID = import.meta.env.VITE_DIFY_NAMESPACE_ID ?? "default";

export function buildApiUrl(path: string): string {
  const p = path.startsWith("/") ? path.slice(1) : path;
  return new URL(p, normalizedApiBase()).toString();
}

function normalizedServiceBase(base: string): URL {
  const normalized = base.endsWith("/") ? base : `${base}/`;
  if (typeof window === "undefined") {
    return new URL(normalized, "http://127.0.0.1:5173/");
  }
  return new URL(normalized, window.location.href);
}

export function buildServiceUrl(base: string, path: string): string {
  const p = path.startsWith("/") ? path.slice(1) : path;
  return new URL(p, normalizedServiceBase(base)).toString();
}

export function buildBusinessApiUrl(path: string): string {
  return buildServiceUrl(BUSINESS_API_BASE, path);
}

export function buildKnowledgeApiUrl(path: string): string {
  return buildServiceUrl(KNOWLEDGE_API_BASE, path);
}

export function buildApiDownloadUrl(path: string): string {
  return buildApiUrl(path);
}

/** WebSocket：相对 ``/api`` 走当前页 host；绝对 ``VITE_API_BASE`` 时与 HTTP 同机（与主仓一致） */
export function buildWsUrl(path: string): string {
  const p = path.startsWith("/") ? path : `/${path}`;
  if (typeof window === "undefined") {
    const apiBase = API_BASE.endsWith("/") ? API_BASE.slice(0, -1) : API_BASE;
    return `ws://127.0.0.1:5173/${apiBase}${p}`;
  }
  try {
    const baseUrl = new URL(normalizedApiBase());
    const wsProto = baseUrl.protocol === "https:" ? "wss:" : "ws:";
    const pathname = baseUrl.pathname.endsWith("/") ? baseUrl.pathname.slice(0, -1) : baseUrl.pathname;
    return `${wsProto}//${baseUrl.host}${pathname}${p}`;
  } catch {
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    const apiBase = API_BASE.endsWith("/") ? API_BASE.slice(0, -1) : API_BASE;
    return `${proto}//${window.location.host}/${apiBase}${p}`;
  }
}

function normalizedApiBase(): URL {
  const base = API_BASE.endsWith("/") ? API_BASE : `${API_BASE}/`;
  if (typeof window === "undefined") {
    return new URL(base, "http://127.0.0.1:5173/");
  }
  return new URL(base, window.location.href);
}

/** Rich error type so callers can show the FastAPI {"detail": "..."} message. */
export class ApiError extends Error {
  status: number;
  detail: string | null;
  body: string;
  constructor(status: number, detail: string | null, body: string) {
    super(detail || `HTTP ${status}: ${body}`);
    this.name = "ApiError";
    this.status = status;
    this.detail = detail;
    this.body = body;
  }
}

async function throwIfNotOk(r: Response): Promise<void> {
  if (r.ok) return;
  const body = await r.text();
  let detail: string | null = null;
  try {
    const parsed = JSON.parse(body);
    if (typeof parsed?.detail === "string") {
      detail = parsed.detail;
    } else if (Array.isArray(parsed?.detail)) {
      // FastAPI validation errors arrive as a list of {loc, msg, ...}
      detail = parsed.detail
        .map((d: { msg?: string }) => d?.msg ?? JSON.stringify(d))
        .join("; ");
    } else if (parsed?.detail != null) {
      detail = JSON.stringify(parsed.detail);
    }
  } catch {
    // body wasn't JSON; leave detail null
  }
  throw new ApiError(r.status, detail, body);
}

async function serviceGet<T>(base: string, path: string): Promise<T> {
  const r = await fetch(buildServiceUrl(base, path));
  await throwIfNotOk(r);
  return r.json() as Promise<T>;
}

async function servicePost<T>(base: string, path: string, body?: unknown): Promise<T> {
  const r = await fetch(buildServiceUrl(base, path), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  await throwIfNotOk(r);
  return r.json() as Promise<T>;
}

async function servicePostForm<T>(base: string, path: string, form: FormData, init?: RequestInit): Promise<T> {
  const r = await fetch(buildServiceUrl(base, path), { method: "POST", body: form, ...init });
  await throwIfNotOk(r);
  return r.json() as Promise<T>;
}

async function servicePatch<T>(base: string, path: string, body: unknown): Promise<T> {
  const r = await fetch(buildServiceUrl(base, path), {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  await throwIfNotOk(r);
  return r.json() as Promise<T>;
}

async function serviceDelete<T>(base: string, path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(buildServiceUrl(base, path), { ...init, method: "DELETE" });
  await throwIfNotOk(r);
  return r.json() as Promise<T>;
}

export function businessGet<T>(path: string): Promise<T> {
  return serviceGet<T>(BUSINESS_API_BASE, path);
}

export function businessPost<T>(path: string, body?: unknown): Promise<T> {
  return servicePost<T>(BUSINESS_API_BASE, path, body);
}

export function knowledgeGet<T>(path: string): Promise<T> {
  return serviceGet<T>(KNOWLEDGE_API_BASE, path);
}

export function knowledgePost<T>(path: string, body?: unknown): Promise<T> {
  return servicePost<T>(KNOWLEDGE_API_BASE, path, body);
}

export function knowledgePostForm<T>(path: string, form: FormData, init?: RequestInit): Promise<T> {
  return servicePostForm<T>(KNOWLEDGE_API_BASE, path, form, init);
}

export function knowledgePatch<T>(path: string, body: unknown): Promise<T> {
  return servicePatch<T>(KNOWLEDGE_API_BASE, path, body);
}

export function knowledgeDelete<T>(path: string, init?: RequestInit): Promise<T> {
  return serviceDelete<T>(KNOWLEDGE_API_BASE, path, init);
}

export type KnowledgeRagResult = {
  doc_id: string;
  text: string;
  score: number;
};

export type KnowledgeRagResponse = {
  available: boolean;
  indexed: boolean;
  reason: string;
  results: KnowledgeRagResult[];
};

export function queryExhibitionKnowledge(
  query: string,
  options: { limit?: number; datasetId?: string; namespaceId?: string } = {},
): Promise<KnowledgeRagResponse> {
  const datasetId = options.datasetId?.trim() || DIFY_EXHIBITION_DATASET_ID;
  const namespaceId = options.namespaceId?.trim() || DIFY_NAMESPACE_ID;
  const queryParams = new URLSearchParams({ namespace_id: namespaceId });
  return knowledgePost<KnowledgeRagResponse>(
    `/agent/knowledge-bases/${encodeURIComponent(datasetId)}/rag/query?${queryParams.toString()}`,
    { query, ...(options.limit != null ? { limit: options.limit } : {}) },
  );
}

export async function apiGet<T>(path: string): Promise<T> {
  const r = await fetch(buildApiUrl(path));
  await throwIfNotOk(r);
  return r.json() as Promise<T>;
}

export async function apiPost<T>(path: string, body?: unknown): Promise<T> {
  const r = await fetch(buildApiUrl(path), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  await throwIfNotOk(r);
  return r.json() as Promise<T>;
}

export async function apiPut<T, B = unknown>(path: string, body?: B): Promise<T> {
  const r = await fetch(buildApiUrl(path), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  await throwIfNotOk(r);
  return r.json() as Promise<T>;
}

export async function apiPostBlob(path: string, body?: unknown): Promise<Blob> {
  const r = await fetch(buildApiUrl(path), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  await throwIfNotOk(r);
  return r.blob();
}

export async function apiPostFormBlob(path: string, form: FormData, init?: RequestInit): Promise<Blob> {
  const r = await fetch(buildApiUrl(path), { method: "POST", body: form, ...init });
  await throwIfNotOk(r);
  return r.blob();
}

/** multipart/form-data（语音识别 speak_audio / transcribe） */
export async function apiPostForm<T>(path: string, form: FormData, init?: RequestInit): Promise<T> {
  const r = await fetch(buildApiUrl(path), { method: "POST", body: form, ...init });
  await throwIfNotOk(r);
  return r.json() as Promise<T>;
}

export async function apiUploadFile<T>(path: string, fieldName: string, file: File): Promise<T> {
  const form = new FormData();
  form.set(fieldName, file);
  return apiPostForm<T>(path, form);
}

export type RuntimeConfigLlm = {
  base_url: string;
  model: string;
  api_key_set: boolean;
};

export type RuntimeConfigStt = {
  provider: string;
  enabled_providers: string[];
  base_url: string;
  model: string;
  api_key_set: boolean;
  service_url_set: boolean;
};

export type RuntimeConfigTts = {
  provider: string;
  enabled_providers: string[];
  base_url: string;
  model: string;
  voice: string;
  api_key_set: boolean;
  service_url_set: boolean;
};

export type RuntimeConfigMem0Model = {
  provider: string;
  base_url: string;
  model: string;
  api_key_set: boolean;
};

export type RuntimeConfigMem0 = {
  llm: RuntimeConfigMem0Model;
  embedder: RuntimeConfigMem0Model;
};

export type RuntimeConfigResponse = {
  llm: RuntimeConfigLlm;
  stt: RuntimeConfigStt;
  tts: RuntimeConfigTts;
  mem0: RuntimeConfigMem0;
  applied?: boolean;
  requires_new_session?: boolean;
  live_runners_refreshed?: number;
};

export type RuntimeConfigApplyInput = {
  llm_base_url?: string;
  llm_model?: string;
  llm_api_key?: string;
  stt_provider?: string;
  stt_base_url?: string;
  stt_model?: string;
  stt_api_key?: string;
  tts_provider?: string;
  tts_base_url?: string;
  tts_model?: string;
  tts_voice?: string;
  tts_api_key?: string;
  mem0_llm_provider?: string;
  mem0_llm_base_url?: string;
  mem0_llm_api_key?: string;
  mem0_llm_model?: string;
  mem0_embedder_provider?: string;
  mem0_embedder_base_url?: string;
  mem0_embedder_api_key?: string;
  mem0_embedder_model?: string;
  sync_dashscope_api_key?: boolean;
};

export async function loadRuntimeConfig(): Promise<RuntimeConfigResponse> {
  return apiGet<RuntimeConfigResponse>("/runtime-config");
}

export async function applyRuntimeConfig(input: RuntimeConfigApplyInput): Promise<RuntimeConfigResponse> {
  return apiPost<RuntimeConfigResponse>("/runtime-config/apply", input);
}

export type ExportVideoKind = "realtime_dialogue" | "video_clone" | "video_creation";

export type ExportVideoItem = {
  id: string;
  kind: ExportVideoKind;
  title: string;
  duration_sec: number | null;
  size_bytes: number;
  mime_type: string;
  created_at: string;
  path: string;
  download_url: string;
  session_id: string | null;
  avatar_id: string | null;
  model: string | null;
};

export type UploadExportVideoInput = {
  blob: Blob;
  kind: ExportVideoKind;
  title: string;
  durationSec?: number | null;
  sessionId?: string | null;
  avatarId?: string | null;
  model?: string | null;
};

export function exportVideoExtensionForMimeType(mimeType: string): ".mp4" | ".webm" {
  const normalized = mimeType.split(";", 1)[0].trim().toLowerCase();
  if (normalized === "video/mp4") return ".mp4";
  if (normalized === "video/webm") return ".webm";
  return ".webm";
}

export async function uploadExportVideo(input: UploadExportVideoInput): Promise<ExportVideoItem> {
  const form = new FormData();
  form.set("file", input.blob, `${input.kind}${exportVideoExtensionForMimeType(input.blob.type)}`);
  form.set("kind", input.kind);
  form.set("title", input.title);
  if (input.durationSec != null) form.set("duration_sec", String(input.durationSec));
  if (input.sessionId) form.set("session_id", input.sessionId);
  if (input.avatarId) form.set("avatar_id", input.avatarId);
  if (input.model) form.set("model", input.model);
  return apiPostForm<ExportVideoItem>("/exports/videos", form);
}

export type SceneBackgroundAsset = {
  id: string;
  name: string;
  kind: "image" | "video";
  mime_type: string;
  filename: string;
  size_bytes: number;
  url: string;
  created_at: string;
};

export type SceneComposition = {
  id: string;
  name: string;
  avatar_id: string;
  background_id: string | null;
  background_color: string;
  avatar_fit: "contain" | "cover";
  avatar_scale: number;
  avatar_anchor: "center" | "bottom" | "left" | "right";
  matting_required: boolean;
  subtitle_style: "none" | "compact" | "lower-third";
  created_at: string;
  updated_at: string;
};

export type VoiceIntent = "navigation" | "exhibition_content" | "shopping";

export type ExhibitionVoiceConfig = {
  exhibition_id: string;
  keywords: {
    navigation: string[];
    exhibition_content: string[];
    shopping: string[];
  };
  supports_deferred_speak?: boolean;
};

export type NavigationResult = {
  matched?: boolean;
  fallback?: boolean;
  title?: string;
  spoken_text: string;
  subtitle_text?: string;
  image_url?: string | null;
  route?: {
    id?: string;
    from?: string;
    to?: string;
    directions?: string[];
    estimated_minutes?: number;
  };
  alternatives?: Array<{
    title: string;
    image_url?: string | null;
    route: {
      from?: string;
      to?: string;
      directions?: string[];
      estimated_minutes?: number;
    };
  }>;
};

export type ExhibitionVoiceConfigResponse = Partial<ExhibitionVoiceConfig> & {
  exhibitionId?: string;
  keyword_groups?: {
    navigation?: string[];
    exhibition_content?: string[];
    exhibitionContent?: string[];
    shopping?: string[];
  };
};

export type NavigationQueryResponse = NavigationResult;

export type GuideRecommendation = {
  id: string;
  name: string;
  category: string;
  description: string;
  tags: string[];
  image_url?: string | null;
  exhibitor: string;
  booth_code: string;
  score: number;
  compare: Record<string, string>;
  material_token?: string | null;
};

export type GuideRecommendationResponse = {
  exhibition_id: string;
  query: string;
  strategy: Record<string, unknown>;
  items: GuideRecommendation[];
};

type GuideRecommendationApiItem = {
  exhibitId: string;
  name: string;
  category: string;
  exhibitorId: string;
  exhibitorName: string;
  boothCode: string;
  imageUrl?: string | null;
  reason: string;
  materialToken?: string | null;
};

type GuideRecommendationApiResponse = {
  exhibition_id: string;
  strategy: Record<string, unknown>;
  recommendations?: GuideRecommendationApiItem[];
};

export type MaterialQrResponse = {
  exhibition_id?: string;
  material_id?: string;
  token: string;
  url: string;
  qr_data_url?: string | null;
  expires_at?: string | null;
  title?: string;
  type?: string;
  exhibit_id?: string | null;
  exhibit_name?: string | null;
};

type MaterialQrApiItem = {
  materialId: string;
  token: string;
  title: string;
  type: string;
  exhibitId: string;
  exhibitName: string;
  qrPath: string;
  qrUrl: string;
};

type MaterialQrApiResponse = {
  exhibition_id: string;
  items: MaterialQrApiItem[];
};

export type MaterialTokenResponse = {
  id?: string;
  material_id?: string;
  token: string;
  exhibition_id?: string;
  exhibit_id?: string | null;
  exhibit_name?: string | null;
  title?: string;
  type?: string;
  description?: string;
  url?: string;
  status?: string;
  created_at?: string;
  qr_path?: string;
  expires_at?: string | null;
  form_url?: string;
};

export async function getExhibitionVoiceConfig(exhibitionId?: string | null): Promise<ExhibitionVoiceConfigResponse> {
  const id = exhibitionId?.trim();
  const path = `/exhibitions/${encodeURIComponent(id || "current")}/digital-human-config`;
  return businessGet<ExhibitionVoiceConfigResponse>(path);
}

export async function queryExhibitionNavigation(
  exhibitionId: string | null | undefined,
  input: { text: string; session_id: string },
): Promise<NavigationQueryResponse> {
  const id = exhibitionId?.trim();
  const path = `/exhibitions/${encodeURIComponent(id || "current")}/navigation/query`;
  return businessPost<NavigationQueryResponse>(path, input);
}

export async function getExhibitionGuide(
  exhibitionId: string | null | undefined,
  query = "",
): Promise<GuideRecommendationResponse> {
  const id = exhibitionId?.trim();
  const path = `/exhibitions/${encodeURIComponent(id || "current")}/guide/recommendations?query=${encodeURIComponent(query)}`;
  const response = await businessGet<GuideRecommendationApiResponse>(path);
  return {
    exhibition_id: response.exhibition_id,
    query,
    strategy: response.strategy ?? {},
    items: (response.recommendations ?? []).map((item) => ({
      id: item.exhibitId,
      name: item.name,
      category: item.category,
      description: item.reason,
      tags: [item.category].filter(Boolean),
      image_url: item.imageUrl ?? null,
      exhibitor: item.exhibitorName || item.exhibitorId,
      booth_code: item.boothCode,
      score: 0,
      compare: {},
      material_token: item.materialToken ?? null,
    })),
  };
}

export async function getMaterialQr(
  exhibitionId: string | null | undefined,
  itemId?: string,
): Promise<MaterialQrResponse> {
  const id = exhibitionId?.trim();
  const response = await businessGet<MaterialQrApiResponse>(
    `/exhibitions/${encodeURIComponent(id || "current")}/materials/qr`,
  );
  const item = response.items.find((candidate) => (
    !itemId
      || candidate.materialId === itemId
      || candidate.exhibitId === itemId
      || candidate.token === itemId
  )) ?? response.items[0];
  if (!item) {
    throw new ApiError(404, "MATERIAL_NOT_FOUND", JSON.stringify(response));
  }
  const materialPath = item.qrUrl || item.qrPath || `/runtime/materials/${encodeURIComponent(item.token)}`;
  return {
    exhibition_id: response.exhibition_id,
    material_id: item.materialId,
    token: item.token,
    url: /^https?:\/\//i.test(materialPath) ? materialPath : buildBusinessApiUrl(materialPath),
    title: item.title,
    type: item.type,
    exhibit_id: item.exhibitId,
    exhibit_name: item.exhibitName,
    qr_data_url: null,
    expires_at: null,
  };
}

export function getMaterialToken(token: string): Promise<MaterialTokenResponse> {
  return businessGet<MaterialTokenResponse>(`/runtime/materials/${encodeURIComponent(token)}`);
}

export async function submitRuntimeLead(input: {
  exhibitionId: string;
  sessionId?: string | null;
  traceId?: string;
  companyName: string;
  contactName: string;
  phone: string;
  email?: string;
  intentSummary?: string;
  interestedExhibitIds?: string[];
  materialToken?: string;
  consent: boolean;
  source?: string;
}): Promise<Record<string, unknown>> {
  const intentParts = [
    input.intentSummary?.trim(),
    input.interestedExhibitIds?.length
      ? `interested_exhibit_ids=${input.interestedExhibitIds.join(",")}`
      : null,
  ].filter((value): value is string => Boolean(value));
  // 18302 RuntimeLeadBody currently has no materialToken field; keep it out of
  // the request until the backend publishes an explicit binding for that token.
  const body = {
    exhibitionId: input.exhibitionId,
    authorized: input.consent,
    contactName: input.contactName,
    phone: input.phone || null,
    email: input.email || null,
    companyName: input.companyName,
    intent: intentParts.join("; "),
    source: input.source ?? "web",
    ...(input.sessionId ? { sessionId: input.sessionId } : {}),
    ...(input.traceId ? { traceId: input.traceId } : {}),
  };
  return businessPost<Record<string, unknown>>("/api/v1/runtime/lead", body);
}

export async function transcribeSessionAudio(
  sessionId: string,
  file: Blob,
  sttProvider?: string,
): Promise<{ session_id: string; text: string }> {
  const form = new FormData();
  form.set("file", file, "speech.webm");
  if (sttProvider) form.set("stt_provider", sttProvider);
  return apiPostForm<{ session_id: string; text: string }>(`/sessions/${encodeURIComponent(sessionId)}/transcribe`, form);
}

export type CreateSceneCompositionInput = {
  name: string;
  avatar_id: string;
  background_id?: string | null;
  background_color?: string;
  avatar_fit?: "contain" | "cover";
  avatar_scale?: number;
  avatar_anchor?: "center" | "bottom" | "left" | "right";
  matting_required?: boolean;
  subtitle_style?: "none" | "compact" | "lower-third";
};

export async function listSceneBackgrounds(): Promise<{ items: SceneBackgroundAsset[] }> {
  return apiGet<{ items: SceneBackgroundAsset[] }>("/scene-assets/backgrounds");
}

export async function uploadSceneBackground(input: { file: File; name: string }): Promise<SceneBackgroundAsset> {
  const form = new FormData();
  form.set("file", input.file);
  form.set("name", input.name);
  return apiPostForm<SceneBackgroundAsset>("/scene-assets/backgrounds", form);
}

export async function deleteSceneBackground(backgroundId: string): Promise<{ id: string; deleted: boolean }> {
  return apiDelete<{ id: string; deleted: boolean }>(`/scene-assets/backgrounds/${encodeURIComponent(backgroundId)}`);
}

export async function listSceneCompositions(): Promise<{ items: SceneComposition[] }> {
  return apiGet<{ items: SceneComposition[] }>("/scene-assets/compositions");
}

export async function createSceneComposition(input: CreateSceneCompositionInput): Promise<SceneComposition> {
  return apiPost<SceneComposition>("/scene-assets/compositions", input);
}

export async function deleteSceneComposition(compositionId: string): Promise<{ id: string; deleted: boolean }> {
  return apiDelete<{ id: string; deleted: boolean }>(`/scene-assets/compositions/${encodeURIComponent(compositionId)}`);
}


export type VideoCreationAudioSource = "upload" | "tts_text" | "voice_clone" | "duo_dialog" | "reference_video";

export type IndexTTSEmotionMode = "voice" | "text" | "vector" | "audio";

export type IndexTTSConfig = {
  emotion_mode: IndexTTSEmotionMode;
  emo_alpha?: number;
  emo_audio_prompt?: string;
  emo_text?: string;
  emo_vector?: number[];
  use_random?: boolean;
  interval_silence_ms?: number;
  streaming_mode?: "segment" | "token_window";
  max_text_tokens_per_segment?: number;
  quick_streaming_tokens?: number;
};

export type PersonMode = "single" | "double";

export type DuoDialogRole = "left" | "right";

export type DuoDialogLine = {
  id: string;
  role: DuoDialogRole;
  text: string;
};

export type DuoDialogSpeakerTTS = {
  tts_provider?: string;
  tts_model?: string;
  voice?: string;
  indextts_config?: IndexTTSConfig;
};

export type DuoDialogRequest = {
  lines: DuoDialogLine[];
  voices?: Record<DuoDialogRole, string>;
  speakers?: Record<DuoDialogRole, DuoDialogSpeakerTTS>;
  gap_ms?: number;
};

export type DuoDialogCapability = {
  speaker_faces: Record<string, string>;
  default_voices: Partial<Record<DuoDialogRole, string>>;
};

export type VideoCreationJobResponse = {
  job_id: string;
  status: "done" | "error" | string;
  source?: VideoCreationAudioSource | string;
  export_video: ExportVideoItem;
};

export type VideoCreationCompositionConfig = {
  scene_composition_id?: string | null;
  background_id?: string | null;
  background_color?: string;
  avatar_fit?: "contain" | "cover";
  avatar_anchor?: "center" | "bottom" | "left" | "right";
  avatar_scale?: number;
  avatar_offset_x?: number;
  avatar_offset_y?: number;
  output_width?: number;
  output_height?: number;
};

export type CreateVideoCreationJobInput = {
  model: string;
  avatarId: string;
  title?: string;
  audioSource: VideoCreationAudioSource;
  audioFile?: File | null;
  text?: string;
  ttsProvider?: string;
  ttsModel?: string;
  voice?: string;
  durationSec?: number;
  fasterliveportraitConfig?: Record<string, unknown>;
  indexttsConfig?: IndexTTSConfig;
  indexttsEmotionAudioFile?: File | null;
  duoDialog?: DuoDialogRequest;
  compositionConfig?: VideoCreationCompositionConfig | null;
};

export async function createVideoCreationJob(input: CreateVideoCreationJobInput): Promise<VideoCreationJobResponse> {
  const form = new FormData();
  form.set("model", input.model);
  form.set("avatar_id", input.avatarId);
  form.set("audio_source", input.audioSource);
  if (input.title) form.set("title", input.title);
  if (input.audioSource === "upload" && input.audioFile) {
    form.set("audio_file", input.audioFile);
  }
  if (input.text) form.set("text", input.text);
  if (input.ttsProvider) form.set("tts_provider", input.ttsProvider);
  if (input.ttsModel) form.set("tts_model", input.ttsModel);
  if (input.voice) form.set("voice", input.voice);
  if (input.durationSec != null) {
    form.set("duration_sec", String(input.durationSec));
  }
  if (input.fasterliveportraitConfig) {
    form.set("fasterliveportrait_config", JSON.stringify(input.fasterliveportraitConfig));
  }
  if (input.indexttsConfig) {
    form.set("indextts_config", JSON.stringify(input.indexttsConfig));
  }
  if (input.indexttsEmotionAudioFile) {
    form.set("indextts_emotion_audio_file", input.indexttsEmotionAudioFile);
  }
  if (input.duoDialog) {
    form.set("duo_dialog", JSON.stringify(input.duoDialog));
  }
  if (input.compositionConfig) {
    form.set("composition_config", JSON.stringify(input.compositionConfig));
  }
  return apiPostForm<VideoCreationJobResponse>("/video-creation/jobs", form);
}

export async function apiDelete<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(buildApiUrl(path), { ...init, method: "DELETE" });
  await throwIfNotOk(r);
  return r.json() as Promise<T>;
}

export type KnowledgeDocument = {
  id: string;
  kb_id: string;
  filename: string;
  mime_type: string;
  bytes: number;
  sha256: string;
  status: "ready" | "error" | string;
  error: string | null;
  chunk_count: number;
  created_at: string;
  updated_at: string;
};

export type KnowledgeDocumentsResponse = {
  documents: KnowledgeDocument[];
};

export type KnowledgeBaseSummary = {
  id: string;
  name: string;
  document_count: number;
  ready_document_count: number;
  error_document_count: number;
  created_at: string;
  updated_at: string;
};

export type KnowledgeBasesResponse = {
  knowledge_bases?: (string | KnowledgeBaseSummary)[];
  knowledge_base_summaries?: KnowledgeBaseSummary[];
};

export type AvatarKnowledgeBasesResponse = {
  avatar_id?: string;
  knowledge_base_ids?: string[];
  knowledge_base_summaries?: KnowledgeBaseSummary[];
};

export type AvatarKnowledgeBasesRequest = {
  knowledge_base_ids: string[];
};

export type SessionKnowledgeBasesRequest = {
  knowledge_base_ids: string[];
};

export type SessionKnowledgeBasesResponse = {
  session_id: string;
  knowledge_base_ids: string[];
};

export type CreateSessionRequest = {
  exhibition_id?: string;
  persona_id?: string;
  avatar_id?: string;
  model?: string;
  llm_system_prompt?: string;
  tts_provider: string;
  stt_provider: string;
  tts_voice?: string;
  tts_model?: string;
  wav2lip_postprocess_mode?: string;
  fasterliveportrait_config?: Record<string, unknown>;
  user_id: string;
  agent_enabled: boolean;
  memory_enabled: boolean;
  memory_profile_id?: string;
  character_id?: string;
  memory_library_id?: string;
  knowledge_enabled: boolean;
  knowledge_base_id?: string;
  knowledge_base_ids?: string[];
};

export type PersonaSummary = {
  schema_version: string;
  id: string;
  name: string;
  description: string;
  locale: string;
  avatar: {
    id: string;
    model: string;
    path?: string | null;
  };
  voice: {
    provider?: string | null;
    voice_id?: string | null;
    model?: string | null;
  };
  agent: {
    system_prompt?: string | null;
    style_prompt?: string | null;
    memory_enabled: boolean;
    knowledge_enabled: boolean;
    knowledge_base_ids: string[];
  };
  runtime: {
    stt_provider?: string | null;
    tts_provider?: string | null;
    preferred_backend?: string | null;
  };
  safety: {
    authorized_avatar: boolean;
    authorized_voice: boolean;
    content_label_required: boolean;
  };
  created_at: string;
  updated_at: string;
  source: string;
};

export type PersonasResponse = {
  personas: PersonaSummary[];
};

export type ClientRendererDescriptor = {
  type: "light2d";
  config_url: string;
  asset_base_url: string;
  recommended_for: string[];
};

export type AvatarSummary = {
  id: string;
  name: string | null;
  model_type: string;
  width: number;
  height: number;
  person_mode: PersonMode;
  is_custom: boolean;
  has_preview_video: boolean;
  matting_status: "unknown" | "opaque" | "transparent_ready";
  duo_dialog: DuoDialogCapability | null;
  client_renderer: ClientRendererDescriptor | null;
  waiting_gif_url?: string | null;
  speaking_gif_url?: string | null;
};

export type CreateSessionResponse = { session_id: string; status: string };

function memoryQuery(profileId: string, characterId: string): string {
  const qs = new URLSearchParams({ profile_id: profileId, character_id: characterId });
  return qs.toString();
}

export function getMemoryLibraries(profileId: string, characterId: string): Promise<{ items: MemoryLibrary[] }> {
  return apiGet(`/memory/libraries?${memoryQuery(profileId, characterId)}`);
}

export function createMemoryLibrary(body: {
  id?: string;
  name?: string;
  profile_id?: string;
  character_id: string;
}): Promise<MemoryLibrary> {
  return apiPost("/memory/libraries", body);
}

export function getMemoryItems(
  libraryId: string,
  profileId: string,
  characterId: string,
): Promise<{ items: MemoryItem[] }> {
  return apiGet(`/memory/libraries/${encodeURIComponent(libraryId)}/items?${memoryQuery(profileId, characterId)}`);
}

export function deleteMemoryItem(
  libraryId: string,
  itemId: string,
  profileId: string,
  characterId: string,
): Promise<{ deleted: true }> {
  return apiDelete(
    `/memory/libraries/${encodeURIComponent(libraryId)}/items/${encodeURIComponent(itemId)}?${memoryQuery(
      profileId,
      characterId,
    )}`,
  );
}

export function importMemoryTurns(
  libraryId: string,
  body: {
    profile_id?: string;
    character_id: string;
    turns: MemoryTurn[];
    source?: string;
  },
): Promise<{ imported: number }> {
  return apiPost(`/memory/libraries/${encodeURIComponent(libraryId)}/import`, body);
}

export function uploadWeChatImport(
  file: File,
  body: {
    profileId?: string;
    memoryLibraryId?: string;
    avatarId: string;
    avatarModel?: string;
    characterId?: string;
    targetSpeakerId?: string;
    sourceFormat?: string;
    timezone?: string;
  },
): Promise<WeChatImportJob> {
  const form = new FormData();
  form.set("file", file);
  form.set("profile_id", body.profileId || "default");
  form.set("memory_library_id", body.memoryLibraryId || "default");
  form.set("avatar_id", body.avatarId);
  form.set("avatar_model", body.avatarModel || "mock");
  if (body.characterId) form.set("character_id", body.characterId);
  if (body.targetSpeakerId) form.set("target_speaker_id", body.targetSpeakerId);
  if (body.sourceFormat) form.set("source_format", body.sourceFormat);
  if (body.timezone) form.set("timezone", body.timezone);
  return apiPostForm<WeChatImportJob>("/memory/wechat-import", form);
}

export function selectWeChatImportSpeaker(jobId: string, targetSpeakerId: string): Promise<WeChatImportJob> {
  return apiPost(`/memory/wechat-import/${encodeURIComponent(jobId)}/speaker`, {
    target_speaker_id: targetSpeakerId,
  });
}

export function commitWeChatImportJob(
  jobId: string,
  body: { personaId: string; personaName?: string; description?: string },
): Promise<WeChatImportCommitResult> {
  return apiPost(`/memory/wechat-import/${encodeURIComponent(jobId)}/commit`, {
    persona_id: body.personaId,
    persona_name: body.personaName,
    description: body.description,
  });
}

/** GET /voices 返回的音色目录项（含 SQLite 中的系统预设与复刻） */
export type VoiceCatalogItem = {
  id: number;
  user_id: number;
  provider: string;
  voice_id: string;
  display_label: string;
  target_model: string | null;
  source: "system" | "clone" | string;
};
