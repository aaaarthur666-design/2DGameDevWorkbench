## Level-owned world-anchored rain with screen lightning, below dialogue (layer 50).
extends CanvasLayer

@export_group("Rain")
@export_range(0.0, 1.0, 0.01) var rain_density: float = 0.62
@export_range(0.0, 1.0, 0.01) var rain_opacity: float = 0.62
@export_range(0.1, 3.0, 0.05) var rain_speed: float = 1.0
@export_range(-0.5, 0.5, 0.01) var wind_slant: float = 0.16
@export_group("Lightning")
@export var lightning_enabled: bool = true
@export_range(0.0, 0.8, 0.01) var lightning_strength: float = 0.52
## Quiet time after each strike; each strike has a short lead and a softer afterglow.
@export var lightning_interval: Vector2 = Vector2(7.0, 14.0)

var _rng := RandomNumberGenerator.new()
var _weather_time: float = 0.0
var _until_strike: float = 0.0
var _strike_time: float = -1.0
var _strike_gain: float = 1.0
@onready var _screen: ColorRect = $ScreenRain
@onready var _material: ShaderMaterial = $ScreenRain.material as ShaderMaterial

func _ready() -> void:
	_rng.randomize()
	_until_strike = _rng.randf_range(3.5, 6.0)
	_resize()
	get_viewport().size_changed.connect(_resize)
	RenderingServer.frame_pre_draw.connect(_sync_projection)
	_sync_material()

func _resize() -> void:
	_material.set_shader_parameter("viewport_size", get_viewport().get_visible_rect().size)
	_sync_projection()

func _sync_projection() -> void:
	# Sample the same world rain field as the camera scrolls or zooms. No player
	# position or velocity drives the weather; only its own clock moves the drops.
	var to_world := get_viewport().get_canvas_transform().affine_inverse() * _screen.get_global_transform_with_canvas()
	_material.set_shader_parameter("world_origin", to_world.origin)
	_material.set_shader_parameter("world_axis_x", to_world.x)
	_material.set_shader_parameter("world_axis_y", to_world.y)

func _process(delta: float) -> void:
	_weather_time += delta
	if not lightning_enabled:
		_strike_time = -1.0
	elif _strike_time >= 0.0:
		_strike_time += delta
		if _strike_time >= 0.85:
			_strike_time = -1.0
			var shortest := maxf(3.0, lightning_interval.x)
			_until_strike = _rng.randf_range(shortest, maxf(shortest, lightning_interval.y))
	else:
		_until_strike -= delta
		if _until_strike <= 0.0:
			_strike_time = 0.0
			_strike_gain = _rng.randf_range(0.85, 1.0)
	_sync_material()

func _sync_material() -> void:
	_material.set_shader_parameter("weather_time", _weather_time)
	_material.set_shader_parameter("rain_density", rain_density)
	_material.set_shader_parameter("rain_opacity", rain_opacity)
	_material.set_shader_parameter("rain_speed", rain_speed)
	_material.set_shader_parameter("wind_slant", wind_slant)
	_material.set_shader_parameter("lightning", lightning_envelope(_strike_time) * lightning_strength * _strike_gain)

## Fast precursor, brief gap, stronger return stroke, then a smooth cloud afterglow.
## Explicit envelope avoids continuous sine-wave flicker; it is also reproducible in render checks.
static func lightning_envelope(seconds: float) -> float:
	if seconds < 0.0 or seconds >= 0.85:
		return 0.0
	var precursor := 0.58 * smoothstep(0.0, 0.015, seconds) * (1.0 - smoothstep(0.035, 0.09, seconds))
	var main_flash := smoothstep(0.12, 0.145, seconds) * (1.0 - smoothstep(0.20, 0.36, seconds))
	var afterglow := 0.20 * smoothstep(0.16, 0.20, seconds) * (1.0 - smoothstep(0.24, 0.85, seconds))
	return clampf(maxf(precursor, main_flash) + afterglow, 0.0, 1.0)

func _exit_tree() -> void:
	if RenderingServer.frame_pre_draw.is_connected(_sync_projection):
		RenderingServer.frame_pre_draw.disconnect(_sync_projection)
