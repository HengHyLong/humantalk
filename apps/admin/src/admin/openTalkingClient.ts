import {
  apiDelete,
  apiGet,
  apiPost,
  apiPostForm,
  buildApiUrl,
  type AvatarSummary,
  type CreateSceneCompositionInput,
  type SceneBackgroundAsset,
  type SceneComposition,
  type VoiceCatalogItem,
} from "../lib/api";
import { buildTTSPreviewPayload, requestTTSPreview } from "../lib/ttsPreview";
import type { TtsProviderExtended } from "../constants/ttsBailian";
import { beginAdminProgress, finishAdminProgress, notifyAdmin, updateAdminProgress } from "./feedback";

export type OpenTalkingClient = {
  listAvatars(): Promise<AvatarSummary[]>;
  listModels(): Promise<{ models: string[]; defaultModel: string | null }>;
  listVoices(): Promise<VoiceCatalogItem[]>;
  deleteVoiceEntry(entryId: number): Promise<void>;
  createCustomAvatar(input: {
    name: string;
    file?: File;
    video?: File;
    listenVideo?: File;
    thinkVideo?: File;
    talkVideo?: File;
    baseAvatarId?: string | null;
    model?: string | null;
    personMode?: "single" | "double";
    removeBackground?: boolean;
  }): Promise<AvatarSummary>;
  deleteAvatar(avatarId: string): Promise<void>;
  previewTts(input: { text: string; voice: string; provider?: string; model?: string | null }): Promise<Blob>;
  previewUrl(avatarId: string): string;
  assetUrl(path: string): string;
  listSceneBackgrounds(): Promise<SceneBackgroundAsset[]>;
  uploadSceneBackground(input: { file: File; name: string }): Promise<SceneBackgroundAsset>;
  deleteSceneBackground(backgroundId: string): Promise<void>;
  listSceneCompositions(): Promise<SceneComposition[]>;
  createSceneComposition(input: CreateSceneCompositionInput): Promise<SceneComposition>;
  updateSceneComposition(id: string, input: Partial<CreateSceneCompositionInput>): Promise<SceneComposition>;
  deleteSceneComposition(id: string): Promise<void>;
};

async function uploadWithFeedback<T>(label: string, path: string, form: FormData): Promise<T> {
  const progressId = beginAdminProgress(label);
  try {
    const result = await apiPostForm<T>(path, form, undefined, (progress) => updateAdminProgress({ id: progressId, label, progress, phase: "progress" }));
    finishAdminProgress(progressId, label, true);
    notifyAdmin(`${label}成功`, "success");
    return result;
  } catch (error) {
    finishAdminProgress(progressId, label, false);
    notifyAdmin(`${label}失败：${error instanceof Error ? error.message : "请稍后重试"}`, "error");
    throw error;
  }
}

export const openTalkingClient: OpenTalkingClient = {
  listAvatars: () => apiGet<AvatarSummary[] | { items?: AvatarSummary[]; avatars?: AvatarSummary[] }>("/avatars").then((response) => {
    if (Array.isArray(response)) return response;
    return response.items ?? response.avatars ?? [];
  }),
  listModels: () => apiGet<{ models?: string[]; default_model?: string | null }>("/models").then((response) => ({
    // video is a browser-side driver and therefore is intentionally not part of
    // the backend synthesis-model list.
    models: Array.from(new Set([...(response.models ?? []), "video"])),
    defaultModel: response.default_model ?? null,
  })),
  listVoices: () =>
    apiGet<VoiceCatalogItem[] | { items?: VoiceCatalogItem[] }>("/voices").then((response) =>
      Array.isArray(response) ? response : response.items ?? [],
    ),
  deleteVoiceEntry: (entryId) => apiDelete<Record<string, unknown>>(`/voices/${entryId}`).then(() => undefined),
  createCustomAvatar: ({ file, video, listenVideo, thinkVideo, talkVideo, name, baseAvatarId, model = null, personMode = "single", removeBackground = false }) => {
    const form = new FormData();
    if (baseAvatarId) form.set("base_avatar_id", baseAvatarId);
    form.set("name", name);
    if (model) form.set("model", model);
    form.set("person_mode", personMode);
    if (model === "video") {
      if (!listenVideo || !thinkVideo || !talkVideo) throw new Error("视频驱动必须同时上传聆听、思考和讲话视频。");
      form.set("listen_video", listenVideo);
      form.set("think_video", thinkVideo);
      form.set("talk_video", talkVideo);
    } else if (video) {
      form.set("video", video);
      form.set("remove_background", "false");
    } else {
      if (!file) throw new Error("静态形象必须提供图片文件。");
      form.set("image", file);
      form.set("remove_background", removeBackground ? "true" : "false");
    }
    return uploadWithFeedback<AvatarSummary>("数字人形象上传", "/avatars/custom", form);
  },
  deleteAvatar: (avatarId) => apiDelete<{ avatar_id: string; status: string }>(`/avatars/${encodeURIComponent(avatarId)}`).then(() => undefined),
  previewTts: ({ text, voice, provider = "edge", model }) =>
    requestTTSPreview(buildTTSPreviewPayload({ text, voice, provider: provider as TtsProviderExtended, model: model ?? undefined })),
  previewUrl: (avatarId) => buildApiUrl(`/avatars/${encodeURIComponent(avatarId)}/preview`),
  assetUrl: (path) => buildApiUrl(path),
  listSceneBackgrounds: () => apiGet<{ items: SceneBackgroundAsset[] }>("/scene-assets/backgrounds").then((response) => response.items ?? []),
  uploadSceneBackground: ({ file, name }) => {
    const form = new FormData();
    form.set("file", file);
    if (name.trim()) form.set("name", name.trim());
    return uploadWithFeedback<SceneBackgroundAsset>("场景背景上传", "/scene-assets/backgrounds", form);
  },
  deleteSceneBackground: (backgroundId) => apiDelete<{ id: string; deleted: boolean }>(`/scene-assets/backgrounds/${encodeURIComponent(backgroundId)}`).then(() => undefined),
  listSceneCompositions: () => apiGet<{ items: SceneComposition[] }>("/scene-assets/compositions").then((response) => response.items ?? []),
  createSceneComposition: (input) => apiPost<SceneComposition>("/scene-assets/compositions", input),
  updateSceneComposition: async (id, input) => {
    const response = await fetch(buildApiUrl(`/scene-assets/compositions/${encodeURIComponent(id)}`), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    if (!response.ok) throw new Error(`场景组合更新失败：${response.status}`);
    return response.json() as Promise<SceneComposition>;
  },
  deleteSceneComposition: (id) => apiDelete<{ id: string; deleted: boolean }>(`/scene-assets/compositions/${encodeURIComponent(id)}`).then(() => undefined),
};
