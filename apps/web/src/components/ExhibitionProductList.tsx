import { buildApiUrl } from "../lib/api";
import type { ExhibitionEntityCard as ExhibitionEntityCardData } from "../types";

function displayImageUrl(value: string): string {
  const url = value.trim();
  return url.startsWith("/scene-assets/") ? buildApiUrl(url) : url;
}

type ExhibitionProductListProps = {
  products: ExhibitionEntityCardData[];
  immersive?: boolean;
  english?: boolean;
};

export function ExhibitionProductList({
  products,
  immersive = false,
  english = false,
}: ExhibitionProductListProps) {
  return (
    <section
      className={`exhibition-product-list ${immersive ? "is-immersive" : "is-light"}`}
      aria-label={english ? "Exhibitor product list" : "展商相关展品列表"}
    >
      <header className="exhibition-product-list-header">
        <div>
          <strong>{english ? "Choose a product to learn more" : "请选择想了解的展品"}</strong>
        </div>
        <span className="exhibition-product-list-count">
          {english ? `${products.length} item${products.length === 1 ? "" : "s"}` : `${products.length} 件`}
        </span>
      </header>
      <div className="exhibition-product-list-track" role="list">
        {products.map((product) => {
          const imageUrl = product.image_urls.map(displayImageUrl).find(Boolean);
          return (
            <article className="exhibition-product-list-item" key={`${product.kind}-${product.id}`} role="listitem">
              {imageUrl ? (
                <img
                  src={imageUrl}
                  alt={english ? `${product.name} product image` : `${product.name}展品图片`}
                  loading="lazy"
                  onError={(event) => { event.currentTarget.style.display = "none"; }}
                />
              ) : (
                <div className="exhibition-product-list-item-placeholder" aria-hidden="true">{english ? "Product" : "展品"}</div>
              )}
              <strong>{product.name}</strong>
            </article>
          );
        })}
      </div>
    </section>
  );
}
