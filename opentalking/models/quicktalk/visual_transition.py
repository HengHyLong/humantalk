from __future__ import annotations

from dataclasses import dataclass

import cv2
import numpy as np


def smoothstep(value: float) -> float:
    """Return a C1-continuous transition weight in the inclusive 0..1 range."""
    x = min(1.0, max(0.0, float(value)))
    return x * x * (3.0 - 2.0 * x)


def _resize_flow(flow: np.ndarray, width: int, height: int) -> np.ndarray:
    source_height, source_width = flow.shape[:2]
    resized = cv2.resize(flow, (width, height), interpolation=cv2.INTER_LINEAR)
    resized[..., 0] *= width / float(max(1, source_width))
    resized[..., 1] *= height / float(max(1, source_height))
    return resized


def _optical_flow(source: np.ndarray, target: np.ndarray, max_edge: int) -> np.ndarray:
    height, width = source.shape[:2]
    scale = min(1.0, max_edge / float(max(height, width))) if max_edge > 0 else 1.0
    work_width = max(32, int(round(width * scale)))
    work_height = max(32, int(round(height * scale)))
    source_gray = cv2.cvtColor(source, cv2.COLOR_BGR2GRAY)
    target_gray = cv2.cvtColor(target, cv2.COLOR_BGR2GRAY)
    if (work_width, work_height) != (width, height):
        source_gray = cv2.resize(source_gray, (work_width, work_height), interpolation=cv2.INTER_AREA)
        target_gray = cv2.resize(target_gray, (work_width, work_height), interpolation=cv2.INTER_AREA)
    flow = cv2.calcOpticalFlowFarneback(
        source_gray,
        target_gray,
        None,
        0.5,
        4,
        21,
        4,
        7,
        1.5,
        0,
    )
    if (work_width, work_height) != (width, height):
        flow = _resize_flow(flow, width, height)
    return flow.astype(np.float32, copy=False)


def frame_similarity_score(source: np.ndarray, target: np.ndarray) -> float:
    """Cheap full-frame pose/background distance used for endpoint selection."""
    size = (96, 96)
    source_small = cv2.resize(source, size, interpolation=cv2.INTER_AREA)
    target_small = cv2.resize(target, size, interpolation=cv2.INTER_AREA)
    source_gray = cv2.cvtColor(source_small, cv2.COLOR_BGR2GRAY).astype(np.float32)
    target_gray = cv2.cvtColor(target_small, cv2.COLOR_BGR2GRAY).astype(np.float32)
    return float(np.mean(np.abs(source_gray - target_gray)))


def should_reverse_for_idle_anchor(
    idle_anchor: np.ndarray,
    first_frame: np.ndarray,
    last_frame: np.ndarray,
) -> bool:
    return frame_similarity_score(idle_anchor, last_frame) < frame_similarity_score(
        idle_anchor,
        first_frame,
    )


def source_alignment_transform(
    reference_face_affine: np.ndarray,
    source_face_affine: np.ndarray,
) -> np.ndarray:
    """Map a source frame so its detected face matches the reference frame."""
    reference = np.vstack(
        [np.asarray(reference_face_affine, dtype=np.float64), [0.0, 0.0, 1.0]]
    )
    source = np.vstack(
        [np.asarray(source_face_affine, dtype=np.float64), [0.0, 0.0, 1.0]]
    )
    transform = np.linalg.inv(reference) @ source
    return transform[:2].astype(np.float32)


def warp_frame_to_reference(frame: np.ndarray, transform: np.ndarray) -> np.ndarray:
    height, width = frame.shape[:2]
    return cv2.warpAffine(
        frame,
        np.asarray(transform, dtype=np.float32),
        (width, height),
        flags=cv2.INTER_LANCZOS4,
        borderMode=cv2.BORDER_REFLECT_101,
    )


@dataclass
class MotionCompensatedTransition:
    """Warp two endpoint frames toward each other before blending them.

    A plain opacity crossfade shows two poses at once.  Motion compensation
    moves the pixels along their estimated trajectory first, so the boundary
    reads as one continuous movement instead of a video dissolve.
    """

    source: np.ndarray
    source_to_target: np.ndarray
    target_to_source: np.ndarray
    grid_x: np.ndarray
    grid_y: np.ndarray

    @classmethod
    def prepare(
        cls,
        source: np.ndarray,
        target: np.ndarray,
        *,
        flow_max_edge: int = 384,
    ) -> "MotionCompensatedTransition":
        source_frame = np.ascontiguousarray(source, dtype=np.uint8)
        target_frame = np.ascontiguousarray(target, dtype=np.uint8)
        if source_frame.shape != target_frame.shape:
            target_frame = cv2.resize(
                target_frame,
                (source_frame.shape[1], source_frame.shape[0]),
                interpolation=cv2.INTER_LANCZOS4,
            )
        height, width = source_frame.shape[:2]
        grid_x, grid_y = np.meshgrid(
            np.arange(width, dtype=np.float32),
            np.arange(height, dtype=np.float32),
        )
        return cls(
            source=source_frame.copy(),
            source_to_target=_optical_flow(source_frame, target_frame, flow_max_edge),
            target_to_source=_optical_flow(target_frame, source_frame, flow_max_edge),
            grid_x=grid_x,
            grid_y=grid_y,
        )

    def render(self, target: np.ndarray, alpha: float) -> np.ndarray:
        weight = smoothstep(alpha)
        target_frame = np.ascontiguousarray(target, dtype=np.uint8)
        if target_frame.shape != self.source.shape:
            target_frame = cv2.resize(
                target_frame,
                (self.source.shape[1], self.source.shape[0]),
                interpolation=cv2.INTER_LANCZOS4,
            )
        if weight <= 0.0:
            return self.source.copy()
        if weight >= 1.0:
            return target_frame.copy()

        source_map_x = self.grid_x - self.source_to_target[..., 0] * weight
        source_map_y = self.grid_y - self.source_to_target[..., 1] * weight
        target_map_x = self.grid_x - self.target_to_source[..., 0] * (1.0 - weight)
        target_map_y = self.grid_y - self.target_to_source[..., 1] * (1.0 - weight)
        warped_source = cv2.remap(
            self.source,
            source_map_x,
            source_map_y,
            interpolation=cv2.INTER_LINEAR,
            borderMode=cv2.BORDER_REFLECT_101,
        )
        warped_target = cv2.remap(
            target_frame,
            target_map_x,
            target_map_y,
            interpolation=cv2.INTER_LINEAR,
            borderMode=cv2.BORDER_REFLECT_101,
        )
        return cv2.addWeighted(warped_source, 1.0 - weight, warped_target, weight, 0.0)
