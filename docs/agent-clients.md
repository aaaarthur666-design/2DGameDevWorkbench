# Agent 客户端接入

## 1. 角色边界

打开本仓库的 Codex、WorkBuddy 或其他 MCP 客户端是主 Agent。它负责理解用户意图、选择能力、组织输入、发起经过授权的任务，并用真实任务记录报告结果。

Web 工作台负责展示任务和进度、恢复草稿、预览产物，以及地图画布、交互区域等更适合人工操作的编辑工作。它没有通用 Agent 对话框，也不替代外部客户端的规划能力。

所有入口最终以 `workbench/manifest.json` 和 `lib/workbench/runtime.mjs` 为共同契约。

## 2. 接入方式

| 入口 | 用途 | 仓库配置 |
| --- | --- | --- |
| STDIO MCP | Agent 客户端首选；类型化发现、执行与状态查询 | `.mcp.json`、`.codex/config.toml` |
| 项目指令 | 角色、安全边界和验证规则 | `AGENTS.md` |
| Repository Skill | 四项生产能力的选择与操作流程 | `.agents/skills/2d-game-workbench/SKILL.md` |
| CLI | 不支持 MCP 的客户端或本地诊断 | `npm run workbench -- ...` |
| Web 工作台 | 任务可视化、审查和人工编辑 | `npm run dev` |
| Browser WebMCP | 宿主支持时控制当前可见页面 | 页面按需注册 |

Codex 使用 `AGENTS.md` 形成项目级指令链；相关机制见 [OpenAI 官方 AGENTS.md 文档](https://learn.chatgpt.com/docs/agent-configuration/agents-md)。MCP 与 Skill 的通用配置原则见 [MCP 文档](https://learn.chatgpt.com/docs/extend/mcp) 和 [Skills 文档](https://learn.chatgpt.com/docs/build-skills)。仓库内配置仍是本项目可执行命令和工具名的直接来源。

## 3. MCP 配置

仓库已提交两份等价配置：

```json
{
  "mcpServers": {
    "2d-game-workbench": {
      "command": "node",
      "args": ["scripts/workbench-mcp.mjs"]
    }
  }
}
```

```toml
[mcp_servers."2d-game-workbench"]
command = "node"
args = ["scripts/workbench-mcp.mjs"]
required = false
startup_timeout_sec = 10
tool_timeout_sec = 300
default_tools_approval_mode = "writes"
```

客户端必须以仓库根目录作为工作目录启动 server。需要手工配置的客户端使用：

- 名称：`2d-game-workbench`
- 传输：STDIO
- 命令：`node`
- 参数：`scripts/workbench-mcp.mjs`
- 工作目录：本仓库根目录

可以在终端直接运行 `npm run workbench:mcp` 做启动诊断，但 STDIO server 启动后等待 MCP 消息是正常现象，不会显示交互式菜单。

## 4. MCP 能力面

Server 暴露只读资源 `workbench://manifest`，以及 13 个工具：

| 工具 | 行为 |
| --- | --- |
| `workbench_list_capabilities` | 列出能力、适配器和外部提供方就绪情况 |
| `workbench_describe_capability` | 返回某一能力的输入 schema、输出与工作流契约 |
| `workbench_prepare_task` | 校验输入并写入任务记录，不运行适配器 |
| `workbench_run_task` | 对已授权请求运行清单选定的适配器 |
| `workbench_interactable_template` | 获取四种行为的完整交互物模板，不创建任务 |
| `workbench_get_task` | 读取任务；运行中时安全刷新已有上游作业一次 |

新增工具：`workbench_start_frontend`（本地前端及运行时启动）、`workbench_get_environment`、`workbench_start_services`、`workbench_list_presets`、`workbench_list_tasks`、`workbench_get_result`、`workbench_read_artifact`。分别用于实际就绪检查、本机启动、角色与动作发现、历史查询、结构化结果和图像读取。完整契约和手动验收见 [MCP 第一阶段](agent-phase1-acceptance.md)。

标准调用顺序：

```text
list → describe → prepare 或 run → get → 报告 task/status/outputs
```

选择 `prepare` 的情况：

- 用户只要求方案、检查或准备输入；
- 操作可能产生外部 API 费用或上传数据，但尚未授权；
- 需要先把输入校验结果交给用户确认。

选择 `run` 的情况：用户已经要求实际生成、拼接或导出，并且操作仍在其授权范围内。本地操作无需额外制造确认步骤；外部调用仍受客户端自身审批策略约束。

## 5. 状态与异步任务

- `prepared`：只完成校验和记录。
- `running`：本地适配器或上游任务仍在执行。
- `awaiting_configuration`：缺少指定服务配置；任务没有产物完成声明。
- `completed`：运行时确认完成并记录有效产物。
- `failed`：任务失败，读取其错误并说明恢复路径。
- `attention_required`：序列帧需要检查、审核或恢复；先查看结果和候选状态，不直接重生成。

序列帧生成可能异步返回。此时调用 `workbench_get_task` 刷新原来的上游 job；不要再次调用 `workbench_run_task`。查询是幂等刷新，短暂轮询错误不会改写已有任务为虚假成功，也不会提交第二次生成。

Agent 的最终报告至少包括：能力和操作、任务 ID、当前状态、错误或缺失配置、确认存在的输出路径。不能把 `prepared`、`running` 或 `awaiting_configuration` 描述为完成。

## 6. CLI 后备

客户端不能加载 MCP 时，在仓库根目录使用同一运行时：

```powershell
npm run workbench -- list --json
npm run workbench -- agent interactable-template --input-json '{"kind":"toggle","name":"门"}' --json
npm run workbench -- describe interactable-editor --json
npm run workbench -- run interactable-editor --input examples/requests/interactable-export.json --json
npm run workbench -- status <task-id> --json
```

具体样例文件以 `examples/requests/` 当前内容为准。CLI 与 MCP 共享任务目录、状态机、适配器和输出验证，不是另一套实现。

## 7. 生产能力的 Agent 选择

### 序列帧

选择 `sprite-generator`。先描述 capability，再使用真实声明的 `create`、`create-and-generate`、`generate-existing`、`get`、`export` 以及清单声明的检查、审核和恢复操作。preset ID 必须来自 SpritePipeline，不从自然语言猜测。详见 [序列帧生成](sprite-generator.md)。

### 地图

地图在 `/tools/map-stitcher` 前端由用户操作。MCP 发现列表不提供该能力，describe/prepare/run 均拒绝地图制作请求，且不创建任务。CLI/HTTP 仍保留前端所需底层接口，Agent 不应绕过手动边界。详见 [地图拼接](map-stitcher.md)。

### 交互物

先调用 `workbench_interactable_template` 获取查看、切换、拾取或序列模板；按需求修改完整 `project`，调用 `interactable-editor` 的 `save-project` 保存。`get_result.viewPath` 可直接打开前端编辑；需要资源包时再用 `export-godot` 和可选 `selectedDefinitionIds`。这是本地导出，不要求 API key、SpritePipeline 或 Godot。完成只证明资源包已生成，不证明目标游戏已通过回归测试。详见 [独立交互物编辑器](interactable-editor.md)。

跨能力请求应建立多个独立任务，再在对话中汇总它们的状态和产物；不要制造一个清单中不存在的复合 operation。

## 8. Browser WebMCP 与仓库 MCP

当浏览器宿主提供 `document.modelContext` 时，工作台可以注册当前页面的工具，例如能力入口，地图页还可暴露读取、视图、导入、生成、区域和导出操作。这些工具直接作用于可见编辑器，并复用页面的锁定、版本和忙碌状态。

Browser WebMCP 与仓库 STDIO MCP 是两个边界：

- STDIO MCP 面向打开仓库的外部主 Agent，可访问持久化任务运行时。
- Browser WebMCP 面向当前页面会话，只在宿主支持且页面打开时存在。
- 页面工具不能作为后台任务完成的证据；需要以页面返回或 runtime task record 为准。

## 9. Web 与部署边界

`npm run dev` 启动 Web、回环 runtime bridge 和默认 SpritePipeline。Web 的服务端 API 代理到 bridge，而不是把 Node 文件系统和原生图片模块打进 Worker 客户端。

部署在远端的页面不能直接读取开发者电脑上的 `127.0.0.1:8790`、本地任务或浏览器另一来源的 IndexedDB。若要远程运行能力，需要独立部署经过认证、TLS、访问控制和审计的 runtime；仅发布前端不会自动获得这些能力。

## 10. 排错

| 现象 | 检查 |
| --- | --- |
| 客户端看不到 server | 确认项目已信任、工作目录正确、Node 版本满足要求，并重载项目配置 |
| 工具列表为空或旧 | 运行 `npm run workbench -- doctor --json`，重启 MCP server |
| `awaiting_configuration` | 查看任务给出的环境变量；只配置对应外部 operation，勿伪造输出 |
| Sprite 任务一直运行 | 使用 `get`/`status` 查询原 job，并检查 `127.0.0.1:7860` 健康状态 |
| Web 看不到 Agent 任务 | 确认 `npm run workbench:http` 在 `127.0.0.1:8790` 运行，检查 `WORKBENCH_RUNTIME_URL` |
| 托管页面无法访问本机任务 | 这是预期网络边界；需要安全远程 runtime，不应暴露本机回环服务 |
| 输出路径不存在 | 把任务视为未完成或失败，检查 `result.json` 和适配器错误，不手工编造路径 |

协议细节见 [连接器与任务契约](connector-contract.md)，完整服务拓扑见 [系统架构](architecture.md)。

## WorkBuddy 首次对话自动打开

在 WorkBuddy 连接本项目 MCP 后发送第一条消息，Agent 会先检查 `workbench_get_environment.frontend`。服务离线时调用 `workbench_start_frontend`，等待 `frontend.ready`，再用 WorkBuddy 自带的 `present_files` 打开 `frontend.hostAction.arguments.files` 中的地址。前端地址以清单 `workspace.frontend` 为准，默认 `http://localhost:3000`。同一对话复用已有预览，用户关闭后不会自动重开。

这是 MCP 初始化 instructions 与项目 AGENTS.md 约定的 **首次对话工作流**，执行依赖 WorkBuddy Agent；没有把“握手完成”伪装成打开浏览器事件。WorkBuddy 5.5.3 的原生 `present_files` 支持内部 URL 预览；项目 STDIO server 没有宿主会话浏览器的直接控制接口。宿主工具缺失、调用失败或前端冲突时，Agent 应明确报告并继续可完成的原请求。

`workbench_start_frontend` 与 CLI `npm run workbench -- agent frontend --json`、HTTP `POST /v1/agent/frontend` 共用运行时。它只启动固定的本地 Web/Runtime 进程，不启动 SpritePipeline、不安装依赖、不调用生图 API。启动请求返回 `starting`，须继续查询环境；返回的 `hostAction` 是宿主待执行操作，不能当作已打开证明。服务日志与 PID 在 `work/services/`；MCP 断开后服务继续运行，后续连接复用它们。端口被其他应用占用时停止，不终止其他进程，也不改用其他端口。

手动验收：

1. 在 WorkBuddy 刷新或重连 `2d-game-workbench`，确认有 `workbench_start_frontend`（总计 13 个工具），然后新建本项目对话。
2. 发送“看看工作台现在有哪些功能”，无需要求打开网页。预期内部浏览器打开工作台首页，Agent 继续回答原问题。
3. 再发送“列出已有角色”。预期复用页面，不增加重复预览；手动关掉预览后再发消息，也不应强行重开。
4. 可选冷启动：正常关闭工作台开发服务，重新开启 WorkBuddy 项目对话并重复第 2 步。预期自动启动前端和 Runtime Bridge；无需 PixelLab Key 或 Python。若首次编译超过 60 秒，Agent 报告仍在启动和日志位置，不应谎报成功。
5. 验证仅连上 MCP、不发送消息不会打开页面；这是已确认的触发时机。不要据此判定为故障。

自动化测试能验证 MCP 契约、启动/复用/冲突和前端响应；WorkBuddy 是否实际执行宿主预览工具，需以上手工验收确认。

## 自然语言制作引导

`workbench_list_capabilities` 除能力列表外，还返回 `conversationGuidance`。它从清单的 `agentAssets.conversationGuide` 读取 [共用引导](../workbench/conversation-guide.md)，供只有 MCP、没有仓库 Skill 的 WorkBuddy 会话使用。CLI `npm run workbench -- agent guidance --json` 和 HTTP `POST /v1/agent/guidance`（请求体 `{}`）返回相同内容；读取引导不写任务、不调用生成服务。原有工具数量不变。

引导覆盖角色动作、地图拼接/扩图、交互物行为。Agent 先利用上下文和已有资产，仅询问改变结果的关键选择。宿主 `AskUserQuestion` 可用时先查看其参数契约再调用；当前模式不可用时用简短文字提问。没有答案、取消和超时均不能当作默认选项已获同意。引导不提供任意图片注册角色或纯文字生成地图等未注册能力。

以下是 WorkBuddy 人工行为验收；在重新连接 MCP 的新对话中逐项进行。除明确的本地逻辑包例子外，先指定“只讨论方案，不生成”，避免验收时产生生图费用。

| 输入场景 | 预期行为 |
| --- | --- |
| “只讨论方案：做个角色动画。” | 只问角色来源、动作等真正缺失选择，用提问工具（若可用）；不创建空任务。 |
| “只讨论方案：用已有赛博战士做行走，你决定其他设置。” | 查真实角色/动作 ID，说明沿用 preset 和一个候选；不重复问角色、动作、帧数。 |
| “只讨论方案：做一张森林地图，目前没有任何素材。” | 说明当前地图能力的模板/素材边界，给出下一步所需素材；不伪造一次文生地图调用。 |
| “只讨论方案：把这四张图按两行两列、附件顺序拼起来。” | 已有布局就不重复追问；提供地图前端入口，不运行 MCP 地图任务。 |
| “只讨论方案：做个宝箱。” | 根据上下文区分外观图与可交互物，必要时询问；不默认宝箱等于拾取物。 |
| “制作一个靠近按键可打开、可关上的门，只要可替换美术的逻辑包，通用 Godot。” | 选择 toggle 与 generic；执行本地导出，不要求 PixelLab Key，不新增角色生图。 |
| 在提问卡片中取消或不作答 | 不提交依赖答案的任务，也不把推荐项当成用户选择。 |
| 连续回答“已有角色”“做行走” | 记住答案，补足其余真实缺项后推进，不重复整份问卷。 |

自动测试校验 MCP/CLI 共享运行时与 HTTP 的引导内容一致，以及真实适配器链路不回归。它们不等同于已验证 WorkBuddy 模型遵循每条对话规则；上表用于宿主侧验收。
