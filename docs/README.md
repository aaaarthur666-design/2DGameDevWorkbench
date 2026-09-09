# 文档中心

这里汇总 Forge 的当前文档。普通用户从[使用与操作手册](operations-manual.md)开始；外部 Agent 从根 [AGENTS.md](../AGENTS.md)开始。项目同时面向两类入口：外部 Agent 客户端负责理解意图并驱动能力，Web 工作台负责展示任务、编辑参数、处理人工操作和预览产物。

## 文档权威顺序

用户要求及宿主高优先级指令决定授权；根 AGENTS 与 Skills 定义项目操作边界。以下顺序只用于核实功能事实，不能用接口实现绕过人工地图规则：

1. `workbench/manifest.json`：能力 ID、输入、输出、连接器、路由和工作流引用的运行时清单。
2. `features/**`、`lib/workbench/**` 与 `scripts/**`：适配器、协议和运行时实现。
3. 根目录 `AGENTS.md` 与 `.agents/skills/` 下生产、工程两个 Skills：外部 Agent 的项目级操作规范。
4. 本目录中标为“当前维护”的说明文档。
5. 标为“历史快照”的方案、修复计划和验收记录。

交互物对象的嵌套字段有一个额外约束：`features/interactable-editor/contract.mjs` 是编辑源，修改后用 `npm run schema:interactable` 同步到清单，再运行校验。

## 当前维护

| 文档 | 适用内容 |
| --- | --- |
| [使用与操作手册](operations-manual.md) | 安装、各模块操作、MCP、工程接入、备份与排错；DOCX 正文来源 |
| [项目 README](../README.md) | 产品定位、快速开始、能力概览和入口导航 |
| [系统架构](architecture.md) | Agent、MCP/CLI、运行时、Web、适配器和数据流 |
| [开发与验证](development.md) | 环境、启动方式、测试矩阵、扩展和发布检查 |
| [Windows / macOS 兼容性](desktop-compatibility.md) | 双平台凭据、数据目录、输入、验证范围与实机检查 |
| [Agent 客户端接入](agent-clients.md) | Codex、WorkBuddy 类客户端的 MCP 配置和调用流程 |
| [连接器与任务契约](connector-contract.md) | 公共任务协议、状态机、HTTP 边界和安全规则 |
| [Web 工作台界面](workbench-interface.md) | 页面职责、路由、本地草稿、任务聚合和部署边界 |
| [交互物品原图](prop-art.md) | PixelLab 物品生图、预览采用、MCP 与来源交接 |
| [角色原图](reference-art.md) | PixelLab 原图生成、共享密钥与序列帧参考交接 |
| [序列帧生成](sprite-generator.md) | SpritePipeline 能力、操作、异步状态和产物 |
| [地图拼接](map-stitcher.md) | 本地拼接、外部生成、编辑流程和导出 |
| [地图拼接架构](MAP_STITCHER_ARCHITECTURE.md) | 地图模块的分层、数据流和格式兼容 |
| [资产目录](asset-catalog.md) | 持久资产范围、候选身份、真实素材 ZIP 与阶段二验收 |
| [MCP 链路验收](agent-phase1-acceptance.md) | 环境、生成、检查、审核与恢复的专项回归 |
| [Agent 展示验收](agent-presentation-acceptance.md) | 精确详情、宿主预览与提问行为验收 |
| [游戏工程 Skill](game-engineering.md) | CopyWorms 方法、角色帧资源、地图接入和工程脚本验收 |
| [场景组装](scene-composer.md) | 地图与交互物摆放、遮挡、手动替换、保存和完整场景导出 |
| [独立交互物编辑器](interactable-editor.md) | 交互模型、编辑器、Godot 导出和 Agent 调用 |
| [第三方声明](../THIRD_PARTY_NOTICES.md) | 上游组件、兼容性实现和参考项目边界 |
| [贡献指南](../CONTRIBUTING.md) | 变更流程、架构约束和提交前检查 |
| [安全策略](../SECURITY.md) | 密钥、回环服务、文件边界和漏洞报告方式 |

- [直接导出到游戏项目](godot-delivery.md)：选择目标、资源交付、WorkBuddy 代码接入、备份和验收。

## Demo 策划

以下文档定义拟制作作品的范围和协作约定，不代表相应游戏已经实现或验收：

- [《最后一盏灯》协作策划案](demos/the-last-light-plan.md)：独立横版探索修复 Demo 的玩法、资产、CopyWorms 方法适配、工作包与验收标准。

## 历史快照

以下文档用于解释设计演进，不再定义当前产品行为：

- [交互物编辑器实施计划](INTERACTABLE_EDITOR_PLAN.md)
- [地图拼接前端修复计划](MAP_STITCHER_FRONTEND_REPAIR_PLAN.md)
- [地图拼接修复验收记录](MAP_STITCHER_REPAIR_VERIFICATION.md)
- [地图布局验收记录](map-layout-verification.md)
- [地图生成验收记录](map-generation-verification.md)

## 组件内文档

`Tools/SpritePipeline/` 是同步自独立上游仓库的组件。其目录内 README、API 文档和许可声明描述组件自身，并应尽量随上游同步；工作台层面的接入方式以本目录文档和 `workbench/manifest.json` 为准。

## 更新规则

- 新增或修改能力：先更新清单与适配器，再更新架构、连接器契约、对应功能手册、Agent 指令和 Skill。
- 修改页面或路由：同步更新界面文档与根 README。
- 修改任务状态、输出格式或 API：同步更新连接器契约和 Agent 客户端文档。
- 修改交互物字段：从 `features/interactable-editor/contract.mjs` 生成清单字段，禁止手工维护两份 schema。
- 计划完成后：保留为历史快照，顶部写明状态、完成版本和当前文档入口。
- 文档中的命令必须在仓库根目录可执行；提交前按 [开发与验证](development.md) 的矩阵检查。

- [Agent 执行过程与页面跟随](agent-preview-follow.md)：MCP 0.9.0、当前页面摘要、步骤确认、暂停与验收。

- [内部素材导入与联用](internal-imports.md)：地图、交互物、原图、动画和完整场景的内部复用入口。
