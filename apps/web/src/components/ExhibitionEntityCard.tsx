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
  closeLabel?: string;
};

export function ExhibitionEntityCard({
  entity,
  immersive = false,
  onClose,
  closeLabel = "关闭介绍卡片",
}: ExhibitionEntityCardProps) {
  const imageUrl = entity.image_urls.map(displayImageUrl).find(Boolean);
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
      </div>
      {imageUrl ? (
        <img
          src={imageUrl}
          alt={`${entity.name}${KIND_LABELS[entity.kind]}图片`}
          loading="lazy"
          onError={(event) => { event.currentTarget.style.display = "none"; }}
        />
      ) : null}
    </article>
  );
}
