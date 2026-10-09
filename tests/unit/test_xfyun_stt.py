import base64
import json
import queue
import threading
from urllib.parse import parse_qs, urlparse

import pytest

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
    responses = queue.Queue()
    answer = base64.b64encode(json.dumps({"ws": [{"cw": [{"w": "你好"}]}]}).encode()).decode()

    class Socket:
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

        def send(self, value):
            frame = json.loads(value)
            sent.append(frame)
            if frame["header"]["status"] == 2:
                responses.put(json.dumps({"header": {"code": 0, "status": 2}, "payload": {"result": {"text": answer}}}))

        def recv(self, timeout):
            try:
                return responses.get(timeout=timeout)
            except queue.Empty:
                raise TimeoutError from None

    monkeypatch.setattr(xfyun, "connect", lambda *_args, **_kwargs: Socket())
    text, _elapsed = xfyun.XfyunSTTAdapter("app", "key", "secret")._transcribe(b"\0" * 2560)
    assert text == "你好"
    assert [frame["header"]["status"] for frame in sent] == [0, 1, 2]
    assert sent[0]["parameter"]["iat"]["language"] == "mul_cn"


def _response(text="", *, status=1, **result_fields):
    result = {"ws": [{"cw": [{"w": text}]}], **result_fields}
    encoded = base64.b64encode(json.dumps(result).encode()).decode()
    return json.dumps({"header": {"code": 0, "status": status}, "payload": {"result": {"text": encoded}}})


class _StreamingSocket:
    def __init__(self):
        self.sent = []
        self.responses = queue.Queue()
        self.partial_received = threading.Event()
        self.closed = False

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        self.closed = True

    def send(self, value):
        frame = json.loads(value)
        self.sent.append(frame)
        if frame["header"]["status"] == 0:
            self.responses.put(_response("你好", sn=0))
        elif frame["header"]["status"] == 2:
            self.responses.put(_response("世界", sn=1, status=2))

    def recv(self, timeout):
        try:
            response = self.responses.get(timeout=timeout)
        except queue.Empty:
            raise TimeoutError from None
        if json.loads(response)["header"].get("status") == 1:
            self.partial_received.set()
        return response


def test_xfyun_sends_and_receives_before_microphone_ends(monkeypatch):
    socket = _StreamingSocket()
    monkeypatch.setattr(xfyun, "connect", lambda *_args, **_kwargs: socket)
    chunks = queue.Queue()
    result = []
    errors = []

    def recognize():
        try:
            result.append(xfyun.XfyunSTTAdapter("app", "key", "secret").transcribe_pcm_queue(chunks))
        except Exception as exc:
            errors.append(exc)

    worker = threading.Thread(target=recognize)
    worker.start()
    try:
        chunks.put(b"\0" * 1280)
        # No end sentinel yet: both sending AND receiving must already work.
        assert socket.partial_received.wait(2)
        assert [frame["header"]["status"] for frame in socket.sent] == [0]
        assert worker.is_alive()
        chunks.put(b"\1" * 1280)
    finally:
        chunks.put(None)
        worker.join(timeout=3)
    assert not worker.is_alive()
    assert not errors
    assert result[0][0] == "你好世界"
    assert [frame["header"]["status"] for frame in socket.sent] == [0, 1, 2]
    assert socket.closed


def test_xfyun_reframes_arbitrary_pcm_chunks_without_losing_tail(monkeypatch):
    socket = _StreamingSocket()
    monkeypatch.setattr(xfyun, "connect", lambda *_args, **_kwargs: socket)
    chunks = queue.Queue()
    pcm = bytes(range(256)) * 12  # 3072 bytes, including a short final packet.
    for chunk in (pcm[:1], pcm[1:700], b"", pcm[700:]):
        chunks.put(chunk)
    chunks.put(None)
    text, _elapsed = xfyun.XfyunSTTAdapter("app", "key", "secret").transcribe_pcm_queue(chunks)
    audio = [frame["payload"]["audio"] for frame in socket.sent[:-1]]
    assert [len(base64.b64decode(packet["audio"])) for packet in audio] == [1280, 1280, 512]
    assert b"".join(base64.b64decode(packet["audio"]) for packet in audio) == pcm
    assert [packet["seq"] for packet in audio] == [1, 2, 3]
    assert text == "你好世界"


def test_xfyun_bounds_close_wait_after_final_transcript(monkeypatch, caplog):
    socket = _StreamingSocket()
    options = {}
    def connect(*args, **kwargs):
        options.update(kwargs)
        return socket
    monkeypatch.setattr(xfyun, "connect", connect)
    chunks = queue.Queue()
    chunks.put(b"\0" * 1280)
    chunks.put(None)
    with caplog.at_level("INFO", logger=xfyun.__name__):
        text, _ = xfyun.XfyunSTTAdapter("app", "key", "secret").transcribe_pcm_queue(chunks)
    assert text == "你好世界"
    assert 0 < options['close_timeout'] < 1
    assert 'end_sent_to_final_ms=' in caplog.text
    assert socket.closed


def test_xfyun_server_error_stops_waiting_for_microphone(monkeypatch):
    socket = _StreamingSocket()
    socket.responses.put(json.dumps({"header": {"code": 101, "message": "denied"}}))
    monkeypatch.setattr(xfyun, "connect", lambda *_args, **_kwargs: socket)
    with pytest.raises(RuntimeError, match="101: denied"):
        xfyun.XfyunSTTAdapter("app", "key", "secret").transcribe_pcm_queue(queue.Queue())
    assert socket.closed
    assert not any(t.name == "xfyun-stt-receiver" for t in threading.enumerate())


def test_xfyun_dynamic_result_replaces_previous_text(monkeypatch):
    class Socket(_StreamingSocket):
        def send(self, value):
            frame = json.loads(value)
            self.sent.append(frame)
            if frame["header"]["status"] == 0:
                self.responses.put(_response("旧", sn=0))
                self.responses.put(_response("文本", sn=1))
            elif frame["header"]["status"] == 2:
                self.responses.put(_response("正确文本", sn=2, pgs="rpl", rg=[0, 1], status=2))

    socket = Socket()
    monkeypatch.setattr(xfyun, "connect", lambda *_args, **_kwargs: socket)
    text, _elapsed = xfyun.XfyunSTTAdapter("app", "key", "secret")._transcribe(b"\0" * 1280)
    assert text == "正确文本"


@pytest.mark.parametrize("pcm", [b"", b"\0" * 100])
def test_xfyun_empty_or_short_audio_has_first_and_end_frames(monkeypatch, pcm):
    socket = _StreamingSocket()
    monkeypatch.setattr(xfyun, "connect", lambda *_args, **_kwargs: socket)
    xfyun.XfyunSTTAdapter("app", "key", "secret")._transcribe(pcm)
    assert [frame["header"]["status"] for frame in socket.sent] == [0, 2]
    assert base64.b64decode(socket.sent[0]["payload"]["audio"]["audio"]) == pcm


def test_xfyun_final_result_timeout_cleans_up_receiver(monkeypatch):
    socket = _StreamingSocket()
    monkeypatch.setattr(socket, "send", lambda value: socket.sent.append(json.loads(value)))
    monkeypatch.setattr(xfyun, "connect", lambda *_args, **_kwargs: socket)
    monkeypatch.setattr(xfyun, "_RESULT_TIMEOUT", 0.02)
    with pytest.raises(TimeoutError, match="final result timed out"):
        xfyun.XfyunSTTAdapter("app", "key", "secret")._transcribe(b"\0" * 1280)
    assert socket.closed
    assert not any(t.name == "xfyun-stt-receiver" for t in threading.enumerate())


def test_xfyun_input_timeout_cleans_up_receiver(monkeypatch):
    socket = _StreamingSocket()
    monkeypatch.setattr(xfyun, "connect", lambda *_args, **_kwargs: socket)
    monkeypatch.setattr(xfyun, "_INPUT_TIMEOUT", 0.02)
    with pytest.raises(TimeoutError, match="audio input timed out"):
        xfyun.XfyunSTTAdapter("app", "key", "secret").transcribe_pcm_queue(queue.Queue())
    assert socket.closed
    assert not any(t.name == "xfyun-stt-receiver" for t in threading.enumerate())


def test_xfyun_send_failure_cleans_up_receiver(monkeypatch):
    socket = _StreamingSocket()

    def fail_send(_value):
        raise ConnectionError("connection lost")

    monkeypatch.setattr(socket, "send", fail_send)
    monkeypatch.setattr(xfyun, "connect", lambda *_args, **_kwargs: socket)
    with pytest.raises(ConnectionError, match="connection lost"):
        xfyun.XfyunSTTAdapter("app", "key", "secret")._transcribe(b"\0" * 1280)
    assert socket.closed
    assert not any(t.name == "xfyun-stt-receiver" for t in threading.enumerate())


def test_xfyun_stream_over_real_local_websocket(monkeypatch):
    from websockets.sync.server import serve

    first_audio = threading.Event()
    sent = []
    result = []
    errors = []
    chunks = queue.Queue()

    def handler(socket):
        for message in socket:
            frame = json.loads(message)
            sent.append(frame)
            if frame["header"]["status"] == 0:
                socket.send(_response("实时", sn=0))
                first_audio.set()
            elif frame["header"]["status"] == 2:
                socket.send(_response("识别", sn=1, status=2))
                return

    def recognize():
        try:
            result.append(xfyun.XfyunSTTAdapter("app", "key", "secret").transcribe_pcm_queue(chunks))
        except Exception as exc:
            errors.append(exc)

    with serve(handler, "127.0.0.1", 0) as server:
        port = server.socket.getsockname()[1]
        monkeypatch.setattr(xfyun, "signed_url", lambda *_args: f"ws://127.0.0.1:{port}")
        server_thread = threading.Thread(target=server.serve_forever)
        worker = threading.Thread(target=recognize)
        server_thread.start()
        worker.start()
        try:
            chunks.put(b"\0" * 1280)
            assert first_audio.wait(2)
            assert worker.is_alive()
            assert [frame["header"]["status"] for frame in sent] == [0]
        finally:
            chunks.put(None)
            worker.join(timeout=3)
            server.shutdown()
            server_thread.join(timeout=3)
        assert not worker.is_alive()
        assert not errors
        assert result[0][0] == "实时识别"
        assert [frame["header"]["status"] for frame in sent] == [0, 2]


@pytest.mark.parametrize(
    "pcm, error",
    [(b"\0", "complete 16-bit"), (b"\0" * (60 * 16000 * 2 + 2), "at most 60")],
    ids=["incomplete-sample", "over-60-seconds"],
)
def test_xfyun_stream_rejects_invalid_audio(monkeypatch, pcm, error):
    socket = _StreamingSocket()
    monkeypatch.setattr(xfyun, "connect", lambda *_args, **_kwargs: socket)
    chunks = queue.Queue()
    chunks.put(pcm)
    chunks.put(None)
    with pytest.raises(ValueError, match=error):
        xfyun.XfyunSTTAdapter("app", "key", "secret").transcribe_pcm_queue(chunks)
    assert socket.closed


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
