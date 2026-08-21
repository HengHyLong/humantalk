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


def test_closing_registration_does_not_restore_the_dismissed_product_card() -> None:
    source = APP_SOURCE.read_text(encoding="utf-8")

    assert "enqueueSpeech(registration.spoken_text, text, [], true);" in source
    assert 'enqueueSpeech(englishConversation ? "The registration QR code is temporarily unavailable. Please try again later." : "登记二维码暂时无法生成，请稍后再试。", text, [], true);' in source


def test_registration_dialog_is_centered_on_desktop_and_mobile() -> None:
    source = STYLE_SOURCE.read_text(encoding="utf-8")
    centered_rule = ".digital-display-presentation-stack.is-registration { top: 50%;"

    assert source.count(centered_rule) == 2
    assert source.count("transform: translate(-50%, -50%);") >= 2
    assert ".digital-display-presentation-stack.is-registration { top: 55%;" not in source
