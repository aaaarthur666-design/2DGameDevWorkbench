## Run in an isolated project copy. Add -- --capture-dir=/absolute/path for GPU frames.
extends SceneTree

var failures := 0

func check(ok: bool, label: String) -> void:
	print("PASS " if ok else "FAIL ", label)
	if not ok:
		failures += 1

func _initialize() -> void:
	call_deferred("run_checks")

func run_checks() -> void:
	var game = load("res://GameRoot.tscn").instantiate()
	root.add_child(game)
	for i in 8:
		await physics_frame
	var weather = game._current_level.get_node("RainStorm")
	var screen: ColorRect = weather.get_node("ScreenRain")
	check(weather.layer == 20, "weather is above world and below dialogue layer 50")
	check(screen.mouse_filter == Control.MOUSE_FILTER_IGNORE, "weather does not consume mouse input")
	check(screen.size.is_equal_approx(root.get_visible_rect().size), "overlay covers viewport")
	check(weather._material.get_shader_parameter("viewport_size").is_equal_approx(screen.size), "shader uses logical viewport dimensions")
	var second = load("res://LevelModule/weather/RainStorm.tscn").instantiate()
	root.add_child(second)
	check(second._material != weather._material, "instances own independent shader parameters")
	second.queue_free()
	await process_frame

	weather.set_process(false)
	weather._until_strike = 0.01
	weather._process(0.02)
	weather._process(0.16)
	var flash: float = weather._material.get_shader_parameter("lightning")
	check(flash > 0.40 and flash <= 0.60, "scheduled lightning creates a strong but translucent peak")
	weather._process(0.9)
	check(is_zero_approx(weather._material.get_shader_parameter("lightning")), "lightning returns to zero")
	check(weather._until_strike >= 7.0 and weather._until_strike <= 14.0, "strikes have a long randomized quiet interval")
	weather._strike_time = 0.16
	weather.lightning_enabled = false
	weather._process(0.01)
	check(is_zero_approx(weather._material.get_shader_parameter("lightning")), "disabling lightning immediately clears an active flash")
	weather.lightning_enabled = true
	weather.set_process(true)
	paused = true
	var clock_before: float = weather._weather_time
	for i in 4:
		await process_frame
	check(is_equal_approx(clock_before, weather._weather_time), "pause freezes weather clock and lightning scheduling")
	paused = false

	var previous: WeakRef = weakref(weather)
	game._load_level()
	for i in 8:
		await physics_frame
	weather = game._current_level.get_node("RainStorm")
	check(previous.get_ref() == null, "restart frees the old weather and its timers")
	check(weather._weather_time < 1.0 and weather._strike_time < 0.0, "restart begins with a fresh clock and no flash")
	var layer_count := 0
	for child in game._current_level.get_children():
		if child is CanvasLayer and child.name == &"RainStorm":
			layer_count += 1
	check(layer_count == 1, "restart creates exactly one weather overlay")

	for arg in OS.get_cmdline_user_args():
		if arg.begins_with("--capture-dir="):
			check(DisplayServer.get_name() != "headless", "capture uses real rendering, not the headless dummy renderer")
			if DisplayServer.get_name() != "headless":
				await capture_frames(game, weather, arg.trim_prefix("--capture-dir="))
	print("WEATHER_RESULT failures=", failures)
	quit(failures)

func capture_frames(game: Node, weather: CanvasLayer, directory: String) -> void:
	DirAccess.make_dir_recursive_absolute(directory)
	game.process_mode = Node.PROCESS_MODE_DISABLED
	weather._weather_time = 5.25
	weather._strike_time = -1.0
	weather._strike_gain = 1.0
	weather._sync_material()
	weather.hide()
	await save_frame(directory.path_join("clear.png"))
	weather.show()
	await save_frame(directory.path_join("rain.png"))
	weather._strike_time = 0.16
	weather._sync_material()
	await save_frame(directory.path_join("lightning.png"))
	weather._strike_time = -1.0
	weather._weather_time = 5.45
	weather._sync_material()
	await save_frame(directory.path_join("rain_later.png"))
	# A second aspect ratio verifies coverage while rain keeps its world-space size.
	var old_size := root.size
	root.size = Vector2i(960, 720)
	await process_frame
	check(weather.get_node("ScreenRain").size.is_equal_approx(root.get_visible_rect().size), "overlay tracks resized viewport")
	await save_frame(directory.path_join("rain_resized.png"))
	root.size = old_size

func save_frame(path: String) -> void:
	await process_frame
	await RenderingServer.frame_post_draw
	var frame := root.get_texture().get_image()
	check(frame != null and not frame.is_empty(), "GPU frame available: " + path.get_file())
	if frame != null and not frame.is_empty():
		check(frame.save_png(path) == OK, "saved " + path.get_file())
