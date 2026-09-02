from __future__ import annotations

import numpy as np

from opentalking.models.quicktalk.motion_cycle import (
    motion_crossfade_alpha,
    next_motion_context,
    reset_motion_cursor,
)
from opentalking.pipeline.speak.idle_frames import loop_crossfade_alpha
from opentalking.pipeline.speak.synthesis_runner import FlashTalkRunner, _LoopingIdleVideo


def test_quicktalk_idle_video_uses_the_full_source_duration_before_repeating() -> None:
    idle_video = object.__new__(_LoopingIdleVideo)
    idle_video.source_fps = 24.0
    idle_video.output_fps = 25.0
    idle_video.frame_count = 241

    assert [idle_video.source_index_for_output(index) for index in (0, 1, 250, 251, 252)] == [
        0,
        0,
        240,
        240,
        0,
    ]


def test_dynamic_idle_frames_are_configured_for_forward_looping() -> None:
    runner = object.__new__(FlashTalkRunner)
    frames = [np.zeros((2, 2, 3), dtype=np.uint8) for _ in range(3)]

    runner._set_idle_frames(frames, playback_mode="loop")

    assert runner._idle_playback_indices == [0, 1, 2]


def test_quicktalk_multi_motion_templates_play_forward_and_advance_without_repeat() -> None:
    groups = [["talk-a-0", "talk-a-1"], ["talk-b-0", "talk-b-1"]]
    group_index = 0
    frame_index = 0
    sequence = []
    for _ in range(6):
        context, group_index, frame_index = next_motion_context(
            groups,
            group_index=group_index,
            frame_index=frame_index,
        )
        sequence.append(context)

    assert sequence == [
        "talk-a-0",
        "talk-a-1",
        "talk-b-0",
        "talk-b-1",
        "talk-a-0",
        "talk-a-1",
    ]


def test_quicktalk_idle_video_fades_the_tail_exactly_into_the_first_frame() -> None:
    assert loop_crossfade_alpha(91, frame_count=100, crossfade_frames=8) == 0.0
    assert loop_crossfade_alpha(92, frame_count=100, crossfade_frames=8) == 0.125
    assert loop_crossfade_alpha(95, frame_count=100, crossfade_frames=8) == 0.5
    assert loop_crossfade_alpha(99, frame_count=100, crossfade_frames=8) == 1.0


def test_quicktalk_idle_video_crossfade_is_bounded_for_short_sources() -> None:
    assert loop_crossfade_alpha(5, frame_count=8, crossfade_frames=20) == 0.0
    assert loop_crossfade_alpha(6, frame_count=8, crossfade_frames=20) == 0.5
    assert loop_crossfade_alpha(7, frame_count=8, crossfade_frames=20) == 1.0


def test_quicktalk_speech_reset_starts_the_next_motion_template() -> None:
    group_index, frame_index = reset_motion_cursor(
        emitted_frames=1,
        group_index=0,
        group_count=2,
    )

    context, _, _ = next_motion_context(
        [["talk-a-0"], ["talk-b-0"]],
        group_index=group_index,
        frame_index=frame_index,
    )
    assert context == "talk-b-0"


def test_quicktalk_motion_crossfade_reaches_the_new_clip_without_overshooting() -> None:
    assert motion_crossfade_alpha(frame_index=0, frame_count=6) == 0.0
    assert motion_crossfade_alpha(frame_index=3, frame_count=6) == 0.5
    assert motion_crossfade_alpha(frame_index=6, frame_count=6) == 1.0
    assert motion_crossfade_alpha(frame_index=7, frame_count=6) == 1.0
    assert motion_crossfade_alpha(frame_index=1, frame_count=0) == 1.0
