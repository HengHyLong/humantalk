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
    """Play uploaded clips in order, advancing after each complete clip.

    A lone clip keeps seamless ping-pong playback.  With several clips, the
    caller blends the boundary between groups while speech continues.
    """
    if not groups or any(not group for group in groups):
        raise ValueError("QuickTalk motion context groups must be non-empty")
    selected_group = group_index % len(groups)
    contexts = groups[selected_group]
    cursor = max(0, int(frame_index))
    if len(groups) == 1:
        context = contexts[ping_pong_frame_index(frame_index=cursor, frame_count=len(contexts))]
        return context, selected_group, cursor + 1
    context = contexts[cursor % len(contexts)]
    next_cursor = cursor % len(contexts) + 1
    if next_cursor == len(contexts):
        return context, (selected_group + 1) % len(groups), 0
    return context, selected_group, next_cursor


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
