from __future__ import annotations

from dataclasses import dataclass
import json
from pathlib import Path
from typing import Any

try:
    import cv2
except ImportError:  # OpenCV is only needed when preparing Wav2Lip video assets.
    cv2 = None  # type: ignore[assignment]

from opentalking.avatar import mouth_metadata


@dataclass(frozen=True)
class Wav2LipVideoFrames:
    frame_count: int
    fps: int
    source_fps: float
    source_frame_count: int
    metadata_path: Path


def _frame_mouth_metadata(frame_path: Path, frame: Any) -> dict[str, Any] | None:
    landmarks = mouth_metadata.detect_mouth_landmarks(frame)
    if landmarks is None:
        return None
    height, width = frame.shape[:2]
    return {
        "mouth_polygon_source": "mediapipe",
        "source_frame_hash": mouth_metadata.image_file_sha256(frame_path),
        "face_box": mouth_metadata._normalized_face_box(landmarks, width=width, height=height),
        "animation": mouth_metadata._animation_from_landmarks(landmarks, width=width, height=height),
    }


def prepare_wav2lip_video_frames(
    source_video: Path,
    frames_dir: Path,
    *,
    width: int,
    height: int,
    fps: int,
    max_frames: int,
    jpeg_quality: int = 95,
) -> Wav2LipVideoFrames:
    """Extract a bounded, motion-preserving Wav2Lip reference-frame sequence."""

    if cv2 is None:
        raise RuntimeError(
            "OpenCV is required to prepare Wav2Lip video assets; install the project's video extras first."
        )

    capture = cv2.VideoCapture(str(source_video))
    if not capture.isOpened():
        raise RuntimeError(f"failed to open Wav2Lip source video: {source_video}")

    source_fps = float(capture.get(cv2.CAP_PROP_FPS) or 0.0)
    source_frame_count = int(capture.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    target_fps = max(1, int(fps))
    if source_fps > 0:
        target_fps = min(target_fps, max(1, int(round(source_fps))))

    frames_dir.mkdir(parents=True, exist_ok=True)
    for stale in frames_dir.iterdir():
        if stale.is_file() and (
            stale.suffix.lower() in {".jpg", ".jpeg", ".png", ".webp"}
            or stale.name == "mouth_metadata.json"
        ):
            stale.unlink()

    frame_metadata: dict[str, Any] = {}
    missing_metadata: list[str] = []
    source_index = 0
    output_index = 0
    quality = max(1, min(100, int(jpeg_quality)))
    try:
        while output_index < max(1, int(max_frames)):
            ok, frame = capture.read()
            if not ok:
                break

            if source_fps > 0:
                expected_source_index = int(round(output_index * source_fps / target_fps))
                if source_index < expected_source_index:
                    source_index += 1
                    continue

            if frame.shape[1] != width or frame.shape[0] != height:
                frame = cv2.resize(frame, (int(width), int(height)), interpolation=cv2.INTER_AREA)

            frame_name = f"frame_{output_index:05d}.jpg"
            frame_path = frames_dir / frame_name
            if not cv2.imwrite(
                str(frame_path),
                frame,
                [int(cv2.IMWRITE_JPEG_QUALITY), quality],
            ):
                raise RuntimeError(f"failed to write Wav2Lip reference frame: {frame_path}")

            metadata = _frame_mouth_metadata(frame_path, frame)
            if metadata is None:
                missing_metadata.append(frame_name)
            else:
                frame_metadata[frame_name] = metadata
            output_index += 1
            source_index += 1
    finally:
        capture.release()

    if output_index <= 0:
        raise RuntimeError(f"no frames extracted from Wav2Lip source video: {source_video}")

    metadata_path = frames_dir / "mouth_metadata.json"
    metadata_path.write_text(
        json.dumps(
            {
                "version": 1,
                "frames": frame_metadata,
                "missing_frames": missing_metadata,
            },
            ensure_ascii=False,
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    return Wav2LipVideoFrames(
        frame_count=output_index,
        fps=target_fps,
        source_fps=source_fps,
        source_frame_count=source_frame_count,
        metadata_path=metadata_path,
    )
