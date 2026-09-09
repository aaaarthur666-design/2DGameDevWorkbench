## Godot 4.7: actual actor playback, cadence, facing and interruption regression.
## Run: godot --headless --path <game> --script res://tests/keeper_idle.gd
extends SceneTree
var failures := 0
var count := 0
func check(ok: bool, label: String) -> void:
 count += 1
 print("PASS " if ok else "FAIL ",label)
 if not ok:
  failures += 1
func _initialize() -> void:
 call_deferred("run_checks")
func wait_for_frame(sprite: AnimatedSprite2D, frame_index: int, seconds: float) -> bool:
 var deadline := Time.get_ticks_msec() + int(seconds * 1000)
 while Time.get_ticks_msec() < deadline:
  await process_frame
  if sprite.animation == &"idle" and sprite.frame == frame_index:
   return true
 return false
func run_checks() -> void:
 var game = load("res://GameRoot.tscn").instantiate()
 root.add_child(game)
 for i in 8:
  await physics_frame
 var player = game._current_level._player
 var sprite: AnimatedSprite2D = player.get_node("Sprite")
 var collision: CollisionShape2D = player.get_node("CollisionShape")
 var original: SpriteFrames = load("res://Assets/Characters/maintainer/maintainer_frames_v02.tres")
 var frames: SpriteFrames = sprite.sprite_frames
 check(player.is_on_floor() and sprite.flip_h, "spawn faces right using mirrored left-facing art")
 check(player.scale == Vector2.ONE and collision.scale == Vector2.ONE and collision.position == Vector2(0,-36) and collision.shape.size == Vector2(28,72), "body and collider geometry unchanged")
 var correct_order := frames.get_frame_count(&"idle") == 32
 var expected: Array[int] = []
 for i in range(17): expected.append(i)
 for i in range(15,0,-1): expected.append(i)
 for i in expected.size():
  var source: AtlasTexture = original.get_frame_texture(&"idle",expected[i])
  var actual: AtlasTexture = frames.get_frame_texture(&"idle",i)
  correct_order = correct_order and actual.region == source.region and actual.atlas.resource_path == source.atlas.resource_path
 check(correct_order, "one turn plus explicit return; no duplicated endpoint frames or modified PNGs")
 for clip in [&"walk", &"jump"]:
  var same := frames.get_frame_count(clip) == original.get_frame_count(clip) and frames.get_animation_loop(clip) == original.get_animation_loop(clip) and is_equal_approx(frames.get_animation_speed(clip),original.get_animation_speed(clip))
  for i in original.get_frame_count(clip):
   var a: AtlasTexture = frames.get_frame_texture(clip,i)
   var b: AtlasTexture = original.get_frame_texture(clip,i)
   same = same and a.region == b.region and a.atlas.resource_path == b.atlas.resource_path and frames.get_frame_duration(clip,i) == original.get_frame_duration(clip,i)
  check(same, str(clip) + " order/duration/FPS/loop unchanged")
 check(is_equal_approx(frames.get_frame_duration(&"idle",0) / frames.get_animation_speed(&"idle"),3.0), "standing duration is 3 seconds")
 check(is_equal_approx(frames.get_frame_duration(&"idle",16) / frames.get_animation_speed(&"idle"),1.2), "turned pose duration is 1.2 seconds")
 var events: Array = []
 sprite.frame_changed.connect(func():
  if sprite.animation == &"idle":
   events.append({"frame":sprite.frame,"ms":Time.get_ticks_msec()}))
 player._last_clip = ""
 player._request_clip("idle",player._jump_token)
 events.clear()
 var start := Time.get_ticks_msec()
 check(await wait_for_frame(sprite,1,3.8), "idle starts turning after standing")
 check(absf((Time.get_ticks_msec()-start)/1000.0-3.0) < 0.18, "real initial hold lasts 3 seconds")
 check(await wait_for_frame(sprite,16,2.5), "outward turn reaches final source frame")
 var turned_at := Time.get_ticks_msec()
 await create_timer(0.5).timeout
 check(sprite.frame == 16, "turned pose remains still halfway through hold")
 check(await wait_for_frame(sprite,17,1.5), "return begins after turned hold")
 check(absf((Time.get_ticks_msec()-turned_at)/1000.0-1.2) < 0.18, "real turned hold lasts 1.2 seconds")
 check(await wait_for_frame(sprite,0,2.8), "return reaches original standing pose smoothly")
 var first_cycle_end := Time.get_ticks_msec()
 check(absf((first_cycle_end-start)/1000.0-7.575) < 0.2, "one full cycle lasts 7.575 seconds")
 var observed: Array = []
 for event in events: observed.append(event.frame)
 var expected_slots: Array = []
 for i in range(1,32): expected_slots.append(i)
 expected_slots.append(0)
 check(observed == expected_slots, "real playback visits every scheduled slot exactly once")
 var return_step := (int(events[17].ms)-int(events[16].ms))/1000.0 if events.size() >= 18 else 0.0
 check(absf(return_step-0.125) < 0.045, "return runs at 8 FPS, slower than outward turn")
 await create_timer(0.5).timeout
 check(sprite.frame == 0, "next cycle rests instead of immediately turning again")
 check(await wait_for_frame(sprite,1,3.0), "second idle begins after inter-cycle wait")
 check(absf((Time.get_ticks_msec()-first_cycle_end)/1000.0-3.0) < 0.18, "real inter-cycle hold lasts 3 seconds")
 check(await wait_for_frame(sprite,16,2.5), "second turn reaches hold for interruption test")
 Input.action_press("ui_right")
 for i in 4: await physics_frame
 check(sprite.animation == &"walk" and sprite.flip_h and player.velocity.x > 0, "moving right immediately interrupts turned hold")
 Input.action_release("ui_right")
 for i in 12: await physics_frame
 check(sprite.animation == &"idle" and sprite.frame == 0, "stopping resets idle to standing interval")
 Input.action_press("ui_left")
 for i in 4: await physics_frame
 check(sprite.animation == &"walk" and not sprite.flip_h and player.velocity.x < 0, "leftward movement uses original left-facing art")
 Input.action_release("ui_left")
 for i in 12: await physics_frame
 check(sprite.animation == &"idle" and sprite.frame == 0 and not sprite.flip_h, "idle retains last movement direction")
 Input.action_press("player_jump")
 for i in 3: await physics_frame
 Input.action_release("player_jump")
 check(sprite.animation == &"jump" and player.velocity.y < 0, "jump immediately interrupts standing interval")
 for i in 110: await physics_frame
 check(player.is_on_floor() and sprite.animation == &"idle" and sprite.frame == 0, "landing restarts the idle waiting period")
 paused = true
 var held_frame := sprite.frame
 var held_progress := sprite.frame_progress
 await create_timer(0.2,true,false,true).timeout
 check(sprite.frame == held_frame and is_equal_approx(sprite.frame_progress,held_progress), "scene pause freezes idle timing")
 paused = false
 var old_level = weakref(game._current_level)
 game._load_level()
 for i in 8: await physics_frame
 var fresh_sprite: AnimatedSprite2D = game._current_level._player.get_node("Sprite")
 check(old_level.get_ref() == null and fresh_sprite.flip_h and fresh_sprite.frame == 0, "restart frees old actor and restores default right-facing stand")
 var arguments := OS.get_cmdline_user_args()
 if not arguments.is_empty():
  var file := FileAccess.open(arguments[0],FileAccess.WRITE)
  file.store_string(JSON.stringify(events,"\t"))
 print("KEEPER_IDLE_RESULT checks=",count," failures=",failures)
 game.queue_free()
 await process_frame
 quit(failures)
