# 游戏工程 Skill（阶段三）

当前入口是 [forge-game-engineering](../.agents/skills/forge-game-engineering/SKILL.md)。工作台 MCP 的 `workbench_list_capabilities` 在 `conversationGuidance.engineering` 返回同一入口。工程设计、文件整理与 GDScript 编写由 WorkBuddy/Codex 等外部 Agent 执行；前端没有新增聊天框，MCP 也没有新增地图自动制作操作。

## 这次提供什么

- 以 CopyWorms 的正式角色基类、状态/计时、Resource 配置、关卡 Builder、事件和生命周期契约为依据；代码来源与复用取舍见 Skill 的 references/copyworms.md。
- 把已选候选的真实 PNG 或显式 atlas 区域转成 `SpriteFrames.tres` 与可实例化的视觉场景，保留帧顺序、fps、loop、来源和哈希。单动作更新提供合并方法，保留原资源中的其他动作。提供只管表现的播放/重播、朝向与显式帧提示信号；伤害和角色状态仍由原控制器负责。
- 对当前 Frame Ronin Godot 地图包做独立命名空间接入，保留碰撞和世界坐标，排除示例 project.godot。旧 Pixelwork 地图和场景组装包有各自接入指引，不会被假装转换成同一种包。
- 提供只读原工程检查器、小型地图实例化/重挂载辅助脚本，以及自动化资产与 Godot 行为测试。

原 CopyWorms 工程仅作只读依据。这次没有替换其角色、关卡、脚本或配置，也没有生成新的美术。Skill 不会自动建立完整游戏；收到具体目标工程和可玩范围后，Agent 才按授权实施该工程。

## WorkBuddy 使用

重新连接/开启能读取本仓库的 WorkBuddy 会话，在发现结果中读取 `engineering.skill`。无需把它作为新 MCP server 安装。宿主必须能读取项目文件并执行本地脚本；MCP discovery 返回路径不等于宿主已经加载 Skill。可直接说：

> 用 Forge 游戏工程 Skill，按 CopyWorms 的方法，把我选择的角色动画接入目标 Godot 4.7 工程。先检查工程和资产，保留原来的攻击计时与命中规则。

或者：

> 把这个已经导出的地图接入指定工程，用关卡 Builder 实例化；保留坐标、遮挡和碰撞，检查离开再进入。

用户提供目标目录/导出包即可。Agent 根据现有工程确定路径和别名；不要求用户填写帧索引、候选 ID 或 GDScript 参数。只做设计时明确说“只设计，先不改文件”，讨论不会创建生产任务。

## 自动验收

```powershell
$env:GODOT_47_BIN = '你的 Godot 4.7.x 可执行文件绝对路径'
npm run test:engineering
```

无需模型或 API Key。测试会建立隔离目录 `work/engineering-test-*`，从真实地图导出函数构造测试地图，用明确顺序的彩色测试帧验证导入。引擎验证会实际运行播放、重播、信号、暂停、地图物理碰撞、销毁和重挂载契约。未设置 GODOT_47_BIN 时只跑导入测试并明确标出引擎跳过；4.6 等其他版本不会替代 4.7。

这些夹具证明接入代码，不等于验证整套 CopyWorms 战斗、Pixelwork 插件或实际关卡。相关修改需要在获授权的目标项目继续做真实场景回归。自动报告和日志保留在上述目录。

## 手动验收（与阶段一/二不同）

1. **角色运行时接入。** 在测试工程或目标工程的副本中选定一个动作候选，让 WorkBuddy 导入并说明对应动作。用 Godot 4.7 打开生成资源，核对实际帧、次序、fps 和 loop；运行后反复触发同一动作，确认不是始终卡在首帧，单次动作结束停在末帧。左右切换时只镜像画面，脚底和碰撞位置保持原约定。
2. **玩法与表现边界。** 要求只替换动画，检查原攻击前摇、攻击持续时间和伤害次数；它们不应因为新帧数或 fps 被擅自重写。若使用旧 Cyber 特殊动作，还要实际测试蓄力/突进的动画控制权和所引用帧是否存在。
3. **地图场景接入。** 使用已经手动导出的地图包，导入到空目录或工程副本。由 Builder 实例化，检查视觉、遮挡、碰撞；移动地图根节点后碰撞随图移动，离开再进入无残留。Pixelwork 流式地图需另测插件依赖、图块加载与重新挂载，不能拿静态测试地图代替。
4. **工程依据。** 让 WorkBuddy 解释这次复用了 CopyWorms 哪些脚本/方法、依赖和验证结果。应能指向真实文件；它不应凭空引入另一套全局管理器或通用状态框架。

验收对象是 Godot 中的资源和运行行为；资产库打开、JSON 清单或 zip 下载成功都不算这一阶段的运行时验收。

## 本次本地验证记录（2026-09-08）

15 项导入与拒绝用例通过；Godot 4.6.2 完成资源加载、真实播放/重播、显式提示事件、暂停、朝向、单动作合并、地图运行时清单加载、物理碰撞和重挂载契约检查。另从现有已审批作业 `20260905_player_cyber_attack_001` 的候选 1 读取 17 帧，在隔离项目按 18 FPS 完整播放两次，原帧与作业记录哈希保持不变。没有调用生图模型。

共享清单 doctor、适配器、HTTP、MCP、Agent acceptance、lint 和两项 Skill 校验通过。该记录不等同于 WorkBuddy 已自动加载 Skill，也不包含 CopyWorms 全游戏或 Pixelwork 插件回归。

## 从项目交付继续实施

[Godot 交付流程](godot-delivery.md)提供选定目标、包身份、资源安装与备份。Agent 不再让用户处理文件搬运、res 修复或节点挂载：检查真实项目后完成这些工作，保留 CopyWorms 的实际方法与目标已有实现。工程 helper 可继续用于手动暂存；stage_assets.py map 支持新的 forge_maps 包。必须分别报告文件接入、代码连接和引擎执行。

## 2026-09-09 Godot 4.7 当前基线

用户授权迁移至 4.7.x；此前 4.6.x 验收是历史记录。本次实际 4.7 验证与限制见 [迁移记录](../games/the-last-light/Docs/godot-47-migration.md)。测试使用 GODOT_47_BIN。
