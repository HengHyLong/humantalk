#!/usr/bin/env python3
"""Export official Real-ESRGAN x2plus weights for QuickTalk face SR.

This conversion is intentionally separate from the realtime process. The
server only needs torch and the generated TorchScript file at runtime.
"""

from __future__ import annotations

import argparse
from pathlib import Path

import torch


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


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Export RealESRGAN_x2plus.pth to a QuickTalk TorchScript model."
    )
    parser.add_argument("--weights", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--device", default="cpu")
    args = parser.parse_args()

    try:
        from basicsr.archs.rrdbnet_arch import RRDBNet
    except ImportError as exc:
        raise SystemExit(
            "BasicSR is required only for conversion. Install the "
            "quicktalk-face-sr-export extra first."
        ) from exc

    device = torch.device(args.device)
    model = RRDBNet(
        num_in_ch=3,
        num_out_ch=3,
        num_feat=64,
        num_block=23,
        num_grow_ch=32,
        scale=2,
    )
    model.load_state_dict(_load_state(args.weights), strict=True)
    model = model.eval().to(device=device, dtype=torch.float32)
    sample = torch.zeros((1, 3, 256, 256), device=device, dtype=torch.float32)
    with torch.inference_mode():
        traced = torch.jit.trace(model, sample, strict=True)
        traced = torch.jit.freeze(traced.eval())
        output = traced(sample)
    if tuple(output.shape) != (1, 3, 512, 512):
        raise RuntimeError(f"unexpected exported model output shape: {tuple(output.shape)}")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    torch.jit.save(traced, str(args.output))
    print(f"Exported QuickTalk face SR model: {args.output.resolve()}")


if __name__ == "__main__":
    main()
