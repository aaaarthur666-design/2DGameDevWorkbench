# source-to-target.md — 《最后一盏灯》CopyWorms 复用映射

> 依据策划案 v1.0 §8.1 建立：记录「直接复用 / 适配重写 / 仅参考方法 / 未采用」四类处置。
> 源基线：CopyWorms（织梦者 / HackathonGame）本地检出 `D:\黑客松正式项目文档`，commit `bb1581d12c9626e294e403a01db5f3cffb229cd8`（master，2026-09-08 核查基线，2026-09-09 复核一致）。
> 复核方式：只读逐行核读，未复制任何源码进本工程。后续搬运代码前须按 Forge 工程 Skill 约定重查实际提交、依赖与许可。

## 1. 直接复用（不改写）

| 源 | 用于 | 备注 |
| --- | --- | --- |
| Forge `features/interactable-editor/godot-templates/`（generic 导出运行时） | 五个交互实例（inspect×2 / pickup×2 / toggle×1） | 信号契约已逐行核对，见第 5 节 |
| Forge 工程 Skill `assets/sprite_frames_merge.gd` 的 `merge_clips(existing, incoming)` | 三动作合并为角色总 SpriteFrames（策划案 §8.6.3） | 纯函数，不改输入；结果存新资源路径，不覆盖来源 |
| Forge 工程 Skill `assets/character_visual.gd` | 可选的视觉节点行为适配 | 不实例化第二个视觉场景 |
| Forge 工程 Skill `scripts/stage_assets.py` | 帧资源暂存 + handoff 元数据 | 产物复制进 `Assets/Characters/maintainer/` |

## 2. 适配重写（保留方法，替换实现）

| 源（CopyWorms bb1581d） | 本工程目标 | 保留 | 不保留 |
| --- | --- | --- | --- |
| `PlayerModule/Formal/Player_Warrior.gd` 动画与朝向 | `PlayerModule/Formal/player_maintainer.gd` | `_update_animation` 只在目标 clip 变化时 `play()` + `frame=0`（防逐帧重置）；状态→clip 映射表；朝向只动 `Sprite.flip_h`（`scale.x` 恒 1，不镜像物理/碰撞） | attack / skill / hurt / death 全部逻辑；FALL 帧 4 锁定（依赖其 jump 实际帧长，TLL 须在 WP-05 候选帧长确认后自研决定）；attack_in_air / defeated 分支 |
| `Global/InputManager.gd` owner/token 输入锁 | `RuntimeSupport/input_lock_adapter.gd` | token 配对释放、owner 嵌套计数、owner 离树兜底释放 | GameManager / SceneTransitionManager autoload 依赖；全屏与鼠标捕获；action block；暂停守卫对全局的耦合。本工程三个持有者：交互（`busy_changed`）/ 暂停 / 演出 |
| `Global/MainEntry.gd` 容器式关卡承载 | `game_root.gd`（GameRoot → LevelSlot） | add_child 承载、queue_free 旧关、失效标志（`_switching_level` → 本工程 `run_id` 递增过期） | SceneTransitionManager whole-tree 转场、转场遮罩演出、LEVEL_COMPLETE 订阅（单关不需要） |
| `LevelModule/Formal/Level_02_SceneBuilder.gd` 组装模式 | `LevelModule/last_light_builder.gd` | RefCounted builder、`build_all()` 单入口、`_get_or_create_child` 幂等挂点、容器分组 | 代码直建碰撞体（TLL 碰撞来自场景导出包）；具体关卡字段与叙事节点 |
| `LevelModule/Formal/Level_02_UIBuilder.gd` | `UIModule/last_light_ui_builder.gd` | 同 builder 模式，构建结果引用写回宿主 | 叙事面板等业务内容 |
| `DataConfig/Player/PlayerConfig.gd` + `WarriorConfig.tres` 的 Resource 配置方式 | `DataConfig/player_config.gd/.tres`、`DataConfig/demo_config.gd/.tres` | `extends Resource` + `@export_group` + `.tres` 序列化；默认值必须被实际消费者读取，杜绝第二套硬编码 | 战斗 / 冲刺 / 受击数值组。**命名预警**：若用 `class_name PlayerConfig` 会与 CopyWorms 撞名——本工程类名加 `Tll` 前缀（如 `TllPlayerConfig`），避免搬运任何 CopyWorms 脚本时全局类冲突 |

## 3. 仅参考方法（不搬代码）

| 源 | 参考点 |
| --- | --- |
| `PlayerModule/Formal/PlayerBase.gd`（692 行） | `_physics_process` 执行序（timers → 输入 → 重力 → 状态 → move_and_slide → 朝向）；`_air_time` + `air_state_threshold` 落地防抖；`set_frozen` 冻结时显式 `_update_animation()` 刷新到 idle 的修复；输入统一经「是否被锁」网关过滤（本工程由 InputLockAdapter 提供） |

不继承原因：战斗 / 伤害 / 冲刺 / 受击占主体，且硬依赖 GameManager / EventBus / SFXManager / DamageCalculator / GlobalDefine 全套全局单例；策划案明确无战斗（§2.3），新写无战斗控制器更干净。

## 4. 未采用

| 源 | 原因 |
| --- | --- |
| `Global/EventBus.gd` | 策划案 §8.1：单关优先关卡局部信号 + §8.4 新增语义接口；不引入全局事件总线。若未来确需跨模块事件，须整文件重审 payload 契约与 owner 生命周期后另行决定 |
| `Global/SceneTransitionManager.gd` / `GameManager.gd` / `MusicManager.gd` / `SFXManager.gd` | autoload 全局管理器组；TLL 单关无转场、无战斗全局状态，音效走关卡局部节点（§7.4） |
| `Player_Warrior_Cyber.gd` 特化门控（冲刺 / 蓄力早退） | 策划案 §8.1 明示不继承 |
| `EnemyModule/`、`DataConfig/Skill/`、梯子 / 二段跳 / 移动平台 | 范围外（策划案 §2.3） |
| `LevelModule/Scenes/PixelworkMapStitch/` 旧流式地图包 | 策划案 §8.1：使用当前完整场景导出包，不按旧 Pixelwork streaming 处理，不移植旧插件与运行时门控 |
| CopyWorms Level_03–05 剧情 / 梦境转场 / Boss / 特效 | 无剧情依赖（Skill 默认不含） |

## 5. 交互运行时信号实证（2026-09-09 逐行核对 `interaction_runtime_2d.gd` / `workbench_interactable_2d.gd`）

对应策划案 §8.4，编写 `interaction_bridge.gd` 前必读：

1. **提交顺序**：`_commit()` 依次发 `picked_up` / `toggled` / `sequence_advanced` → `interaction_finished` → `interaction_completed` → 进入冷却 → 最后 `release_interaction`（`busy_changed(false)` 垫底）。收到业务成功信号时交互锁仍持有——终端 `request_start` 必须延迟处理并校验 run_id、节点有效性、阶段。
2. pickup 一次交互同时发 `picked_up`、`interaction_finished`、`interaction_completed`——Bridge 只消费 `picked_up`（T08 双计分陷阱实证）。
3. `toggled` 的 `context.result.toggleState` 是取反后的**新值**——直接读取，不自行反转。
4. `context` = `{definitionId, instanceId, source, kind, result{completed, toggleState, sequenceIndex, successCount}}`；`source` 为运行中节点引用，不写入资产清单或 JSON 交接记录。
5. E 键 echo 已过滤（`event.is_echo()` 直接 return）；对话期间 E / `ui_accept` 由 runtime `_unhandled_input` 消费（`set_input_as_handled`），同帧不会二次触发物件。
6. `busy_changed` 只是信号，不锁移动 / 跳跃——锁移动由 `input_lock_adapter.gd` 订阅它实现（策划案 §6.2）。
7. `memory.scope == "instance"` 时不读写 state store，记忆纯靠节点变量，卸载即清（策划案 §4.6）。
8. `effective_instance_id()` 缺省退化为节点路径——scene-composer 导出必须确认显式 instanceId 写入，否则 §6.1 的 ID 映射表失去稳定锚。
9. `resolve_actor` 按 group 找 PhysicsBody2D，多候选按节点路径字典序取第一——`interaction_actor` group 内只能有玩家（策划案 §5.4）。
10. `register_interactable` 在 action 缺失时才注册 `workbench_interact` + E——本工程 `project.godot` 已显式定义同名 action（同键），运行时不会重复注册；不得再配第二套交互键。
11. 冷却由 `cooldownSeconds` 驱动（COOLDOWN 相位结束后回 IDLE）；pickup 默认 `completed = true`，`completion: hide` 时隐藏并禁用 solid（策划案 §4.5 / §6.2）。

## 6. 待办（随工程推进回填）

- [ ] Godot 4.6.x 补丁版本与导出模板版本冻结（当前机器未安装，2026-09-08 验收记录）
- [ ] 角色三动作实际帧长 / FPS / loop / 脚底锚点（WP-05 候选审批后回填；决定 jump 是否做帧锁定）
- [ ] 真实 scene-id / instanceId / 节点路径映射（WP-08 场景导出后回填）
- [ ] 若引入任何 CopyWorms 源文件：重记实际提交、依赖与许可
