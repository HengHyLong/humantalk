from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
APP_SOURCE = ROOT / "apps" / "web" / "src" / "App.tsx"
RUNNER_SOURCE = ROOT / "opentalking" / "pipeline" / "speak" / "synthesis_runner.py"


def test_direct_speech_text_is_visible_before_media_is_ready() -> None:
    source = APP_SOURCE.read_text(encoding="utf-8")

    assert "if (direct) setCurrentSubtitle(text);" in source
    assert 'text: direct ? text : "正在合成语音和口型..."' in source
    assert "if (immediateText) setCurrentSubtitle(immediateText);" in source


def test_speech_started_event_identifies_direct_responses() -> None:
    source = RUNNER_SOURCE.read_text(encoding="utf-8")

    assert '{"session_id": self.session_id, "text": text, "direct": direct}' in source
