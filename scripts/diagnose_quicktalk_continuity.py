#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

import cv2
import numpy as np

REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from opentalking.models.quicktalk.visual_transition import (
    MotionCompensatedTransition,
    should_reverse_for_idle_anchor,
)


def _endpoints(path: Path, max_edge: int) -> tuple[np.ndarray, np.ndarray]:
    capture = cv2.VideoCapture(str(path))
    first: np.ndarray | None = None
    last: np.ndarray | None = None
    try:
        while True:
            ok, frame = capture.read()
            if not ok or frame is None:
                break
            if first is None:
                first = frame
            last = frame
    finally:
        capture.release()
    if first is None or last is None:
        raise RuntimeError(f"No video frames decoded: {path}")

    height, width = first.shape[:2]
    scale = min(1.0, max_edge / float(max(height, width)))
    size = (max(2, int(round(width * scale))), max(2, int(round(height * scale))))
    if size != (width, height):
        first = cv2.resize(first, size, interpolation=cv2.INTER_AREA)
        last = cv2.resize(last, size, interpolation=cv2.INTER_AREA)
    return first, last


def _mad(source: np.ndarray, target: np.ndarray) -> float:
    if source.shape != target.shape:
        target = cv2.resize(target, (source.shape[1], source.shape[0]), cv2.INTER_AREA)
    return float(np.mean(np.abs(source.astype(np.float32) - target.astype(np.float32))))


def _transition_metrics(source: np.ndarray, target: np.ndarray, frames: int) -> dict[str, float]:
    transition = MotionCompensatedTransition.prepare(source, target, flow_max_edge=384)
    sequence = [source]
    sequence.extend(transition.render(target, (index + 1) / frames) for index in range(frames))
    steps = [_mad(left, right) for left, right in zip(sequence, sequence[1:])]
    return {
        "direct_boundary_mad": round(_mad(source, target), 4),
        "transition_max_step_mad": round(max(steps), 4),
        "transition_mean_step_mad": round(float(np.mean(steps)), 4),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Measure QuickTalk source-boundary continuity")
    parser.add_argument("--idle", type=Path, required=True)
    parser.add_argument("--talk", type=Path, action="append", required=True)
    parser.add_argument("--transition-frames", type=int, default=10)
    parser.add_argument("--analysis-max-edge", type=int, default=540)
    args = parser.parse_args()

    idle_first, idle_last = _endpoints(args.idle, args.analysis_max_edge)
    anchors: list[np.ndarray] = []
    results: dict[str, dict[str, float]] = {}
    for path in args.talk:
        first, last = _endpoints(path, args.analysis_max_edge)
        target = last if should_reverse_for_idle_anchor(idle_first, first, last) else first
        anchors.append(target)
        results[f"idle->{path.name}"] = _transition_metrics(
            idle_last,
            target,
            max(1, args.transition_frames),
        )
    for index, source in enumerate(anchors):
        target = anchors[(index + 1) % len(anchors)]
        results[f"talk{index + 1}->talk{(index + 1) % len(anchors) + 1}"] = (
            _transition_metrics(source, target, max(1, args.transition_frames))
        )
    print(json.dumps(results, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
