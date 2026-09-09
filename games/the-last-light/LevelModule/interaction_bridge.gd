## InteractionBridge —— 把现有物件信号映射为本关状态操作（策划案 §8.3 / §8.4）
## 不复制交互物焦点选择和动作执行引擎；只消费业务成功信号，只接受已绑定实例。
class_name InteractionBridge
extends Node

signal line_switch_used

var _state: DemoRunState
var _config: TllDemoConfig
var _run_id: int = 0
var _lock: InputLockAdapter
var _runtime: Node
var _line_switch: Node
var _interaction_lock_token: int = -1

func bind(scene_root: Node, state: DemoRunState, config: TllDemoConfig, run_id: int, lock: InputLockAdapter) -> void:
	_state = state
	_config = config
	_run_id = run_id
	_lock = lock
	var runtimes := get_tree().get_nodes_in_group("workbench_interaction_runtime").filter(
		func(n): return scene_root.is_ancestor_of(n))
	if runtimes.size() != 1:
		push_error("[Bridge] 期望场景内恰好一个 InteractionRuntime，实际 %d（§8.3 不加第二个）" % runtimes.size())
		return
	_runtime = runtimes[0]
	_state.state_changed.connect(_on_state_changed)
	if not _runtime.busy_changed.is_connected(_on_busy_changed):
		_runtime.busy_changed.connect(_on_busy_changed)
	# 物件经 call_deferred 注册进 runtime；桥接用 call_deferred 排在其后，帧序确定（不赌帧数）
	call_deferred("_connect_objects")

func _connect_objects() -> void:
	if not is_instance_valid(_runtime):
		return
	var expected := _config.available_cell_ids.size() + 1
	var bound := 0
	for object in _runtime.objects:
		if not is_instance_valid(object):
			continue
		var iid: String = object.effective_instance_id()
		if _config.available_cell_ids.has(iid):
			if not object.picked_up.is_connected(_on_picked_up):
				object.picked_up.connect(_on_picked_up)
				bound += 1
		elif iid == _config.line_switch_instance_id:
			_line_switch = object
			if not object.toggled.is_connected(_on_toggled):
				object.toggled.connect(_on_toggled)
				bound += 1
	if bound != expected:
		push_error("[Bridge] 实例绑定不完整：%d/%d（§4.2 找不到配置指定物件）" % [bound, expected])
	_sync_switch_enabled()

func _on_state_changed(_snapshot: Dictionary) -> void:
	_sync_switch_enabled()

## 使用现有交互入口门控：收齐电池前不显示操作提示，也不能开始切换。
func _sync_switch_enabled() -> void:
	if is_instance_valid(_line_switch):
		_line_switch.set_enabled(_state.can_toggle_line())

## §8.4：只消费 picked_up 业务成功信号；kind 与白名单由状态层复核（T08）。
func _on_picked_up(context: Dictionary) -> void:
	if context.get("kind") != "pickup":
		return
	_state.register_cell(String(context.get("instanceId", "")), _run_id)

## §8.4：读取 result.toggleState 新值，不自行取反；只接受已绑定线路实例。
func _on_toggled(context: Dictionary) -> void:
	if String(context.get("instanceId", "")) != _config.line_switch_instance_id:
		return
	var result: Dictionary = context.get("result", {})
	if _state.set_line_enabled(bool(result.get("toggleState", false)), _run_id):
		line_switch_used.emit()

## §8.4 busy_changed：交互持有的输入锁；只释放交互自己的锁，不解除暂停/演出锁。
func _on_busy_changed(busy: bool) -> void:
	if busy:
		if _interaction_lock_token < 0:
			_interaction_lock_token = _lock.acquire(self, "interaction")
	else:
		if _interaction_lock_token >= 0:
			_lock.release_token(_interaction_lock_token)
			_interaction_lock_token = -1

func _exit_tree() -> void:
	if _state != null and _state.state_changed.is_connected(_on_state_changed):
		_state.state_changed.disconnect(_on_state_changed)
	if is_instance_valid(_runtime) and _runtime.busy_changed.is_connected(_on_busy_changed):
		_runtime.busy_changed.disconnect(_on_busy_changed)
	if _interaction_lock_token >= 0 and _lock != null:
		_lock.release_token(_interaction_lock_token)
		_interaction_lock_token = -1
