# 开发与验证指南

## 1. 环境要求

- Node.js 22.13.0 或更高版本；CI 使用 22.13.0。
- npm，以及能够执行 PowerShell 的 Windows 环境（用于本地 SpritePipeline 辅助脚本）。
- 仅在开发或验证 SpritePipeline 时需要 Python 3.11+ 及其锁定依赖；CI 使用 Python 3.12。
- 外部地图图像生成是可选能力；本地拼接、交互物导出和工作台壳层不要求 API key。

首次安装：

```powershell
npm install
Copy-Item .env.example .env
```

不要把真实 token 提交到仓库。`scripts/dev.mjs` 会读取仓库根目录的 `.env`；直接运行独立命令时，也可以通过当前进程环境传入同名变量。

## 2. 启动方式

### 完整本地工作台

```powershell
npm run dev
```

该命令统一管理 Web、工作台 HTTP bridge，并在默认回环配置下启动或复用 SpritePipeline：

| 服务 | 默认地址 | 说明 |
| --- | --- | --- |
| Web 工作台 | `http://localhost:3000` | 主界面和专业编辑器 |
| Runtime bridge | `http://127.0.0.1:8790` | Web 到共享运行时的本地 HTTP 桥 |
| SpritePipeline | `http://127.0.0.1:7860` | 序列帧服务和原生操作界面 |

### 只开发交互物或工作台壳层

```powershell
npm run dev:interactable
```

此入口不启动 SpritePipeline，Web 和 runtime bridge 仍可使用。

### 拆分启动

```powershell
npm run dev:web
npm run workbench:http
npm run sprite-pipeline:api
```

`npm run sprite-pipeline` 启动 SpritePipeline 自身 UI。首次使用其 Python 环境时先运行：

```powershell
npm run sprite-pipeline:setup
```

## 3. 环境变量

以 `.env.example` 为唯一示例，常用变量如下：

| 变量 | 用途 |
| --- | --- |
| `WORKBENCH_RUNTIME_URL` | Web 服务端代理访问 runtime bridge 的地址 |
| `WORKBENCH_RUNTIME_PORT` | 本地 bridge 监听端口 |
| `SPRITE_PIPELINE_API_URL` | SpritePipeline API；默认 `127.0.0.1:7860` |
| `SPRITE_PIPELINE_API_TOKEN` | 可选的受保护 SpritePipeline token |
| `NEXT_PUBLIC_SPRITE_PIPELINE_UI_URL` | 浏览器打开原生 SpritePipeline UI 的地址；不得包含 token |
| `MAP_STITCHER_IMAGE_PROVIDER` | 可选的地图图像生成提供方 ID |
| `GEMINI_API_KEY` | Nano Banana 2 提供方凭据 |
| `OPENAI_API_KEY` | GPT Image 2 提供方凭据 |

地图编辑器也允许把 key 只保存在当前本地 runtime 进程中；进程退出后该临时设置消失。任何密钥都不能写入客户端组件、任务记录或日志。

## 4. 命令行与诊断

```powershell
npm run workbench -- list --json
npm run workbench -- describe sprite-generator --json
npm run workbench -- prepare <capability-id> --input <json-file>
npm run workbench -- run <capability-id> --input <json-file>
npm run workbench -- status <task-id> --json
npm run workbench -- doctor --json
```

以 `npm run workbench -- --help` 和各子命令帮助为参数细节来源。`doctor` 检查清单、适配器和连接器配置；外部图像提供方未配置时可以显示为未就绪，但不能把 `awaiting_configuration` 当作成功产物。

## 5. 新增或修改能力

1. 在独立模块或工具中实现算法，不把业务算法塞进 Web 壳层。
2. 在 `lib/workbench/adapters/` 新增或修改适配器，并在适配器注册表中登记。
3. 更新 `workbench/manifest.json` 的能力、schema、输出、路由和连接器。
4. 若修改交互物字段，只编辑 `features/interactable-editor/contract.mjs`，随后运行 `npm run schema:interactable`。
5. 为适配器、HTTP、MCP 和具体功能补充与风险相称的测试。
6. 同步更新 `AGENTS.md`、仓库 Skill、架构文档、连接器契约和对应功能手册。
7. 运行本页测试矩阵，并检查任务只在 `work/`、产物只在 `outputs/` 中生成。

新增外部连接器时还必须：

- 仅在服务端读取 token；
- 明确区分“未配置”“处理中”“完成”和“失败”；
- 对超时、错误体和返回文件进行归一化与验证；
- 避免重试造成重复计费；异步查询必须复用原始上游任务 ID；
- 在执行可能产生费用或数据出站的调用前，为 Agent 保留 `prepare` 路径。

## 6. 验证矩阵

按变更范围选择检查；跨层变更应运行所涉及各行的并集。

| 变更范围 | 必须运行 |
| --- | --- |
| 清单或连接器契约 | `npm run workbench -- doctor --json`、`npm run test:adapters`、`npm run test:http` |
| MCP、CLI 或共享运行时 | 上述检查，加 `npm run test:mcp` |
| 工作台壳层、路由、任务聚合 | `npm run test:workbench-shell`、`npm run lint`、`npm run typecheck`、`npm run build` |
| 原图生成与移送 | `npm run test:reference-art`、SpritePipeline Python 测试，以及清单 / Runtime / 壳层对应检查 |
| 地图拼接 | `npm run test:map-stitcher`，再按 UI 影响运行前端检查 |
| 交互物编辑器或 schema | schema 改动先运行 `npm run schema:interactable` 并检查 manifest diff；再运行 `npm run test:interactable`、`npm run test:interactable-http`；兼容配置另跑 `npm run test:interactable-copyworms` |
| SpritePipeline 总控 | `npm run test:dev-supervisor` |
| SpritePipeline 上游组件 | 在 `Tools/SpritePipeline` 安装 `requirements.lock` 后运行 `python -m pytest -q` 和 `python -m pip check` |
| 仓库 Skill | 运行 Skill validator，并人工核对工具名、授权边界与文档链接 |
| 纯文档 | `git diff --check`、相对链接检查、示例命令与当前清单核对 |

当前 `package.json` 没有单独的 schema check 脚本。运行同步命令后应审查 `workbench/manifest.json` 的 diff；如果工作区原本干净，也可用 `git diff --exit-code -- workbench/manifest.json` 确认生成结果没有遗漏。存在有意的清单改动时不要把非零退出误判为失败。

CI 会运行 doctor、MCP、适配器、HTTP、交互物、地图、Sprite 总控、lint、typecheck、build 和 SpritePipeline Python 测试。`test:workbench-shell`、`test:interactable-copyworms` 目前属于提交前的本地补充检查。

## 7. 数据与调试

- `work/tasks/`：运行时任务记录，适合排查输入、状态和适配器结果。
- `outputs/<task-id>/`：任务专属产物目录。
- 浏览器 IndexedDB `workbench-production-v1`：Web 草稿与本地条目，不是服务端任务的替代品。
- `work/` 和 `outputs/` 均不提交；复现问题时优先提供脱敏后的输入、任务 ID、状态和错误，不上传 token。

调试异步任务时先运行 `status` 或 MCP 的 `workbench_get_task`。不要再次调用 `run` 来“查询”，否则外部工具可能创建第二个任务。

## 8. 文档与发布检查

提交前确认：

- 根 README 的能力、端口和入口与当前实现一致；
- [文档中心](README.md) 中所有当前文档和历史快照分类正确；
- 新增字段已进入清单、功能手册和 Agent 指令；
- `THIRD_PARTY_NOTICES.md` 反映新增依赖、复制代码或兼容性来源；
- 没有提交 `.env`、`work/`、`outputs/`、测试生成包或上游缓存；
- 提交信息能区分实现、文档和上游同步。

Agent 接口或序列帧自动化变更后，运行 `npm run test:agent-acceptance`，使用隔离真实服务与 fixture 完成 MCP 全流程。详见 [验收说明](agent-phase1-acceptance.md)。

WorkBuddy 前端启动或就绪探测修改后，运行 `npm run test:frontend` 与 `npm run test:mcp`；内部浏览器的人工验收见 [Agent 客户端接入](agent-clients.md#workbuddy-首次对话自动打开)。
