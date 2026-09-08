extends SceneTree
var completed: int = 0
var looped: int = 0
func _initialize() -> void:
	test.call_deferred()
func test() -> void:
	var once: AnimatedSprite2D = load(ONCE).instantiate()
	root.add_child(once)
	var frames: SpriteFrames = once.sprite_frames
	if frames.get_frame_count(&"hit") != 3 or frames.get_animation_speed(&"hit") != 12.5 or frames.get_animation_loop(&"hit"):
		quit(1)
		return
	var first: AtlasTexture = frames.get_frame_texture(&"hit", 0)
	if first.region != Rect2(64, 64, 64, 64) or first.get_image().get_pixel(8, 8).r < 0.9 or once.offset != Vector2(2, -28):
		quit(2)
		return
	once.animation_finished.connect(func(): completed += 1)
	var repeating: AnimatedSprite2D = load(REPEATING).instantiate()
	root.add_child(repeating)
	repeating.animation_looped.connect(func(): looped += 1)
	var deadline: int = Time.get_ticks_msec() + 2500
	while (completed != 1 or looped < 2) and Time.get_ticks_msec() < deadline:
		await process_frame
	if completed != 1 or once.frame != 2 or looped < 2:
		quit(3)
		return
	print("SPRITE_GODOT_PACKAGE_OK")
	once.queue_free()
	repeating.queue_free()
	await process_frame
	quit(0)
