# 2D Game Dev Workbench

面向 2D 游戏开发流程的可复用 Agent 生产工作台，也是 2026 腾讯云黑客松总决赛赛题一「生产工作台」方向的参赛项目。

项目把地图编辑器、序列帧能力、独立交互物编辑、本地适配器、可选外部 API 和固定流程收进同一个工作台。创作者从开始页的「序列帧」「场景」进入制作，通过常驻状态栏恢复具体资产；WorkBuddy、Codex 等外部 Agent 客户端则把本仓库作为项目，通过 MCP 驱动同一套工具链。网页不内置主 Agent 或通用对话框。

## 核心目标

- **两条直观制作路线**：序列帧直达角色动作工具，场景连接地图拼接与交互物编辑；深色科技风外壳统一导航、流程位置和制作状态。
- **外部主 Agent**：主 Agent 运行在打开本项目的 WorkBuddy、Codex 等客户端中，不由网页伪装或替代。
- **明确的人机分工**：外部 Agent 负责编排和执行；网页工作区负责监控、审查与精细人工操作。
- **按资产继续制作**：状态栏合并本机草稿、序列帧作业和共享执行记录；首次进入提供可跳过、可重看的三步引导。
- **可插拔能力层**：工具可以是本地流程、项目 Skill、命令行适配器或外接 API。
- **可复用于其他游戏**：项目约定、能力说明和接入接口都随仓库交付，不依赖原作者现场操作。
- **明确的产物边界**：Agent 任务写入项目目录；浏览器草稿与下载单独标识，不伪装成已执行的后台任务。

## 首批工具

| 工具          | 用途                                               | 当前接入策略                                 |
| ------------- | -------------------------------------------------- | -------------------------------------------- |
| 2D 序列帧生成 | 从角色与动作描述组织动画帧、检查、修补并导出精灵表 | 已整合 NativeFramesGeneration 本地完整工作台 |
| 地图拼接      | 编排地图切片、检查边界并导出完整关卡画布           | 浏览器编辑器已完整并入主应用                 |
| 交互物编辑器  | 配置查看、切换、拾取、序列物件及外观、碰撞、文本、动画与音效 | 独立编辑页，网页 / CLI / MCP 共用本地 Godot 导出器 |

地图拼接的本地编辑、补全与导出逻辑位于本仓库；Agent 通过本地适配器执行确定性拼接，整体层扩图可选用 Nano Banana 2（`gemini-3.1-flash-image`）或 GPT Image 2（`gpt-image-2`）。

交互物编辑器从 copyWorms 的交互逻辑整理为通用 Workbench Interaction Kit，独立于序列帧和地图生成。点击导出直接获得 Godot 4.6 原生资源 ZIP；不要求安装或运行 Godot，也没有导出前验证流程。完整用法见 [交互物编辑器](docs/interactable-editor.md)。

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

完整的分层、状态机、服务拓扑和安全边界见 [系统架构](docs/architecture.md)。

### 台面层

开始页提供「序列帧」「场景」两个入口，工具内部的制作方式保留。全局状态栏以动作、地图、交互物为单位显示可继续的工作；执行输入、服务状态和产物路径放在 `/advanced`。地图和交互物草稿保存在当前浏览器的 IndexedDB，序列帧作业保存在本地服务中。网页仍由共享任务 API 读取 `work/tasks/`，外部主 Agent 的 MCP / CLI 工作流保持一致。详见 [工作台界面与制作流程](docs/workbench-interface.md)。

### 能力资产层

工作台背后的可复用资产：

- 项目 Skill / 提示词
- 专家角色与上下文模板
- 本地协议 Adapter 与可选 API Connector
- MCP 或本地工具
- 预置工作流

### Agent 驱动层

仓库已经提供面向外部 Agent 客户端的三层入口：

- 标准 STDIO MCP Server：向支持 MCP 的客户端提供 5 个类型化工具和只读 Manifest 资源。
- 根目录 `AGENTS.md` 与 `.agents/skills/`：让 Codex 等客户端理解项目规则与生产流程。
- 统一 CLI 后备入口：供不支持 MCP 的客户端列出能力、检查输入、发起任务、查询状态和定位产物。
- 机器可读模块清单：保证网页与 Agent 使用同一来源，避免行为漂移。

## 项目目录

```text
app/                         开始页、工具路由与连接器网关
components/workbench/        公共导航、生产入口、状态与任务可视化组件
components/map-stitcher/      地图拼接编辑器与隔离样式
components/sprite-generator/  序列帧管线连接与嵌入工作区
components/interactable-editor/ 独立交互物编辑与预览
features/map-stitcher/        地图类型、图片处理与导出逻辑
features/interactable-editor/  交互物契约、模拟器与 Godot 运行时模板
Tools/SpritePipeline/          本地生成、检查、修补与导出管线
lib/workbench/                Manifest 驱动的前端映射、共享运行时与适配器
workbench/manifest.json       网页与 Agent 的统一能力清单
workbench/experts/            专家角色约定
workbench/workflows/          预置生产流程
scripts/workbench.mjs         Agent 可调用的工作台命令
scripts/workbench-mcp.mjs     外部 Agent 客户端 STDIO MCP Server
.mcp.json                     通用 MCP 客户端项目配置
.codex/config.toml            Codex 项目级 MCP 配置
.agents/skills/               项目级 Agent Skill
examples/requests/            可直接验证的请求样例
docs/                         架构、接入、开发与各能力说明
work/                         本地任务记录（不提交）
outputs/                      本地产物目录（不提交）
```

## 本地运行

环境要求：Node.js 22.13 或更高版本；完整序列帧工作区需要 Python 3.11 或更高版本（CI 使用 3.12）。

```bash
npm install
npm run dev
```

`npm run dev` 会同时启动 Vinext 页面、仅监听 `127.0.0.1:8790` 的 Workbench Runtime Bridge 和本地 SpritePipeline；网页通过该桥读取与 MCP/CLI 相同的 `work/tasks` 和 `outputs`。已有健康的 SpritePipeline 会被复用。只调试页面时可分别运行 `npm run workbench:http` 与 `npm run dev:web`。

只使用交互物编辑器可运行 `npm run dev:interactable`，启动页面与本地导出服务，不启动 SpritePipeline。更新后，已运行的 Node Runtime Bridge 需要重启才能加载新适配器。

首次使用序列帧工作区时只需安装一次 Python 依赖：

```powershell
npm run sprite-pipeline:setup
```

页面入口：

- `/`：序列帧 / 场景开始页、初次引导与制作状态栏
- `/scene`：地图拼接与交互物编辑的场景制作入口
- `/advanced`：服务连接、后台执行记录、输入与产物详情
- `/tools/sprite-generator`：完整序列帧生成、检查、修补与导出工作区
- `/tools/map-stitcher`：完整地图拼接编辑器
- `/tools/interactable-editor`：独立交互物编辑器，含草稿、素材导入、交互预览与直接导出

生产构建与代码检查：

```bash
npm run build
npm run lint
npm run typecheck
```

拆分启动、环境变量和按变更范围选择测试的完整说明见 [开发与验证指南](docs/development.md)。

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

任务记录保存在 `work/tasks/`。本地适配器的标准化结果保存在 `outputs/<task-id>/result.json`，地图拼接及引擎包也写入同一个任务目录。全局制作记录和高级工具读取这些真实记录；本机编辑草稿以独立来源合并展示，不伪装成已经执行的后台任务。

完整的客户端接入方式和角色边界见 [Agent 客户端接入](docs/agent-clients.md)。

## 连接现有工具

复制 `.env.example` 为本地环境文件，填写对应的 API 地址和可选令牌：

- `SPRITE_PIPELINE_API_URL`（默认 `http://127.0.0.1:7860`）
- `SPRITE_PIPELINE_API_TOKEN`
- `MAP_STITCHER_IMAGE_PROVIDER`（可选：`nano-banana` 或 `gpt-image-2`）
- `GEMINI_API_KEY`
- `OPENAI_API_KEY`

`sprite-pipeline` 适配器把 Manifest 的 camelCase 输入转换成 Python `/v1/jobs` 协议；`map-stitcher` 适配器在本地执行 `compose`，仅在 `generate-layer` 时调用所选官方图片 API。也可以在地图设置窗口输入密钥：它只保存在当前 Runtime Bridge 进程内存中，服务端不会把密钥回传给页面，也不会写入任务记录或日志。完整请求与响应约定见 [`docs/connector-contract.md`](docs/connector-contract.md)。

地图编辑器提供读取、视图调整、图片导入、图层生成、区域批量创建、导出和生成队列七类页面工具。它们复用可见编辑器的动作、锁定和版本检查，是浏览器宿主的补充通道，不替代仓库级 STDIO MCP Server。地图使用单选图片视图和独立区域标注，支持撤销重做、全部 PNG 与包含完整编辑源的 Godot 包；详见 [地图编辑器](docs/map-stitcher.md)。全局制作记录同步汇总外部 Agent 与工具工作区产生的任务和产物。

## 接入原则

1. 工具算法与公共工作台外壳分离，能力入口统一来自 Manifest。
2. API 密钥只通过本地运行时内存或环境变量提供，不写入仓库、浏览器存储或任务记录。
3. 外部 API 不可用时，界面必须给出明确错误和恢复路径。
4. 新工具应通过注册表加入，不修改工作台核心导航逻辑。
5. Agent 与网页端提交到 Runtime 的任务使用相同结构，并把结果保存在项目内可定位的位置。

## 当前状态

统一开始页、新手引导、资产制作状态栏、公共导航、本地适配器、FrameRonin 模式地图编辑器和 SpritePipeline 工作台已经整合。地图 `compose` 无需外部服务；`generate-layer` 直接适配 Google Generate Content 与 OpenAI Images Edits 协议，缺少所选模型密钥时会明确停在 `awaiting_configuration`。序列帧适配器默认连接本机工作台的真实 REST API，不再发送通用连接器 envelope。序列帧本地启动与部署边界见 [`docs/sprite-generator.md`](docs/sprite-generator.md)，第三方来源与许可见 [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md)。

完整文档索引、权威顺序和历史资料入口见 [文档中心](docs/README.md)。贡献前请阅读 [贡献指南](CONTRIBUTING.md)；安全边界和私下报告方式见 [安全策略](SECURITY.md)。

## License

本项目以 [MIT License](LICENSE) 发布。内置 SpritePipeline 的许可副本位于 [`Tools/SpritePipeline/LICENSE`](Tools/SpritePipeline/LICENSE)。
