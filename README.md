# 2D Game Dev Workbench

面向 2D 游戏开发流程的可复用 AI 生产工作台，也是 2026 腾讯云黑客松总决赛赛题一「生产工作台」方向的参赛项目。

项目把地图编辑器、序列帧能力、本地适配器、可选外部 API 和固定流程收进同一个工作台。创作者可以从统一控制台进入具体工具，也可以让 WorkBuddy、Codex 等外部 Agent 客户端把本仓库作为项目，通过 MCP 驱动同一套工具链。控制台会同步显示真实任务状态与产物。

## 核心目标

- **一个统一控制台**：提供序列帧与地图拼接入口，并监控共享任务与产物。
- **外部主 Agent**：主 Agent 运行在打开本项目的 WorkBuddy、Codex 等客户端中，不由网页伪装或替代。
- **两种操作入口**：网页工具与外部 Agent 共享模块注册、任务协议和输出目录。
- **结构化人工直调**：首页可以提交符合 Manifest schema 的 JSON，并写入与 MCP 相同的任务记录。
- **可插拔能力层**：工具可以是本地流程、项目 Skill、命令行适配器或外接 API。
- **可复用于其他游戏**：项目约定、能力说明和接入接口都随仓库交付，不依赖原作者现场操作。
- **明确的产物边界**：Agent 任务写入项目目录；浏览器编辑器导出到用户下载目录，不伪造落盘状态。

## 首批工具

| 工具          | 用途                                               | 当前接入策略                                 |
| ------------- | -------------------------------------------------- | -------------------------------------------- |
| 2D 序列帧生成 | 从角色与动作描述组织动画帧、检查、修补并导出精灵表 | 已整合 NativeFramesGeneration 本地完整工作台 |
| 地图拼接      | 编排地图切片、检查边界并导出完整关卡画布           | 浏览器编辑器已完整并入主应用                 |

地图拼接的本地编辑、补全与导出逻辑位于本仓库；Agent 通过本地适配器执行确定性拼接，外部图片生成只作为 `generate-layer` 的可选步骤。

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
Web 可视化控制台 ── 共享任务 API ─┘
                                │
                 ┌──────────────┴──────────────┐
                 ▼                             ▼
          本地协议适配器                 可选外部图片 API
                 └──────────────┬──────────────┘
                                ▼
                     统一任务状态与项目产物目录
```

### 台面层

用户首先进入统一控制台，可以打开序列帧工作区和地图拼接编辑器，也可以提交结构化能力输入。网页不是内置大模型；主 Agent 对话仍发生在外部 Agent 客户端中。控制台轮询 `work/tasks/`，因此所有入口共享任务状态。

### 能力资产层

工作台背后的可复用资产：

- 项目 Skill / 提示词
- 专家角色与上下文模板
- 本地协议 Adapter 与可选 API Connector
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
app/                         开始页、工具路由与连接器网关
components/workbench/        公共导航、首页与 AI 预览组件
components/map-stitcher/      地图拼接编辑器与隔离样式
components/sprite-generator/  序列帧管线连接与嵌入工作区
features/map-stitcher/        地图类型、图片处理与导出逻辑
Tools/SpritePipeline/          本地生成、检查、修补与导出管线
lib/workbench/                Manifest 驱动的前端模块映射
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

环境要求：Node.js 22.13 或更高版本；完整序列帧工作区还需要 Python 3.11 或更高版本。

```bash
npm install
npm run dev
```

`npm run dev` 会同时启动 Vinext 页面和仅监听 `127.0.0.1:8790` 的 Workbench Runtime Bridge；网页通过该桥读取与 MCP/CLI 相同的 `work/tasks` 和 `outputs`。只调试页面时可分别运行 `npm run workbench:http` 与 `npm run dev:web`。

首次使用序列帧工作区时，安装并在另一个终端启动本地管线：

```powershell
npm run sprite-pipeline:setup
npm run sprite-pipeline
```

页面入口：

- `/`：统一任务控制与监控台
- `/tools/sprite-generator`：完整序列帧生成、检查、修补与导出工作区
- `/tools/map-stitcher`：完整地图拼接编辑器

生产构建与代码检查：

```bash
npm run build
npm run lint
```

## 通过 Agent 使用

主 Agent 是从本仓库目录启动的 WorkBuddy、Codex 或其他 Agent 客户端。支持项目配置的客户端可通过 `.mcp.json` 或 `.codex/config.toml` 自动启动工作台 MCP Server；Codex 同时会读取根目录 `AGENTS.md` 与 `.agents/skills/2d-game-workbench`。

MCP 提供以下工具：`workbench_list_capabilities`、`workbench_describe_capability`、`workbench_prepare_task`、`workbench_run_task`、`workbench_get_task`。不支持 MCP 时，也可以直接执行同一套 CLI：

```bash
# 发现能力并检查适配器
npm run workbench -- list --json
npm run workbench -- doctor --json

# 不调用适配器或外部 API，只验证并生成任务记录
npm run workbench -- prepare sprite-generator --input examples/requests/sprite-generator.json --json

# 授权后执行真实任务；SpritePipeline 生成可能调用收费服务
npm run workbench -- run sprite-generator --input examples/requests/sprite-generator.json --json
```

任务记录保存在 `work/tasks/`。本地适配器的标准化结果保存在 `outputs/<task-id>/result.json`，地图拼接及引擎包也写入同一个任务目录。首页控制台读取这些真实记录，因此 MCP、CLI 与网页看到的是同一任务队列。

完整的客户端接入方式和角色边界见 [`docs/agent-clients.md`](docs/agent-clients.md)。Codex 的项目指令、仓库 Skill 和 MCP 分层方式参见 [OpenAI 官方自定义文档](https://learn.chatgpt.com/zh-Hans/docs/customization/overview) 与 [MCP 文档](https://learn.chatgpt.com/zh-Hans/docs/extend/mcp)。

## 连接现有工具

复制 `.env.example` 为本地环境文件，填写对应的 API 地址和可选令牌：

- `SPRITE_PIPELINE_API_URL`（默认 `http://127.0.0.1:7860`）
- `SPRITE_PIPELINE_API_TOKEN`
- `MAP_STITCHER_API_URL`
- `MAP_STITCHER_API_TOKEN`

`sprite-pipeline` 适配器把 Manifest 的 camelCase 输入转换成 Python `/v1/jobs` 协议；`map-stitcher` 适配器在本地执行 `compose`，仅在 `generate-layer` 时读取外部扩图地址。令牌不会进入浏览器或任务记录。完整请求与响应约定见 [`docs/connector-contract.md`](docs/connector-contract.md)。

地图编辑器提供读取、视图调整、图片导入、图层生成、区域批量创建和导出六类页面工具。它们直接复用可见编辑器状态，是浏览器宿主的补充通道，不替代仓库级 STDIO MCP Server。首页可提交符合 Manifest schema 的 JSON，并同步显示所有入口产生的任务和产物。

## 接入原则

1. 工具算法与公共工作台外壳分离，能力入口统一来自 Manifest。
2. API 密钥只通过环境变量提供，不写入仓库、浏览器存储或任务记录。
3. 外部 API 不可用时，界面必须给出明确错误和恢复路径。
4. 新工具应通过注册表加入，不修改工作台核心导航逻辑。
5. Agent 与网页端产生的任务使用相同结构，并把结果保存在项目内可定位的位置。

## 当前状态

统一监控台、公共导航、两项本地适配器、FrameRonin 模式地图编辑器和 SpritePipeline 工作台已经整合。地图 `compose` 无需外部服务；`generate-layer` 未配置时会明确停在 `awaiting_configuration`。序列帧适配器默认连接本机工作台的真实 REST API，不再发送通用连接器 envelope。序列帧本地启动与部署边界见 [`docs/sprite-generator.md`](docs/sprite-generator.md)，第三方来源与许可见 [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md)。

## License

本项目以 [MIT License](LICENSE) 发布。内置 SpritePipeline 的许可副本位于 [`Tools/SpritePipeline/LICENSE`](Tools/SpritePipeline/LICENSE)。
