## Shares the focus dismissal clock; keeps the camera inside the map at every zoom.
extends Node

var _camera: Camera2D
var _viewport: Viewport
var _bounds: Rect2
var _start_zoom: float = 1.0
var _progress: float = 0.0
var _active: bool = false

func configure(camera: Camera2D, map_bounds: Rect2) -> void:
	_camera = camera
	_viewport = camera.get_viewport()
	_bounds = map_bounds
	if not _bounds.has_area():
		push_error("[MapRevealCamera] Requires valid map bounds")
		return
	_viewport.size_changed.connect(_refresh_view)

func apply_progress(progress: float) -> void:
	if not is_instance_valid(_camera) or not _bounds.has_area():
		return
	if not _active:
		_start_zoom = _camera.zoom.x
		_active = true
	_progress = clampf(progress, 0.0, 1.0)
	_refresh_view()

func _refresh_view() -> void:
	if not _active or not is_instance_valid(_camera):
		return
	# Keep the viewport filled. Limits alone cannot contain a view larger than
	# the map, so the minimum zoom must satisfy BOTH its width and its height.
	var minimum_zoom := _minimum_zoom(_viewport.get_visible_rect().size)
	_camera.zoom = Vector2.ONE * maxf(lerpf(_start_zoom, minimum_zoom, _progress), minimum_zoom)
	_camera.force_update_scroll()

func _minimum_zoom(view_size: Vector2) -> float:
	return maxf(view_size.x / _bounds.size.x, view_size.y / _bounds.size.y)

func _exit_tree() -> void:
	if is_instance_valid(_viewport) and _viewport.size_changed.is_connected(_refresh_view):
		_viewport.size_changed.disconnect(_refresh_view)
