import type { MultimodalCompositionView, MultimodalPresentation } from "../lib/multimodalViewModel";

type MultimodalPanelProps = {
  view: MultimodalCompositionView;
  onClose: () => void;
  embedded?: boolean;
  focusSlot?: "primary" | "supporting" | "detail" | "action" | null;
};

const FOCUS_SLOT_LABELS = {
  primary: "展馆概览",
  supporting: "参观推荐",
  detail: "展品介绍",
  action: "资料二维码",
} as const;

function MapPanel({ presentation }: { presentation: Extract<MultimodalPresentation, { kind: "map" }> }) {
  const polyline = presentation.points.map((point) => `${point.xPercent},${point.yPercent}`).join(" ");
  return (
    <article className="digital-display-multimodal-card digital-display-multimodal-map-card">
      <div className="digital-display-multimodal-card-heading"><div><small>地图区域</small><strong>{presentation.title}</strong></div><span>{presentation.points.length} 个点位</span></div>
      <div className="digital-display-multimodal-map">
        <div className="digital-display-multimodal-grid" aria-hidden />
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden><polyline points={polyline} /></svg>
        {presentation.points.map((point, index) => <span key={point.pointId} className={`digital-display-multimodal-marker is-${point.emphasis ?? "normal"}`} style={{ left: `${point.xPercent}%`, top: `${point.yPercent}%` }} title={point.label}>{index + 1}<b>{point.label}</b></span>)}
      </div>
      {presentation.caption ? <p className="digital-display-multimodal-copy">{presentation.caption}</p> : null}
    </article>
  );
}

function ListPanel({ presentation }: { presentation: Extract<MultimodalPresentation, { kind: "list" }> }) {
  return <article className="digital-display-multimodal-card"><div className="digital-display-multimodal-card-heading"><div><small>推荐列表</small><strong>{presentation.title}</strong></div><span>{presentation.items.length} 项</span></div><div className="digital-display-multimodal-list">{presentation.items.map((item, index) => <div key={item.itemId} className="digital-display-multimodal-list-item"><i>{index + 1}</i><div><strong>{item.title}</strong>{item.meta ? <span>{item.meta}</span> : null}{item.description ? <p>{item.description}</p> : null}</div></div>)}</div></article>;
}

function CardPanel({ presentation }: { presentation: Extract<MultimodalPresentation, { kind: "card" }> }) {
  return <article className="digital-display-multimodal-card is-highlight"><small>{presentation.eyebrow || "信息卡片"}</small><h3>{presentation.title}</h3><p className="digital-display-multimodal-copy">{presentation.summary}</p>{presentation.facts?.length ? <dl>{presentation.facts.map((fact) => <div key={`${fact.label}-${fact.value}`}><dt>{fact.label}</dt><dd>{fact.value}</dd></div>)}</dl> : null}</article>;
}

function QrPanel({ presentation }: { presentation: Extract<MultimodalPresentation, { kind: "qr-code" }> }) {
  const canDisplay = presentation.sourceStatus === "trusted" && Boolean(presentation.imageSrc);
  const status = presentation.sourceStatus === "expired" ? "二维码已失效" : canDisplay ? "可扫码" : "等待受信二维码";
  return <article className="digital-display-multimodal-card digital-display-multimodal-qr"><div className="digital-display-multimodal-qr-image">{canDisplay ? <img src={presentation.imageSrc} alt={`${presentation.title}二维码`} /> : <span aria-label="不可扫描二维码占位">待验证</span>}</div><div><small>二维码区域</small><h3>{presentation.title}</h3><em>{status}</em>{presentation.targetLabel ? <p>目标：{presentation.targetLabel}</p> : null}</div><p className="digital-display-multimodal-copy">{presentation.description}</p></article>;
}

function PresentationPanel({ presentation }: { presentation: MultimodalPresentation }) {
  if (presentation.kind === "map") return <MapPanel presentation={presentation} />;
  if (presentation.kind === "list") return <ListPanel presentation={presentation} />;
  if (presentation.kind === "card") return <CardPanel presentation={presentation} />;
  return <QrPanel presentation={presentation} />;
}

export function MultimodalPanel({
  view,
  onClose,
  embedded = false,
  focusSlot = null,
}: MultimodalPanelProps) {
  const visibleSlots = focusSlot
    ? view.visibleSlots.filter((slot) => slot.slotKey === focusSlot)
    : view.visibleSlots;
  const title = focusSlot ? FOCUS_SLOT_LABELS[focusSlot] : view.title;
  return (
    <section className={`digital-display-multimodal-panel${embedded ? " is-embedded" : ""}`} aria-label={`${title}内容`}>
      {!embedded ? <header><div><small>展会服务</small><h2>{title}</h2><p role="status">{view.statusMessage}</p></div><button type="button" onClick={onClose} aria-label="关闭展会服务">关闭</button></header> : null}
      {view.hasDevelopmentPreview ? <p className="digital-display-multimodal-notice">当前为演示内容，连接服务后将更新为实时数据。</p> : null}
      {view.phase === "error" ? <div className="digital-display-multimodal-empty" role="alert">{view.errorMessage || view.statusMessage}</div> : visibleSlots.length ? <div className="digital-display-multimodal-content">{visibleSlots.map((slot) => slot.presentation ? <PresentationPanel key={`${slot.slotKey}-${slot.presentation.contentKey}`} presentation={slot.presentation} /> : null)}</div> : <div className="digital-display-multimodal-empty">该功能暂无可展示内容</div>}
    </section>
  );
}
