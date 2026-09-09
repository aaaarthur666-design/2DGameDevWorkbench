## GPU acceptance: --script res://tests/character_focus.gd -- --capture-dir=/absolute/path
extends SceneTree

var failures := 0
var capture_directory := ""

func check(ok: bool, label: String) -> void:
	print("PASS " if ok else "FAIL ", label)
	if not ok:
		failures += 1

func _initialize() -> void:
	for arg in OS.get_cmdline_user_args():
		if arg.begins_with("--capture-dir="):
			capture_directory = arg.trim_prefix("--capture-dir=")
	if not capture_directory.is_empty():
		DirAccess.make_dir_recursive_absolute(capture_directory)
	call_deferred("run_checks")

func run_checks() -> void:
	if DisplayServer.get_name() == "headless":
		printerr("Character focus pixel checks require a real GPU renderer")
		quit(1)
		return
	var game = load("res://GameRoot.tscn").instantiate()
	root.add_child(game)
	for i in 8:
		await physics_frame
	var level = game._current_level
	var player: CharacterBody2D = level._player
	var camera: Camera2D = player.get_node("Camera2D")
	var initial_zoom := camera.zoom
	var focus = level.get_node("CharacterFocus")
	var weather = level.get_node("RainStorm")
	game.process_mode = Node.PROCESS_MODE_DISABLED
	weather._strike_time = -1.0
	weather._sync_material()
	await capture("focus-standing")
	check(focus.layer > weather.layer and focus.layer < 50, "focus dims weather/world while dialogue remains above it")
	check(focus._mask.mouse_filter == Control.MOUSE_FILTER_IGNORE, "focus overlay passes input through")
	check(is_equal_approx(focus._reference_height, 56.0), "height uses the 56px opaque character, not the 64px frame or atlas")
	var radius: float = focus._material.get_shader_parameter("focus_radius")
	check(is_equal_approx(radius * 2.0 / camera.zoom.y, 252.0), "focus diameter remains 3 x character height: 252 world pixels")
	check(is_equal_approx(radius * 2.0 / root.get_visible_rect().size.y, 0.84), "focus diameter occupies 84 percent of the camera view height")
	check_center(focus, player, "standing center matches torso")
	# Move in both axes while the camera changes its smoothed transform.
	player.global_position += Vector2(340.0, -160.0)
	camera.force_update_scroll()
	await capture("focus-moved")
	check_center(focus, player, "focus follows movement through the active camera transform")
	camera.zoom = initial_zoom * 0.8
	camera.force_update_scroll()
	await capture("focus-zoomed")
	check(is_equal_approx(focus._material.get_shader_parameter("focus_radius"), radius * 0.8), "circle size scales with camera zoom")
	check_center(focus, player, "zoom keeps focus centered on torso")
	camera.zoom = initial_zoom
	camera.reset_smoothing()
	camera.force_update_scroll()
	var old_size := root.size
	root.size = Vector2i(960, 720)
	await capture("focus-resized")
	check(focus._mask.size.is_equal_approx(root.get_visible_rect().size), "mask covers resized viewport")
	check_center(focus, player, "resizing keeps focus on the player")
	root.size = old_size
	await process_frame

	# A uniform background makes circularity and absence of a painted outline measurable.
	var backdrop := CanvasLayer.new()
	backdrop.layer = 29
	var gray := ColorRect.new()
	gray.color = Color(0.6, 0.6, 0.6, 1.0)
	gray.mouse_filter = Control.MOUSE_FILTER_IGNORE
	backdrop.add_child(gray)
	root.add_child(backdrop)
	gray.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	focus.effect_enabled = false
	var plain: Image = await capture("")
	focus.effect_enabled = true
	var masked: Image = await capture("")
	var center: Vector2 = focus._material.get_shader_parameter("focus_center")
	radius = focus._material.get_shader_parameter("focus_radius")
	var inside := pixel(masked, center)
	check(absf(inside.r - pixel(plain, center).r) < 0.01, "focus center preserves original brightness")
	var inner := pixel(masked, center + Vector2(radius * 0.5, 0.0))
	var boundary := pixel(masked, center + Vector2(radius, 0.0))
	var outside := pixel(masked, center + Vector2(radius * 1.5, 0.0))
	check(inner.r > inside.r * 0.97, "inner half of the original circle stays almost fully bright")
	check(absf(boundary.r / inside.r - (1.0 - focus.inner_darkness)) < 0.02, "original circle boundary has only light shading")
	check(outside.r < inside.r * 0.6 and boundary.r - outside.r > inside.r - boundary.r, "brightness falls faster outside the original circle")
	var edge_x := pixel(masked, center + Vector2(radius, 0.0))
	var edge_y := pixel(masked, center + Vector2(0.0, -radius))
	check(absf(edge_x.r - edge_y.r) < 0.03, "horizontal and vertical radii render the same circular edge")
	var last_brightness := inside.r
	var monotonic := true
	for i in 41:
		var value := pixel(masked, center + Vector2(radius * float(i) / 20.0, 0.0)).r
		monotonic = monotonic and value <= last_brightness + 0.005
		last_brightness = value
	check(monotonic, "nonlinear gradient darkens continuously outward without an outline")
	backdrop.queue_free()
	await process_frame
	# Losing the target must not leave an opaque screen; rebinding restores the hole.
	focus._sprite = null
	await capture("")
	check(not focus._mask.visible, "missing target hides the mask")
	focus.bind_player(player)
	await capture("")
	check(focus._mask.visible, "binding a player restores the focus")
	# Keep only this presentation animation running while the game is frozen.
	focus.process_mode = Node.PROCESS_MODE_ALWAYS
	await capture("focus-expand-before")
	var before_expansion: float = focus._material.get_shader_parameter("focus_radius")
	focus.expand_and_dismiss()
	await create_timer(focus.dismissal_seconds * 0.35).timeout
	await capture("focus-expand-mid")
	var expanded: float = focus._material.get_shader_parameter("focus_radius")
	check(expanded > before_expansion and focus._mask.visible, "circle expands visibly before the mask disappears")
	player.global_position += Vector2(90.0, -30.0)
	camera.force_update_scroll()
	await capture("")
	check_center(focus, player, "expanding circle continues to follow the player's body")
	focus.expand_and_dismiss()
	check(focus._dismiss_progress > 0.0, "repeated switch use does not restart the expansion")
	await create_timer(focus.dismissal_seconds).timeout
	await capture("focus-expand-after")
	check(focus._dismissed and not focus._mask.visible, "completed expansion removes the mask")
	center = focus._material.get_shader_parameter("focus_center")
	radius = focus._material.get_shader_parameter("focus_radius")
	var clear_radius: float = focus._material.get_shader_parameter("reveal_radius")
	for corner in [Vector2.ZERO, Vector2(focus._mask.size.x, 0.0), focus._mask.size, Vector2(0.0, focus._mask.size.y)]:
		check(center.distance_to(corner) < clear_radius, "expansion clears the entire soft edge past a viewport corner")
	var old_focus: WeakRef = weakref(focus)
	game.process_mode = Node.PROCESS_MODE_INHERIT
	game._load_level()
	for i in 8:
		await physics_frame
	await capture("focus-restarted")
	check(old_focus.get_ref() == null, "restart releases old focus and its rendering callback")
	var new_focus = game._current_level.get_node("CharacterFocus")
	check(new_focus._sprite == game._current_level._player.get_node("Sprite"), "restart binds only to the new player")
	check(not new_focus._dismiss_started and new_focus._mask.visible, "restart restores the original focus mask")
	check_center(new_focus, game._current_level._player, "restarted focus follows the new player")
	print("CHARACTER_FOCUS_RESULT failures=", failures)
	quit(failures)

func check_center(focus: CanvasLayer, player: CharacterBody2D, label: String) -> void:
	var expected: Vector2 = focus._mask.get_global_transform_with_canvas().affine_inverse() * (player.get_global_transform_with_canvas() * Vector2(0.0, -42.0))
	var actual: Vector2 = focus._material.get_shader_parameter("focus_center")
	check(actual.distance_to(expected) < 0.1, label)

func capture(label: String) -> Image:
	await process_frame
	await RenderingServer.frame_post_draw
	var frame := root.get_texture().get_image()
	if not label.is_empty() and not capture_directory.is_empty():
		check(frame.save_png(capture_directory.path_join(label + ".png")) == OK, "saved " + label)
	return frame

func pixel(frame: Image, logical_position: Vector2) -> Color:
	# Samples live at texel centers. Bilinear sampling avoids biasing opposite edge
	# directions by half a pixel when testing a small antialiased circle.
	var point := logical_position * Vector2(frame.get_size()) / root.get_visible_rect().size - Vector2(0.5, 0.5)
	var x0 := clampi(floori(point.x), 0, frame.get_width() - 1)
	var y0 := clampi(floori(point.y), 0, frame.get_height() - 1)
	var x1 := mini(x0 + 1, frame.get_width() - 1)
	var y1 := mini(y0 + 1, frame.get_height() - 1)
	var weight := point - point.floor()
	return frame.get_pixel(x0, y0).lerp(frame.get_pixel(x1, y0), weight.x).lerp(
		frame.get_pixel(x0, y1).lerp(frame.get_pixel(x1, y1), weight.x), weight.y)
