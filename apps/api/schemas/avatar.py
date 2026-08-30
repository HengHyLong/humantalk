from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, Field

PersonMode = Literal["single", "double"]
MotionState = Literal["idle", "welcome", "listen", "think", "talk", "emphasis"]


class DuoDialogCapability(BaseModel):
    speaker_faces: dict[str, str]
    default_voices: dict[str, str] = Field(default_factory=dict)


class AvatarPersonModeUpdate(BaseModel):
    person_mode: PersonMode


class ClientRendererCapability(BaseModel):
    type: Literal["light2d"]
    config_url: str
    asset_base_url: str
    recommended_for: list[str] = Field(default_factory=list)


class VideoDriverCapability(BaseModel):
    listen_url: str
    think_url: str
    talk_url: str
    states: dict[str, list[str]] = Field(default_factory=dict)


class MotionClipCapability(BaseModel):
    id: str
    state: MotionState
    filename: str
    url: str


class MotionDriverCapability(BaseModel):
    states: dict[str, list[MotionClipCapability]] = Field(default_factory=dict)
    total_clips: int = 0


class AvatarSummary(BaseModel):
    id: str
    name: Optional[str] = None
    model_type: str
    width: int
    height: int
    person_mode: PersonMode = "single"
    # True for avatars created via POST /avatars/custom; only these are deletable.
    is_custom: bool = False
    has_preview_video: bool = False
    matting_status: str = "unknown"
    duo_dialog: Optional[DuoDialogCapability] = None
    client_renderer: Optional[ClientRendererCapability] = None
    video_driver: Optional[VideoDriverCapability] = None
    motion_driver: Optional[MotionDriverCapability] = None
