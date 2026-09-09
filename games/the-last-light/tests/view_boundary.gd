## 验证实际玩家形状与四边物理碰撞、镜头覆盖范围及重入生命周期。
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
	var level = game._current_level
	var player: CharacterBody2D = level._player
	var boundary = level.get_node("MapBoundary")
	check(boundary.get_child_count() == 4, "four perimeter walls")
	var camera: Camera2D = player.get_node("Camera2D")
	var visible_size := root.get_visible_rect().size / camera.zoom
	check(visible_size.is_equal_approx(Vector2(1280, 720)), "camera sees 1280x720 world units")
	var view := root.canvas_transform.affine_inverse() * root.get_visible_rect()
	print("VISIBLE_RECT ", view)
	check(view.position.x >= -1 and view.position.y >= -1 and view.end.x <= 1537 and view.end.y <= 1025, "camera view stays inside map")
	check(view.has_point(player.global_position - Vector2(0, 36)), "player visible immediately after spawn")
	var probes := [
		[Vector2(100, 300), Vector2(-3000, 0), Vector2.RIGHT, "left"],
		[Vector2(1400, 300), Vector2(3000, 0), Vector2.LEFT, "right"],
		[Vector2(200, 100), Vector2(0, -3000), Vector2.DOWN, "top"],
		[Vector2(16, 980), Vector2(0, 3000), Vector2.UP, "bottom"],
	]
	for p in probes:
		var transform := player.global_transform
		transform.origin = p[0]
		var collision := KinematicCollision2D.new()
		var hit := player.test_move(transform, p[1], collision)
		check(hit and collision.get_collider() == boundary, p[3] + " blocks real player shape, including fast movement")
		check(hit and collision.get_normal().is_equal_approx(p[2]), p[3] + " inward collision normal")
	Input.action_press("ui_left")
	for i in 150:
		await physics_frame
	Input.action_release("ui_left")
	check(player.global_position.x >= 14 and player.global_position.y <= 1024.1, "walking off left edge remains inside map")
	var previous = weakref(boundary)
	game._load_level()
	for i in 8:
		await physics_frame
	check(previous.get_ref() == null, "old perimeter freed on restart")
	check(game._current_level.get_node("MapBoundary").get_child_count() == 4, "restart creates exactly one perimeter")
	print("VIEW_BOUNDARY_RESULT failures=", failures)
	quit(failures)
