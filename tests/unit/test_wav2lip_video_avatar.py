from __future__ import annotations

import json

import numpy as np

from opentalking.avatar import wav2lip_video


class _FakeCapture:
    def __init__(self, frames: list[np.ndarray], *, fps: float) -> None:
        self.frames = frames
        self.fps = fps
        self.index = 0
        self.released = False

    def isOpened(self) -> bool:
        return True

    def get(self, prop: int) -> float:
        if prop == wav2lip_video.cv2.CAP_PROP_FPS:
            return self.fps
        if prop == wav2lip_video.cv2.CAP_PROP_FRAME_COUNT:
            return float(len(self.frames))
        return 0.0

    def read(self):
        if self.index >= len(self.frames):
            return False, None
        frame = self.frames[self.index]
        self.index += 1
        return True, frame.copy()

    def release(self) -> None:
        self.released = True


def test_prepare_wav2lip_video_frames_resamples_and_writes_metadata(tmp_path, monkeypatch):
    frames = [np.full((8, 6, 3), index, dtype=np.uint8) for index in range(12)]
    capture = _FakeCapture(frames, fps=50.0)
    monkeypatch.setattr(wav2lip_video.cv2, "VideoCapture", lambda path: capture)
    monkeypatch.setattr(
        wav2lip_video.mouth_metadata,
        "detect_mouth_landmarks",
        lambda frame: None,
    )

    result = wav2lip_video.prepare_wav2lip_video_frames(
        tmp_path / "source.mp4",
        tmp_path / "frames",
        width=12,
        height=16,
        fps=25,
        max_frames=4,
        jpeg_quality=90,
    )

    assert capture.released is True
    assert result.frame_count == 4
    assert result.fps == 25
    assert result.source_fps == 50.0
    assert result.source_frame_count == 12
    written = sorted((tmp_path / "frames").glob("frame_*.jpg"))
    assert [path.name for path in written] == [
        "frame_00000.jpg",
        "frame_00001.jpg",
        "frame_00002.jpg",
        "frame_00003.jpg",
    ]
    metadata = json.loads(result.metadata_path.read_text(encoding="utf-8"))
    assert metadata["frames"] == {}
    assert metadata["missing_frames"] == [path.name for path in written]
