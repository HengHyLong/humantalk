from __future__ import annotations

import torch
import torch.nn.functional as F

from opentalking.models.quicktalk.face_super_resolution import create_face_super_resolution
from opentalking.models.quicktalk.runtime import RealtimeV3SessionState, RealtimeV3Worker


class _FakeEnhancer:
    def __init__(self, value: float = 1.0) -> None:
        self.value = value
        self.calls = 0

    def enhance(self, patch: torch.Tensor) -> torch.Tensor:
        self.calls += 1
        return torch.full(
            (patch.shape[0], patch.shape[1] * 2, patch.shape[2] * 2),
            self.value,
            dtype=patch.dtype,
            device=patch.device,
        )


def _worker(enhancer: _FakeEnhancer | None) -> RealtimeV3Worker:
    worker = RealtimeV3Worker.__new__(RealtimeV3Worker)
    worker.face_super_resolution = enhancer
    worker.face_sr_strength = 0.5
    worker.face_sr_temporal_alpha = 0.75
    worker.face_sr_min_roi_edge = 320
    worker.face_sr_interval = 1
    return worker


def test_face_sr_enhances_before_roi_resize_and_records_temporal_detail() -> None:
    enhancer = _FakeEnhancer()
    worker = _worker(enhancer)
    state = RealtimeV3SessionState()
    patch = torch.zeros((3, 2, 2), dtype=torch.float32)

    enhanced = worker._enhance_face_patch(
        patch,
        target_height=500,
        target_width=400,
        state=state,
    )

    assert enhanced.shape == (3, 4, 4)
    assert torch.allclose(enhanced, torch.full_like(enhanced, 0.5))
    assert state.face_sr_previous_detail is not None
    assert enhancer.calls == 1


def test_face_sr_temporal_filter_smooths_only_the_added_detail() -> None:
    enhancer = _FakeEnhancer(1.0)
    worker = _worker(enhancer)
    state = RealtimeV3SessionState()
    patch = torch.zeros((3, 2, 2), dtype=torch.float32)
    worker._enhance_face_patch(patch, target_height=500, target_width=400, state=state)

    enhancer.value = 0.0
    second = worker._enhance_face_patch(
        patch,
        target_height=500,
        target_width=400,
        state=state,
    )

    # Current detail is zero and the previous detail contributes 25%; strength is 50%.
    assert torch.allclose(second, torch.full_like(second, 0.125))


def test_face_sr_interval_reuses_only_detail_with_current_mouth_base() -> None:
    enhancer = _FakeEnhancer(1.0)
    worker = _worker(enhancer)
    worker.face_sr_interval = 2
    state = RealtimeV3SessionState()

    first_patch = torch.zeros((3, 2, 2), dtype=torch.float32)
    worker._enhance_face_patch(
        first_patch,
        target_height=500,
        target_width=400,
        state=state,
    )
    current_patch = torch.full((3, 2, 2), 0.25, dtype=torch.float32)
    second = worker._enhance_face_patch(
        current_patch,
        target_height=500,
        target_width=400,
        state=state,
    )

    assert enhancer.calls == 1
    # Current-frame low-frequency content is 0.25; only cached detail is reused.
    assert torch.allclose(second, torch.full_like(second, 0.75))


def test_face_sr_interval_runs_again_on_scheduled_frame() -> None:
    enhancer = _FakeEnhancer(1.0)
    worker = _worker(enhancer)
    worker.face_sr_interval = 2
    state = RealtimeV3SessionState()
    patch = torch.zeros((3, 2, 2), dtype=torch.float32)

    for _ in range(3):
        worker._enhance_face_patch(
            patch,
            target_height=500,
            target_width=400,
            state=state,
        )

    assert enhancer.calls == 2


def test_face_sr_bypasses_small_face_roi() -> None:
    enhancer = _FakeEnhancer()
    worker = _worker(enhancer)
    state = RealtimeV3SessionState(face_sr_previous_detail=torch.ones((3, 4, 4)))
    patch = torch.rand((3, 2, 2), dtype=torch.float32)

    output = worker._enhance_face_patch(
        patch,
        target_height=240,
        target_width=180,
        state=state,
    )

    assert output is patch
    assert state.face_sr_previous_detail is None
    assert enhancer.calls == 0


def test_face_sr_failure_falls_back_to_original_patch() -> None:
    class _BrokenEnhancer:
        def enhance(self, patch: torch.Tensor) -> torch.Tensor:
            return patch

    worker = _worker(None)
    worker.face_super_resolution = _BrokenEnhancer()
    state = RealtimeV3SessionState()
    patch = torch.rand((3, 2, 2), dtype=torch.float32)

    output = worker._enhance_face_patch(
        patch,
        target_height=500,
        target_width=400,
        state=state,
    )

    assert output is patch
    assert state.face_sr_previous_detail is None


def test_session_reset_drops_face_sr_temporal_history() -> None:
    state = RealtimeV3SessionState(
        face_sr_previous_detail=torch.ones((3, 4, 4)),
        face_sr_frame_index=7,
    )
    state.reset()
    assert state.face_sr_previous_detail is None
    assert state.face_sr_frame_index == 0


def test_enabled_face_sr_without_model_path_is_fail_open(monkeypatch) -> None:
    monkeypatch.setenv("OPENTALKING_QUICKTALK_FACE_SR_ENABLED", "1")
    monkeypatch.delenv("OPENTALKING_QUICKTALK_FACE_SR_MODEL_PATH", raising=False)
    assert create_face_super_resolution(device=torch.device("cpu")) is None


def test_reference_bicubic_shape_matches_enhancer_contract() -> None:
    patch = torch.rand((3, 2, 2), dtype=torch.float32)
    assert F.interpolate(patch.unsqueeze(0), scale_factor=2).shape == (1, 3, 4, 4)
