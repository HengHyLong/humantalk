from pathlib import Path


WEB = Path("apps/web/src")


def test_voice_listener_pauses_for_the_full_assistant_turn() -> None:
    app = (WEB / "App.tsx").read_text(encoding="utf-8")
    chat_input = (WEB / "components" / "ChatInput.tsx").read_text(encoding="utf-8")
    display = (WEB / "components" / "DigitalHumanDisplay.tsx").read_text(encoding="utf-8")

    assert "const [voiceTurnActive, setVoiceTurnActive]" in app
    assert "setVoiceTurnActive(true)" in app
    assert "setVoiceTurnActive(false)" in app
    assert "suspendListening={voiceTurnActive || isSpeaking" in app
    assert "suspendListening?: boolean" in chat_input
    assert "suspendDuringTurn" in chat_input
    assert "const hardPaused = d || vb || uploadLockRef.current || suspendDuringTurn" in chat_input
    assert "suspendListening={suspendListening}" in display


def test_paused_streaming_stt_does_not_keep_preroll_audio() -> None:
    source = (WEB / "components" / "ChatInput.tsx").read_text(encoding="utf-8")

    assert "!uiRef.current.suspendListening && !pcmSendGateRef.current" in source
    assert "pcmPrerollRef.current = new Int16Array(0);" in source
