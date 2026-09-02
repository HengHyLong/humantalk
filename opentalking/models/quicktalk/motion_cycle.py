from __future__ import annotations

from typing import TypeVar


T = TypeVar("T")


def next_motion_context(
    groups: list[list[T]],
    *,
    group_index: int,
    frame_index: int,
) -> tuple[T, int, int]:
    """Return the next context and cursor for forward, non-repeating clip playback."""
    if not groups or any(not group for group in groups):
        raise ValueError("QuickTalk motion context groups must be non-empty")
    selected_group = group_index % len(groups)
    contexts = groups[selected_group]
    selected_frame = frame_index % len(contexts)
    context = contexts[selected_frame]
    next_frame = selected_frame + 1
    next_group = selected_group
    if next_frame >= len(contexts):
        next_frame = 0
        next_group = (selected_group + 1) % len(groups)
    return context, next_group, next_frame


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
