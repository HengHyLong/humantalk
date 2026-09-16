from __future__ import annotations

import numpy as np

from opentalking.models.quicktalk.visual_transition import (
    MotionCompensatedTransition,
    source_alignment_transform,
    should_reverse_for_idle_anchor,
    smoothstep,
)


def test_smoothstep_keeps_exact_endpoints() -> None:
    assert smoothstep(-1.0) == 0.0
    assert smoothstep(0.0) == 0.0
    assert smoothstep(0.5) == 0.5
    assert smoothstep(1.0) == 1.0
    assert smoothstep(2.0) == 1.0


def test_motion_compensated_transition_returns_exact_first_and_last_frames() -> None:
    source = np.zeros((48, 64, 3), dtype=np.uint8)
    target = np.zeros_like(source)
    source[12:28, 8:24] = (255, 255, 255)
    target[12:28, 32:48] = (255, 255, 255)

    transition = MotionCompensatedTransition.prepare(source, target, flow_max_edge=64)

    assert np.array_equal(transition.render(target, 0.0), source)
    assert np.array_equal(transition.render(target, 1.0), target)
    middle = transition.render(target, 0.5)
    assert middle.shape == source.shape
    assert middle.dtype == np.uint8
    assert 0 < int(middle.sum())


def test_motion_group_prefers_the_idle_nearest_endpoint() -> None:
    idle = np.zeros((24, 24, 3), dtype=np.uint8)
    far = np.full_like(idle, 255)
    near = np.full_like(idle, 8)
    assert should_reverse_for_idle_anchor(idle, far, near) is True
    assert should_reverse_for_idle_anchor(idle, near, far) is False


def test_source_alignment_transform_matches_reference_face_coordinates() -> None:
    reference = np.array([[2.0, 0.0, -20.0], [0.0, 2.0, -40.0]], dtype=np.float32)
    source = np.array([[1.0, 0.0, -30.0], [0.0, 1.0, -50.0]], dtype=np.float32)
    transform = source_alignment_transform(reference, source)
    source_point = np.array([70.0, 90.0, 1.0], dtype=np.float32)

    assert np.allclose(transform @ source_point, [30.0, 40.0])
