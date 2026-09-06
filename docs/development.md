# 开发与验证指南

## 1. 环境要求

- Node.js 22.13.0 或更高版本；CI 使用 22.13.0。
- npm；Windows 与 macOS 使用相同的 Node.js 初始化和启动命令，不依赖 PowerShell。
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
npm run sprite-pipeline
```

`npm run sprite-pipeline` 启动 SpritePipeline 的 UI 和 API；`npm run sprite-pipeline:api` 仅用于不需要网页界面的接口调试。仅 API 模式的根地址返回 404，不能用于工作台内嵌界面。工作台会分别检查 API 和界面状态；完整启动命令不会把 API-only 服务误当作界面已就绪。首次使用其 Python 环境时先运行：

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
| 场景组装 | `npm run test:scene-composer`、`npm run test:workbench-shell`、`npm run test:http`、lint、typecheck、build；可选 Godot 导入检查见 [场景组装](scene-composer.md) |
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

## Windows / macOS 本机服务初始化

在仓库根目录依次运行：

```sh
npm ci
npm run sprite-pipeline:setup
npm run dev
```

初始化通过 Node.js 查找 Python 3.11+，在 Tools/SpritePipeline/.venv 创建本机虚拟环境并安装 requirements.lock，然后执行 pip check 和服务依赖导入检查。重复运行会复用环境并补齐依赖；不会修改系统 Python。Windows 依次查找 py -3、python、python3 和已有的 Codex Python，macOS 查找 python3、python。也可在初始化前通过 SPRITE_PIPELINE_PYTHON 指定解释器的完整路径（不要附加命令参数）。

虚拟环境不能跨操作系统复制。迁移仓库时重新运行初始化；检测到不完整或旧系统的 .venv 时会明确报错，需先将旧目录移走。安装中断后可重新执行相同命令。

npm run dev 启动本机 Runtime Bridge、SpritePipeline 与前端，已有健康服务会被复用，端口冲突会报错；远程服务配置继续按原规则处理。npm run sprite-pipeline 单独启动 UI，npm run sprite-pipeline:api 单独启动 API，两者使用相同的本机服务地址配置，默认监听 127.0.0.1:7860，不能同时占用该端口。npm run dev:interactable 可在无需 Python 的情况下启动地图、交互物和场景工具。

初始化需要访问 Python 包仓库。依赖安装失败时不会报告就绪，请按错误检查网络或包仓库配置后重试。旧 PowerShell 入口保留为 Node.js 启动器的兼容包装。

### 运行时测试数据隔离

会创建任务的测试必须先导入 [runtime-workspace.mjs](../tests/helpers/runtime-workspace.mjs)。
该入口设置每次运行独立的 `WORKBENCH_TEST_RUN`，MCP、HTTP 和 CLI 子进程继承同一标识。
运行时将测试记录写入 `work/test-runs/<run-id>/tasks/`，产物写入 `outputs/test-runs/<run-id>/`；正式任务列表只读取清单原有目录。
不要将此变量配置到日常工作台服务中。`npm run test:task-isolation` 验证正式目录不被新增任务、子进程继承、不同测试批次隔离及目录越界拒绝。

### 前端测试缓存隔离

使用 Vite 加载 TypeScript 的测试必须通过 `tests/helpers/vite-server.mjs` 创建服务器。每次测试使用 `work/test-runs/vite-<uuid>/cache`，不可与开发前端共用 `node_modules/.vite`。否则测试服务器会替换依赖索引，让仍在运行的网页请求旧模块时得到 `504 Outdated Optimize Dep`，表现为 `Failed to fetch dynamically imported module`。

排查时同时检查页面入口和其 JavaScript 依赖的 HTTP 状态；入口返回 200 不代表整个页面可以加载。修复缓存后重启前端，再刷新旧页面；不要清空浏览器草稿或素材目录。服务没有闲置自动关闭机制，但关闭启动终端或某个受管理进程意外退出会影响服务。
