import type { MultimodalControllerState, MultimodalSlotStatus, PresentationKind } from "./multimodalController";

export type MultimodalPresentationBase = { contentKey: string; revision: number; kind: PresentationKind; title: string; isDevelopmentPreview?: boolean };
export type MultimodalMapPoint = { pointId: string; label: string; xPercent: number; yPercent: number; emphasis?: "start" | "normal" | "destination" };
export type MultimodalMapPresentation = MultimodalPresentationBase & { kind: "map"; caption?: string; points: readonly MultimodalMapPoint[] };
export type MultimodalListItem = { itemId: string; title: string; description?: string; meta?: string };
export type MultimodalListPresentation = MultimodalPresentationBase & { kind: "list"; items: readonly MultimodalListItem[] };
export type MultimodalCardFact = { label: string; value: string };
export type MultimodalCardPresentation = MultimodalPresentationBase & { kind: "card"; eyebrow?: string; summary: string; facts?: readonly MultimodalCardFact[] };
export type QrSourceStatus = "trusted" | "unverified" | "expired";
export type MultimodalQrPresentation = MultimodalPresentationBase & { kind: "qr-code"; description: string; sourceStatus: QrSourceStatus; imageSrc?: string; targetLabel?: string; expiresAtLabel?: string };
export type MultimodalPresentation = MultimodalMapPresentation | MultimodalListPresentation | MultimodalCardPresentation | MultimodalQrPresentation;

export type MultimodalPresentationState = {
  controller: MultimodalControllerState;
  presentations: Readonly<Record<string, MultimodalPresentation>>;
  phase: "loading" | "stable" | "error";
  errorMessage?: string;
};

export type MultimodalSlotView = {
  slotKey: string;
  status: MultimodalSlotStatus;
  presentation?: MultimodalPresentation;
  degradedReason?: "invalid-content" | "presentation-failure" | "missing-presentation";
};

export type MultimodalCompositionView = {
  phase: MultimodalPresentationState["phase"];
  title: string;
  statusMessage: string;
  slots: readonly MultimodalSlotView[];
  visibleSlots: readonly MultimodalSlotView[];
  hiddenCount: number;
  hasDevelopmentPreview: boolean;
  errorMessage?: string;
};

const SLOT_ORDER = ["primary", "supporting", "detail", "action"];
const text = (value: unknown) => typeof value === "string" ? value.trim() : "";
const validCoordinate = (value: number) => Number.isFinite(value) && value >= 0 && value <= 100;
const validImageSource = (value: string) => /^https:\/\//i.test(value) || /^data:image\/png;base64,/i.test(value);

export function validateMultimodalPresentation(presentation: MultimodalPresentation): readonly string[] {
  const errors: string[] = [];
  if (!text(presentation.contentKey)) errors.push("contentKey 不能为空");
  if (!Number.isSafeInteger(presentation.revision) || presentation.revision < 0) errors.push("revision 必须是非负安全整数");
  if (!text(presentation.title)) errors.push("标题不能为空");
  if (presentation.kind === "map") {
    if (!presentation.points.length) errors.push("地图至少需要一个点位");
    if (new Set(presentation.points.map((point) => text(point.pointId))).size !== presentation.points.length) errors.push("地图点位 ID 不能重复");
    if (presentation.points.some((point) => !text(point.pointId) || !text(point.label) || !validCoordinate(point.xPercent) || !validCoordinate(point.yPercent))) errors.push("地图点位信息无效");
  } else if (presentation.kind === "list") {
    if (!presentation.items.length) errors.push("列表至少需要一项");
    if (new Set(presentation.items.map((item) => text(item.itemId))).size !== presentation.items.length) errors.push("列表项 ID 不能重复");
    if (presentation.items.some((item) => !text(item.itemId) || !text(item.title))) errors.push("列表项信息无效");
  } else if (presentation.kind === "card") {
    if (!text(presentation.summary)) errors.push("卡片摘要不能为空");
    if (presentation.facts?.some((fact) => !text(fact.label) || !text(fact.value))) errors.push("卡片事实项无效");
  } else {
    if (!text(presentation.description)) errors.push("二维码说明不能为空");
    if (presentation.imageSrc && !validImageSource(presentation.imageSrc)) errors.push("二维码图片地址不受支持");
    if (presentation.sourceStatus === "trusted" && (!presentation.imageSrc || !validImageSource(presentation.imageSrc))) errors.push("受信二维码缺少安全图片地址");
  }
  return errors;
}

export function buildMultimodalCompositionView(state: MultimodalPresentationState): MultimodalCompositionView {
  const slots = Object.values(state.controller.slots)
    .sort((left, right) => (SLOT_ORDER.indexOf(left.slotKey) - SLOT_ORDER.indexOf(right.slotKey)) || left.slotKey.localeCompare(right.slotKey))
    .map<MultimodalSlotView>((slot) => {
      const presentation = slot.content ? state.presentations[slot.content.contentKey] : undefined;
      const valid = Boolean(presentation && presentation.kind === slot.content?.presentationKind && presentation.revision === slot.content.contentRevision && validateMultimodalPresentation(presentation).length === 0);
      return { slotKey: slot.slotKey, status: slot.status, presentation: valid ? presentation : undefined, degradedReason: slot.degradedReason ?? (slot.content && !valid ? "missing-presentation" : undefined) };
    });
  const visibleSlots = slots.filter((slot) => slot.status === "visible" && slot.presentation);
  const hiddenCount = slots.filter((slot) => slot.status === "hidden").length;
  const degradedCount = slots.filter((slot) => slot.status === "degraded" || slot.degradedReason).length;
  let statusMessage = "正在准备多模态内容";
  if (state.phase === "error") statusMessage = "多模态内容暂时不可用";
  else if (visibleSlots.length) statusMessage = `已组合 ${visibleSlots.length} 个内容区域${degradedCount ? `，${degradedCount} 个区域已降级` : ""}`;
  else if (hiddenCount) statusMessage = "内容已隐藏，可随时恢复";
  else if (degradedCount) statusMessage = "内容呈现失败，已进入降级模式";
  else if (state.phase === "stable") statusMessage = "暂无可展示内容";
  return { phase: state.phase, title: "多模态信息", statusMessage, slots, visibleSlots, hiddenCount, hasDevelopmentPreview: visibleSlots.some((slot) => slot.presentation?.isDevelopmentPreview), errorMessage: state.errorMessage };
}
