from __future__ import annotations

import torch

from scripts.export_realesrgan_x2_torchscript import _trace_and_maybe_freeze


def test_export_falls_back_to_traced_model_when_freeze_fails(monkeypatch) -> None:
    model = torch.nn.Upsample(scale_factor=2, mode="nearest").eval()
    sample = torch.zeros((1, 3, 4, 4), dtype=torch.float32)

    def fail_freeze(_module):
        raise RuntimeError("frozen_conv_folding internal assertion")

    monkeypatch.setattr(torch.jit, "freeze", fail_freeze)
    exported = _trace_and_maybe_freeze(model, sample)

    assert tuple(exported(sample).shape) == (1, 3, 8, 8)
