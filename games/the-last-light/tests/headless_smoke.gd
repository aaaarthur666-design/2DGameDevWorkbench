## headless_smoke.gd —— 《最后一盏灯》引擎行为冒烟（V3，Godot 4.7.x headless）
## 运行：godot --headless --path <project> --script res://tests/headless_smoke.gd
## 覆盖：场景挂载/玩家/信号桥接/T06/T08/T09/T10-T14/T20/T25/跳跃/朝向/越界恢复/重开。
## 不覆盖：渲染、人工游玩手感（V4 待人工）。
extends SceneTree

var _failures: int = 0

func check(cond: bool, label: String) -> void:
	if cond:
		print("PASS  ", label)
	else:
		_failures += 1
		printerr("FAIL  ", label)

func _initialize() -> void:
	print("== TLL headless smoke ==")
	await _main()
	print("== 结束：", "全部通过" if _failures == 0 else "%d 项失败" % _failures, " ==")
	quit(_failures)

func _main() -> void:
	# ---- 启动主场景 ----
	var game_root = load("res://GameRoot.tscn").instantiate()
	root.add_child(game_root)
	for i in 6:
		await physics_frame
	check(game_root.run_id == 1, "GameRoot run_id=1")
	var level = game_root._current_level
	check(level != null and is_instance_valid(level), "LevelRoot 已加载（GameRoot→LevelSlot 容器承载）")
	if level == null:
		return
	var state: DemoRunState = level.get("run_state")
	check(state != null and state.phase == DemoRunState.PHASE_PLAYING, "配置校验通过并进入 PLAYING（T25 正常配置）")
	if state == null:
		printerr("ABORT  run_state 缺失（level 脚本可能加载失败）")
		_failures += 1
		return

	# ---- 场景结构 ----
	var scene_instance = level.get_child(0)
	check(scene_instance != null, "导出场景实例已挂载于 LevelRoot 外层之下")
	var runtimes := get_nodes_in_group("workbench_interaction_runtime").filter(func(n): return level.is_ancestor_of(n))
	check(runtimes.size() == 1, "场景内恰好一个 InteractionRuntime（§8.3 不加第二个）")
	var runtime = runtimes[0]
	var expected_ids := ["instance-67959b63-c7ac-4fa0-b1c8-c1428a69058b", "instance-8eb5dd2b-5b17-4e68-b373-480f4e05fbfa", "instance-65c3867d-7354-4d56-890e-51cdaddcc390"]
	var found: Array = []
	for o in runtime.objects:
		if is_instance_valid(o):
			found.append(o.effective_instance_id())
	for id in expected_ids:
		check(found.has(id), "runtime 已注册实例 " + id)

	# ---- 玩家 ----
	var slot = scene_instance.get_node_or_null("ActorSlot")
	check(slot != null, "ActorSlot 存在")
	var player = slot.get_child(0) if slot and slot.get_child_count() > 0 else null
	check(player != null and player is CharacterBody2D, "玩家挂载于 ActorSlot（相对 Z 保持 0）")
	check(player != null and player.is_in_group("interaction_actor"), "玩家加入 interaction_actor 组（§5.4）")
	check(player != null and player.collision_layer == 2 and player.collision_mask == 1, "碰撞层：玩家层 2 / 世界层 1（§5.4）")
	var cam = player.get_node_or_null("Camera2D") if player else null
	check(cam != null and cam.limit_right == 1536 and cam.limit_bottom == 1024, "镜头限制在地图内（双向跟随，§5.4 偏差已登记）")
	check(player.is_on_floor(), "玩家落在左码头地面（spawn 派生锚点）")
	check(player.global_position.distance_to(Vector2(96, 872)) < 4.0, "出生点坐标正确")

	# ---- 信号桥接（真实信号 → 状态）----
	var battery_a = null
	var switch_obj = null
	for o in runtime.objects:
		if not is_instance_valid(o):
			continue
		if o.effective_instance_id() == "instance-8eb5dd2b-5b17-4e68-b373-480f4e05fbfa":
			battery_a = o
		elif o.effective_instance_id() == "instance-65c3867d-7354-4d56-890e-51cdaddcc390":
			switch_obj = o
	check(battery_a != null and switch_obj != null, "桥接目标物件可定位")
	var ctx := {"definitionId": "object-2d9c7f0c-3181-4aa2-8373-3eb9ede088ad", "instanceId": "instance-8eb5dd2b-5b17-4e68-b373-480f4e05fbfa", "source": null, "kind": "pickup", "result": {"completed": true, "toggleState": false, "sequenceIndex": 0, "successCount": 1}}
	battery_a.picked_up.emit(ctx)
	check(state.collected_total() == 1, "picked_up → register_cell 计数=1（T06）")
	battery_a.picked_up.emit(ctx)
	check(state.collected_total() == 1, "重复 picked_up 不重复计数（T08 重复实例）")
	switch_obj.toggled.emit({"instanceId": "instance-65c3867d-7354-4d56-890e-51cdaddcc390", "kind": "toggle", "result": {"toggleState": true}})
	check(state.line_enabled == true, "toggled → 写入 toggleState 新值（§4.5）")
	switch_obj.toggled.emit({"instanceId": "instance-65c3867d-7354-4d56-890e-51cdaddcc390", "kind": "toggle", "result": {"toggleState": true}})
	check(state.line_enabled == true, "相同值幂等（§8.4）")

	# ---- 单元级判定表（§4.4 / T09-T14 / T20 / T25）----
	_truth_table()
	# ---- 本局点灯闭环（T14 + 演出占位 → WON）----
	var battery_b_ctx := ctx.duplicate()
	battery_b_ctx["instanceId"] = "instance-67959b63-c7ac-4fa0-b1c8-c1428a69058b"
	for o in runtime.objects:
		if is_instance_valid(o) and o.effective_instance_id() == "instance-67959b63-c7ac-4fa0-b1c8-c1428a69058b":
			o.picked_up.emit(battery_b_ctx)
	check(state.cells_ready(), "两块电池就绪（顺序无关 T09：先开关后电池）")
	check(state.request_start(state.run_id) == &"STARTED", "request_start → STARTED（唯一一次点灯）")
	check(state.request_start(state.run_id) == &"IGNORED", "LIGHTING 中再次请求被忽略（T14）")
	await create_timer(3.1).timeout
	check(state.phase == DemoRunState.PHASE_WON, "演出占位 2.8s 后进入 WON")

	# ---- 玩家物理：跳跃 / 朝向 / 越界恢复 ----
	await _player_physics(player)
	# ---- 动画接入合同（§7.2 / §8.6）----
	await _animation_contract(player)
	# ---- 重开（T18/T20：整棵重建 + run_id 失效）----
	var old_level = level
	game_root._load_level()
	await physics_frame
	await physics_frame
	for i in 4:
		await physics_frame
	check(game_root.run_id == 2, "重开 run_id 递增=2")
	check(not is_instance_valid(old_level), "旧关卡已卸载")
	var new_level = game_root._current_level
	check(new_level != null and new_level != old_level, "新关卡已建立")
	if new_level and new_level.get("run_state"):
		check(new_level.run_state.run_id == 2, "新局状态携带新 run_id")
		check(new_level.run_state.collected_total() == 0 and not new_level.run_state.line_enabled, "新局电池/线路归零（T18）")
		check(new_level.run_state.phase == DemoRunState.PHASE_PLAYING, "新局进入 PLAYING")
	else:
		check(false, "新局 run_state 缺失")

func _truth_table() -> void:
	var cfg := TllDemoConfig.new()
	cfg.required_cells = 2
	cfg.available_cell_ids = ["a", "b"]
	cfg.line_switch_instance_id = "sw"
	# T10-T13（§4.4 判定表：每例独立状态，避免条件交叉污染）
	var st_t10 := DemoRunState.new(cfg, 70)
	st_t10.begin_playing()
	check(st_t10.request_start(70) == &"MISSING_BOTH", "T10 零电池+线路关 → MISSING_BOTH")
	var st := DemoRunState.new(cfg, 7)
	st.begin_playing()
	st.register_cell("a", 7)
	st.set_line_enabled(true, 7)
	check(st.request_start(7) == &"MISSING_CELLS", "T11 一电池+线路开 → MISSING_CELLS")
	var st12 := DemoRunState.new(cfg, 12)
	st12.begin_playing()
	st12.register_cell("a", 12)
	st12.register_cell("b", 12)
	check(st12.request_start(12) == &"LINE_OFF", "T12 电池齐+线路关 → LINE_OFF")
	st12.set_line_enabled(true, 12)
	check(st12.phase == DemoRunState.PHASE_PLAYING and st12.can_start(), "T13 条件齐全但不操作终端 → 保持 PLAYING")
	check(st12.request_start(12) == &"STARTED", "T14 条件齐全 → STARTED")
	check(st12.request_start(12) == &"IGNORED", "T14 连续请求第二次 → IGNORED")
	st12.presentation_finished(12)
	check(st12.phase == DemoRunState.PHASE_WON, "presentation_finished → WON")
	st12.presentation_finished(12)
	check(st12.phase == DemoRunState.PHASE_WON, "presentation_finished 幂等")
	# T08 异常输入
	var st2 := DemoRunState.new(cfg, 8)
	st2.begin_playing()
	check(st2.register_cell("a", 8) == true, "T08 首次登记受理")
	check(st2.register_cell("a", 8) == false, "T08 重复实例拒绝")
	check(st2.register_cell("zzz", 8) == false, "T08 非白名单拒绝")
	check(st2.register_cell("b", 999) == false, "T20 旧 run_id 拒绝")
	check(st2.collected_total() == 1, "T08 异常输入后集合不变")
	check(st2.set_line_enabled(true, 999) == false, "T20 旧 run_id 写线路拒绝")
	# T09 顺序无关
	var st3 := DemoRunState.new(cfg, 9)
	st3.begin_playing()
	st3.set_line_enabled(true, 9)
	st3.register_cell("a", 9)
	st3.register_cell("b", 9)
	check(st3.request_start(9) == &"STARTED", "T09 先线路后电池 → 正常点灯")
	# 需求 1 变体（§4.4：两块仍可拾取，条件用 >=）
	var cfg1 := TllDemoConfig.new()
	cfg1.required_cells = 1
	cfg1.available_cell_ids = ["a", "b"]
	cfg1.line_switch_instance_id = "sw"
	var st4 := DemoRunState.new(cfg1, 10)
	st4.begin_playing()
	st4.register_cell("a", 10)
	st4.register_cell("b", 10)
	st4.set_line_enabled(true, 10)
	check(st4.request_start(10) == &"STARTED", "T24 需求 1 时拾两块仍可通关")
	# T25 非法配置
	var bad1 := TllDemoConfig.new()
	bad1.required_cells = 0
	bad1.available_cell_ids = ["a"]
	bad1.line_switch_instance_id = "s"
	check(DemoRunState.validate_config(bad1).size() > 0, "T25 拒绝需求 0")
	var bad2 := TllDemoConfig.new()
	bad2.required_cells = 2
	bad2.available_cell_ids = ["a", "a"]
	bad2.line_switch_instance_id = "s"
	check(DemoRunState.validate_config(bad2).size() > 0, "T25 拒绝重复实例 ID")
	var bad3 := TllDemoConfig.new()
	bad3.required_cells = 3
	bad3.available_cell_ids = ["a", "b"]
	bad3.line_switch_instance_id = "s"
	check(DemoRunState.validate_config(bad3).size() > 0, "T25 拒绝需求大于可用数")
	var bad4 := TllDemoConfig.new()
	bad4.required_cells = 1
	bad4.available_cell_ids = ["a"]
	bad4.line_switch_instance_id = ""
	check(DemoRunState.validate_config(bad4).size() > 0, "T25 拒绝缺线路绑定")
	var good := TllDemoConfig.new()
	good.required_cells = 1
	good.available_cell_ids = ["a"]
	good.line_switch_instance_id = "s"
	check(DemoRunState.validate_config(good).is_empty(), "T25 合法配置通过")

func _animation_contract(player: CharacterBody2D) -> void:
	if player == null:
		check(false, "玩家缺失，跳过动画合同检查")
		return
	var sprite = player.get_node("Sprite")
	check(sprite is AnimatedSprite2D, "视觉节点为 AnimatedSprite2D（唯一视觉节点 §8.6.4）")
	check(player.get_node_or_null("Placeholder") == null, "灰盒占位已移除（真实资产到位）")
	var frames: SpriteFrames = sprite.sprite_frames
	check(frames != null, "合并 SpriteFrames 已挂载")
	if frames == null:
		return
	check(frames.has_animation(&"idle") and frames.has_animation(&"walk") and frames.has_animation(&"jump"), "三动作别名齐全 idle/walk/jump")
	check(frames.get_frame_count(&"idle") == 32 and frames.get_frame_count(&"walk") == 17 and frames.get_frame_count(&"jump") == 17, "待机 32 个播放槽位（17 张原帧含转回），walk/jump 保留 17 帧")
	check(absf(frames.get_animation_speed(&"idle") - 10.0) < 0.01 and absf(frames.get_animation_speed(&"walk") - 10.0) < 0.01 and absf(frames.get_animation_speed(&"jump") - 10.0) < 0.01, "FPS 保留本次替换前实际游戏值 10/10/10")
	check(frames.get_animation_loop(&"idle") and frames.get_animation_loop(&"walk") and not frames.get_animation_loop(&"jump"), "loop：idle/walk 循环、jump 非循环（§7.2）")
	check(sprite.offset == Vector2(1, -28), "64px 导出锚点 (31,60) 对应偏移 (1,-28)")
	check(sprite.scale.is_equal_approx(Vector2(1.5, 1.5)), "原生 64px 视觉放大 1.5，角色高度约 84px")
	check(frames.get_frame_texture(&"idle", 0).get_size() == Vector2(64, 64), "实际帧资源为原生 64px")
	# 状态→clip 真实播放（T02 动画映射）
	check(sprite.is_playing() and sprite.animation == &"idle", "静止 → idle 播放中（T02 动画映射）")
	Input.action_press("ui_right")
	for i in 20:
		await physics_frame
	Input.action_release("ui_right")
	check(sprite.animation == &"walk" and sprite.is_playing(), "移动 → walk 播放中")
	for i in 30:
		await physics_frame
	var jumped := false
	for i in 6:
		Input.action_release("player_jump")
		await physics_frame
		Input.action_press("player_jump")
		await physics_frame
		if player.velocity.y < 0.0:
			jumped = true
			break
	Input.action_release("player_jump")
	check(jumped and sprite.animation == &"jump", "起跳 → jump 播放中（新动作重播 §8.6.5）")
	for i in 120:
		await physics_frame
		if player.is_on_floor():
			break
	check(sprite.animation == &"idle" or sprite.animation == &"walk", "落地切回 idle/walk（物理判定 §8.6.8）")

func _player_physics(player: CharacterBody2D) -> void:
	if player == null:
		check(false, "玩家缺失，跳过物理检查")
		return
	# 跳跃（T03：每次起跳重新播放 → jump_token 递增；v=-720 灰盒 v0）
	var token_before: int = player._jump_token
	var jumped := false
	for i in 6:
		Input.action_release("player_jump")
		await physics_frame
		Input.action_press("player_jump")
		await physics_frame
		if player.velocity.y < 0.0:
			jumped = true
			break
	Input.action_release("player_jump")
	check(jumped, "起跳生效（jump_velocity=-720，可越 192px 平台间隙）")
	check(player._jump_token == token_before + 1, "再次起跳作为新动作重播（jump_token +1）")
	# 落地
	for i in 90:
		await physics_frame
		if player.is_on_floor():
			break
	check(player.is_on_floor(), "落地（物理判定，非 animation_finished §8.6.8）")
	# 朝向（T03：只翻转视觉，碰撞不镜像）
	Input.action_press("ui_right")
	for i in 20:
		await physics_frame
	check(player.velocity.x > 0 and player.get_node("Sprite").flip_h == true, "向右移动：朝左原图 flip_h=true")
	check(player.scale.x == 1.0, "物理节点不镜像（scale.x 恒 1）")
	Input.action_release("ui_right")
	Input.action_press("ui_left")
	for i in 30:
		await physics_frame
	check(player.velocity.x < 0 and player.get_node("Sprite").flip_h == false, "向左移动：朝左原图 flip_h=false")
	Input.action_release("ui_left")
	for i in 30:
		await physics_frame
	# 越界恢复（T21：回安全点、速度清零）
	player.global_position = Vector2(500, 1300)
	await physics_frame
	await physics_frame
	check(player.global_position.y < 1000.0, "越界恢复到最近安全地面点（T21）")
	check(player.velocity == Vector2.ZERO, "恢复后速度清零（T21）")
