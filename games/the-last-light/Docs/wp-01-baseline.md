# WP-01 基线与建项记录

> 当前引擎基线：Godot 4.7.stable.official.5b4e0cb0f（2026-09-09 用户授权迁移）。下文原 4.6.2 冻结与测试记录仅作历史；本次验证见 [迁移记录](godot-47-migration.md)。

```text
工作包：WP-01 / 基线与建项
直接负责人：James（兼 WP-05 角色美术、玩法脚本）
输入基线：策划案 v1.0（docs/demos/the-last-light-plan.md）；Forge 基线 029d5ed（实施起点，正式开工时重记）；CopyWorms bb1581d
本次范围：目标工程目录、project.godot、GameRoot 容器骨架、§8.2 目录结构、source-to-target 复核
依赖：Godot 4.6.x 安装（G0 硬前置）；生成授权（WP-05 前置，不阻塞本包验收）
交付：games/the-last-light/ 全部内容
验证：V1 静态核对（本记录）；V2 引擎导入待 Godot 安装后执行
已知问题：无
下一责任人：James —— 安装 Godot 后打开工程确认可运行（G0 阶段门）
```

## 位置决策（2026-09-09，James 指示）

- 置于工作台文件夹内部、与工作台互不干扰 → 新建顶层目录 `games/the-last-light/`。
- 未触碰 Forge 任何现有文件与配置；避开策划案 §8.2 禁区：`features/`、`Tools/SpritePipeline/`、`outputs/`、`work/`。
- 互不干扰核验（2026-09-09 实读配置）：`tsc` 仅扫 `**/*.ts(x)/.mts`（本工程无 TS 文件）；`oxlint` 仅 JS/TS；`vinext build` 仅 `app/`；全部测试脚本路径固定；dev 启动不扫描根目录；Godot 编辑器缓存 `.godot/` 仅生成于本目录内（已被本目录 `.gitignore` 忽略）。
- VCS 状态：当前为 Forge 工作树内未跟踪目录。团队源码 / 大资产存储方案待集成负责人决定（策划案 §15.1）；如需对 Forge 仓库隐藏，后续在 Forge `.gitignore` 加一行 `/games/` 即可——本包未改动该文件。

## 工程配置（project.godot）

| 项 | 值 | 依据 |
| --- | --- | --- |
| 逻辑画面 | 640×360；窗口覆盖 1280×720 | 策划案 §1.3 |
| 拉伸 | `canvas_items` / `keep`（等比留边，不拉伸不裁剪） | 策划案 §6.4 |
| 渲染 | `gl_compatibility`；纹理过滤 Nearest（0） | 像素画保真 + 目标机器兼容性 |
| 主场景 | `res://GameRoot.tscn`（GameRoot → LevelSlot 容器） | 策划案 §8.2 / §8.3 |
| 输入 | `ui_left`=←/A、`ui_right`=→/D、`player_jump`=Space、`workbench_interact`=E、`ui_accept`=Enter/KP Enter（**剔除默认 Space**） | 策划案 §4.1；剔除 Space 避免「既是跳跃又是对话推进」双重语义 |
| autoload | 无（不用全局单例） | 策划案 §8.3 / §8.8：锁、状态、事件均关卡局部 |

## 目录结构（对齐策划案 §8.2）

已建：`PlayerModule/Formal/`、`LevelModule/`、`UIModule/`、`DataConfig/`、`RuntimeSupport/`、`Assets/Characters/maintainer/`、`Docs/`。

随导出包到达再建（不手工预建）：`forge_sprites/`、`scenes/<scene-id>/`、`addons/workbench_interaction/runtime/v1/` —— 这些是 WP-07 / WP-08 导出产物，以真实包内容为准。

## 引擎版本（2026-09-09 冻结，当日经 James 迁移更新）

- **Godot 4.7.stable.official.5b4e0cb0f**（WinGet 安装；迁移与模板校验记录见 `Docs/godot-47-migration.md`，4.6.x 已删除，旧 4.6 证据不得标为当前基线通过）。
- 导出模板：官方 4.7.stable 已安装（SHA-512 校验见 work/godot-47-migration/templates.json）。
- headless 用法（WinGet 路径）：`Godot_v4.7-stable_win64_console.exe --headless --path . --editor --import --quit`（V2 导入）；`--script res://tests/<name>.gd`（V3 行为）。

## 下一步

1. ~~James 安装 Godot 4.6.x~~（已完成，见上）。
2. 打开工程运行，确认占位画面出现（G0 → WP-02 灰盒关卡）。
3. WP-02 起在 `LevelModule/` 内建灰盒 LevelRoot + 五个实例锚点（策划案 §5.2）。

## 2026-09-09 引擎迁移（当前基线）

用户明确将当前基线改为 Godot 4.7，取代上文 4.6.2 冻结决定。实际版本：4.7.stable.official.5b4e0cb0f。启动和测试使用已验证的 4.7 可执行文件；历史 4.6.2 验收保持原样。迁移验证见 godot-47-migration.md。

## 当前显示与边界（2026-09-09）

游戏默认最大化；恢复窗口保持 1280×720。逻辑画面 640×360，镜头缩放 0.5；新增四周 8px 空气墙。设计调整、实测记录与操作见 [窗口和地图边界](view-boundary-adjustment.md)。
