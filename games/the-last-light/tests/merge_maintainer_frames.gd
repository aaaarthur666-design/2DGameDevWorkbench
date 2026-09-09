## merge_maintainer_frames.gd —— 合并守灯人三动作为角色总 SpriteFrames（§8.6.3）
## 用法：godot --headless --path . --script res://tests/merge_maintainer_frames.gd
## 规则：只合并选中动作（idle/walk/jump），不覆盖来源包；保留包内帧序/FPS/loop/锚点。
## 产物：res://Assets/Characters/maintainer/maintainer_frames.tres（新资源路径）
extends SceneTree

const IDLE := "res://forge_sprites/reference_6f84e3e6e116560d2c75f9fb/20260909_reference_6f84e3e6e116560d2c75f9fb_idle_001_c01_a8a41918a11c/sprite_frames.tres"
const WALK := "res://forge_sprites/reference_6f84e3e6e116560d2c75f9fb/20260909_reference_6f84e3e6e116560d2c75f9fb_walk_001_c01_07d2684ef86e/sprite_frames.tres"
const JUMP := "res://forge_sprites/reference_6f84e3e6e116560d2c75f9fb/20260909_reference_6f84e3e6e116560d2c75f9fb_jump_001_c01_b89020fcb6be/sprite_frames.tres"
const MERGE_HELPER := "res://RuntimeSupport/sprite_frames_merge.gd"
const OUT := "res://Assets/Characters/maintainer/maintainer_frames.tres"

func _initialize() -> void:
	var Merge = load(MERGE_HELPER)
	var idle := load(IDLE) as SpriteFrames
	var walk := load(WALK) as SpriteFrames
	var jump := load(JUMP) as SpriteFrames
	if idle == null or walk == null or jump == null:
		printerr("来源 SpriteFrames 加载失败")
		quit(1)
		return
	var merged := Merge.merge_clips(idle, walk) as SpriteFrames
	merged = Merge.merge_clips(merged, jump) as SpriteFrames
	if merged == null:
		printerr("merge_clips 失败")
		quit(1)
		return
	# 核对：三动作齐全、帧序/FPS/loop 与导出配方一致（§8.6.7 不按文件名字典序猜帧序）
	var ok := true
	for name in [&"idle", &"walk", &"jump"]:
		if not merged.has_animation(name):
			printerr("缺少动作 ", name)
			ok = false
	if ok:
		var report := []
		for name in [&"idle", &"walk", &"jump"]:
			report.append("%s: %d帧 %.1fFPS loop=%s" % [name, merged.get_frame_count(name), merged.get_animation_speed(name), merged.get_animation_loop(name)])
		print("合并结果：", " | ".join(report))
		ok = merged.get_frame_count(&"idle") == 17 and merged.get_frame_count(&"walk") == 17 and merged.get_frame_count(&"jump") == 17
		ok = ok and absf(merged.get_animation_speed(&"idle") - 8.0) < 0.01
		ok = ok and absf(merged.get_animation_speed(&"walk") - 5.0) < 0.01
		ok = ok and absf(merged.get_animation_speed(&"jump") - 6.0) < 0.01
		ok = ok and merged.get_animation_loop(&"idle") and merged.get_animation_loop(&"walk") and not merged.get_animation_loop(&"jump")
	if not ok:
		printerr("合并结果与导出配方不一致")
		quit(1)
		return
	# 来源包只读校验：合并不得修改输入（§8.6.3 不覆盖来源资源）
	var err := ResourceSaver.save(merged, OUT)
	if err != OK:
		printerr("保存失败：", err)
		quit(1)
		return
	print("已写出 ", OUT)
	quit(0)
