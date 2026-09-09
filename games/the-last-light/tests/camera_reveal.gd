## Short GPU check of switch -> shared reveal clock -> bounded camera zoom.
## --script res://tests/camera_reveal.gd -- --capture-dir=/absolute/path
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
		printerr("Camera reveal check requires a real renderer")
		quit(1)
		return
	var game = load("res://GameRoot.tscn").instantiate()
	root.add_child(game)
	for i in 8:
		await physics_frame
	var level = game._current_level
	var player: CharacterBody2D = level._player
	var camera: Camera2D = player.get_node("Camera2D")
	var focus = level.get_node("CharacterFocus")
	var reveal = level.get_node("MapRevealCamera")
	var runtime = level._bridge._runtime
	var switch_object = level._bridge._line_switch
	var bounds: Rect2 = reveal._bounds
	var initial_zoom := camera.zoom.x
	var original_content_size := root.content_scale_size
	var original_aspect := root.content_scale_aspect
	check(not switch_object.request_interaction() and not reveal._active, "locked switch leaves the camera unchanged")
	for object in runtime.objects.duplicate():
		if level.demo_config.available_cell_ids.has(object.effective_instance_id()):
			await interact(object, runtime)
	check(is_equal_approx(camera.zoom.x, initial_zoom) and not reveal._active, "collecting both batteries does not start the zoom")
	player.set_physics_process(false)
	player.global_position = Vector2(1005.0, 513.0)
	player.velocity = Vector2.ZERO
	camera.reset_smoothing()
	camera.force_update_scroll()
	await capture("camera-before")
	await interact(switch_object, runtime)
	check(focus._dismiss_started and reveal._active, "successful switch interaction starts focus and camera together")
	var contained := true
	var synchronized := true
	var monotonic := true
	var previous_zoom := camera.zoom.x
	var frames := 0
	var captured_middle := false
	var deadline := Time.get_ticks_msec() + int((focus.dismissal_seconds + 1.0) * 1000.0)
	while not focus._dismissed and Time.get_ticks_msec() < deadline:
		await process_frame
		await RenderingServer.frame_post_draw
		var view := root.canvas_transform.affine_inverse() * root.get_visible_rect()
		contained = contained and bounds.grow(0.01).encloses(view)
		var minimum := maxf(root.get_visible_rect().size.x / bounds.size.x, root.get_visible_rect().size.y / bounds.size.y)
		synchronized = synchronized and is_equal_approx(camera.zoom.x, lerpf(initial_zoom, minimum, focus._dismiss_progress))
		monotonic = monotonic and camera.zoom.x <= previous_zoom + 0.00001
		previous_zoom = camera.zoom.x
		frames += 1
		if not captured_middle and focus._dismiss_progress >= 0.5:
			captured_middle = true
			await capture("camera-middle")
	check(frames > 0 and contained, "every sampled rendered view stays within the map")
	check(synchronized and monotonic, "zoom follows the same easing progress and only zooms out")
	check(focus._dismissed, "camera transition completes with focus dismissal")
	await capture("camera-after")
	var final_view := root.canvas_transform.affine_inverse() * root.get_visible_rect()
	check(bounds.grow(0.01).encloses(final_view) and is_equal_approx(final_view.size.x, bounds.size.x), "final view fills the map width without revealing outside it")
	check(root.content_scale_size == original_content_size and root.content_scale_aspect == original_aspect, "window aspect and viewport remain unchanged, with no added letterboxing")
	print("CAMERA_REVEAL frames=", frames, " zoom=", camera.zoom, " view=", final_view)
	for position in [bounds.position + Vector2(20.0, 100.0), bounds.end - Vector2(20.0, 24.0)]:
		player.global_position = position
		camera.reset_smoothing()
		camera.force_update_scroll()
		await capture("")
		check(bounds.grow(0.01).encloses(root.canvas_transform.affine_inverse() * root.get_visible_rect()), "final zoom stays contained near a map corner")
	await interact(switch_object, runtime)
	check(focus._dismissed and is_equal_approx(reveal._progress, 1.0), "repeated switch use does not restart the camera reveal")
	var previous: WeakRef = weakref(reveal)
	game._load_level()
	for i in 8:
		await physics_frame
	check(previous.get_ref() == null and not game._current_level.get_node("MapRevealCamera")._active, "restart frees the previous camera reveal")
	check(is_equal_approx(game._current_level._player.get_node("Camera2D").zoom.x, initial_zoom), "restart restores the initial close camera")
	print("CAMERA_REVEAL_RESULT failures=", failures)
	quit(failures)

func interact(object: Node, runtime: Node) -> void:
	var before: int = object.success_count
	check(object.request_interaction(), "request interaction: " + object.definition.display_name)
	for i in 12:
		await process_frame
		if runtime.dialogue.is_open():
			runtime.dialogue.advance()
		else:
			break
	check(object.success_count == before + 1, "interaction commits successfully")

func capture(label: String) -> void:
	await process_frame
	await RenderingServer.frame_post_draw
	if not label.is_empty() and not capture_directory.is_empty():
		root.get_texture().get_image().save_png(capture_directory.path_join(label + ".png"))
