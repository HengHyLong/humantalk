#!/usr/bin/env python3
"""Export official Real-ESRGAN x2plus weights for QuickTalk face SR.

This conversion is intentionally separate from the realtime process. The
server only needs torch and the generated TorchScript file at runtime.
"""

from __future__ import annotations

import argparse
import logging
from pathlib import Path

import torch
from torch import nn
from torch.nn import functional as F

log = logging.getLogger(__name__)


# Standalone, checkpoint-compatible reimplementation of BasicSR's RRDBNet.
# BasicSR is Apache-2.0 licensed: https://github.com/XPixelGroup/BasicSR
# The registry/config helpers were removed so exporting does not require the
# legacy BasicSR package or its build-time dependencies.
class ResidualDenseBlock(nn.Module):
    def __init__(self, num_feat: int = 64, num_grow_ch: int = 32) -> None:
        super().__init__()
        self.conv1 = nn.Conv2d(num_feat, num_grow_ch, 3, 1, 1)
        self.conv2 = nn.Conv2d(num_feat + num_grow_ch, num_grow_ch, 3, 1, 1)
        self.conv3 = nn.Conv2d(num_feat + 2 * num_grow_ch, num_grow_ch, 3, 1, 1)
        self.conv4 = nn.Conv2d(num_feat + 3 * num_grow_ch, num_grow_ch, 3, 1, 1)
        self.conv5 = nn.Conv2d(num_feat + 4 * num_grow_ch, num_feat, 3, 1, 1)
        self.lrelu = nn.LeakyReLU(negative_slope=0.2, inplace=True)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        x1 = self.lrelu(self.conv1(x))
        x2 = self.lrelu(self.conv2(torch.cat((x, x1), dim=1)))
        x3 = self.lrelu(self.conv3(torch.cat((x, x1, x2), dim=1)))
        x4 = self.lrelu(self.conv4(torch.cat((x, x1, x2, x3), dim=1)))
        x5 = self.conv5(torch.cat((x, x1, x2, x3, x4), dim=1))
        return x + x5 * 0.2


class RRDB(nn.Module):
    def __init__(self, num_feat: int = 64, num_grow_ch: int = 32) -> None:
        super().__init__()
        self.rdb1 = ResidualDenseBlock(num_feat, num_grow_ch)
        self.rdb2 = ResidualDenseBlock(num_feat, num_grow_ch)
        self.rdb3 = ResidualDenseBlock(num_feat, num_grow_ch)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        output = self.rdb3(self.rdb2(self.rdb1(x)))
        return x + output * 0.2


class RRDBNetX2(nn.Module):
    """Real-ESRGAN x2plus network with official checkpoint key names."""

    def __init__(self) -> None:
        super().__init__()
        num_feat = 64
        num_grow_ch = 32
        # x2 checkpoints pixel-unshuffle by 2 before the common x4 trunk.
        self.conv_first = nn.Conv2d(3 * 4, num_feat, 3, 1, 1)
        self.body = nn.Sequential(*(RRDB(num_feat, num_grow_ch) for _ in range(23)))
        self.conv_body = nn.Conv2d(num_feat, num_feat, 3, 1, 1)
        self.conv_up1 = nn.Conv2d(num_feat, num_feat, 3, 1, 1)
        self.conv_up2 = nn.Conv2d(num_feat, num_feat, 3, 1, 1)
        self.conv_hr = nn.Conv2d(num_feat, num_feat, 3, 1, 1)
        self.conv_last = nn.Conv2d(num_feat, 3, 3, 1, 1)
        self.lrelu = nn.LeakyReLU(negative_slope=0.2, inplace=True)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        feature = self.conv_first(F.pixel_unshuffle(x, 2))
        feature = feature + self.conv_body(self.body(feature))
        feature = self.lrelu(
            self.conv_up1(F.interpolate(feature, scale_factor=2, mode="nearest"))
        )
        feature = self.lrelu(
            self.conv_up2(F.interpolate(feature, scale_factor=2, mode="nearest"))
        )
        return self.conv_last(self.lrelu(self.conv_hr(feature)))


def _load_state(path: Path) -> dict[str, torch.Tensor]:
    try:
        payload = torch.load(path, map_location="cpu", weights_only=True)
    except TypeError:  # torch < 2.0
        payload = torch.load(path, map_location="cpu")
    if not isinstance(payload, dict):
        raise TypeError("Real-ESRGAN checkpoint must contain a state dictionary")
    state = payload.get("params_ema") or payload.get("params") or payload
    if not isinstance(state, dict):
        raise TypeError("Real-ESRGAN checkpoint params must be a dictionary")
    return state


def _trace_and_maybe_freeze(
    model: nn.Module,
    sample: torch.Tensor,
) -> torch.jit.ScriptModule:
    traced = torch.jit.trace(model, sample, strict=True).eval()
    try:
        return torch.jit.freeze(traced)
    except RuntimeError as exc:
        # Some PyTorch/CUDA combinations hit an internal assertion in
        # frozen_conv_folding. Freezing is only an optional optimization;
        # an eval-mode traced module has the same weights and output.
        log.warning(
            "TorchScript freeze failed; saving the compatible traced model instead: %s",
            exc,
        )
        return traced


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Export RealESRGAN_x2plus.pth to a QuickTalk TorchScript model."
    )
    parser.add_argument("--weights", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--device", default="cpu")
    args = parser.parse_args()

    device = torch.device(args.device)
    model = RRDBNetX2()
    model.load_state_dict(_load_state(args.weights), strict=True)
    model = model.eval().to(device=device, dtype=torch.float32)
    sample = torch.zeros((1, 3, 256, 256), device=device, dtype=torch.float32)
    with torch.inference_mode():
        traced = _trace_and_maybe_freeze(model, sample)
        output = traced(sample)
    if tuple(output.shape) != (1, 3, 512, 512):
        raise RuntimeError(f"unexpected exported model output shape: {tuple(output.shape)}")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    torch.jit.save(traced, str(args.output))
    print(f"Exported QuickTalk face SR model: {args.output.resolve()}")


if __name__ == "__main__":
    main()
