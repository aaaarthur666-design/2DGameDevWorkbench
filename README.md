# 2D Game Dev Workbench

面向 2D 游戏开发流程的可复用 AI 生产工作台，也是 2026 腾讯云黑客松总决赛赛题一「生产工作台」方向的参赛项目。

项目把分散的 AI 能力、外部 API 和固定流程收进同一个工作台，让创作者既可以在网页控制台中直接操作，也可以让 WorkBuddy、Codex 等外部 Agent 客户端把本仓库作为项目，通过自然语言驱动同一套工具链。

## 核心目标

- **一个工作台主界面**：以 Harness 风格的三栏工作区呈现工具、任务进度、运行上下文和产物。
- **外部主 Agent**：主 Agent 运行在打开本项目的 WorkBuddy、Codex 等客户端中，不由网页伪装或替代。
- **两种操作入口**：网页人工直调与外部 Agent 对话共享模块注册、任务协议和输出目录。
- **可插拔能力层**：工具可以是本地流程、项目 Skill、命令行适配器或外接 API。
- **可复用于其他游戏**：项目约定、能力说明和接入接口都随仓库交付，不依赖原作者现场操作。
- **真实产物落盘**：每次任务都有可追踪状态，结果写入项目目录，便于游戏引擎继续消费。

## 首批工具

| 工具          | 用途                                         | 当前接入策略                           |
| ------------- | -------------------------------------------- | -------------------------------------- |
| 2D 序列帧生成 | 从角色与动作描述组织动画帧、预览并导出精灵表 | 接入已完成的外部功能，工作台提供适配层 |
| 地图拼接      | 编排地图切片、检查边界并导出完整关卡画布     | 接入已完成的外部功能，工作台提供适配层 |

本仓库不会复制两项工具的内部算法；工作台负责发现、调度、进度、错误和产物交接。

## 架构概览

```text
WorkBuddy / Codex / 其他 Agent 客户端（主 Agent）
  ├─ MCP STDIO（首选）──────────┐
  ├─ 项目 Skill + AGENTS.md ────┤
  └─ CLI（兼容后备）────────────┤
                                ▼
                     Workbench Capability Registry
                     模块清单 · 输入约束 · 任务协议
                                ▲
Web 可视化控制台 ── 服务端网关 ─┘
                                │
                 ┌──────────────┴──────────────┐
                 ▼                             ▼
           外部 API 适配器                本地工作流/脚本
                 └──────────────┬──────────────┘
                                ▼
                     统一任务状态与项目产物目录
```

### 台面层

用户能看到和操作的工作台：工具切换、人工直调、运行队列、进度、日志摘要和产物预览。网页中的命令区不是内置大模型；主 Agent 对话发生在外部 Agent 客户端中。

### 能力资产层

工作台背后的可复用资产：

- 项目 Skill / 提示词
- 专家角色与上下文模板
- API Connector
- MCP 或本地工具
- 预置工作流

### Agent 驱动层

仓库已经提供面向外部 Agent 客户端的三层入口：

- 标准 STDIO MCP Server：向支持 MCP 的客户端提供 5 个类型化工具与能力清单资源。
- 根目录 `AGENTS.md` 与 `.agents/skills/`：让 Codex 等客户端理解项目规则与生产流程。
- 统一 CLI 后备入口：供不支持 MCP 的客户端列出能力、检查输入、发起任务、查询状态和定位产物。
- 机器可读模块清单：保证网页与 Agent 使用同一来源，避免行为漂移。

## 项目目录

```text
app/                         Web 工作台与连接器网关
components/workbench/        Harness 风格界面组件
lib/workbench/               前端模块映射
lib/workbench/runtime.mjs    MCP 与 CLI 共享运行时
workbench/manifest.json       网页与 Agent 的统一能力清单
workbench/experts/            专家角色约定
workbench/workflows/          预置生产流程
scripts/workbench.mjs         Agent 可调用的工作台命令
scripts/workbench-mcp.mjs     外部 Agent 客户端 STDIO MCP Server
.mcp.json                     通用 MCP 客户端项目配置
.codex/config.toml            Codex 项目级 MCP 配置
.agents/skills/               项目级 Agent Skill
examples/requests/            可直接验证的请求样例
docs/connector-contract.md    外接 API 协议
work/                         本地任务记录（不提交）
outputs/                      本地产物目录（不提交）
```

## 本地运行

环境要求：Node.js 22.13 或更高版本。

```bash
npm install
npm run dev
```

生产构建与代码检查：

```bash
npm run build
npm run lint
```

## 通过 Agent 使用

主 Agent 是从本仓库目录启动的 WorkBuddy、Codex 或其他 Agent 客户端。支持项目配置的客户端可通过 `.mcp.json` 或 `.codex/config.toml` 自动启动工作台 MCP Server；Codex 同时会读取根目录 `AGENTS.md` 与 `.agents/skills/2d-game-workbench`。

MCP 提供以下工具：`workbench_list_capabilities`、`workbench_describe_capability`、`workbench_prepare_task`、`workbench_run_task`、`workbench_get_task`。不支持 MCP 时，也可以直接执行同一套 CLI：

```bash
# 发现能力并检查连接器
npm run workbench -- list --json
npm run workbench -- doctor --json

# 不调用外部 API，只验证并生成任务记录
npm run workbench -- prepare sprite-generator --input examples/requests/sprite-generator.json --json

# 已配置连接器后执行真实任务
npm run workbench -- run sprite-generator --input examples/requests/sprite-generator.json --json
```

任务记录保存在 `work/tasks/`。成功调用连接器后，原始结构化结果保存在 `outputs/<task-id>/result.json`。

完整的客户端接入方式和角色边界见 [`docs/agent-clients.md`](docs/agent-clients.md)。Codex 的项目指令、仓库 Skill 和 MCP 分层方式参见 [OpenAI 官方自定义文档](https://learn.chatgpt.com/zh-Hans/docs/customization/overview) 与 [MCP 文档](https://learn.chatgpt.com/zh-Hans/docs/extend/mcp)。

## 连接现有工具

复制 `.env.example` 为本地环境文件，填写对应的 API 地址和可选令牌：

- `SPRITE_GENERATOR_API_URL`
- `SPRITE_GENERATOR_API_TOKEN`
- `MAP_STITCHER_API_URL`
- `MAP_STITCHER_API_TOKEN`

网页通过服务端网关调用这些地址，令牌不会进入浏览器。Agent runner 使用相同变量和请求结构。完整请求与响应约定见 [`docs/connector-contract.md`](docs/connector-contract.md)。

工作台页面还声明了两个页面级 WebMCP 工具：读取能力清单、启动可见任务。它们是浏览器宿主的补充通道，不替代仓库级 STDIO MCP Server，也不把网页本身当成主 Agent。

## 接入原则

1. 主工作台不包含具体工具算法，只依赖稳定的能力协议。
2. API 密钥只通过环境变量提供，不写入仓库、浏览器存储或任务记录。
3. 外部 API 不可用时，界面必须给出明确错误和恢复路径。
4. 新工具应通过注册表加入，不修改工作台核心导航逻辑。
5. Agent 与网页端产生的任务使用相同结构，并把结果保存在项目内可定位的位置。

## 当前状态

首个工作台骨架已经完成：可视化控制台、外部 Agent 客户端 MCP/Skill/CLI 入口、统一能力协议、共享任务运行时、服务端 API 网关和两项可替换适配接口均可使用。未配置外部 API 时，任务会明确停在 `awaiting_configuration`，不会伪造生成结果。
