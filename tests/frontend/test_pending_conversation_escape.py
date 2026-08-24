from pathlib import Path


APP_SOURCE = Path("apps/web/src/App.tsx")


def test_registration_confirmation_can_release_to_a_new_topic() -> None:
    source = APP_SOURCE.read_text(encoding="utf-8")
    block = source.split("const pendingShopping = pendingShoppingRegistrationRef.current;", 1)[1].split(
        "const pendingContent = pendingContentClarificationRef.current;",
        1,
    )[0]

    assert "classifyRegistrationFollowupDecision(" in block
    assert 'decision === "new_topic"' in block
    assert "pendingShoppingRegistrationRef.current = null;" in block


def test_content_clarification_can_release_to_a_new_topic() -> None:
    source = APP_SOURCE.read_text(encoding="utf-8")
    block = source.split("const pendingContent = pendingContentClarificationRef.current;", 1)[1].split(
        "const baseVoiceConfig",
        1,
    )[0]

    assert "classifyContentClarificationTurn(" in block
    assert 'choice === "new_topic"' in block
    assert "pendingContentClarificationRef.current = null;" in block
