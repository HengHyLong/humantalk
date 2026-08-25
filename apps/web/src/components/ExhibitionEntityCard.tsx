import { buildApiUrl } from "../lib/api";
import type { ExhibitionEntityCard as ExhibitionEntityCardData } from "../types";

const KIND_LABELS: Record<ExhibitionEntityCardData["kind"], string> = {
  exhibition: "展会",
  exhibitor: "展商",
  exhibit: "展品",
  venue: "场地",
  point: "点位",
  schedule: "活动",
};

function displayImageUrl(value: string): string {
  const url = value.trim();
  if (url.startsWith("/scene-assets/")) return buildApiUrl(url);
  return url;
}

type ExhibitionEntityCardProps = {
  entity: ExhibitionEntityCardData;
  immersive?: boolean;
  onClose?: () => void;
  onSelect?: () => void;
  selectLabel?: string;
  onRegister?: () => void;
  registerLabel?: string;
  closeLabel?: string;
  onImageClick?: (src: string, alt: string) => void;
};

export function ExhibitionEntityCard({
  entity,
  immersive = false,
  onClose,
  onSelect,
  selectLabel = "查看详情",
  onRegister,
  registerLabel = "二维码登记",
  closeLabel = "关闭介绍卡片",
  onImageClick,
}: ExhibitionEntityCardProps) {
  const imageUrl = entity.image_urls.map(displayImageUrl).find(Boolean);
  const imageAlt = `${entity.name}${KIND_LABELS[entity.kind]}图片`;
  return (
    <article className={`exhibition-entity-card ${immersive ? "is-immersive" : "is-light"}`}>
      {onClose ? (
        <button
          type="button"
          className="exhibition-entity-card-close"
          onClick={onClose}
          aria-label={closeLabel}
          title={closeLabel}
        >
          ×
        </button>
      ) : null}
      <div className="exhibition-entity-card-copy">
        <div className="exhibition-entity-card-heading">
          <span>{KIND_LABELS[entity.kind]}</span>
          <strong>{entity.name}</strong>
        </div>
        {entity.description ? <p>{entity.description}</p> : null}
        {entity.details.length ? (
          <dl>
            {entity.details.slice(0, 4).map((detail) => (
              <div key={`${detail.label}-${detail.value}`}>
                <dt>{detail.label}</dt>
                <dd>{detail.value}</dd>
              </div>
            ))}
          </dl>
        ) : null}
        {onSelect ? (
          <button type="button" className="exhibition-entity-card-select" onClick={onSelect}>
            {selectLabel}
          </button>
        ) : null}
        {entity.kind === "exhibit" && onRegister ? (
          <button type="button" className="exhibition-entity-card-register" onClick={onRegister}>
            {registerLabel}
          </button>
        ) : null}
      </div>
      {imageUrl ? (
        <button
          type="button"
          className="digital-display-zoom-trigger exhibition-entity-card-image"
          onClick={() => onImageClick?.(imageUrl, imageAlt)}
          aria-label={`放大查看${imageAlt}`}
          disabled={!onImageClick}
        >
          <img
            src={imageUrl}
            alt={imageAlt}
            loading="lazy"
            onError={(event) => { event.currentTarget.parentElement?.style.setProperty("display", "none"); }}
          />
        </button>
      ) : null}
    </article>
  );
}
