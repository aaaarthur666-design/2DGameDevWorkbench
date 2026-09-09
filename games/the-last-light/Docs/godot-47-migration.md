# Godot 4.7 迁移记录

日期：2026-09-09。用户授权将 Forge 与《最后一盏灯》的当前基线从 4.6.x 改为 4.7，并删除本机 4.6.2。

## 当前版本

- 引擎：4.7.stable.official.5b4e0cb0f（实际执行 --version 核验）。
- 游戏 project.godot、MCP manifest、导出器、Agent 规范与两份 Skill 已同步；测试环境变量为 GODOT_47_BIN。
- Windows .godot 双击入口及当前工程缓存路径已指向 WinGet 安装的 4.7。旧关联内部标识可能仍包含旧可执行文件名，实际 open command 已改到 4.7。
- 官方 4.7.stable 导出模板已安装，下载包通过官方 SHA-512 校验；校验记录在 work/godot-47-migration/templates.json。
- 已删除 WorkBuddy 和 D:/新建文件夹 中两份 4.6.2 引擎、Downloads 中对应安装 ZIP，以及 Roaming/Godot 下 4.6.2.stable 导出模板。保留游戏、资产、历史包和历史验收记录。

## 本次验证

- 《最后一盏灯》4.7 引擎导入成功；既有 headless_smoke.gd 59 项通过。
- 工程 Skill：15 项暂存测试通过，4.7 实际动画播放、重播、帧事件、暂停、地图碰撞和重新挂载检查通过。
- 通用交互物 72 项引擎检查、CopyWorms 兼容 46 项引擎检查通过；参考工程未修改。
- SpritePipeline Godot 包 8 项测试通过，包含实际 4.7 导入和播放。
- 游戏交付 15 项通过，覆盖 4.7 验收标志、4.6 历史证据不得标为当前基线通过。
- doctor、adapters、HTTP、MCP、Agent acceptance、资产、地图和场景导出回归通过；lint、typecheck、两份 Skill 校验及 git diff --check 通过。
- 原测试首次失败分别来自错误工作目录、系统临时目录权限、未传参考工程路径和错误 Python 解释器；修正测试调用环境后复跑通过，未降低断言。

这是自动导入与行为验证，不等于人工视觉或全游戏验收，也未执行发布版打包。未调用付费模型。4.6.x 旧记录保留原版本，不能当作 4.7 测试。当前既有动画包保留原始元数据和哈希，新导出使用 4.7 基线。

本地日志位于 work/godot-47-migration/。代码变更未提交或推送。旧 WorkBuddy MCP 会话应重连以刷新已缓存的发现元数据。
