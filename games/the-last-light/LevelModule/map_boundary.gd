## 关卡外围空气墙；由 LevelRoot 根据实际地图尺寸创建，随关卡一起释放。
## 放在生成资源之外，重新导出地图不会覆盖；内表面贴边，不缩小可玩区域。
extends StaticBody2D

const THICKNESS := 8.0

func configure(bounds: Rect2) -> void:
	collision_layer = 1
	collision_mask = 0
	var center := bounds.get_center()
	_add_wall("Left", Vector2(bounds.position.x - THICKNESS / 2.0, center.y), Vector2(THICKNESS, bounds.size.y))
	_add_wall("Right", Vector2(bounds.end.x + THICKNESS / 2.0, center.y), Vector2(THICKNESS, bounds.size.y))
	_add_wall("Top", Vector2(center.x, bounds.position.y - THICKNESS / 2.0), Vector2(bounds.size.x + THICKNESS * 2.0, THICKNESS))
	_add_wall("Bottom", Vector2(center.x, bounds.end.y + THICKNESS / 2.0), Vector2(bounds.size.x + THICKNESS * 2.0, THICKNESS))

func _add_wall(wall_name: String, center: Vector2, size: Vector2) -> void:
	var wall := CollisionShape2D.new()
	wall.name = wall_name
	var rectangle := RectangleShape2D.new()
	rectangle.size = size
	wall.shape = rectangle
	wall.position = center
	add_child(wall)
