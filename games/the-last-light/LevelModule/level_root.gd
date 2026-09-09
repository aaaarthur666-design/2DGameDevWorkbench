## LevelRoot —— 本关 Builder 与生命周期宿主（策划案 §8.3）
## 职责：加载并校验导出场景、建立真实 ID 绑定、挂载玩家和信号，管理 phase 流转。
## 不承担：每帧扫描全树、保存第二份任务进度、决定电池是否已拾取。
extends Node2D

const SCENE_PATH := "res://scenes/scene-fe3fd0ff-8b14-4020-8c2a-9083dfda4275/scene.tscn"
const PLAYER_PATH := "res://PlayerModule/Formal/Player_Maintainer.tscn"
const MapBoundary = preload("res://LevelModule/map_boundary.gd")
const WEATHER_SCENE = preload("res://LevelModule/weather/RainStorm.tscn")
const CHARACTER_FOCUS_SCENE = preload("res://LevelModule/presentation/CharacterFocus.tscn")
const MAP_REVEAL_CAMERA = preload("res://LevelModule/presentation/map_reveal_camera.gd")

## 360 / 1.2 = 300 世界像素高，人物聚光圆直径保持 252。
@export_range(0.25, 3.0, 0.05) var camera_zoom: float = 1.2

const DEMO_CONFIG_PATH := "res://DataConfig/demo_config.tres"
## §7.4 点灯演出 2.8 秒占位（WP-10 前由定时器代替 BeaconPresentation）
const PRESENTATION_SECONDS := 2.8
## spawn_main 派生锚点：左码头地面，脚底 Y=872（实图坐标；§5.2 旧设计坐标已随地图替换登记）
const SPAWN_POSITION := Vector2(96, 872)

## 由 GameRoot 注入（每局唯一值，§4.2 run_id）
var run_id: int = 0
var demo_config: TllDemoConfig
var run_state: DemoRunState
var input_lock: InputLockAdapter
var _bridge: InteractionBridge
var _player: CharacterBody2D

func _ready() -> void:
	demo_config = load(DEMO_CONFIG_PATH) as TllDemoConfig
	var errors := DemoRunState.validate_config(demo_config)
	if not errors.is_empty():
		for e in errors:
			push_error("[LevelRoot] 配置非法：" + e)
		_show_config_error(errors)
		return
	input_lock = InputLockAdapter.new()
	run_state = DemoRunState.new(demo_config, run_id)
	run_state.phase_changed.connect(_on_phase_changed)
	# 挂载导出场景（§8.7.4：Builder 包装生成场景，脚本与演出节点放外层）
	var scene: Node = (load(SCENE_PATH) as PackedScene).instantiate()
	add_child(scene)
	var map := scene.get_node("map_overall") as Sprite2D
	var world_bounds: Rect2 = map.global_transform * map.get_rect()
	var boundary := MapBoundary.new()
	boundary.name = "MapBoundary"
	boundary.configure(global_transform.affine_inverse() * world_bounds)
	add_child(boundary)
	# 玩家挂 ActorSlot，相对 Z 保持 0（§5.4 / §8.7.4）
	var slot: Node = scene.get_node_or_null("ActorSlot")
	if slot == null:
		push_error("[LevelRoot] 场景缺少 ActorSlot，无法挂载玩家")
		return
	_player = load(PLAYER_PATH).instantiate()
	_player.input_lock = input_lock
	slot.add_child(_player)
	_player.global_position = SPAWN_POSITION
	var camera := _player.get_node("Camera2D") as Camera2D
	camera.zoom = Vector2.ONE * camera_zoom
	camera.limit_left = floori(world_bounds.position.x)
	camera.limit_top = floori(world_bounds.position.y)
	camera.limit_right = ceili(world_bounds.end.x)
	camera.limit_bottom = ceili(world_bounds.end.y)
	# 出生时直接定位，避免镜头从原点缓慢追来导致开场角色被裁掉。
	camera.reset_smoothing()
	camera.force_update_scroll()
	# 交互桥接：现有物件信号 → 本关状态操作
	_bridge = InteractionBridge.new()
	add_child(_bridge)
	_bridge.bind(scene, run_state, demo_config, run_id, input_lock)
	# 屏幕雨幕随关卡释放；在世界上方、对话层下方，不参与交互输入。
	add_child(WEATHER_SCENE.instantiate())
	var character_focus := CHARACTER_FOCUS_SCENE.instantiate()
	add_child(character_focus)
	character_focus.bind_player(_player)
	var camera_reveal := MAP_REVEAL_CAMERA.new()
	camera_reveal.name = "MapRevealCamera"
	add_child(camera_reveal)
	camera_reveal.configure(camera, world_bounds)
	character_focus.dismissal_progressed.connect(camera_reveal.apply_progress)
	_bridge.line_switch_used.connect(character_focus.expand_and_dismiss)
	run_state.begin_playing()

func _on_phase_changed(phase: StringName, p_run_id: int) -> void:
	if phase != DemoRunState.PHASE_LIGHTING:
		return
	var state := run_state
	await get_tree().create_timer(PRESENTATION_SECONDS).timeout
	# 旧局/已卸载关卡不再推进（§8.8 延迟回调检查 run_id 与节点有效性）
	if is_instance_valid(self) and state != null:
		state.presentation_finished(p_run_id)

func _show_config_error(errors: Array[String]) -> void:
	# §6.4：配置缺失给出返回路径与开发诊断，不把字段名铺在正常游戏 UI（灰盒阶段直接显示）
	var label := Label.new()
	label.text = "DemoConfig invalid, see console:\n" + "\n".join(errors)
	label.position = Vector2(16, 16)
	add_child(label)
