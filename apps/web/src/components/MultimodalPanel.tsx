import type { MultimodalCompositionView, MultimodalPresentation } from "../lib/multimodalViewModel";

type MultimodalPanelProps = {
  view: MultimodalCompositionView;
  onUpdatePreview: () => void;
  onToggleSupporting: () => void;
  onClear: () => void;
  onDegrade: () => void;
  onClose: () => void;
};

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

export function MultimodalPanel({ view, onUpdatePreview, onToggleSupporting, onClear, onDegrade, onClose }: MultimodalPanelProps) {
  const supporting = view.slots.find((slot) => slot.slotKey === "supporting");
  const action = view.slots.find((slot) => slot.slotKey === "action");
  const clearAvailable = view.slots.some((slot) => slot.status !== "empty");
  return (
    <section className="digital-display-multimodal-panel" aria-label="F02 多模态信息">
      <header><div><small>F02 多模态联动 · 开发预览</small><h2>{view.title}</h2><p role="status">{view.statusMessage}</p></div><button type="button" onClick={onClose} aria-label="关闭多模态预览">关闭</button></header>
      {view.hasDevelopmentPreview ? <p className="digital-display-multimodal-notice">当前点位、文案和二维码均为前端开发预览，不代表正式业务数据或接口成功。</p> : null}
      {view.phase === "error" ? <div className="digital-display-multimodal-empty" role="alert">{view.errorMessage || view.statusMessage}</div> : view.visibleSlots.length ? <div className="digital-display-multimodal-content">{view.visibleSlots.map((slot) => slot.presentation ? <PresentationPanel key={`${slot.slotKey}-${slot.presentation.contentKey}`} presentation={slot.presentation} /> : null)}</div> : <div className="digital-display-multimodal-empty">暂无可展示内容</div>}
      <details className="digital-display-multimodal-actions"><summary>展开联动检查</summary><div><button type="button" onClick={onUpdatePreview}>模拟版本更新</button><button type="button" disabled={!supporting || (supporting.status !== "visible" && supporting.status !== "hidden")} onClick={onToggleSupporting}>{view.hiddenCount ? "恢复列表区域" : "隐藏列表区域"}</button><button type="button" disabled={!action || action.status === "empty" || action.status === "degraded"} onClick={onDegrade}>模拟二维码降级</button><button type="button" disabled={!clearAvailable} onClick={onClear}>模拟清空数据</button></div></details>
    </section>
  );
}
