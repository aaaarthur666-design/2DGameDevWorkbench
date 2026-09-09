## Player_Maintainer —— 无战斗维修员控制器（策划案 §8.3）
## 职责：输入、物理、朝向、动画请求、安全落点。
## 方法来源：CopyWorms PlayerBase / Player_Warrior（适配重写，见 Docs/source-to-target.md）。
## 不承担：背包、终端通关、直接读具体物件节点。
extends CharacterBody2D

const DEFAULT_CONFIG_PATH := "res://DataConfig/tll_player_config.tres"

@export var config: TllPlayerConfig

enum State { IDLE, RUN, JUMP, FALL }

## 由 LevelRoot 注入；对话/演出期间锁定移动与跳跃（§6.2）
var input_lock: InputLockAdapter

var _state: State = State.IDLE
var _facing_right: bool = true
var _air_time: float = 0.0
var _last_safe_position: Vector2
var _has_safe_position: bool = false
var _jump_token: int = 0  ## 动作发生标记：再次起跳作为新动作重播（§7.2）
var _last_clip: String = ""
var _last_clip_token: int = -1

@onready var _sprite: Node2D = $Sprite

func _ready() -> void:
	collision_layer = 2  ## 玩家层 2（§5.4）
	collision_mask = 1   ## 世界层 1
	add_to_group("interaction_actor")
	if config == null:
		config = load(DEFAULT_CONFIG_PATH) as TllPlayerConfig
	if config == null:
		push_error("[Player] 玩家配置加载失败，使用 TllPlayerConfig 安全默认值")
		config = TllPlayerConfig.new()
	_apply_facing()
	_last_safe_position = global_position

func _physics_process(delta: float) -> void:
	var locked := input_lock != null and input_lock.is_blocked()
	var dir := 0.0
	if not locked:
		dir = Input.get_axis("ui_left", "ui_right")
	# 水平移动：加速度插值（方法同 PlayerBase）
	if absf(dir) > config.input_dead_zone:
		velocity.x = move_toward(velocity.x, dir * config.move_speed, config.move_speed * config.movement_acceleration_multiplier * delta)
	else:
		velocity.x = move_toward(velocity.x, 0.0, config.move_speed * config.movement_acceleration_multiplier * delta)
	# 重力
	if not is_on_floor():
		velocity.y += config.gravity * delta
	# 起跳：仅地面，空中不连续起跳（§4.1）
	if not locked and is_on_floor() and Input.is_action_just_pressed("player_jump"):
		velocity.y = config.jump_velocity
		_jump_token += 1
		# 起跳立即进入空中状态（CopyWorms PlayerBase._perform_jump 同款）；
		# 防抖阈值只保护「走出平台」的被动腾空，不拖慢起跳动画切换
		_air_time = config.air_state_threshold + 0.01
		_state = State.JUMP
	move_and_slide()
	# 落地防抖与安全点（air_state_threshold，方法同 PlayerBase）
	# 必须在 move_and_slide 之后评估：传送后旧帧的 is_on_floor 是过期值，
	# 先更新会把安全点写进坠落区（T21 回归实证）
	if is_on_floor():
		_air_time = 0.0
		if global_position.y < config.kill_y:
			_has_safe_position = true
			_last_safe_position = global_position
	else:
		_air_time += delta
	# 朝向：只翻转视觉节点，不镜像物理、碰撞体和世界坐标（§7.2 / §8.6.6）
	if velocity.x > config.facing_velocity_threshold:
		_facing_right = true
	elif velocity.x < -config.facing_velocity_threshold:
		_facing_right = false
	_apply_facing()
	_update_state()
	_update_animation()
	# 越界无损恢复（§4.5）：回最近安全地面点、清零速度、保留进度
	if global_position.y > config.kill_y and _has_safe_position:
		global_position = _last_safe_position
		velocity = Vector2.ZERO

func _apply_facing() -> void:
	if _sprite is Sprite2D or _sprite is AnimatedSprite2D:
		_sprite.flip_h = _facing_right != config.source_facing_right

func _update_state() -> void:
	if is_on_floor():
		_state = State.RUN if absf(velocity.x) > config.facing_velocity_threshold else State.IDLE
	elif _air_time > config.air_state_threshold:
		_state = State.JUMP if velocity.y < 0.0 else State.FALL

## 动作映射（§7.2）：静止地面→idle，移动地面→walk，上升/下落→jump。
## 只在目标动画变化时切换（防逐帧重置）；再次起跳凭发生标记重播（§8.6.5）。
func _update_animation() -> void:
	var clip := "idle"
	match _state:
		State.IDLE:
			clip = "idle"
		State.RUN:
			clip = "walk"
		State.JUMP, State.FALL:
			clip = "jump"
	_request_clip(clip, _jump_token)

func _request_clip(clip: String, token: int) -> void:
	if clip == _last_clip and token == _last_clip_token:
		return
	_last_clip = clip
	_last_clip_token = token
	if _sprite is AnimatedSprite2D and _sprite.sprite_frames and _sprite.sprite_frames.has_animation(clip):
		_sprite.play(clip)
		_sprite.frame = 0
	# WP-05 之前无真实 clip：保持占位视觉，不虚报动画存在（§9.2 灰盒标记）
