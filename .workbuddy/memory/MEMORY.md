# 2D Game Dev Workbench — 项目记忆

## 项目定位
- 2026 腾讯云黑客松总决赛赛题一「生产工作台」参赛项目
- 面向 2D 游戏开发流程的可复用 Agent 生产工作台；主 Agent = 外部客户端（WorkBuddy/Codex），网页只是可视化控制台（监控/审查/精修），不内置通用对话
- 单一能力来源：`workbench/manifest.json`（schemaVersion 1），网页与 Agent 共用，禁止第二套硬编码目录

## 四项能力（2026-09-05 doctor 全部 ok）
| 能力 | id | 执行方 | 依赖 |
|---|---|---|---|
| 角色原图生成 | reference-art | 本地适配器 → PixelLab（经 SpritePipeline 服务保护 Key） | SpritePipeline API 127.0.0.1:7860 |
| 序列帧生成 | sprite-generator | 本地 SpritePipeline（Python，REST /v1/jobs） | 同上 + Python 3.11+ |
| 地图拼接 | map-stitcher | compose 确定性本地执行；generate-layer 可选外部 API | 扩图 provider Gemini（nano-banana）/GPT Image 2，当前均未配 Key |
| 交互物编辑 | interactable-editor | 纯本地 Godot 4.6 导出（inspect/toggle/pickup/sequence） | 无外部依赖 |

## 接入与运行
- Agent 入口三层：MCP STDIO（`scripts/workbench-mcp.mjs`，11 个工具）> 项目 Skill + AGENTS.md > CLI（`npm run workbench -- list|describe|prepare|run|status|doctor`）
- WorkBuddy 会话 MCP 原生挂载已验证可用（2026-09-05 实测 list_capabilities / get_environment / list_presets / list_tasks 全通）；CLI 仅作未挂载时的后备
- `npm run dev` 起 Vinext 页面 + Runtime Bridge(127.0.0.1:8790) + SpritePipeline；仅交互物编辑器用 `npm run dev:interactable`
- 任务记录 `work/tasks/`（不提交），产物 `outputs/<task-id>/`（不提交）；浏览器 IndexedDB 草稿与运行时任务是两个来源，不得混充

## 关键纪律（来自 AGENTS.md）
- prepare ≠ 完成；只有任务 status=completed 且文件存在才算成功
- 未经授权不调用收费外部 API（SpritePipeline 真实生成、generate-layer 扩图）
- Key 只进服务端 env / 运行时内存，不进仓库、浏览器存储、任务记录、日志
- 变更后验证矩阵：manifest/connector → doctor + test:adapters + test:http；MCP/CLI/runtime → + test:mcp；shell → test:workbench-shell + lint + typecheck + build
- 密钥现状：GEMINI_API_KEY、OPENAI_API_KEY 均未配置（generate-layer 会停在 awaiting_configuration）

## 规模快照（2026-09-05）
- work/tasks 164 条记录；outputs/ 712 文件（491 PNG / 152 JSON / 45 ZIP）
- 当天 07:30 有一批 agent-acceptance 测试任务（interactable completed；sprite-generator 停在 prepared 属诊断 fixture，正常）
