# 独立交互物编辑器实施方案

日期：2026-09-04。状态：已实现。实际用法、字段与开发检查见 [交互物编辑器说明](interactable-editor.md)。

新增工作台能力 `interactable-editor`，显示名称为“交互物编辑器”，Godot 运行时包名为 **Workbench Interaction Kit**，首个目标为 Godot 4.6.x。

采用“从 copyWorms 提取可复用代码，再整理为通用运行时”的路线。用户在独立编辑页面配置物件，点击一次导出，得到可以放进 Godot 项目的 ZIP。导出过程不启动 Godot，也不要求先运行模拟、验证任务或生成验证报告。

已增加独立的“导出 copyWorms 兼容版”按钮；通过 `targetProfile: "copyworms"` 输出独立目录的兼容包，适配人物、Enter、输入锁和可选原剧情事件。普通导出保持默认。配置、安装方式与兼容边界见 [交互物编辑器使用文档](interactable-editor.md#copyworms-兼容导出)。下文通用运行时的无单例依赖约定仅指普通版。

## 1. 本次调整的重点

| 原方案 | 修订方案 |
|---|---|
| 只继承 copyWorms 的设计经验，不复用代码 | 允许提取并改造其感知、最近对象选择、完成去重和拾取反馈代码；重写项目耦合部分 |
| 每次导出都经过临时 Godot 项目、加载、实例化和行为测试 | 本地生成 `.gd`、`.tres`、`.tscn`，复制素材并打包；引擎测试属于开发流程 |
| 缺少 Godot 时进入 `awaiting_configuration` | 导出不依赖 Godot；本地导出服务可用即可生成文件 |
| 类型、重复策略、序列策略和步骤存在交叉含义 | 四类预设各自限定有效选项；冷却独立设置，序列只在 Sequence 中定义 |
| 物件模板 ID 同时承担实例识别和存档用途 | 分开模板身份与场景实例身份，避免复制物件后串状态 |
| 统一使用一个碰撞体表达范围和碰撞 | 感知范围、可点击区域、实体阻挡分别表达 |
| 用户排列 `finish`、`emit_interacted` 等内部步骤 | 用户只编辑内容和反馈，运行时自动提交状态、发信号和完成收尾 |

保留原方案的四种交互、固定内部生命周期、对象自身状态、标准信号和独立导入包。会话记忆、持久化和取消策略作为高级选项，不出现在普通物件的必填流程中。

## 2. copyWorms 的复用边界

本次已读取指定仓库 [flxBurnOut/copyWorms](https://github.com/flxBurnOut/copyWorms)，核对时 `master` 指向 `bb1581d12c9626e294e403a01db5f3cffb229cd8`。以下链接固定到该提交。

| 已有实现 | 提取到新系统 | 需要改造的部分 |
|---|---|---|
| [InteractiveObject.gd](https://github.com/flxBurnOut/copyWorms/blob/bb1581d12c9626e294e403a01db5f3cffb229cd8/LevelModule/Formal/InteractiveObject.gd#L21) | 范围进入/离开、启用状态、提示和完成去重 | 移除 `GlobalDefine.Collision.PLAYER`、固定人物类型、固定黄点外观和人物私有方法依赖 |
| [Level_01.gd 的最近对象选择](https://github.com/flxBurnOut/copyWorms/blob/bb1581d12c9626e294e403a01db5f3cffb229cd8/LevelModule/Formal/Level_01.gd#L481) | 集中选择一个可交互对象，再分发输入 | 从关卡中提取为运行时协调逻辑；替换 `GameManager.player_ref`，移除关卡 FSM 和 EventBus 依赖 |
| [Level_01.gd 的输入处理](https://github.com/flxBurnOut/copyWorms/blob/bb1581d12c9626e294e403a01db5f3cffb229cd8/LevelModule/Formal/Level_01.gd#L453) | 文本推进优先、同一次输入只处理一次 | 使用独立 InputMap action，并让目标游戏的 UI 能优先消费输入 |
| [DropItem.gd](https://github.com/flxBurnOut/copyWorms/blob/bb1581d12c9626e294e403a01db5f3cffb229cd8/Tools/DropItem.gd#L67) | 一次拾取、反馈后隐藏或释放、可选漂浮外观 | 移除图鉴写入、`DropItemShowcase`、固定素材字典和固定缩放；改为配置与 `picked_up` 信号 |

现有 `InteractiveObject` 并不是一个已经独立完整的交互系统：输入和最近对象选择在关卡脚本中，拾取还会写入图鉴。新系统应把可复用逻辑提取到自己的源码中，在开发阶段完成改造；用户导出时不再下载、读取或依赖 copyWorms。

原来的距离补偿会读取人物的 `_get_collision_size()`，也没有完整覆盖任意碰撞形状和变换。新系统采用明确的物理感知契约，避免把这套项目补偿逻辑直接包装成通用检测。固定黄点和漂浮效果可以保留为可选外观预设。

## 3. 在工作台中的位置

三个入口并列，由 `workbench/manifest.json` 统一登记：

```text
2D Game Dev Workbench
├─ sprite-generator     序列帧生成
├─ map-stitcher         地图拼接 / 场景素材
└─ interactable-editor  交互物编辑器
```

新页面为 `/tools/interactable-editor`。它有自己的文档、草稿、素材、预览和导出操作，可以从空白物件开始使用。

序列帧和地图工具只提供可选素材来源：用户可以导入它们导出的图片、帧序列或裁切素材，也可以直接上传自己的素材。编辑交互物不要求先创建角色、生成地图或启动图片生成服务。首版在 Godot 中完成物件的关卡摆放，后续再考虑地图编辑器中的物件放置功能。

## 4. 用户实际编辑什么

编辑器以“新建物件 → 选择类型 → 配置外观和内容 → 可选预览 → 导出”为主流程。

| 类型 | 常见用途 | 默认行为 | 可配置项 |
|---|---|---|---|
| Inspect / 查看 | 告示牌、书页、说明牌 | 播放一段或多页文本，可重复查看 | 一次或重复、文本、动画、音效、冷却 |
| Toggle / 切换 | 开关、灯、可开合的物件 | 在自身 A/B 两个状态间切换 | 两套外观、对应反馈、自身阻挡碰撞、冷却 |
| Pickup / 拾取 | 收集物、道具外观 | 成功一次后发出拾取信号并隐藏或释放 | 说明、拾取动画、音效、收尾方式 |
| Sequence / 序列 | 分次阅读、分阶段变化的物件 | 每次成功交互推进一项 | 各项内容与外观、项间冷却、末项后停止/循环/停留末项 |

这些预设使用同一个运行时，不拆成四个能力或四套编辑器。

Toggle 只改变本物件的外观及其自身实体碰撞。Pickup 只表示物件侧拾取成功；游戏可以通过信号决定如何增加背包或推进任务。Sequence 不提供条件分支。

系统范围保持为物件本身：外观、范围、提示、文本、动画、音效、启停、重复、冷却、完成状态和信号。人物移动、NPC、战斗、背包、任务、剧情条件、传送、谜题及其他节点的控制由目标游戏处理。

### 编辑界面

采用物件列表、中央画布、右侧属性面板、顶部保存/导出操作的布局。属性分为四组：

1. **外观与范围**：图片或帧动画、偏移、缩放、翻转、绘制层级；感知形状、点击区域和可选实体阻挡。
2. **触发与提示**：触发方式、提示文字、按键、范围设置；来源 group、碰撞层和焦点优先级折叠在高级设置中。
3. **内容与反馈**：文本分页、A/B 状态或序列条目、动画和音效；预设相关选项按需显示。
4. **完成与记忆**：一次/重复、冷却、完成后的外观；跨场景记忆和存档为高级选项。

支持保存草稿、复制物件、导入之前的工作台源数据。复制为新物件时生成新的模板 ID。

画布可以显示范围、播放动画、模拟靠近/离开/按键/点击以及重置状态。双对象重叠作为可选测试场景。预览称为“编辑器预览”，用户无需运行预览即可导出。

### 素材输入

首版支持 PNG、WebP、JPEG、按顺序排列的图片帧、规则精灵表，以及音效。帧动画使用统一的帧顺序、帧率、循环和动画名称描述，导出时生成 Godot `SpriteFrames`。

序列帧工具产物通过这套描述转换后复用。任意外部 `.tres` 可能依赖脚本、其他资源和导入缓存，首版不承诺直接解析所有 Godot `SpriteFrames.tres`；这项作为后续专门的资源导入增强。

不选美术时允许使用内置占位外观或只制作触发区域。音效、焦点动画等未配置时直接跳过。已明确选择但丢失的素材应提示重新选择，不生成悬空引用。

## 5. 数据和状态

工作台用可序列化 JSON 保存编辑源数据；Godot 包用原生 `.tres` 保存配置、`.tscn` 保存可实例化场景。导出是单向生成，不承诺将用户在 Godot 中任意修改的场景反向还原到工作台。

建议数据结构：

```text
InteractableProject v1
├─ schemaVersion
├─ projectId / name
├─ assets[]
└─ objects[]
   ├─ definitionId / displayName
   ├─ visual                 图片、帧动画、变换、提示锚点
   ├─ detection              感知形状、actor group、mask、优先级
   ├─ pointer                点击区域
   ├─ solid                  可选实体阻挡和独立碰撞层
   ├─ activation             触发方式、InputMap action、离开策略
   ├─ content                提示和文本显示设置
   ├─ behavior               四类预设及各自参数
   ├─ feedback               文本/动画/音效/等待步骤
   ├─ cooldownSeconds
   ├─ completion             保留外观、隐藏、释放
   └─ memory                 默认 instance
```

界面、模拟器和导出器共用契约及默认值。四类预设限制有效组合，避免用户配置出“可重复拾取但首次交互后释放”等矛盾。

`definitionId` 识别物件模板，创建时自动生成并在重新导出时保持。`instanceId` 属于 Godot 关卡中放置的实例，用于区分同一种物件的多个副本，不能把同一个模板 ID 自动当成所有实例的存档 ID。

`.tres` 只保存配置。`completed`、Toggle 当前状态、Sequence 进度和冷却等运行状态保存在节点实例中，避免共享 Resource 导致多个副本一起变化。Godot 会复用已经加载的 Resource，这也是配置与实例状态需要分开的原因。[Godot 4.6 Resources 文档](https://docs.godotengine.org/en/4.6/tutorials/scripting/resources.html)

## 6. Godot 运行时

在需要交互功能的关卡根节点下放置一个运行时，再放置任意数量的物件场景：

```text
LevelRoot
├─ InteractionRuntime2D
│  ├─ DialoguePresenter
│  └─ InteractionStateStore（启用记忆时使用）
├─ Player / 已有交互来源
└─ WorkbenchInteractable2D (Area2D)
   ├─ VisualRoot
   │  └─ Sprite2D 或 AnimatedSprite2D
   ├─ DetectionShape (CollisionShape2D)
   ├─ PromptAnchor (Marker2D)
   ├─ PromptLabel
   ├─ AudioStreamPlayer2D（可选）
   └─ SolidBody (StaticBody2D，可选)
      └─ SolidShape (CollisionShape2D)
```

焦点仲裁、输入分发和忙碌锁先作为 `InteractionRuntime2D` 的内部职责，不必为每个职责增加一个节点。物件只向所属关卡运行时注册；运行时范围是其父节点对应的关卡子树，嵌套运行时接管自己的子树，避免 `MainEntry` 托管多个场景时串焦点。

导出的 `.tscn` 实际包含外观和碰撞节点，导入后在 Godot 编辑器中能够看到和调整。运行逻辑不能只在 `_ready()` 中临时生成全部外观，留下空白的可编辑场景。

**感知范围与实体阻挡分开。** `Area2D` 负责检测进入范围，实体阻挡由可选 `StaticBody2D` 负责。Toggle 修改自身阻挡时不应同时关闭感知，否则用户无法再次操作它。点击区域属于物件数据，由运行时进行统一命中选择。

### 来源契约

靠近交互默认识别属于 `interaction_actor` group 的 `PhysicsBody2D`，同时要求检测 mask 能覆盖来源的 collision layer。普通 `Node2D` 仅加入 group 并不会产生 `Area2D.body_entered`；它可以通过外部调用触发。以后如需使用 `Area2D` 作为来源，应显式实现 `area_entered` 路径。[Godot 4.6 Area2D 文档](https://docs.godotengine.org/en/4.6/classes/class_area2d.html)

首版按单个本地交互来源设计：运行时可显式指定来源，否则从配置 group 中绑定一个来源；多个来源时应由游戏显式指定。运行时只使用来源身份、位置和物理重叠，不读取人物属性或调用人物私有方法。

以物理重叠作为靠近判定的依据。对象生成、启用及来源更换后，在物理更新完成时同步重叠状态；日常通过进入/离开事件维护候选。不要同时用一套近似距离算法扩大命中范围，造成画出的范围与实际行为不一致。

无需人物的鼠标场景和外部系统仍可使用：

```gdscript
request_interaction(source: Node = null) -> bool
set_enabled(value: bool) -> void
reset_state() -> void
get_state() -> Dictionary
apply_state(snapshot: Dictionary) -> void
```

`request_interaction()` 返回是否受理，不表示已经完成。它仍受启用、完成、冷却和忙碌状态限制；外部显式请求可以省略靠近要求，不能绕过一次性保护。

## 7. 触发、焦点和交互执行

四种触发方式保留：

| 方式 | 规则 |
|---|---|
| `proximity_press` | 有效来源在范围内，按下配置的 action 后操作唯一焦点 |
| `pointer_click` | 按画布坐标命中点击区域；默认无需人物，重叠时选最上层可交互对象，再以优先级和稳定顺序消歧 |
| `automatic_enter` | 来源进入时提交一次请求；持续站在范围内不反复触发 |
| `external_request` | 等待游戏代码显式调用，不注册自动输入 |

默认交互 action 为 `workbench_interact`，初始键为 E。运行时仅在 action 不存在时用 `InputMap` 添加默认绑定；已有映射保持不变。提示从当前绑定生成，用户也可以填写自定义提示。[Godot 4.6 InputMap 文档](https://docs.godotengine.org/en/4.6/classes/class_inputmap.html)

键盘交互通过运行时的 `_unhandled_input()` 分发，让现有 UI 优先处理输入；忽略按键回声。内置文本面板处理翻页、关闭后消费当前事件，不能让同一按键既关闭文本又再次打开物件。鼠标只走一条统一分发路径，不能同时使用每个物件的点击回调再重复调用运行时。

靠近焦点按“优先级高 → 距离近 → 关卡内节点路径稳定排序”选择。同一运行时同一时刻只有一个提示焦点和一个正在执行的交互。内部 `get_instance_id()` 不作为跨运行稳定 ID。

自动进入遇到忙碌锁时只保留仍在范围内的待处理请求；空闲后按相同优先规则受理一个。来源离开则移除请求。每次进入最多执行一次，冷却结束本身不会制造新的进入事件。

### 内部状态

使用固定执行阶段，并把焦点视为显示状态：

```text
IDLE → INTERACTING → COOLDOWN → IDLE
                  └──────────→ COMPLETED

enabled = false 时不接收新交互
focused 由运行时统一决定，不改变完成进度
```

一次成功执行与物件最终完成必须分开：

- 重复 Inspect：每次执行成功后回到等待或冷却，不进入最终完成。
- Toggle：每次成功切换 A/B，继续可用。
- Pickup：只提交一次成功结果，随后进入最终完成。
- Sequence：成功后才推进索引；末项按“停止、循环、停留末项”处理，只有停止策略进入最终完成。

冷却从一次执行成功后开始；最终完成不再进入冷却。暂停跟随目标场景的处理模式，恢复后继续，默认不使用真实墙钟时间跳过冷却。

### 用户步骤与运行时收尾

首版可排列的反馈仅包括 `show_text`、`play_animation`、`play_audio`、`wait`。自身外观和实体碰撞的最终变化放在预设的结果配置中。用户不编辑任意方法、外部 NodePath、GDScript 或通用逻辑图。

运行时统一执行：

```text
受理并锁定 → 播放内容/反馈 → 提交对象状态 → 发出信号 → 完成收尾
```

无需用户插入 `finish` 或 `emit_interacted`。对象提交之前就已被忙碌锁保护，提交状态要早于信号发射，避免监听者再次调用时重复拾取。信号回调可能移除物件或切换场景，收尾必须检查对象有效性。

默认交互开始后执行到结束。高级“离开范围取消”仅作用于提交前：停止等待和临时反馈、关闭本次文本、恢复原视觉，不推进序列、不发成功信号。提交后不回滚。物件或运行时离树必须清理候选、播放回调和忙碌引用。

需要等待的动画必须有结束点；循环动画作为持续外观使用。拾取后释放时，要求播完的音效和动画在释放前完成，避免直接 `queue_free()` 截断反馈。

最终完成后的表现简化为“保留外观、隐藏、释放”三种，三者都停止再次交互。临时禁止交互使用 `set_enabled(false)`，这样“完成”与“暂时禁用”含义清楚。

## 8. 状态记忆和信号

普通物件默认使用 `instance`，不需要配置存档。

| 范围 | 生命周期 | 接入方式 |
|---|---|---|
| `instance` | 节点释放或场景重载后重置 | 无额外设置 |
| `session` | 同一局跨关卡保留 | 游戏根节点持有同一个 StateStore，并传给各关卡运行时；开始新局时清空 |
| `persistent` | 退出后仍保留 | 可选 ConfigFile 后端，使用独立存档槽和命名空间；也可由游戏调用快照接口接入已有存档 |

放在关卡内的 StateStore 只能与该关卡同寿命，不能宣称它能自动跨整树切场景保存 session。跨场景共享由明确的持有者负责，不强制添加 Autoload。

只记忆 `completed`、Toggle 状态、Sequence 索引和成功次数。焦点、来源引用、文本播放进度和冷却倒计时不进入首版持久化快照。

稳定状态键为 `<save-slot>/<namespace>/<scene-key>/<instance-id>`。静态摆放的实例可默认使用相对关卡路径，重命名后需保留显式 `instanceId` 才能继承旧记录；动态生成且要求跨场景记忆的物件由游戏提供稳定 ID。导出不要求用户先确定每个实例的关卡位置。

为 `free` 物件先保存完成记录，再释放；重新实例化时先恢复状态，再决定是否显示或启用。恢复快照不重播 `picked_up` 或其他一次性成功信号。

标准信号建议统一携带一个上下文字典，至少包括模板身份、实例身份、本次结果以及仍有效时的来源：

```gdscript
signal focus_entered(context: Dictionary)
signal focus_exited(context: Dictionary)
signal interaction_started(context: Dictionary)
signal interaction_finished(context: Dictionary)
signal interaction_cancelled(context: Dictionary)
signal interaction_completed(context: Dictionary)
signal picked_up(context: Dictionary)
signal toggled(context: Dictionary)
signal sequence_advanced(context: Dictionary)
```

`interaction_finished` 表示一次成功执行；`interaction_completed` 只在最终完成时发出。取消有自己的信号。对外传递快照，不暴露运行时内部可变字典；节点引用不写入存档。

运行时另提供 `busy_changed(bool)`，方便目标游戏决定是否冻结人物。交互工具本身不冻结人物、不全局暂停游戏，也不直接写入背包、任务或剧情数据。需要特殊行为的游戏只连接相关信号即可。

## 9. 直接导出

用户只点击“导出 Godot 包”。默认导出当前选中物件，也可在同一操作中选择多个物件。

```mermaid
flowchart LR
    A[点击导出] --> B[读取当前定义和已选素材]
    B --> C[生成场景、资源和运行时脚本]
    C --> D[复制素材并压缩 ZIP]
    D --> E[下载文件]
```

导出器使用受控的文本模板/序列化函数直接写入 `.tscn` 和 `.tres`。Godot 场景支持文本格式；生成这类文件不要求在用户导出时调用 `ResourceSaver` 或 `PackedScene.pack()`。[Godot 4.6 TSCN 格式](https://docs.godotengine.org/en/4.6/engine_details/file_formats/tscn.html)

导出只保留写出有效文件所需的基础处理：补默认值、确认已引用素材可读取、进行字符串转义和安全路径映射、确认 ZIP 已写出。错误直接说明具体字段或文件，例如“拾取音效文件不存在”。不设置单独的验证向导、素材签名扫描、测试通过证书或审批步骤。

普通导出不包含临时 Godot 项目、不启动引擎、不实例化交互物、不运行行为回归，也不因为未安装 Godot 而等待配置。源素材保持原样，文件写入独立任务输出目录。

### 默认包内容

```text
<name>-interactables.zip
└─ addons/workbench_interaction/
   ├─ runtime/v1/
   │  ├─ interaction_runtime_2d.gd
   │  ├─ interaction_runtime_2d.tscn
   │  ├─ workbench_interactable_2d.gd
   │  ├─ interactable_definition.gd
   │  ├─ interaction_state_store.gd
   │  ├─ dialogue_presenter.gd
   │  └─ dialogue_presenter.tscn
   ├─ objects/<definition-id>/
   │  ├─ object.tscn
   │  ├─ definition.tres
   │  └─ assets/
   ├─ sources/<export-id>/
   │  └─ interactable-project.json
   └─ packages/<export-id>/
      ├─ package-manifest.json
      └─ INSTALL.md
```

包内素材引用使用实际存在的 `res://addons/workbench_interaction/...` 路径，大小写一致；不带本机绝对路径、copyWorms 路径、旧资源 UID 或 `.godot` 导入缓存。源 JSON 的素材引用也改写到包内，之后导回工作台可恢复本次导出的配置与素材。

同一个包只包含一份运行时。多个物件包共用 `runtime/v1`，同一运行时版本内容保持一致；同一大版本更新保持已有定义可读取，不为每个物件注册重复的全局脚本类。模板 ID 决定物件目录：重新导出同一物件更新同一路径，复制成新物件使用新 ID。

包不包含 `project.godot`、`plugin.cfg`、人物节点或 EditorPlugin。安装说明只需要说明：解压到目标项目根目录，放置运行时及物件场景，靠近模式确认来源 group 与碰撞 mask。鼠标和外部调用模式无需人物配置。

独立示例项目可后续增加为另一个下载项，不能让它成为默认导出的额外要求。

## 10. 工作台实现接入

沿用当前 `manifest → shared runtime → local adapter` 路径。新增一个 capability、一个 adapter 和一个独立页面，不另建业务能力目录。

首版正式任务只需 `operation: "export-godot"`。定义检查是 adapter 的内部输入处理，模拟是编辑器功能；如果以后 Agent 确实需要无界面模拟，再增加 `simulate` 操作。不要为了导出要求用户先提交一个独立 `validate` 任务。

建议调用契约：

```json
{
  "capabilityId": "interactable-editor",
  "input": {
    "operation": "export-godot",
    "project": "<InteractableProject v1 对象>",
    "selectedDefinitionIds": ["<definition-id>"]
  }
}
```

以上为结构示意；正式 `project` 字段为 JSON 对象。素材通过文档中的资产 ID 关联到上传内容或工作区内文件，导出器将实际字节复制到输出包，不能只引用浏览器临时 blob URL。

网页沿用 `/api/workbench/tasks`，经本地 HTTP runtime 执行；CLI 和 MCP 调用同一个 adapter。浏览器不再维护第二套 Godot 构建器。素材上传应考虑现有 HTTP 请求体大小限制，大文件以本地资产文件及句柄传递，避免无限扩大任务 JSON。

Agent 可以使用已有 `workbench_prepare_task` 检查输入，也可以在用户已要求导出时直接调用 `workbench_run_task`。共享运行时内部的输入处理不变成用户可见的前置步骤。

导出成功返回 `completed`、任务 ID 和真实输出路径。该状态表示文件生成完成；界面显示“已导出”，不附加“Godot 已验证”标签。典型输出为：

```text
work/tasks/<task-id>.json
outputs/<task-id>/<name>-interactables.zip
outputs/<task-id>/interactable-project.json
outputs/<task-id>/result.json
```

`result.json` 使用现有运行时写出，内容记录包版本、定义版本、物件列表及输出文件名。无需新增验证报告。

### 建议新增文件

```text
features/interactable-editor/
├─ contract.mjs / contract.d.ts
├─ presets.mjs
├─ simulator.mjs
├─ godot-builder.mjs
└─ godot-templates/

lib/workbench/adapters/interactable-editor.mjs
components/interactable-editor/interactable-editor.tsx
app/(workbench)/tools/interactable-editor/page.tsx
workbench/workflows/interactable-production.json
tests/interactable-editor/
```

根据当前工作树，还需明确接入以下文件：

| 现有文件 | 修改目的 |
|---|---|
| `workbench/manifest.json` | 登记能力、路由、输入 schema、输出和本地 adapter |
| `lib/workbench/adapters/index.mjs` | 注册执行函数、基础输入检查和 configured 判断 |
| `lib/workbench/modules.ts` | 当前只支持 frames/map 图标和两种色彩，扩展交互物入口的显示映射 |
| `components/workbench/workbench-shell.tsx` | 补齐新图标等展示，能力列表仍从 manifest 派生 |
| `.agents/skills/2d-game-workbench/SKILL.md`、工作台专家说明和使用文档 | 增加交互物能力的发现、执行与产物说明 |
| `package.json`、相关测试入口 | 登记该功能开发测试 |

现有地图导出已经使用文本生成场景和 JSZip 打包，可参考其中的序列化与打包经验，但地图包当前包含 `project.godot`，交互物导出不能直接沿用整套地图包结构。交互物算法放在自己的 feature 和 adapter 中。

## 11. 实施顺序和开发验收

按可实际使用的纵向切片推进：

1. **先完成一个查看物件的全过程。** 定义最小契约，提取感知和焦点逻辑，实现最小编辑页、文本预览、adapter 和直接 ZIP 导出。能够在一个干净 Godot 4.6 项目中使用。
2. **补齐四类交互与常用编辑。** 加入 Toggle、Pickup、Sequence，鼠标/自动/外部触发，帧动画、音效、独立实体碰撞，以及多个同模板实例的独立状态。
3. **补齐保存与高级选项。** 草稿恢复、工作台源包导回、批量物件导出、离开取消、session 和可选持久化。核心四类交互可先形成可用里程碑。
4. **完成接入与文档。** MCP/CLI/网页使用同一输入和产物契约，补全安装说明与示例。能力可先登记为 beta，实际功能完成后再标为 ready。

开发阶段验证固定运行时和生成器：中文及特殊字符可正确保存；包内依赖齐全；两个重叠物件只响应一次；四类预设、取消和释放符合约定；同模板实例不串状态；选择记忆后能正确恢复。使用 Godot 4.6 的隔离夹具做运行测试，夹具位于开发测试目录，不跟随普通导出执行。

仓库要求的开发检查保持：manifest 或 connector 改动执行 `npm run workbench -- doctor --json`；共享运行时或 Agent 桥接改动执行 `npm run test:mcp`；应用代码改动执行 `npm run lint` 和 `npm run build`；仓库技能改动使用其技能校验器。这些是实现与发布质量要求，均不加入用户点击导出的流程。

首版不增加任意状态图、脚本编辑、条件分支、NPC/任务/背包编辑或外部节点编排。新增玩法通过物件信号接入，保持此能力可以独立于序列帧和地图工具使用。

## 12. 实施结果

本方案已落地为独立编辑页面、共享契约与本地导出器、Godot 4.6 运行时、草稿与源包恢复，以及网页 / CLI / MCP 接入。开发测试位于 `tests/interactable-editor/`，实际生成的隔离 Godot 项目与导出包位于不提交的 `outputs/`，不跟随正常导出执行。

文件组织相对于建议清单有两处收敛：预设工厂合并到 `contract.mjs`，类型声明采用 `.d.mts`；工作台导航已经从 manifest 派生，因此只扩展公共图标映射，无需再维护一份模块目录。
