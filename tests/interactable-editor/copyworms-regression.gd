extends Node
const KIT := "res://addons/workbench_interaction_copyworms/"
var checks := 0
var failures := 0
var events: Array = []
var level: Node
var runtime: Node
var player: Node2D

func check(value: bool, message: String) -> void:
	checks += 1
	if not value:
		failures += 1
		push_error("COMPAT CHECK: " + message)

func frames(count: int = 4) -> void:
	for i in count:
		await get_tree().physics_frame
		await get_tree().process_frame

func press(echo: bool = false) -> void:
	var event := InputEventKey.new()
	event.physical_keycode = KEY_ENTER
	event.keycode = KEY_ENTER
	event.pressed = true
	event.echo = echo
	Input.parse_input_event(event)
	await get_tree().process_frame
	event = InputEventKey.new()
	event.physical_keycode = KEY_ENTER
	event.keycode = KEY_ENTER
	Input.parse_input_event(event)
	await get_tree().process_frame

func observed(payload: Dictionary) -> void:
	events.append(payload)

func click_at(point: Vector2) -> void:
	var event := InputEventMouseButton.new()
	event.button_index = MOUSE_BUTTON_LEFT
	event.position = point
	event.global_position = point
	event.pressed = true
	Input.parse_input_event(event)
	await frames(1)
	event = InputEventMouseButton.new()
	event.button_index = MOUSE_BUTTON_LEFT
	event.position = point
	event.global_position = point
	Input.parse_input_event(event)
	await frames(1)

func spawn_object(kind: String, offset := Vector2(20, 0)) -> Node:
	var object: Node = load(KIT + "objects/compat-" + kind + "/object.tscn").instantiate()
	level.add_child(object)
	object.global_position = player.global_position + offset
	return object

func _ready() -> void:
	var watchdog := Timer.new()
	watchdog.wait_time = 25
	watchdog.one_shot = true
	add_child(watchdog)
	watchdog.timeout.connect(func():
		push_error("Compatibility regression timed out")
		get_tree().quit(1))
	watchdog.start()
	level = load("res://LevelModule/Formal/Level_01.tscn").instantiate()
	add_child(level)
	await frames()
	player = GameManager.player_ref
	check(is_instance_valid(player), "real Level_01 registers the actual player")
	player.set_physics_process(false)
	player.global_position = Vector2(200, 100)
	for legacy in level._all_interactives:
		legacy.is_active = false
	get_viewport().gui_release_focus()
	EventBus.subscribe(&"interactive_object_triggered", self, &"observed")
	runtime = load(KIT + "compat/copyworms/v1/interaction_runtime_2d.tscn").instantiate()
	level.add_child(runtime)
	var note := spawn_object("inspect")
	await frames()
	check(runtime.resolve_actor("player") == player, "GameManager.player_ref actor binding")
	check(note.collision_mask == 4 and note.in_range, "real player's layer overlaps compatible object")
	check(note.config.activation.action == "ui_accept", "original InputMap action")
	check(runtime.focused == note, "compatible focus")
	await press()
	check(runtime.active_object == note and runtime.dialogue.is_open(), "Enter starts compatible dialogue")
	check(InputManager.is_input_blocked and GameManager.is_dialog_active, "original gameplay and dialogue lock acquired")
	check(runtime.dialogue.layer == 100, "level UI layer")
	check(not InputManager.get_active_pointer_releases().is_empty(), "pointer lease acquired")
	await press(true)
	check(runtime.dialogue._index == 0, "key echo cannot advance dialogue")
	await press()
	check(runtime.dialogue._index == 1, "one Enter advances exactly one page")
	await press()
	check(note.success_count == 1 and runtime.active_object == null, "dialogue completes exactly once")
	check(not InputManager.is_input_blocked and not GameManager.is_dialog_active, "own locks released on success")
	check(events.is_empty(), "empty legacy mapping does not emit original event")
	note.set_enabled(false)
	var toggle := spawn_object("toggle")
	await frames()
	await press()
	check(toggle.toggle_state and toggle.success_count == 1, "toggle via real Enter propagation")
	check(events.is_empty(), "no duplicate original event after synchronous completion")
	toggle.set_enabled(false)
	var pickup := spawn_object("pickup")
	await frames()
	await press()
	await press()
	check(pickup.completed and pickup.success_count == 1 and not pickup.visible, "pickup only once")
	var sequence := spawn_object("sequence")
	await frames()
	await press()
	await frames()
	await press()
	check(sequence.completed and sequence.success_count == 2, "sequence through actual input")
	# Pointer coordinates use the real level's camera transform.
	toggle.config.activation.mode = "pointer_click"
	toggle.set_enabled(true)
	var screen_point: Vector2 = get_viewport().get_final_transform() * Vector2(640, 360)
	var motion := InputEventMouseMotion.new()
	motion.position = screen_point
	motion.global_position = screen_point
	Input.parse_input_event(motion)
	await frames()
	toggle.global_position = toggle.get_global_mouse_position()
	await click_at(screen_point)
	check(toggle.success_count == 2, "pointer click through real camera and input manager")
	check(not InputManager.get_active_pointer_releases().is_empty(), "available pointer object keeps cursor released")
	var ui_layer := CanvasLayer.new()
	level.add_child(ui_layer)
	var ui_button := Button.new()
	ui_layer.add_child(ui_button)
	ui_button.position = get_viewport().get_mouse_position() - Vector2(40, 20)
	ui_button.size = Vector2(80, 40)
	var ui_clicks := [0]
	ui_button.pressed.connect(func(): ui_clicks[0] += 1)
	# Level_01 consumes world mouse clicks in _input even over GUI. Isolate GUI
	# dispatch here; the actual InputManager and adapter remain enabled.
	level.set_process_input(false)
	await frames()
	await click_at(screen_point)
	check(toggle.success_count == 2 and ui_clicks[0] == 1, "adapter lets GUI receive click without triggering object underneath")
	level.set_process_input(true)
	ui_button.release_focus()
	ui_layer.queue_free()
	toggle.set_enabled(false)
	await frames()
	check(InputManager.get_active_pointer_releases().is_empty(), "disabled pointer object releases cursor lease")

	# Real InputManager ownership, not a mocked lock API.
	note.set_enabled(true)
	await frames()
	var foreign_lock: int = InputManager.block_input("compat_test_other", self)
	await press()
	check(runtime.active_object == null and note.success_count == 1, "foreign lock blocks Enter")
	check(not note.request_interaction(player), "foreign lock blocks external requests")
	InputManager.unblock_input_token(foreign_lock)
	await frames()
	await press()
	foreign_lock = InputManager.block_input("compat_test_other", self)
	await press()
	runtime.dialogue.advance()
	check(runtime.dialogue._index == 0, "foreign lock also guards dialogue button and Enter")
	note.cancel_interaction("test")
	check(InputManager.is_input_blocked, "cancel preserves another owner's lock")
	InputManager.unblock_input_token(foreign_lock)
	check(not InputManager.is_input_blocked, "cancel released only its own token")
	GameManager.is_paused = true
	check(not note.request_interaction(), "paused blocks external requests")
	GameManager.is_paused = false
	SceneTransitionManager.is_transitioning = true
	check(not note.request_interaction(), "transition blocks requests")
	SceneTransitionManager.is_transitioning = false
	var edit := LineEdit.new()
	add_child(edit)
	edit.grab_focus()
	check(not note.request_interaction(), "text field focus blocks requests")
	edit.release_focus()
	edit.queue_free()
	await frames()

	# Compete against a real legacy InteractiveObject registered in the real level.
	var legacy := InteractiveObject.new()
	legacy.object_id = "compat_test_legacy"
	var legacy_shape := CollisionShape2D.new()
	legacy_shape.name = "CollisionShape2D"
	legacy_shape.shape = RectangleShape2D.new()
	legacy_shape.shape.size = Vector2(100, 100)
	legacy.add_child(legacy_shape)
	level.add_child(legacy)
	legacy.global_position = player.global_position + Vector2(45, 0)
	legacy.is_player_in_range = true
	level._all_interactives.append(legacy)
	note.config.content.pages = []
	await frames()
	await press()
	check(note.success_count == 2 and events.is_empty(), "new object wins when closer; original handler not called")
	legacy.global_position = player.global_position
	await frames()
	await press()
	check(events.size() == 1 and events[0].object_id == "compat_test_legacy", "closer legacy object retains original dispatch")
	check(note.success_count == 2, "legacy input does not also trigger new object")
	legacy.is_active = false
	level._interact_cooldown = 0.0

	# Automatic enter waits for gameplay locks without losing the pending entry.
	note.config.activation.mode = "automatic_enter"
	note.in_range = false
	foreign_lock = InputManager.block_input("compat_test_other", self)
	await frames()
	check(note.success_count == 2 and note.auto_pending, "auto-enter remains pending under foreign lock")
	InputManager.unblock_input_token(foreign_lock)
	await frames()
	check(note.success_count == 3, "auto-enter resumes after lock")
	await frames()
	check(note.success_count == 3, "auto-enter does not repeat while standing")
	note.config.activation.mode = "proximity_press"

	# A successful event bridge must actually reach the original quest FSM.
	level.current_state = Level_01.LevelState.BEDROOM
	level._notice_node.completed = false
	note.config.copyworms.objectId = "notice"
	await frames()
	await press()
	await frames()
	check(events.size() == 2 and events[1].object_id == "notice", "mapped event emitted exactly once with object_id")
	check(events[1].has("workbench_context"), "mapped event carries original workbench result")
	check(level._notice_node.completed and level._narrative_open, "real Level_01 FSM opens notice narrative")
	check(InputManager.is_input_blocked and runtime._input_token == 0, "original narrative owns its lock after handoff")
	for i in 30:
		if not level._narrative_open:
			break
		await press()
		await frames(3)
	check(not level._narrative_open, "original narrative can advance and close")
	# Original recovery callbacks may keep a short lock while closing.
	await get_tree().create_timer(0.8).timeout
	await frames()
	check(not InputManager.is_input_blocked, "original narrative unlocks after closing")
	note.config.copyworms.objectId = ""
	note.config.content.pages = ["退出清理"]
	check(note.request_interaction(player), "request before runtime removal")
	foreign_lock = InputManager.block_input("compat_test_other", self)
	runtime.queue_free()
	await frames()
	check(note.phase == "IDLE" and InputManager.is_input_blocked, "runtime exit cancels pending object and preserves foreign lock")
	check(not GameManager.is_dialog_active, "runtime exit releases own dialog ownership")
	InputManager.unblock_input_token(foreign_lock)
	check(not InputManager.is_input_blocked and InputManager.get_active_pointer_releases().is_empty(), "no leaked locks or pointer leases")
	level.queue_free()
	MusicManager.stop_bgm(0.0)
	await get_tree().create_timer(0.25).timeout
	await frames()
	print("COPYWORMS_TESTS %d checks, %d failures" % [checks, failures])
	watchdog.stop()
	get_tree().quit.call_deferred(0 if failures == 0 else 1)
