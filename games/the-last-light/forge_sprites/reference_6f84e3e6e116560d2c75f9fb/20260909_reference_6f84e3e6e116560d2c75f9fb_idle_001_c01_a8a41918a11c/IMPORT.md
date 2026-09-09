# Godot 序列帧资源包

1. 将 ZIP 中的整个 `forge_sprites` 文件夹复制到 Godot 4.7.x 项目根目录，保持目录层级。
2. 已有 AnimatedSprite2D：把 `res://forge_sprites/reference_6f84e3e6e116560d2c75f9fb/20260909_reference_6f84e3e6e116560d2c75f9fb_idle_001_c01_a8a41918a11c/sprite_frames.tres` 拖到它的 Sprite Frames 属性，帧已经排列好，无需逐帧添加。
3. 新建角色画面：将 `res://forge_sprites/reference_6f84e3e6e116560d2c75f9fb/20260909_reference_6f84e3e6e116560d2c75f9fb_idle_001_c01_a8a41918a11c/animated_sprite.tscn` 拖入场景，运行后自动播放 `idle`。

本包包含当前候选的一个动作：17 帧，8.0 FPS，循环：True。非循环动画播放一次后保留末帧。脚本使用 `sprite.play("idle")`，需要明确重播时将 frame / frame_progress 归零；不要在每个物理帧重新归零。

已有角色若需要保留其他动作，请合并此动作到原 SpriteFrames 的副本，不要用单动作资源直接替换整套动画。Forge 工程 Skill 提供单动作合并方法。请核对包内动作名与现有控制器的映射。

纹理保持原始画布、透明像素和朝向（right），不逐帧裁切或自动居中。示例 Sprite 的脚底原点依据预设锚点 (62, 124) 设置；只替换 SpriteFrames 时不改变原节点的偏移或碰撞。使用 nearest 过滤以保持像素清晰。

包目录按作业、候选与内容区分，多个候选可共存。请保留资源路径；重命名或移动时使用 Godot 文件系统面板，让引擎更新引用。本包不含 project.godot，不修改项目配置，不附带战斗控制器或伤害触发逻辑。
