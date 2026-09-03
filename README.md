# 2D Game Dev Workbench

面向 2D 游戏开发流程的可复用 AI 生产工作台，也是 2026 腾讯云黑客松总决赛赛题一「生产工作台」方向的参赛项目。

项目把分散的 AI 能力、外部 API 和固定流程收进同一个工作台，让创作者既可以在网页界面中直接使用，也可以把本仓库作为 Agent 项目，通过自然语言驱动同一套工具链。

## 核心目标

- **一个工作台主界面**：以 Harness 风格的三栏工作区呈现会话、工具、任务进度和产物。
- **两种操作入口**：网页操作与 Agent 对话共享模块注册、任务协议和输出目录。
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
创作者
  ├─ Web 工作台 ───────────────┐
  └─ 项目内 Agent 对话 ────────┤
                               ▼
                    Workbench Capability Registry
                    模块清单 · 输入约束 · 任务协议
                               │
              ┌────────────────┼────────────────┐
              ▼                ▼                ▼
        本地工作流/脚本      外部 API 适配器      MCP/Connector
              └────────────────┼────────────────┘
                               ▼
                    统一任务状态与项目产物目录
```

### 台面层

用户能看到和操作的工作台：Agent 会话、工具切换、参数面板、运行队列、进度、日志摘要和产物预览。

### 能力资产层

工作台背后的可复用资产：

- 项目 Skill / 提示词
- 专家角色与上下文模板
- API Connector
- MCP 或本地工具
- 预置工作流

### Agent 驱动层

仓库已经提供：

- 根目录 `AGENTS.md`：告诉主 Agent 如何发现、调用和验证工作台能力。
- `.agents/skills/`：封装 2D 游戏生产工作流，使 Codex 从本项目启动时可自动发现。
- 统一工作台命令：列出能力、检查输入、发起任务、查询状态和定位产物。
- 机器可读模块清单：保证网页与 Agent 使用同一来源，避免行为漂移。

## 项目目录

```text
app/                         Web 工作台与连接器网关
components/workbench/        Harness 风格界面组件
lib/workbench/               前端模块映射
workbench/manifest.json       网页与 Agent 的统一能力清单
workbench/experts/            专家角色约定
workbench/workflows/          预置生产流程
scripts/workbench.mjs         Agent 可调用的工作台命令
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

从本仓库目录启动 Codex 后，根目录 `AGENTS.md` 与 `.agents/skills/2d-game-workbench` 会提供项目级工作流。也可以直接执行同一套命令：

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

## 连接现有工具

复制 `.env.example` 为本地环境文件，填写对应的 API 地址和可选令牌：

- `SPRITE_GENERATOR_API_URL`
- `SPRITE_GENERATOR_API_TOKEN`
- `MAP_STITCHER_API_URL`
- `MAP_STITCHER_API_TOKEN`

网页通过服务端网关调用这些地址，令牌不会进入浏览器。Agent runner 使用相同变量和请求结构。完整请求与响应约定见 [`docs/connector-contract.md`](docs/connector-contract.md)。

工作台页面还声明了两个页面级 Agent 工具：读取能力清单、启动可见任务。支持 WebMCP 的宿主可以直接调用它们，并与人工操作共享页面状态。

## 接入原则

1. 主工作台不包含具体工具算法，只依赖稳定的能力协议。
2. API 密钥只通过环境变量提供，不写入仓库、浏览器存储或任务记录。
3. 外部 API 不可用时，界面必须给出明确错误和恢复路径。
4. 新工具应通过注册表加入，不修改工作台核心导航逻辑。
5. Agent 与网页端产生的任务使用相同结构，并把结果保存在项目内可定位的位置。

## 当前状态

首个工作台骨架已经完成：主界面、项目级 Agent 入口、统一能力协议、任务 runner、服务端 API 网关和两项可替换适配接口均可使用。未配置外部 API 时，任务会明确停在 `awaiting_configuration`，不会伪造生成结果。
