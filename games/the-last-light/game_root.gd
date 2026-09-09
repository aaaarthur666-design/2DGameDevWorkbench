## GameRoot.gd —— 《最后一盏灯》游戏根节点（策划案 §8.3）
## 唯一职责：开始 / 退出、LevelSlot 生命周期、关卡重建。
## 不承担：电池数量判定（DemoRunState）、逐帧控制角色（Player_Maintainer）。
## WP-01 骨架：仅建立容器式承载；正式关卡由 LastLightBuilder 在 WP-02/WP-09 接入。
extends Node2D

const LEVEL_PATH := "res://LevelModule/LevelRoot.tscn"

## 每局唯一值（§4.2 run_id）。重开时递增，旧局回调凭 run_id 失效（§8.8）。
var run_id: int = 0
var _current_level: Node = null

@onready var _level_slot: Node2D = $LevelSlot


func _ready() -> void:
	_load_level()


## 容器式关卡承载（参考 CopyWorms MainEntry 方法，不移植 whole-tree 转场管理器）。
## 重开 = 卸载旧关卡整棵重建（§4.6），不逐个猜测修改遗留状态。
func _load_level() -> void:
	run_id += 1
	if _current_level and is_instance_valid(_current_level):
		_current_level.queue_free()
		_current_level = null
		await get_tree().process_frame
	if ResourceLoader.exists(LEVEL_PATH):
		_current_level = load(LEVEL_PATH).instantiate()
		if "run_id" in _current_level:
			_current_level.run_id = run_id
		_level_slot.add_child(_current_level)
	else:
		_show_placeholder()


func _show_placeholder() -> void:
	var label := Label.new()
	label.text = "The Last Light - WP-01 scaffold\nLevelRoot pending WP-02. See Docs/wp-01-baseline.md"
	label.position = Vector2(16, 16)
	add_child(label)
