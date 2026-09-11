export type ModelStatus = {
  id: string;
  backend?: string;
  connected: boolean;
  reason?: string;
};

export const VIDEO_MODEL_ID = "video";
export const VIDU_MODEL_ID = "vidu";

/**
 * Keep product-level drivers discoverable even when an older API process does
 * not advertise them yet. A missing Vidu status is deliberately marked as
 * disconnected: the option remains visible without pretending the runtime is
 * ready.
 */
export function ensureSelectableModelIds(modelIds: string[], includeVideo = false): string[] {
  return Array.from(new Set([
    ...modelIds,
    VIDU_MODEL_ID,
    ...(includeVideo ? [VIDEO_MODEL_ID] : []),
  ]));
}

export function ensureSelectableModelStatuses(
  statuses: ModelStatus[],
  modelIds: string[],
  includeVideo = false,
): ModelStatus[] {
  const byId = new Map(statuses.map((status) => [status.id, status]));
  const selectableIds = ensureSelectableModelIds(modelIds, includeVideo);
  if (!byId.has(VIDU_MODEL_ID)) {
    byId.set(VIDU_MODEL_ID, {
      id: VIDU_MODEL_ID,
      backend: "vidu_live",
      connected: false,
      reason: "runtime_not_reported",
    });
  }
  if (includeVideo) {
    byId.set(VIDEO_MODEL_ID, {
      id: VIDEO_MODEL_ID,
      backend: "browser",
      connected: true,
      reason: "browser_local",
    });
  }
  return selectableIds.map((id) => byId.get(id) ?? { id, connected: false });
}

export type ModelConnectionBadge = {
  connected: boolean;
  label: string;
  tone: "connected" | "disconnected" | "selfTest";
};

export function isSelfTestModel(status?: ModelStatus | null): boolean {
  return status?.id === "mock" || status?.reason === "local_self_test";
}

export function modelConnectionBadge(
  status: ModelStatus | undefined,
  fallbackConnected = false,
): ModelConnectionBadge {
  if (isSelfTestModel(status)) {
    return { connected: true, label: "无需连接", tone: "selfTest" };
  }
  const connected = status?.connected ?? fallbackConnected;
  return {
    connected,
    label: connected ? "已连接" : "未连接",
    tone: connected ? "connected" : "disconnected",
  };
}
