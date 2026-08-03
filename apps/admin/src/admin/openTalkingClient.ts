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

export type OpenTalkingClient = {
  listAvatars(): Promise<AvatarSummary[]>;
  listModels(): Promise<{ models: string[]; defaultModel: string | null }>;
  listVoices(): Promise<VoiceCatalogItem[]>;
  deleteVoiceEntry(entryId: number): Promise<void>;
  createCustomAvatar(input: {
    name: string;
    file?: File;
    baseAvatarId?: string | null;
    model?: string | null;
    personMode?: "single" | "double";
    removeBackground?: boolean;
    waitingGif?: File;
    speakingGif?: File;
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

export const openTalkingClient: OpenTalkingClient = {
  listAvatars: () => apiGet<AvatarSummary[]>("/avatars"),
  listModels: () => apiGet<{ models?: string[]; default_model?: string | null }>("/models").then((response) => ({
    models: response.models ?? [],
    defaultModel: response.default_model ?? null,
  })),
  listVoices: () => apiGet<{ items: VoiceCatalogItem[] }>("/voices").then((response) => response.items ?? []),
  deleteVoiceEntry: (entryId) => apiDelete<Record<string, unknown>>(`/voices/${entryId}`).then(() => undefined),
  createCustomAvatar: ({ file, name, baseAvatarId, model = null, personMode = "single", removeBackground = false, waitingGif, speakingGif }) => {
    const form = new FormData();
    if (baseAvatarId) form.set("base_avatar_id", baseAvatarId);
    form.set("name", name);
    if (model) form.set("model", model);
    form.set("person_mode", personMode);
    if (model === "gif") {
      if (!waitingGif || !speakingGif) throw new Error("GIF 形象必须同时提供等待聆听和张嘴讲话动图。");
      form.set("waiting_gif", waitingGif);
      form.set("speaking_gif", speakingGif);
    } else {
      if (!file) throw new Error("静态形象必须提供图片文件。");
      form.set("image", file);
      form.set("remove_background", removeBackground ? "true" : "false");
    }
    return apiPostForm<AvatarSummary>("/avatars/custom", form);
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
    return apiPostForm<SceneBackgroundAsset>("/scene-assets/backgrounds", form);
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
