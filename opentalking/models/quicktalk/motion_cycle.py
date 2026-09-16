from __future__ import annotations

from typing import TypeVar


T = TypeVar("T")


def ping_pong_frame_index(*, frame_index: int, frame_count: int) -> int:
    """Map a monotonic cursor onto a seamless forward/backward frame cycle.

    The turning frames are emitted once instead of twice.  For four source
    frames the resulting sequence is ``0, 1, 2, 3, 2, 1, 0, 1, ...``.  This
    avoids both the end-to-start visual jump and the small freeze caused by
    repeating the first/last frame at a direction change.
    """
    count = int(frame_count)
    if count <= 0:
        raise ValueError("QuickTalk motion frame count must be positive")
    if count == 1:
        return 0
    period = 2 * (count - 1)
    phase = max(0, int(frame_index)) % period
    return phase if phase < count else period - phase


def next_motion_context(
    groups: list[list[T]],
    *,
    group_index: int,
    frame_index: int,
) -> tuple[T, int, int]:
    """Return a frame from one stable motion clip using seamless ping-pong playback.

    A speaking turn deliberately stays on one motion group.  Switching between
    unrelated uploaded clips inside the same WebRTC stream creates a large pose
    discontinuity which remains visible even when crossfaded.  The next group
    is selected by :func:`reset_motion_cursor` between utterances instead.
    """
    if not groups or any(not group for group in groups):
        raise ValueError("QuickTalk motion context groups must be non-empty")
    selected_group = group_index % len(groups)
    contexts = groups[selected_group]
    selected_frame = ping_pong_frame_index(
        frame_index=frame_index,
        frame_count=len(contexts),
    )
    context = contexts[selected_frame]
    return context, selected_group, max(0, int(frame_index)) + 1


def reset_motion_cursor(
    *,
    emitted_frames: int,
    group_index: int,
    group_count: int,
) -> tuple[int, int]:
    """Start a later utterance on the next clip without skipping the first clip."""
    count = max(1, int(group_count))
    if emitted_frames > 0 and count > 1:
        group_index = (group_index + 1) % count
    return group_index % count, 0


def motion_crossfade_alpha(*, frame_index: int, frame_count: int) -> float:
    """Return the new-clip weight for a bounded motion transition."""
    if frame_count <= 0:
        return 1.0
    return min(1.0, max(0.0, float(frame_index) / float(frame_count)))
