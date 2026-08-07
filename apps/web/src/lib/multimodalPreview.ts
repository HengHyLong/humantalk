import type { MultimodalPreviewItem } from "./useMultimodalController";
import type { MultimodalPresentation } from "./multimodalViewModel";

/** Frontend-only structured data for F02 layout and interaction checks. */
export const F02_DEVELOPMENT_PREVIEW: readonly MultimodalPreviewItem[] = [
  {
    slotKey: "primary",
    presentation: {
      contentKey: "preview-map",
      revision: 1,
      kind: "map",
      title: "重点展区分布",
      caption: "从迎宾大厅出发，依次查看主题展区并前往服务中心。",
      isDevelopmentPreview: true,
      points: [
        { pointId: "preview-a", label: "迎宾大厅", xPercent: 18, yPercent: 72, emphasis: "start" },
        { pointId: "preview-b", label: "主题展区", xPercent: 48, yPercent: 48, emphasis: "normal" },
        { pointId: "preview-c", label: "服务中心", xPercent: 78, yPercent: 24, emphasis: "destination" },
      ],
    },
  },
  {
    slotKey: "supporting",
    presentation: {
      contentKey: "preview-list",
      revision: 1,
      kind: "list",
      title: "推荐参观",
      isDevelopmentPreview: true,
      items: [
        { itemId: "preview-item-a", title: "主题展区", description: "集中了解重点展示内容与特色项目。", meta: "约 8 分钟" },
        { itemId: "preview-item-b", title: "互动体验区", description: "查看现场互动体验安排，也可以继续向数字人提问。", meta: "约 5 分钟" },
      ],
    },
  },
  {
    slotKey: "detail",
    presentation: {
      contentKey: "preview-card",
      revision: 1,
      kind: "card",
      title: "主题展区",
      eyebrow: "当前选择",
      summary: "这里汇集了本次推荐路线中的重点内容，适合首次到访时优先参观。",
      isDevelopmentPreview: true,
      facts: [
        { label: "参观建议", value: "优先体验" },
        { label: "预计停留", value: "8 分钟" },
      ],
    },
  },
  {
    slotKey: "action",
    presentation: {
      contentKey: "preview-qr",
      revision: 1,
      kind: "qr-code",
      title: "资料领取",
      description: "正式资料和二维码由受信服务提供；当前仅展示安全占位，不可扫码。",
      sourceStatus: "unverified",
      targetLabel: "参观资料",
      isDevelopmentPreview: true,
    },
  },
];

export const F02_UPDATED_PREVIEW_CARD: MultimodalPresentation = {
  contentKey: "preview-card",
  revision: 2,
  kind: "card",
  title: "演示内容卡片已更新",
  eyebrow: "版本变化",
  summary: "更高 revision 的内容会替换旧卡片；正式环境仍应由服务端版本事件驱动。",
  isDevelopmentPreview: true,
  facts: [
    { label: "内容版本", value: "revision 2" },
    { label: "更新结果", value: "前端已替换" },
  ],
};
