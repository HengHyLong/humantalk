from __future__ import annotations

import logging
import os
from pathlib import Path
from typing import Any

import torch

log = logging.getLogger(__name__)


def _env_bool(name: str, default: bool = False) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def _env_float(name: str, default: float) -> float:
    try:
        return float(os.environ.get(name, str(default)))
    except ValueError:
        return default


def _env_int(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, str(default)))
    except ValueError:
        return default


def face_sr_cache_signature() -> tuple[Any, ...]:
    """Return the settings which make a cached QuickTalk worker SR-specific."""

    path = os.environ.get("OPENTALKING_QUICKTALK_FACE_SR_MODEL_PATH", "").strip()
    try:
        model_stat = Path(path).expanduser().stat() if path else None
    except OSError:
        model_stat = None
    return (
        _env_bool("OPENTALKING_QUICKTALK_FACE_SR_ENABLED"),
        path,
        int(model_stat.st_mtime_ns) if model_stat else 0,
        int(model_stat.st_size) if model_stat else 0,
        _env_bool("OPENTALKING_QUICKTALK_FACE_SR_FP16", True),
        _env_float("OPENTALKING_QUICKTALK_FACE_SR_STRENGTH", 0.7),
        _env_float("OPENTALKING_QUICKTALK_FACE_SR_TEMPORAL_ALPHA", 0.7),
        _env_int("OPENTALKING_QUICKTALK_FACE_SR_MIN_ROI_EDGE", 320),
        _env_int("OPENTALKING_QUICKTALK_FACE_SR_INTERVAL", 1),
    )


class TorchScriptFaceSuperResolution:
    """Optional 2x face-patch SR stage for the realtime QuickTalk path.

    The TorchScript model must accept and return an NCHW RGB tensor in [0, 1].
    QuickTalk's restored patch is BGR, so channel conversion stays inside this
    class and the rest of the compositor can continue to work in BGR.
    """

    def __init__(
        self,
        model_path: Path,
        *,
        device: torch.device,
        fp16: bool,
        patch_color_order: str,
    ) -> None:
        self.device = device
        self.fp16 = bool(fp16 and device.type == "cuda")
        self.dtype = torch.float16 if self.fp16 else torch.float32
        self.patch_color_order = patch_color_order
        self.model = torch.jit.load(str(model_path), map_location=device)
        self.model = self.model.eval().to(device=device, dtype=self.dtype)
        self._failed = False
        self._warmup()

    def _warmup(self) -> None:
        sample = torch.zeros((1, 3, 256, 256), device=self.device, dtype=self.dtype)
        with torch.inference_mode():
            output = self.model(sample)
        self._validate_output(output)
        if self.device.type == "cuda":
            torch.cuda.synchronize(self.device)

    @staticmethod
    def _validate_output(output: Any) -> torch.Tensor:
        if not isinstance(output, torch.Tensor):
            raise TypeError("face SR model must return a tensor")
        if output.ndim != 4 or output.shape[0] != 1 or output.shape[1] != 3:
            raise ValueError(
                "face SR output must have shape (1, 3, H, W), "
                f"got {tuple(output.shape)}"
            )
        return output

    def enhance(self, patch_bgr: torch.Tensor) -> torch.Tensor:
        if self._failed:
            return patch_bgr
        try:
            source_dtype = patch_bgr.dtype
            patch_rgb = patch_bgr[[2, 1, 0]] if self.patch_color_order == "bgr" else patch_bgr
            rgb = patch_rgb.unsqueeze(0).to(
                device=self.device,
                dtype=self.dtype,
            )
            with torch.inference_mode():
                output = self._validate_output(self.model(rgb.clamp(0.0, 1.0)))
            if output.shape[-2] <= rgb.shape[-2] or output.shape[-1] <= rgb.shape[-1]:
                raise ValueError(
                    "face SR model must increase both spatial dimensions, "
                    f"got input={tuple(rgb.shape)} output={tuple(output.shape)}"
                )
            output_patch = output[0, [2, 1, 0]] if self.patch_color_order == "bgr" else output[0]
            return output_patch.to(dtype=source_dtype).clamp(0.0, 1.0)
        except Exception:
            # A broken optional enhancer must not terminate a live conversation.
            self._failed = True
            log.exception("QuickTalk face super-resolution failed; disabling it for this worker")
            return patch_bgr


def create_face_super_resolution(
    *,
    device: torch.device,
    patch_color_order: str = "bgr",
) -> TorchScriptFaceSuperResolution | None:
    if not _env_bool("OPENTALKING_QUICKTALK_FACE_SR_ENABLED"):
        return None
    raw_path = os.environ.get("OPENTALKING_QUICKTALK_FACE_SR_MODEL_PATH", "").strip()
    if not raw_path:
        log.warning(
            "QuickTalk face SR is enabled but OPENTALKING_QUICKTALK_FACE_SR_MODEL_PATH is empty; "
            "continuing without face SR"
        )
        return None
    model_path = Path(raw_path).expanduser().resolve()
    if not model_path.is_file():
        log.warning("QuickTalk face SR model does not exist: %s; continuing without face SR", model_path)
        return None
    normalized_color_order = patch_color_order.strip().lower()
    if normalized_color_order not in {"rgb", "bgr"}:
        log.warning("Invalid QuickTalk face SR patch color order %r; using bgr", patch_color_order)
        normalized_color_order = "bgr"
    try:
        enhancer = TorchScriptFaceSuperResolution(
            model_path,
            device=device,
            fp16=_env_bool("OPENTALKING_QUICKTALK_FACE_SR_FP16", True),
            patch_color_order=normalized_color_order,
        )
    except Exception:
        log.exception("Cannot load QuickTalk face SR model %s; continuing without face SR", model_path)
        return None
    log.info(
        "QuickTalk face super-resolution active: model=%s device=%s fp16=%s",
        model_path,
        device,
        enhancer.fp16,
    )
    return enhancer


def face_sr_parameters() -> tuple[float, float, int, int]:
    strength = min(1.0, max(0.0, _env_float("OPENTALKING_QUICKTALK_FACE_SR_STRENGTH", 0.7)))
    temporal_alpha = min(
        1.0,
        max(0.0, _env_float("OPENTALKING_QUICKTALK_FACE_SR_TEMPORAL_ALPHA", 0.7)),
    )
    min_roi_edge = max(1, _env_int("OPENTALKING_QUICKTALK_FACE_SR_MIN_ROI_EDGE", 320))
    interval = max(1, _env_int("OPENTALKING_QUICKTALK_FACE_SR_INTERVAL", 1))
    return strength, temporal_alpha, min_roi_edge, interval
