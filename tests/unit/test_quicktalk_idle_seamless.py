from pathlib import Path
from types import SimpleNamespace

import numpy as np
import pytest

from opentalking.pipeline.speak import synthesis_runner


def test_seamless_idle_preserves_frames_across_loop(monkeypatch):
    cv2 = pytest.importorskip("cv2")
    frames = [np.full((2, 2, 3), v, dtype=np.uint8) for v in (0, 80, 160, 240)]

    class Capture:
        cursor = 0

        def isOpened(self):
            return True

        def get(self, prop):
            return 25.0 if prop == cv2.CAP_PROP_FPS else len(frames)

        def set(self, prop, value):
            self.cursor = int(value)
            return True

        def read(self):
            if self.cursor >= len(frames):
                return False, None
            frame = frames[self.cursor]
            self.cursor += 1
            return True, frame

        def release(self):
            pass

    monkeypatch.setattr(cv2, "VideoCapture", lambda *args: Capture())
    monkeypatch.setenv("OPENTALKING_QUICKTALK_IDLE_CROSSFADE_FRAMES", "8")
    video = synthesis_runner._LoopingIdleVideo(
        Path("seamless.mp4"), width=2, height=2, output_fps=25, crossfade_frames=0,
    )
    try:
        assert video.loop_crossfade_frames == 0
        for expected in frames + frames[:2]:
            np.testing.assert_array_equal(video.next_frame(), expected)
    finally:
        video.close()


@pytest.mark.parametrize("metadata,expected", [({}, None), ({"idle_loop_crossfade_frames": 0}, 0)])
def test_idle_crossfade_override_is_avatar_specific(monkeypatch, metadata, expected):
    runner = object.__new__(synthesis_runner.FlashTalkRunner)
    runner.flashtalk = SimpleNamespace(width=1080, height=1440, fps=25)
    monkeypatch.setattr(runner, "_quicktalk_idle_video_path", lambda: Path("idle.mp4"))
    monkeypatch.setattr(runner, "_quicktalk_manifest_metadata", lambda: metadata)
    monkeypatch.setattr(synthesis_runner, "_LoopingIdleVideo", lambda path, **kwargs: kwargs)
    result = runner._open_quicktalk_reference_idle_video()
    assert result["crossfade_frames"] == expected
