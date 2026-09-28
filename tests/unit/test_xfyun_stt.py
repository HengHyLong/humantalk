import base64
import json
from urllib.parse import parse_qs, urlparse

from opentalking.providers.llm.openai_compatible.conversation import ConversationHistory
from opentalking.providers.stt.xfyun import adapter as xfyun


def test_xfyun_signed_url_contains_valid_auth() -> None:
    url = xfyun.signed_url("test-key", "test-secret", date="Mon, 01 Jan 2024 00:00:00 GMT")
    parsed = urlparse(url)
    params = parse_qs(parsed.query)
    auth = base64.b64decode(params["authorization"][0]).decode()
    assert parsed.hostname == xfyun.HOST
    assert 'api_key="test-key"' in auth
    assert 'signature="' in auth


def test_xfyun_transcription_frames_and_result(monkeypatch) -> None:
    sent = []
    answer = base64.b64encode(json.dumps({"ws": [{"cw": [{"w": "你好"}]}]}).encode()).decode()

    class Socket:
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

        def send(self, value):
            sent.append(json.loads(value))

        def recv(self, timeout):
            return json.dumps({"header": {"code": 0, "status": 2}, "payload": {"result": {"text": answer}}})

    monkeypatch.setattr(xfyun, "connect", lambda *_args, **_kwargs: Socket())
    monkeypatch.setattr(xfyun.time, "sleep", lambda _seconds: None)
    text, _elapsed = xfyun.XfyunSTTAdapter("app", "key", "secret")._transcribe(b"\0" * 2560)
    assert text == "你好"
    assert [frame["header"]["status"] for frame in sent] == [0, 1, 2]
    assert sent[0]["parameter"]["iat"]["language"] == "mul_cn"


def test_new_llm_conversation_starts_after_three_completed_turns() -> None:
    history = ConversationHistory(system_prompt="system", reset_after_turns=3)
    for number in range(3):
        history.add_user(f"question {number}")
        history.add_assistant(f"answer {number}")
    history.add_user("next visitor")
    assert history.get_messages() == [
        {"role": "system", "content": "system"},
        {"role": "user", "content": "next visitor"},
    ]
