"""Bounded phase timing. Select real frames; retain every provider byte separately."""
from __future__ import annotations

import io
from PIL import Image, ImageChops, ImageStat
from .errors import ValidationHarnessError


def visible_pixels(data):
    with Image.open(io.BytesIO(data)) as source:
        rgba = source.convert("RGBA")
        # Invisible RGB differs between encoders and must not extend a hold.
        black = Image.new("RGBA", rgba.size, (0, 0, 0, 255))
        black.alpha_composite(rgba)
        black.putalpha(rgba.getchannel("A"))
        return black


def select_phase(frames, count, *, previous=None):
    """Keep endpoints and remove the most redundant interior pose first.

    Up to twice the reserved count can be reduced, never padded, interpolated or
    synthesized. Indices refer to immutable raw frames for audit/recovery.
    """
    if len(frames) < count or len(frames) > count * 2:
        raise ValidationHarnessError("片段返回帧数超出节奏整理范围；原始帧已保留，不会补帧或重新生成")
    images = [visible_pixels(data) for data in frames]
    selected = list(range(len(frames)))
    if previous is not None and len(selected) > count:
        if images[0].tobytes() == visible_pixels(previous).tobytes():
            selected.pop(0)  # Context belongs to the preceding phase.
    distances = {}

    def distance(a, b):
        key = tuple(sorted((a, b)))
        if key not in distances:
            distances[key] = sum(ImageStat.Stat(ImageChops.difference(images[a], images[b])).sum)
        return distances[key]

    while len(selected) > count:
        remove = min(range(1, len(selected) - 1), key=lambda i: (
            min(distance(selected[i - 1], selected[i]), distance(selected[i], selected[i + 1])), i))
        selected.pop(remove)
    return selected


def assemble_phases(raw, counts, names):
    combined, mapping, ranges = [], [], []
    for stage, (frames, count, name) in enumerate(zip(raw, counts, names)):
        indices = select_phase(frames, count, previous=raw[stage - 1][-1] if stage else None)
        start = len(combined) + 1
        for source_index in indices:
            combined.append(frames[source_index])
            mapping.append({"frame": len(combined), "stage": stage, "raw_frame": source_index + 1})
        ranges.append({"name": name, "start": start, "end": len(combined),
                       "raw_count": len(frames), "selected_raw_frames": [i + 1 for i in indices]})
    return combined, {"policy": "phase_budget_keep_endpoints_remove_redundant_v1",
                      "frames": mapping, "phases": ranges, "raw_frames_preserved": True}


def is_context_frame(frame, reference):
    """Allow tiny encoder/color differences, never a changed silhouette/pose."""
    actual, expected = visible_pixels(frame), visible_pixels(reference)
    if actual.size != expected.size:
        return False
    if actual.getchannel("A").getbbox() != expected.getchannel("A").getbbox():
        return False
    union = ImageChops.lighter(actual.getchannel("A"), expected.getchannel("A"))
    histogram = union.histogram()
    area = sum(histogram[1:])
    if not area:
        return actual.tobytes() == expected.tobytes()
    error = sum(ImageStat.Stat(ImageChops.difference(actual, expected)).sum)
    return error / (area * 4 * 255) <= .006


def assemble_anchored_phases(raw, counts, names, reference):
    """Remove only a recognized extra input frame; preserve EVERY motion pose."""
    combined, mapping, phases = [], [], []
    for stage, (frames, count, name) in enumerate(zip(raw, counts, names)):
        if not count <= len(frames) <= count * 2:
            raise ValidationHarnessError("片段返回帧数异常；保留原始帧，不会自动补做")
        context = reference if stage == 0 else raw[stage - 1][-1]
        removed = len(frames) == count + 1 and is_context_frame(frames[0], context)
        indices = list(range(1 if removed else 0, len(frames)))
        start = len(combined) + 1
        for source_index in indices:
            combined.append(frames[source_index])
            mapping.append({"frame": len(combined), "stage": stage, "raw_frame": source_index + 1})
        phases.append({"name": name, "start": start, "end": len(combined), "raw_count": len(frames),
                       "context_removed": removed, "selected_raw_frames": [i + 1 for i in indices]})
    return combined, {"policy": "recognized_extra_context_only_v1", "frames": mapping, "phases": phases,
                      "requested_frame_count": sum(counts), "raw_frames_preserved": True, "motion_poses_removed": False}
