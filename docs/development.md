# 开发与验证指南

## 1. 环境要求

- Node.js 22.13.0 或更高版本；CI 使用 22.13.0。
- npm；Windows 与 macOS 使用相同的 Node.js 初始化和启动命令，不依赖 PowerShell。
- 仅在开发或验证 SpritePipeline 时需要 Python 3.11+ 及其锁定依赖；CI 使用 Python 3.12。
- 外部地图图像生成是可选能力；本地拼接、交互物导出和工作台壳层不要求 API key。

首次安装：

```powershell
npm ci
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
| `OPENAI_API_KEY` | GPT Image 2 地图提供方凭据 |
| `TOKENHUB_API_KEY` | 混元 Image 3.0 地图生图；也可供序列帧默认混元视觉检查使用 |
| `PIXELLAB_API_KEY` | 覆盖序列帧/角色原图受保护的已存凭据 |

地图编辑器会把网页保存的密钥、所选服务和启用状态持久保存在被 Git 忽略的 `work/config/map-generation.json`。Windows 使用当前账户 DPAPI 加密；macOS 使用钥匙串保存加密密钥，以 AES-GCM 加密本地配置；其他系统使用权限受限的本地文件。重启后自动恢复，密钥留空保持原值，停用不删除密钥；已保存密钥优先于同名环境变量。任何密钥都不能写入客户端组件、浏览器存储、任务记录或日志。测试使用 `work/test-runs/<run-id>/config/` 隔离配置。

macOS 序列帧与原图凭据使用系统钥匙串，本地 `credentials.json` 只记录凭据引用。旧 macOS 普通本地凭据在读取时迁移；钥匙串拒绝访问时保存失败，不降级为明文。跨系统或账户复制项目不包含可用凭据，需要在目标机器重新配置。双平台检查范围和实机验收项见 [Windows / macOS 兼容性](desktop-compatibility.md)。

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
- 明确区分输入校验与执行授权：prepare 会写记录，讨论和等待授权不创建任务；外部执行必须有授权。

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
| 资产目录与素材 ZIP | `npm run test:assets`（含场景导出收录、历史归档保留资产、超过 200 条的分页及来源时间），以及 MCP / HTTP / Agent acceptance 对应检查 |
| Agent 结果展示与导航 | `npm run test:presentation`、`npm run test:preview-follow`，以及 MCP / HTTP / Agent acceptance；页面改动加壳层检查 |
| 前端服务启动与就绪 | `npm run test:frontend`、`npm run test:mcp`；桌面初始化加 `npm run test:desktop-services` |
| 工程 Skill helper | `npm run test:engineering`；引擎行为设置 `GODOT_47_BIN` |
| 仓库 Skill | 对每个变更 Skill 运行 validator，核对元数据、工具名、授权边界与相对链接 |
| 纯文档 | `git diff --check`、相对链接检查、示例命令与当前清单核对 |

当前 `package.json` 没有单独的 schema check 脚本。运行同步命令后应审查 `workbench/manifest.json` 的 diff；如果工作区原本干净，也可用 `git diff --exit-code -- workbench/manifest.json` 确认生成结果没有遗漏。存在有意的清单改动时不要把非零退出误判为失败。

CI 的实际步骤以 `.github/workflows/ci.yml` 为准：包含资产、展示、MCP、原图、任务隔离、适配器/HTTP、交互物、场景、地图、前端、Sprite 总控、工程、Agent acceptance 和代码检查，并有 Windows/macOS 初始化检查。`test:workbench-shell`、CopyWorms 实际工程和 Godot 引擎行为仍需按范围在本地补充；未配置引擎的 CI 不证明真实播放。

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
- 新增字段已进入清单、功能手册、Agent 指令和两个相关 Skills；同步维护 `docs/operations-manual.md`；
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


### 深浅主题

工作台顶栏和紧凑编辑器顶栏提供深浅切换。首次打开跟随系统，手动选择保存在 `workbench.theme`，随后刷新、跳转和同源标签页会继续使用该选择；浏览器拒绝存储时仍可切换当前页面。

配色的唯一来源是 [theme-palette.json](../lib/workbench/theme-palette.json)。修改后运行 `npm run theme:sync`，同步生成 Web 与 SpritePipeline 使用的 `theme-tokens.css`；`npm run theme:check` 检查两份生成文件是否与源一致。样式用语义变量定义浅色，并通过 `light-dark()` 保留编辑器原有深色配色；新控件优先使用 `--theme-*`。不要把素材 tint、画笔颜色或导出像素替换为主题变量。

序列帧首次加载通过 URL 接收主题，后续以校验 origin 和 source 的消息同步，不能通过改变 iframe 的 key 或 src 切换主题。像素修补页与动画播放器均接收实时主题同步，包括延迟挂载的播放器；修补页只重绘辅助覆盖层。Gradio 输入框必须显式设置浅色和深色的 `input_border_width`，仅设置边框颜色无法覆盖 Base 主题的零宽度默认值。修改 Python 服务样式或主题脚本后需重启对应本机服务。

主题验证：`npm run test:theme`、`npm run test:workbench-shell`、`npm run lint`、`npm run typecheck`、`npm run build`。人工检查全部入口的两种主题、弹窗/菜单、加载与错误状态，以及序列帧输入在切换后仍保留。

## Agent 展示回归

`npm run test:presentation` 验证精确作品身份、状态、缺失产物和动画预览语义，CI 同步执行。展示 / 结果接口调整同时运行 MCP、HTTP、原图和 Agent acceptance；前端改动运行 shell、lint、typecheck、build。阶段一的 WorkBuddy 宿主验收见 [展示验收](agent-presentation-acceptance.md)，协议测试不代表宿主的浏览器或提问工具已实际执行。

## 资产目录（MCP 0.8.0）

新增 list_assets / get_asset / get_asset_manifest，分别对应共享 agent 操作 assets / asset / asset-manifest。详见 [资产目录、范围与验收](asset-catalog.md)。查询不产生任务；运行 `npm run test:assets` 验证分页、候选、去重、文件校验和 MCP/HTTP 一致性。

## 游戏工程 Skill 验证

`npm run test:engineering` 检查 Skill 的发现入口、真实 Frame Ronin 导出包接入、显式帧顺序/哈希与拒绝用例。设置 `GODOT_47_BIN` 后还会在隔离项目执行 Godot 4.7.x 的资源加载、播放/重播/事件、朝向、地图碰撞与重挂载契约检查。未配置引擎时明确跳过引擎检查，不能报告为引擎通过。产物保留在 `work/engineering-test-*`；不会读写用户游戏或调用外部模型。新 Skill 与原生产 Skill 均用 bundled `quick_validate.py` 校验。

## 规范与操作手册维护

根 `AGENTS.md` 负责 Agent 的范围、证据与工作流规则；两个 Skills 分别负责生产和工程；`workbench/conversation-guide.md` 还会通过 MCP discovery 提供给无 Skill 宿主。不能只更新一份而留下冲突指引。文档事实以清单与实现核对，授权始终来自用户及有效指令；接口存在不解除地图手动边界。

完整操作正文维护在 `docs/operations-manual.md`。更新 DOCX 时使用可用的文档工具，从同一正文生成分级标题、目录和表格；逐页渲染检查中文、换行、目录与表格分页后再交付。正文或 DOCX 更新不代表运行过真实模型或目标游戏。

纯规范变更至少检查 `git diff --check`、相对链接、所有引用脚本存在、MCP 名单与 manifest 一致；两个 Skill 分别执行宿主提供的 `quick_validate.py <skill-directory>`。对 discovery 共用引导的修改再运行 `test:mcp` 和 `test:engineering`，确认入口与共享内容一致。不要为文档验收调用收费生成或改动正式资产。

## 物品原图回归

`npm run test:prop-art` 使用隔离任务目录和模拟 PixelLab 网关，通过真实 MCP 握手覆盖生成 / 恢复、kind=prop 清单与 PNG 下载、禁止角色 transfer、采用的完整性与目标保护，以及交互物源 / Godot ZIP 的来源保留。不会触发真实付费生成。相关回归包括 test:reference-art、test:interactable、test:http、test:mcp、test:assets、test:presentation、test:agent-acceptance 和工作台 / 前端构建检查。

内部导入改动运行 npm run test:asset-import，覆盖五类源文件、旧 prop 分类、候选帧顺序/FPS、碰撞与地图原点、版本校验及无新增任务；按受影响编辑器补充浏览器验收，测试保持独立运行目录与 Vite 缓存。

## 游戏项目导出验收

新增共享 game-export 服务、标准 Godot 包转换器及统一导出窗口。运行 npm run test:game-export，另按改动执行地图/交互物/场景、资产导入、MCP/HTTP、工程、壳层检查和构建。此测试仅写隔离游戏目录，不调用模型。项目选择使用页面内只读目录浏览，不启动系统弹窗；需验收取消、慢请求、关闭和手输路径不被锁定。清单配置、状态、写入边界和人工验收见 [Godot 交付](godot-delivery.md)。

完整地图工程通过人工编辑器保存到 `workspace.mapProjectDirectory`，源 ZIP 位于版本化 outputs 目录，IndexedDB 保留本地备份。持久化独立于生产任务，资产库 map 类型仅索引完整工程。协议、冲突恢复和源包格式见 [地图工具](map-stitcher.md)；`npm run test:map-stitcher` 包含完整源包往返、并发版本冲突及文件完整性检查。

地图缩略图验证：`npm run test:map-stitcher` 覆盖缓存失效、保存降级与版本附件；`npm run test:assets` 覆盖真实预览字节和过期版本拒绝。运行 `node tests/map-stitcher/preview-web.mjs` 后用浏览器打开命令返回的隔离地址，页面执行真实 Canvas 像素断言，并展示实际资产库组件的正常、超宽、旧工程、缺失预览状态。测试不读取生产地图，不调用图片服务；Ctrl+C 关闭测试服务。

完整地图保存链路的浏览器验收：运行 `node tests/map-stitcher/workspace-web.mjs`，打开返回地址。页面挂载实际地图编辑器控制器与保存 Hook，使用真实 IndexedDB、ZIP 持久化与资产目录；依次验证旧工程补预览、视图变化、图片编辑、源包恢复和单件收录。通过后点击“查看真实资产库记录”，再点击地图卡继续编辑，验证从资产库返回后图片编辑、视图和暂停队列完整恢复。所有记录进入唯一的 test-runs 目录，图片服务强制禁用，Ctrl+C 关闭测试服务。

资产回收站变更运行 `test:assets`、`test:http`、`test:mcp`、`test:adapters`、`test:agent-acceptance`、`test:presentation`、`test:workbench-shell`、doctor、lint、typecheck、build。`test:assets` 覆盖五类素材、别名、独立候选、整批失败、离线恢复、损坏索引和源文件不变。`node tests/map-stitcher/workspace-web.mjs` 的隔离页面使用 `?catalog=1` 可手动验证选择、取消、移入、回收站、恢复及刷新持久性，不触及正式资产。
