# 文档中心

这里汇总 2D Game Dev Workbench 的当前文档。项目同时面向两类入口：外部 Agent 客户端负责理解意图并驱动能力，Web 工作台负责展示任务、编辑参数、处理人工操作和预览产物。

## 文档权威顺序

出现不一致时，按以下顺序判断当前行为：

1. `workbench/manifest.json`：能力 ID、输入、输出、连接器、路由和工作流引用的运行时清单。
2. `features/**`、`lib/workbench/**` 与 `scripts/**`：适配器、协议和运行时实现。
3. 根目录 `AGENTS.md` 与 `.agents/skills/2d-game-workbench/SKILL.md`：外部 Agent 的项目级操作规范。
4. 本目录中标为“当前维护”的说明文档。
5. 标为“历史快照”的方案、修复计划和验收记录。

交互物对象的嵌套字段有一个额外约束：`features/interactable-editor/contract.mjs` 是编辑源，修改后用 `npm run schema:interactable` 同步到清单，再运行校验。

## 当前维护

| 文档 | 适用内容 |
| --- | --- |
| [项目 README](../README.md) | 产品定位、快速开始、能力概览和入口导航 |
| [系统架构](architecture.md) | Agent、MCP/CLI、运行时、Web、适配器和数据流 |
| [开发与验证](development.md) | 环境、启动方式、测试矩阵、扩展和发布检查 |
| [Agent 客户端接入](agent-clients.md) | Codex、WorkBuddy 类客户端的 MCP 配置和调用流程 |
| [连接器与任务契约](connector-contract.md) | 公共任务协议、状态机、HTTP 边界和安全规则 |
| [Web 工作台界面](workbench-interface.md) | 页面职责、路由、本地草稿、任务聚合和部署边界 |
| [角色原图](reference-art.md) | PixelLab 原图生成、共享密钥与序列帧参考交接 |
| [序列帧生成](sprite-generator.md) | SpritePipeline 能力、操作、异步状态和产物 |
| [地图拼接](map-stitcher.md) | 本地拼接、外部生成、编辑流程和导出 |
| [地图拼接架构](MAP_STITCHER_ARCHITECTURE.md) | 地图模块的分层、数据流和格式兼容 |
| [场景组装](scene-composer.md) | 地图与交互物摆放、遮挡、手动替换、保存和完整场景导出 |
| [独立交互物编辑器](interactable-editor.md) | 交互模型、编辑器、Godot 导出和 Agent 调用 |
| [第三方声明](../THIRD_PARTY_NOTICES.md) | 上游组件、兼容性实现和参考项目边界 |
| [贡献指南](../CONTRIBUTING.md) | 变更流程、架构约束和提交前检查 |
| [安全策略](../SECURITY.md) | 密钥、回环服务、文件边界和漏洞报告方式 |

## 历史快照

以下文档用于解释设计演进，不再定义当前产品行为：

- [交互物编辑器实施计划](INTERACTABLE_EDITOR_PLAN.md)
- [地图拼接前端修复计划](MAP_STITCHER_FRONTEND_REPAIR_PLAN.md)
- [地图拼接修复验收记录](MAP_STITCHER_REPAIR_VERIFICATION.md)

## 组件内文档

`Tools/SpritePipeline/` 是同步自独立上游仓库的组件。其目录内 README、API 文档和许可声明描述组件自身，并应尽量随上游同步；工作台层面的接入方式以本目录文档和 `workbench/manifest.json` 为准。

## 更新规则

- 新增或修改能力：先更新清单与适配器，再更新架构、连接器契约、对应功能手册、Agent 指令和 Skill。
- 修改页面或路由：同步更新界面文档与根 README。
- 修改任务状态、输出格式或 API：同步更新连接器契约和 Agent 客户端文档。
- 修改交互物字段：从 `features/interactable-editor/contract.mjs` 生成清单字段，禁止手工维护两份 schema。
- 计划完成后：保留为历史快照，顶部写明状态、完成版本和当前文档入口。
- 文档中的命令必须在仓库根目录可执行；提交前按 [开发与验证](development.md) 的矩阵检查。

- [MCP 第一阶段功能与手动验收](agent-phase1-acceptance.md)
