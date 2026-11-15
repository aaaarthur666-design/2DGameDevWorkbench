extends "../../../runtime/v1/interaction_runtime_2d.gd"
## copyWorms bb1581d adapter. Place ONE runtime under the actual level root.
## A level descendant consumes its own input before the level / InputManager:
## https://docs.godotengine.org/en/4.6/tutorials/inputs/inputevent.html
var _input_token: int = 0
var _pointer_token: int = 0
var _dialog_owned: bool = false
var _pending_events: Dictionary = {}

func _ready() -> void:
	super._ready()
	set_process_unhandled_input(false)
	dialogue.set_process_unhandled_input(false)
	dialogue.layer = 100 # copyWorms UILayerContract.LEVEL_UI
	busy_changed.connect(_on_busy_changed)

func register_interactable(object: Node) -> void:
	super.register_interactable(object)
	var callback := _on_finished.bind(object)
	if not object.interaction_finished.is_connected(callback):
		object.interaction_finished.connect(callback)

func unregister_interactable(object: Node) -> void:
	super.unregister_interactable(object)
	_pending_events.erase(object.get_instance_id())
	var callback := _on_finished.bind(object)
	if object.interaction_finished.is_connected(callback):
		object.interaction_finished.disconnect(callback)

func resolve_actor(group: String) -> Node2D:
	if is_instance_valid(actor):
		return actor
	var player: Node2D = GameManager.player_ref
	if is_instance_valid(player) and player.is_inside_tree() and get_parent().is_ancestor_of(player):
		return player
	return super.resolve_actor(group)

func _is_current_level() -> bool:
	var level: Node = GameManager.current_level
	return not is_instance_valid(level) or level == get_parent() or level.is_ancestor_of(self)

func _world_blocked() -> bool:
	return not _is_current_level() or GameManager.is_paused or GameManager.is_game_over or SceneTransitionManager.is_transitioning

func _gameplay_blocked() -> bool:
	return _world_blocked() or GameManager.is_dialog_active or InputManager.is_gameplay_input_blocked() or InputManager.is_action_blocked(&"ui_accept")

func can_advance_dialogue() -> bool:
	if _world_blocked() or not is_instance_valid(active_object):
		return false
	# Our own gameplay lock must not deadlock our own dialogue. Other owners win.
	for entry in InputManager.get_active_locks():
		if int(entry.token) != _input_token:
			return false
	var focus := get_viewport().gui_get_focus_owner()
	return focus == null or not focus.is_visible_in_tree() or dialogue.is_ancestor_of(focus)

func _physics_process(delta: float) -> void:
	if is_instance_valid(active_object):
		if _world_blocked():
			active_object.cancel_interaction("copyworms_context_changed")
		else:
			for object in objects.duplicate():
				if is_instance_valid(object):
					object.refresh_range()
		_set_focus(null)
	elif _gameplay_blocked():
		for object in objects.duplicate():
			if is_instance_valid(object):
				object.refresh_range()
		_set_focus(null)
	else:
		super._physics_process(delta)
		if is_instance_valid(focused) and _legacy_wins(focused):
			_set_focus(null)
	_update_pointer()

func _legacy_wins(candidate: Node2D) -> bool:
	var level := get_parent()
	if not level.has_method("_find_nearby_interactive"):
		return false
	var legacy: Node2D = level.call("_find_nearby_interactive")
	var player := resolve_actor("player")
	if not is_instance_valid(legacy) or not is_instance_valid(player):
		return false
	# Existing quest objects win ties; never fire two handlers for one key press.
	return legacy.get_interaction_distance_to(player) <= candidate.global_position.distance_to(player.global_position)

func _input(event: InputEvent) -> void:
	if event.is_echo():
		return
	var click: bool = event is InputEventMouseButton and event.pressed and event.button_index == MOUSE_BUTTON_LEFT
	var accept := event.is_action_pressed("ui_accept")
	if not accept and not click:
		return
	if is_instance_valid(active_object):
		if not can_advance_dialogue():
			return
		get_viewport().set_input_as_handled()
		if dialogue.is_open():
			dialogue.advance()
		return
	if _gameplay_blocked():
		return
	# _input precedes GUI dispatch. Reuse copyWorms' hit test to respect its UI.
	if click and InputManager._is_mouse_over_interactive_gui(event):
		return
	var candidate: Node = null
	if click:
		var hits := objects.filter(func(o): return is_instance_valid(o) and o.can_interact() and o.config.activation.mode == "pointer_click" and o.pointer_contains(o.get_global_mouse_position()))
		hits.sort_custom(func(a, b): return a.z_index > b.z_index if a.z_index != b.z_index else _nearer(a, b))
		if not hits.is_empty():
			candidate = hits[0]
	if candidate == null:
		candidate = focused
		if is_instance_valid(candidate) and _legacy_wins(candidate):
			return
	if is_instance_valid(candidate) and candidate.can_interact():
		# Consume before callbacks; a synchronous completion may unlock the game.
		get_viewport().set_input_as_handled()
		candidate.request_interaction(resolve_actor("player"))

func try_interact(object: Node, source: Node) -> bool:
	if _gameplay_blocked():
		return false
	return super.try_interact(object, source)

func _on_busy_changed(busy: bool) -> void:
	if busy:
		_input_token = InputManager.block_input("workbench_copyworms", self)
		GameManager.begin_dialog(self)
		_dialog_owned = true
		_set_pointer(true)
	else:
		_release_owned_input()

func _release_owned_input() -> void:
	if _input_token != 0:
		InputManager.unblock_input_token(_input_token)
		_input_token = 0
	if _dialog_owned:
		GameManager.end_dialog(self)
		_dialog_owned = false
	_set_pointer(false)

func _set_pointer(wanted: bool) -> void:
	if wanted and _pointer_token == 0:
		_pointer_token = InputManager.acquire_pointer_release("workbench_copyworms", self)
	elif not wanted and _pointer_token != 0:
		InputManager.release_pointer_release_token(_pointer_token)
		_pointer_token = 0

func _update_pointer() -> void:
	var wanted := is_instance_valid(active_object)
	if not wanted and not _gameplay_blocked():
		wanted = objects.any(func(o): return is_instance_valid(o) and o.can_interact() and o.is_visible_in_tree() and o.config.activation.mode == "pointer_click")
	_set_pointer(wanted)

func _on_finished(context: Dictionary, object: Node) -> void:
	var object_id: String = object.config.copyworms.objectId
	if not object_id.is_empty():
		_pending_events[object.get_instance_id()] = {"object_id": object_id, "workbench_context": context.duplicate(true)}

func release_interaction(object: Node) -> void:
	var payload: Dictionary = _pending_events.get(object.get_instance_id(), {})
	_pending_events.erase(object.get_instance_id())
	super.release_interaction(object)
	# The original narrative takes ownership only after this runtime released its lock.
	if not payload.is_empty() and is_inside_tree() and not _world_blocked():
		EventBus.emit(&"interactive_object_triggered", payload)

func _exit_tree() -> void:
	_pending_events.clear()
	super._exit_tree()
	_release_owned_input()
