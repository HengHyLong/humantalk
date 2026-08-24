from pathlib import Path


DISPLAY_SOURCE = Path("apps/web/src/components/DigitalHumanDisplay.tsx")
ENTITY_CARD_SOURCE = Path("apps/web/src/components/ExhibitionEntityCard.tsx")
PRODUCT_LIST_SOURCE = Path("apps/web/src/components/ExhibitionProductList.tsx")
STYLE_SOURCE = Path("apps/web/src/index.css")


def test_presentation_is_bounded_and_long_subtitles_scroll() -> None:
    styles = STYLE_SOURCE.read_text(encoding="utf-8")

    stack_rule = styles.split(".digital-display-presentation-stack {", 1)[1].split("}", 1)[0]
    subtitle_rule = styles.split(".digital-display-presentation-stack .digital-display-live-subtitle {", 1)[1].split("}", 1)[0]

    assert "bottom:" in stack_rule
    assert "min-height: 0" in stack_rule
    assert "max-height:" in subtitle_rule
    assert "overflow-y: auto" in subtitle_rule
    assert ".digital-display-presentation-stack { top: 55%;" not in styles


def test_presentation_reserves_the_upper_half_for_the_avatar_face() -> None:
    styles = STYLE_SOURCE.read_text(encoding="utf-8")

    assert ".digital-display-presentation-stack { position: absolute; top: 52%;" in styles
    assert ".digital-display-presentation-stack { top: 52dvh;" in styles
    assert ".digital-display-presentation-stack.is-registration { top:" not in styles


def test_multi_row_product_list_owns_the_vertical_scroll_area() -> None:
    display = DISPLAY_SOURCE.read_text(encoding="utf-8")
    styles = STYLE_SOURCE.read_text(encoding="utf-8")

    assert '"is-product-list"' in display
    assert ".digital-display-presentation-stack .digital-display-waist-panel.is-product-list { height: 100%; max-height: 100%; overflow: hidden; }" in styles
    track_rule = styles.split(".exhibition-product-list-track {", 1)[1].split("}", 1)[0]
    assert "min-height: 0" in track_rule
    assert "flex: 1 1 auto" in track_rule
    assert "overflow-y: auto" in track_rule
    assert "touch-action: pan-y" in track_rule
    assert "scrollbar-gutter: stable" in track_rule


def test_presentation_images_open_an_accessible_lightbox() -> None:
    display = DISPLAY_SOURCE.read_text(encoding="utf-8")
    entity_card = ENTITY_CARD_SOURCE.read_text(encoding="utf-8")
    product_list = PRODUCT_LIST_SOURCE.read_text(encoding="utf-8")
    styles = STYLE_SOURCE.read_text(encoding="utf-8")

    assert "const [lightboxImage, setLightboxImage]" in display
    assert 'event.key === "Escape"' in display
    assert 'className="digital-display-image-lightbox"' in display
    assert 'role="dialog"' in display
    assert 'aria-modal="true"' in display
    assert display.count('className="digital-display-zoom-trigger digital-display-navigation-image"') == 2
    assert "onImageClick={openImageLightbox}" in display
    assert 'className="digital-display-zoom-trigger exhibition-entity-card-image"' in entity_card
    assert 'className="digital-display-zoom-trigger exhibition-product-list-image"' in product_list
    assert ".digital-display-image-lightbox { position: absolute; inset: 0;" in styles
