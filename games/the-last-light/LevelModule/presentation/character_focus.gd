## Player-following circular focus. Owned by the level; above weather, below dialogue.
extends CanvasLayer

signal dismissal_progressed(progress: float)

@export_range(1.0, 6.0, 0.1) var diameter_in_character_heights: float = 3.0
@export_range(0.0, 1.0, 0.01) var outside_brightness: float = 0.08
## Darkness at the original circle radius; the center remains clear.
@export_range(0.0, 0.4, 0.01) var inner_darkness: float = 0.12
## Higher values retain a brighter interior and steepen the outer falloff.
@export_range(1.0, 8.0, 0.1) var falloff_power: float = 4.0
@export_range(0.1, 5.0, 0.1) var dismissal_seconds: float = 1.6
@export var effect_enabled: bool = true

var _sprite: AnimatedSprite2D
var _reference_height: float = 0.0
var _reference_center := Vector2.ZERO
var _dismiss_started: bool = false
var _dismissed: bool = false
var _dismiss_progress: float = 0.0:
	set(value):
		_dismiss_progress = clampf(value, 0.0, 1.0)
		dismissal_progressed.emit(_dismiss_progress)
var _dismiss_start_radius: float = 0.0
var _expanded_radius: float = 0.0
@onready var _mask: ColorRect = $ScreenMask
@onready var _material: ShaderMaterial = _mask.material as ShaderMaterial

func _ready() -> void:
	# Run after player physics and Camera2D smoothing, immediately before drawing.
	RenderingServer.frame_pre_draw.connect(_sync_mask)

func bind_player(player: CharacterBody2D) -> void:
	_sprite = player.get_node_or_null("Sprite") as AnimatedSprite2D
	if _sprite == null or _sprite.sprite_frames == null or not _sprite.sprite_frames.has_animation(&"idle"):
		push_warning("[CharacterFocus] Player Sprite requires the idle reference animation")
		_sprite = null
		return
	var texture := _sprite.sprite_frames.get_frame_texture(&"idle", 0)
	if texture == null:
		_sprite = null
		return
	# Read alpha once on binding, not on every frame. A stable idle reference keeps
	# the circle from breathing or wobbling when walk/jump animation frames change.
	var bounds := Rect2(Vector2.ZERO, texture.get_size())
	var image := texture.get_image()
	if image != null and not image.is_empty():
		var used := image.get_used_rect()
		if used.has_area():
			bounds = Rect2(used)
	_reference_height = bounds.size.y
	bounds.position += _sprite.offset
	if _sprite.centered:
		bounds.position -= texture.get_size() * 0.5
	_reference_center = Vector2(0.0, bounds.get_center().y)
	_sync_mask()

## First successful switch use reveals the level for the remainder of this run.
func expand_and_dismiss() -> void:
	if _dismiss_started:
		return
	_sync_mask()
	_dismiss_started = true
	_dismiss_start_radius = _material.get_shader_parameter("focus_radius")
	_expanded_radius = _dismiss_start_radius
	_dismiss_progress = 0.0
	var tween := create_tween().set_trans(Tween.TRANS_QUAD).set_ease(Tween.EASE_IN_OUT)
	tween.tween_property(self, "_dismiss_progress", 1.0, maxf(dismissal_seconds, 0.1))
	tween.tween_callback(_finish_dismissal)

func _finish_dismissal() -> void:
	_sync_mask()
	_dismissed = true
	_mask.hide()

func _sync_mask() -> void:
	if not is_instance_valid(_mask):
		return
	_mask.visible = effect_enabled and not _dismissed and is_instance_valid(_sprite) and _sprite.is_visible_in_tree()
	if not _mask.visible:
		return
	# Project the actual actor through the current camera, then into overlay space.
	# This includes camera limits/zoom and viewport transforms; no world-to-UV guess.
	var to_mask := _mask.get_global_transform_with_canvas().affine_inverse() * _sprite.get_global_transform_with_canvas()
	var center := to_mask * _reference_center
	var height_vector := to_mask * (_reference_center + Vector2(0.0, _reference_height)) - center
	var radius := height_vector.length() * diameter_in_character_heights * 0.5
	var reveal_radius := 0.0
	if _dismiss_started:
		# Cover the farthest corner even while the actor, camera or viewport moves.
		# Push the full gradient beyond it, leaving a completely clear center.
		var farthest := Vector2(
			maxf(absf(center.x), absf(_mask.size.x - center.x)),
			maxf(absf(center.y), absf(_mask.size.y - center.y)))
		var cover_radius := farthest.length() + _dismiss_start_radius + 2.0
		_expanded_radius = maxf(_expanded_radius, lerpf(_dismiss_start_radius, cover_radius, _dismiss_progress))
		radius = _expanded_radius
		reveal_radius = radius - _dismiss_start_radius
	_material.set_shader_parameter("canvas_size", _mask.size)
	_material.set_shader_parameter("focus_center", center)
	_material.set_shader_parameter("focus_radius", radius)
	_material.set_shader_parameter("reveal_radius", reveal_radius)
	_material.set_shader_parameter("outside_brightness", outside_brightness)
	_material.set_shader_parameter("inner_darkness", inner_darkness)
	_material.set_shader_parameter("falloff_power", falloff_power)

func _exit_tree() -> void:
	if RenderingServer.frame_pre_draw.is_connected(_sync_mask):
		RenderingServer.frame_pre_draw.disconnect(_sync_mask)
	_sprite = null
