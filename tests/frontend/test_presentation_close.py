from pathlib import Path


DISPLAY_SOURCE = Path("apps/web/src/components/DigitalHumanDisplay.tsx")
APP_SOURCE = Path("apps/web/src/App.tsx")
STYLE_SOURCE = Path("apps/web/src/index.css")


def test_closing_a_presentation_restores_the_conversation_panel() -> None:
    source = DISPLAY_SOURCE.read_text(encoding="utf-8")

    assert "const closePresentation = useCallback" in source
    assert "onClose?.();" in source
    assert "revealConversation();" in source
    assert "closePresentation(onCloseNavigation)" in source
    assert "closePresentation(onCloseShoppingRegistration)" in source
    assert "closePresentation(() => onCloseEntity(entity.id))" in source


def test_a_stale_subtitle_only_hides_chat_while_a_presentation_is_active() -> None:
    source = DISPLAY_SOURCE.read_text(encoding="utf-8")

    assert "const subtitleActive = presentationActive && Boolean(subtitle?.trim());" in source


def test_presentation_subtitle_keeps_voice_input_mounted_and_visible() -> None:
    source = DISPLAY_SOURCE.read_text(encoding="utf-8")
    styles = STYLE_SOURCE.read_text(encoding="utf-8")
    input_start = source.index('<div className="digital-display-chat-input"')

    assert "!subtitleActive" not in source[input_start - 80:input_start]
    assert ".digital-display-chat-panel.is-subtitle-active { display: flex; }" in styles
    assert ".digital-display-chat-panel.is-subtitle-active { display: none; }" not in styles


def test_closing_registration_does_not_restore_the_dismissed_product_card() -> None:
    source = APP_SOURCE.read_text(encoding="utf-8")

    assert "enqueueSpeech(registration.spoken_text, text, [], true);" in source
    assert 'enqueueSpeech(englishConversation ? "The registration QR code is temporarily unavailable. Please try again later." : "登记二维码暂时无法生成，请稍后再试。", text, [], true);' in source


def test_registration_dialog_uses_the_same_lower_face_safe_area() -> None:
    source = STYLE_SOURCE.read_text(encoding="utf-8")

    assert ".digital-display-presentation-stack { position: absolute; top: 52%;" in source
    assert ".digital-display-presentation-stack { top: 52dvh;" in source
    assert ".digital-display-presentation-stack.is-registration { width:" in source
    assert ".digital-display-presentation-stack.is-registration { top:" not in source
    assert ".digital-display-presentation-stack .digital-display-waist-panel.is-registration { max-height: 100%; overflow-y: auto; }" in source
