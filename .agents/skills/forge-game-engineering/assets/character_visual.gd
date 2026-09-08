# Adapted from CopyWorms Player_Warrior._update_animation and facing behavior.
# Presentation only. The actor's state/timers retain authority over combat.
extends AnimatedSprite2D

signal visual_frame(action: StringName, index: int)
signal frame_cue(action: StringName, cue: StringName)
signal visual_finished(action: StringName)

@export var source_faces_right: bool = true
@export var frame_events: Dictionary = {}
var _selected_action: StringName = &""
var _setting_action: bool = false

func _ready() -> void:
	if not frame_changed.is_connected(_on_visual_frame):
		frame_changed.connect(_on_visual_frame)
	if not animation_finished.is_connected(_on_visual_finished):
		animation_finished.connect(_on_visual_finished)

# Call from the owner's existing state-to-animation mapping.
# restart=true is an explicit new occurrence, never a per-physics-frame default.
func show_action(action: StringName, restart: bool = false) -> bool:
	if sprite_frames == null or not sprite_frames.has_animation(action):
		return false
	if action != _selected_action or restart:
		_setting_action = true
		_selected_action = action
		play(action)
		set_frame_and_progress(0, 0.0)
		_setting_action = false
		_on_visual_frame()
	return true

func face_right(value: bool) -> void:
	flip_h = value != source_faces_right

func _on_visual_frame() -> void:
	if _setting_action or _selected_action == &"":
		return
	visual_frame.emit(animation, frame)
	var events: Dictionary = frame_events.get(String(animation), {})
	var cue: String = String(events.get(str(frame), ""))
	if not cue.is_empty():
		frame_cue.emit(animation, StringName(cue))

func _on_visual_finished() -> void:
	# Non-loop clips hold their final frame. Never apply damage or change actor state here.
	visual_finished.emit(animation)
