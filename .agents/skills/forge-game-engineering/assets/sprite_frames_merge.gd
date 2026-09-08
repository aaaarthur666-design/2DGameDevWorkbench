# Preserve the target actor's other actions when replacing selected clips.
# Neither input resource is mutated; the caller chooses a new save path.
extends RefCounted

static func merge_clips(existing: SpriteFrames, incoming: SpriteFrames) -> SpriteFrames:
	if existing == null or incoming == null:
		push_error("Both existing and incoming SpriteFrames are required")
		return null
	var merged: SpriteFrames = existing.duplicate(true) as SpriteFrames
	for action: StringName in incoming.get_animation_names():
		if merged.has_animation(action):
			merged.clear(action)
		else:
			merged.add_animation(action)
		merged.set_animation_speed(action, incoming.get_animation_speed(action))
		merged.set_animation_loop(action, incoming.get_animation_loop(action))
		for index: int in incoming.get_frame_count(action):
			merged.add_frame(action, incoming.get_frame_texture(action, index), incoming.get_frame_duration(action, index))
	return merged
