## TllPlayerConfig —— 维修员手感配置（策划案 §5.3 + §8.1 Resource 配置方式）
## 默认值必须被实际消费者读取，杜绝第二套硬编码。
## 灰盒 v0（2026-09-09）：jump_velocity/gravity 按真实地图平台间隙（最大 192px）调整并记录，待实机游玩确认。
class_name TllPlayerConfig
extends Resource

@export var move_speed: float = 160.0
@export var gravity: float = 1200.0
@export var jump_velocity: float = -720.0
@export var air_state_threshold: float = 0.05
@export var input_dead_zone: float = 0.1
@export var facing_velocity_threshold: float = 10.0
@export var movement_acceleration_multiplier: float = 10.0
@export var collision_size: Vector2 = Vector2(28, 72)
## 越界恢复阈值（§4.5）：低于此 Y 视为跌出有效范围
@export var kill_y: float = 1100.0

## v02 原图实际朝左；朝向适配只作用于 Sprite。
@export var source_facing_right: bool = false
