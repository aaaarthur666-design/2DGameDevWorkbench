# Agent 客户端接入

## 1. 角色边界

打开本仓库的 Codex、WorkBuddy 或其他 MCP 客户端是主 Agent。它负责理解用户意图、选择能力、组织输入、发起经过授权的任务，并用真实任务记录报告结果。

Web 工作台负责展示任务和进度、恢复草稿、预览产物，以及地图画布、交互区域等更适合人工操作的编辑工作。它没有通用 Agent 对话框，也不替代外部客户端的规划能力。

生产入口以 `workbench/manifest.json` 和 `lib/workbench/runtime.mjs` 为共同契约；共享文档字段与类型化命令由 `lib/workbench/document-contract.mjs` 声明，网页、MCP 和 CLI 共用 Bridge 写入端。

## 2. 接入方式

| 入口 | 用途 | 仓库配置 |
| --- | --- | --- |
| STDIO MCP | Agent 客户端首选；类型化发现、执行与状态查询 | `.mcp.json`；宿主配置在本机创建 |
| Repository Skill | 角色与 Image 2.5 美术、交互物、共享场景与资产操作；legacy 地图拼接保持手动 | `.agents/skills/2d-game-workbench/SKILL.md` |
| 工程 Skill | CopyWorms 方法下的 Godot 资产接入和脚本编写 | `.agents/skills/forge-game-engineering/SKILL.md` |
| CLI | 不支持 MCP 的客户端或本地诊断 | `npm run workbench -- ...` |
| Web 工作台 | 任务可视化、审查和人工编辑 | `npm run dev` |
| Browser WebMCP | 宿主支持时控制当前可见页面 | 页面按需注册 |

Codex 使用 `AGENTS.md` 形成项目级指令链；相关机制见 [OpenAI 官方 AGENTS.md 文档](https://learn.chatgpt.com/docs/agent-configuration/agents-md)。MCP 与 Skill 的通用配置原则见 [MCP 文档](https://learn.chatgpt.com/docs/extend/mcp) 和 [Skills 文档](https://learn.chatgpt.com/docs/build-skills)。仓库内配置仍是本项目可执行命令和工具名的直接来源。

## 3. MCP 配置

仓库提供 `.mcp.json`。以下为通用配置及可由用户在本机创建的 Codex 配置示例：

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

Server 暴露只读资源 `workbench://manifest`，当前构建提供 39 个工具（MCP server version 为 0.11.0；以实际发现结果为准）：

| 工具 | 行为 |
| --- | --- |
| `workbench_list_capabilities` | 发现可用能力、就绪信息与两项 Skill 引导 |
| `workbench_describe_capability` | 读取目标能力完整 schema 与输出约定 |
| `workbench_prepare_task` | 显式输入校验，写准备记录，不运行适配器 |
| `workbench_run_task` | 运行已获授权的操作，写任务及实际产物 |
| `workbench_get_task` | 读取并按需要刷新原异步任务，不新建生成 |
| `workbench_present` | 选择展示目标；WorkBuddy 返回本会话的宿主开页动作 |
| `workbench_get_frontend_context` | 核对本会话页面与步骤到达确认 |
| `workbench_list_game_exports` | 查询游戏项目交付 |
| `workbench_get_game_export` | 检查指定包和目标工程 |
| `workbench_export_to_game` | 交付已有 Godot 包 |
| `workbench_install_game_export` | 校验并安装交付资源 |
| `workbench_complete_game_export` | 记录接入文件与引擎证据 |
| `workbench_get_environment` | 检查运行环境、服务兼容性、前端和 Key 配置状态 |
| `workbench_start_services` | 离线时启动本机 SpritePipeline，不安装或生成 |
| `workbench_start_frontend` | 启动本机 Web 与 Bridge，宿主另行打开预览 |
| `workbench_list_presets` | 查询真实角色与动作 ID 和默认参数 |
| `workbench_interactable_template` | 返回完整行为模板，不保存或导出 |
| `workbench_list_tasks` | 查最近执行和原生作业，用于追踪操作 |
| `workbench_list_assets` | 按名称、类型、候选条件分页查持久资产 |
| `workbench_get_asset` | 读取单件资产、文件证据及精确详情链接 |
| `workbench_get_asset_manifest` | 返回明确所选资产的交接清单，不复制文件 |
| `workbench_get_result` | 读取 taskId 或 jobId 的结果与精确候选链接，不刷新生成 |
| `workbench_read_artifact` | 读取任务登记图片；GIF 为首帧，不等于完整播放 |
| `workbench_list_documents` | 分页发现共享场景与交互物工程 |
| `workbench_get_document` | 读取当前或历史版本；metadataOnly 可省略素材正文 |
| `workbench_create_document` | 从完整内容或模板创建共享工程 |
| `workbench_save_document` | 按预期版本保存完整内容；AI 保存遵守锁定实例保护 |
| `workbench_apply_document_commands` | 单文档类型化事务；需要 expectedRevision 与 commandId |
| `workbench_restore_document` | 将历史快照恢复为新版本，保留原历史 |
| `workbench_validate_document` | 检查保存版本的结构、媒体与诊断 |
| `workbench_simulate_document` | 执行类型化输入事件并检查交互结果，不改文档 |
| `workbench_adopt_document_image` | 使用确切图片任务与 SHA-256，明确采用到指定工程 |
| `workbench_export_document` | 导出明确保存版本的场景源包和 Godot 包 |
| `workbench_observe_document` | 返回保存场景版本的 PNG、几何标注与资源证据 |
| `workbench_inspect_image_target` | 发现或读取既有图片目标、源版本和候选 |
| `workbench_resolve_image_region` | 按确切源版本解析区域；可显式保存命名区域 |
| `workbench_edit_image_region` | 执行本地配方并保存候选，不自动采用 |
| `workbench_apply_image_candidate` | 按目标版本、源哈希和锁采用确切候选 |
| `workbench_get_image_edit` | 读取持久会话、候选及原任务身份 |

启动工具会改变进程状态；prepare/run 会持久化任务。文档修改保留独立版本，场景导出建立独立资产记录；这些操作不创建图片生产任务。其他查询不新建制作任务，get_task 可刷新原有异步记录。

标准调用顺序：

```text
list → describe → prepare 或 run → get → 报告 task/status/outputs
```

选择 `prepare` 的情况：

- 用户明确要求对具体输入进行校验并保存准备记录。

只讨论方案、浏览、澄清需求或等待执行授权时，不调用 prepare/run。

选择 `run` 的情况：用户已经要求在开放能力内实际生成、保存或导出，并且操作仍在其授权范围内。本地操作无需额外制造确认步骤；外部调用仍受客户端自身审批策略约束。

## 5. 状态与异步任务

- `prepared`：只完成校验和记录。
- `running`：本地适配器或上游任务仍在执行。
- `awaiting_configuration`：缺少指定服务配置；任务没有产物完成声明。
- `completed`：运行时确认完成并记录有效产物。
- `failed`：任务失败，读取其错误并说明恢复路径。
- `attention_required`：序列帧需要检查、审核或恢复；先查看结果和候选状态，不直接重生成。

序列帧生成可能异步返回。此时调用 `workbench_get_task` 刷新原来的上游 job；不要再次调用 `workbench_run_task`。查询是幂等刷新，短暂轮询错误不会改写已有任务为虚假成功，也不会提交第二次生成。

Image 2.5 同样先返回已持久化的 running taskId，再由后台进程提交和保存图片。使用同一 get_task/status 查询；进程退出或租约失效时提示 attention_required，不自动重试可能已计费的提交。任务完成后先检查图片，再明确采用；requiresAdoption=true 不代表已经修改地图、交互物或场景。

普通回复先说结果、准确作品链接与下一步；技术详情保留能力、操作、任务 ID、状态、错误或缺失配置及实际输出路径，需要排错时提供。不能把 `prepared`、`running` 或 `awaiting_configuration` 描述为完成。

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

共享工程使用 `npm run workbench -- agent documents --json` 发现，再以 `agent document-get|document-apply|document-observe|document-simulate|document-adopt-image|document-export` 配合 `--input <json-file>` 操作。文档 CLI 与 MCP 都转发长驻 Runtime Bridge，Bridge 离线时明确失败，不回退为另一进程直接写文件。HTTP 等价为 `POST /v1/agent/<operation>`；网页使用 `/api/workbench/documents` 同源代理。

## 7. 生产能力的 Agent 选择

Agent 发现列表提供 image-assets、reference-art、sprite-generator、interactable-editor 四项。legacy map-stitcher 为手动能力，场景编辑另使用共享文档工具。

### 背景与透明物品

选择 `image-assets`，先读取 schema，再按授权执行 generate-background、generate-prop 或 edit-image。该独立路线使用 GPT Image 2.5，支持参考图、显式尺寸与透明 PNG 编辑蒙版；不调用 legacy 地图拼接或扩图接口。使用 get_task/status 跟踪原任务，检查真实图片、尺寸和 sha256；不重复 run 查询进度。

完成的背景或透明 prop 保留原图与来源，不自动替换编辑器。采用到共享工程时，调用 `workbench_adopt_document_image`，提供 sourceTaskId、sha256、documentId、expectedRevision、commandId；交互物 prop 还需已有 definitionId。背景建立单地图层和可回导源包，碰撞为空；prop 只改默认外观，保留行为与状态图片。配置状态通过 `/api/workbench/image-assets/settings` 读取或经专用配置入口保存，密钥不写入任务输入。

### 已有图片的局部修改（7A–7D）

使用五个已注册图片工具；inspect → resolve → edit → apply 是主流程，get-edit 用于恢复会话和查询原候选。先发现保存目标，不依据网页当前选中项或 blob URL 猜测身份。当前只执行本地操作，不需要模型 Key 或 Python；resolve 不创建生成任务，edit 保存独立候选，apply 才写入明确目标。它可以编辑已存在的地图源图片，但不开放地图原图生产、拼接或扩展。

MCP 与 CLI 的全部 image-* 操作转发同一个 canonical Bridge，包含会刷新记录的读取；Bridge 不可用就失败，无本地直写 fallback。同一数据目录只支持一个权威 Bridge。保持 expectedRevision、expectedSha256、regionRef；继续同一会话时还需 expectedEditRevision 和明确 baseCandidateVersion。写入保留 commandId，同 ID 同载荷重试读取原记录，不同载荷冲突；崩溃或应答丢失后查原会话/任务，不用新命令盲目重交。

源 PNG/JPEG/WebP 文件 sha256 与规范 sRGB/RGBA8 straight-alpha 的 rgbaSha256 是不同证据；预览、Canvas 和蒙版不能代替源像素。命名区域绑定源版本，变化后重新解析。7B 共用工作区支持单图恢复，宿主先完成持久保存，再读取准确采用版本协调基线，不回滚其他工程内容。

7C 的显式 ai-edit 冻结基准候选、描述、参考字节和区域；AI 增减笔刷只改硬边 `mask-runs`，不改 RGBA。只在用户请求 AI 时提交，断连 / 重启继续读取原 commandId / taskId，不自动重发或采用。返回的 presentation、task imageEditContext 和 `workbench_present({editId,candidateVersion})` 指向准确 `imageEdit` / `imageCandidate`；在途候选可继续观察，未保存笔划不被轮询覆盖，不可写历史只读。本批真实模型请求为 0，实际 UI 验收另记；7D 已接指定状态槽及场景引用：选中实例使用独立派生素材，其他共享实例保留；地图快照仅在验证单源像素映射后开放，图层 PNG 与嵌入源 ZIP 同一事务保存。不能确认映射的派生或合成层只读，使用源地图入口继续。详见[图片局部编辑](image-editing.md)。隔离 mock 和像素回归不证明真实模型品质或 Godot 执行。

### 序列帧

选择 `sprite-generator`。先描述 capability，再使用真实声明的 `create`、`create-and-generate`、`generate-existing`、`get`、`export` 以及清单声明的检查、审核和恢复操作。preset ID 必须来自 SpritePipeline，不从自然语言猜测。详见 [序列帧生成](sprite-generator.md)。

### 地图

legacy `map-stitcher` 的拼接、扩图与原地图生成操作仍在 `/tools/map-stitcher` 前端由用户操作。MCP 发现列表不提供该能力，describe/prepare/run 均拒绝该能力，且不创建任务。CLI/HTTP 仍保留前端所需底层接口，Agent 不应绕过此边界。这不限制上面的独立 image-assets 背景生成或已声明的共享场景命令。详见 [地图拼接](map-stitcher.md)。

### 交互物

先调用 `workbench_interactable_template` 获取查看、切换、拾取或序列模板；按需求修改完整 `project`，调用 `interactable-editor` 的 `save-project` 保存。`get_result.viewPath` 可直接打开前端编辑；需要资源包时再用 `export-godot` 和可选 `selectedDefinitionIds`。这是本地导出，不要求 API key、SpritePipeline 或 Godot。完成只证明资源包已生成，不证明目标游戏已通过回归测试。详见 [独立交互物编辑器](interactable-editor.md)。

继续网页中的相同交互物时，优先用 list/get_document 读取共享 projectId 和 revision，再执行已声明的 add/bind/shape/behavior 等命令，保留 ID。原有 save-project / export-godot 仍可使用；共享保存与生产任务分别记录。

### 共享场景

通过 list/get_document 读取保存版本和稳定节点 ID，使用 apply_document_commands 完成素材导入、实例移动/缩放/翻转、排序、替换、显隐、地图替换与明确碰撞编辑。一次最多 100 条命令，单文档全部成功才提交。expectedRevision 过旧返回 409 / REVISION_CONFLICT；相同 commandId 重试不重复修改。前端有本机变更或忙碌时保留草稿，冲突需先读取当前内容再决定修改。

修改后 observe_document 返回该确切版本的场景 PNG、可选标注、坐标变换和资源哈希；validate_document 检查模型与媒体，simulate_document 可用最多 200 个输入事件检查状态及期望事件。结果不代表 Godot 物理或游戏运行验收。需要交付时明确提供 documentId 与 revision 给 export_document。observe/export 目前仅支持场景；交互物独立导出仍使用 export-godot。详见 [场景组装](scene-composer.md)。

跨能力请求应建立多个独立任务，再在对话中汇总它们的状态和产物；不要制造一个清单中不存在的复合 operation。

## 8. Browser WebMCP 与仓库 MCP

当浏览器宿主提供 `document.modelContext` 时，工作台可以注册当前页面的工具，例如能力入口，地图页还可暴露读取、视图、导入、生成、区域和导出操作。这些工具直接作用于可见编辑器，并复用页面的锁定、版本和忙碌状态。

Browser WebMCP 与仓库 STDIO MCP 是两个边界：

- STDIO MCP 面向打开仓库的外部主 Agent，可访问持久化任务运行时。
- Browser WebMCP 面向当前页面会话，只在宿主支持且页面打开时存在。
- 页面工具不解除 legacy 地图拼接/扩图的手动边界；共享场景的 Agent 修改以已声明文档命令为准。
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

在 WorkBuddy 连接本项目 MCP 后发送第一条消息，Agent 会先检查 `workbench_get_environment.frontend`。服务离线时调用 `workbench_start_frontend`，等待 `frontend.ready`，再用 WorkBuddy 自带的 `present_files` 打开 `preview.hostAction.arguments.files` 中带本会话 previewSession 的地址。前端地址以清单 `workspace.frontend` 为准，默认 `http://localhost:3000`。同一对话复用已有预览，用户关闭后不会自动重开。

这是 MCP 初始化 instructions 与产品 Skill 约定的 **首次对话工作流**，执行依赖 WorkBuddy Agent；没有把“握手完成”伪装成打开浏览器事件。WorkBuddy 5.5.3 的原生 `present_files` 支持内部 URL 预览；项目 STDIO server 没有宿主会话浏览器的直接控制接口。宿主工具缺失、调用失败或前端冲突时，Agent 应明确报告并继续可完成的原请求。

`workbench_start_frontend` 与 CLI `npm run workbench -- agent frontend --json`、HTTP `POST /v1/agent/frontend` 共用运行时。它只启动固定的本地 Web/Runtime 进程，不启动 SpritePipeline、不安装依赖、不调用生图 API。启动请求返回 `starting`，须继续查询环境；返回的 `hostAction` 是宿主待执行操作，不能当作已打开证明。服务日志与 PID 在 `work/services/`；MCP 断开后服务继续运行，后续连接复用它们。端口被其他应用占用时停止，不终止其他进程，也不改用其他端口。

手动验收：

1. 在 WorkBuddy 刷新或重连 `2d-game-workbench`，确认有 `workbench_start_frontend` 与新增文档工具（当前构建 34 个工具），然后新建本项目对话。
2. 发送“看看工作台现在有哪些功能”，无需要求打开网页。预期内部浏览器打开工作台首页，Agent 继续回答原问题。
3. 再发送“列出已有角色”。预期复用页面，不增加重复预览；手动关掉预览后再发消息，也不应强行重开。
4. 可选冷启动：正常关闭工作台开发服务，重新开启 WorkBuddy 项目对话并重复第 2 步。预期自动启动前端和 Runtime Bridge；无需 PixelLab Key 或 Python。若首次编译超过 60 秒，Agent 报告仍在启动和日志位置，不应谎报成功。
5. 验证仅连上 MCP、不发送消息不会打开页面；这是已确认的触发时机。不要据此判定为故障。

自动化测试能验证 MCP 契约、启动/复用/冲突和前端响应；WorkBuddy 是否实际执行宿主预览工具，需以上手工验收确认。

## 自然语言制作引导

`workbench_list_capabilities` 除能力列表外，还返回 `conversationGuidance`。它从清单的 `agentAssets.conversationGuide` 读取 [共用引导](../workbench/conversation-guide.md)，供只有 MCP、没有仓库 Skill 的 WorkBuddy 会话使用。CLI `npm run workbench -- agent guidance --json` 和 HTTP `POST /v1/agent/guidance`（请求体 `{}`）返回相同内容；读取引导不写任务、不调用生成服务。

引导覆盖角色动作、独立背景/透明物品、共享场景与交互物行为，以及 legacy 地图拼接/扩图的手动边界。Agent 先利用上下文和已有资产，仅询问改变结果的关键选择。宿主 AskUserQuestion 可用时先查看其参数契约再调用；当前模式不可用时用简短文字提问。没有答案、取消和超时均不能当作默认选项已获同意。图片生成只能使用发现的 capability / operation，不能把共享编辑扩大为未注册的地图生产操作。

以下是 WorkBuddy 人工行为验收；在重新连接 MCP 的新对话中逐项进行。除明确的本地逻辑包例子外，先指定“只讨论方案，不生成”，避免验收时产生生图费用。

| 输入场景 | 预期行为 |
| --- | --- |
| “只讨论方案：做个角色动画。” | 只问角色来源、动作等真正缺失选择，用提问工具（若可用）；不创建空任务。 |
| “只讨论方案：用已有赛博战士做行走，你决定其他设置。” | 查真实角色/动作 ID，说明沿用 preset 和一个候选；不重复问角色、动作、帧数。 |
| “只讨论方案：做一张森林地图，目前没有任何素材。” | 说明 image-assets 独立背景路线、检查与采用步骤；需要扩图时给出 legacy 地图前端入口。只讨论时不生成。 |
| “只讨论方案：把这四张图按两行两列、附件顺序拼起来。” | 已有布局就不重复追问；提供地图前端入口，不运行 MCP 地图任务。 |
| “只讨论方案：做个宝箱。” | 根据上下文区分外观图与可交互物，必要时询问；不默认宝箱等于拾取物。 |
| “制作一个靠近按键可打开、可关上的门，只要可替换美术的逻辑包，通用 Godot。” | 选择 toggle 与 generic；执行本地导出，不要求 PixelLab Key，不新增角色生图。 |
| 在提问卡片中取消或不作答 | 不提交依赖答案的任务，也不把推荐项当成用户选择。 |
| 连续回答“已有角色”“做行走” | 记住答案，补足其余真实缺项后推进，不重复整份问卷。 |

自动测试校验 MCP/CLI 共享运行时与 HTTP 的引导内容一致，以及真实适配器链路不回归。它们不等同于已验证 WorkBuddy 模型遵循每条对话规则；上表用于宿主侧验收。

## 作品展示（MCP 0.7.0）

0.7.0 引入的 `get_result` 展示契约在 0.8.0 中继续保留。`get_result` 接受 `taskId` 或序列帧原生 `jobId`，二选一；可用 `candidateIndex` 指定已有候选，`detail:true` 在文本内容中读取完整技术结果。无效候选明确报错，不回退到其他版本。查询只读，不创建任务或重新生图。

`presentation` 由共享运行时生成，包含 `title`、`state`、`summary`、精确 `viewPath/viewUrl`、`actions`、可用的图片/GIF `preview` 和技术详情入口。状态区分已准备、等待配置、处理中、等待检查、已保存和已导出；缺失产物会提示需要处理。它不承诺质量通过，也不编造百分比。

MCP 默认文本只给简明展示信息；原有完整结果仍在 `structuredContent`，旧客户端可用 `get_result(detail:true)` 获取完整 JSON 文本。图像读取仍返回 MCP image 内容。原图链接定位原生成任务，移送结果另提供选择角色动作入口；序列帧链接携带 job 和 candidate；交互物仍通过 task 恢复项目。执行详情页面优先展示预览与可点击操作，日志和输入折叠。

浏览器与提问属于宿主：首次展示已知作品时先 present，再使用返回的 preview.hostAction，保留会话参数；已有预览只在宿主支持且编辑安全时复用，否则提供链接。关闭或重连不自动重开。`browserOpened:false` 只表示项目 MCP 没有操作浏览器，不能被说成打开成功。使用实际可用、已读取 schema 的提问工具；未回答不选择默认项。

验证时分别确认工具返回结果、宿主页面实际到达和素材加载。

## 资产目录（MCP 0.8.0）

新增 list_assets / get_asset / get_asset_manifest，分别对应共享 agent 操作 assets / asset / asset-manifest。详见 [资产目录、范围与验收](asset-catalog.md)。查询不产生任务；运行 `npm run test:assets` 验证分页、候选、去重、文件校验和 MCP/HTTP 一致性。

## 阶段三：游戏工程 Skill

MCP `workbench_list_capabilities` 的 `conversationGuidance.engineering` 返回清单中的工程 Skill 及使用指南路径。可读取项目文件的 WorkBuddy/Codex 应读取该入口后继续架构与脚本任务。它不是新增的 MCP 生图工具，也不会自动安装宿主 Skill 或修改目标游戏。若宿主只能调用 MCP、不能读取仓库文件或执行脚本，需由宿主启用项目文件能力，不能声称已写入工程。具体输入、边界与验收见 [游戏工程](game-engineering.md)。

## 执行过程中的页面跟随（MCP 0.9.0）

新增 workbench_present（提交展示请求、无生成）和 workbench_get_frontend_context（只读页面摘要与确认）。首次宿主开页后，执行前调用 present 启用当前 MCP 连接的自动跟随；run_task/get_task 随步骤更新已有页面，选择旧作品或候选时明确 present。后续跳转由页面保存保护处理，不反复调用宿主打开工具。pending 不代表已展示，paused/blocked 不可绕过。完整协议、升级步骤及人工验收见 [执行过程与页面跟随](agent-preview-follow.md)。

## 游戏交付工具（MCP 0.10.0）

新增 workbench_list_game_exports / get_game_export / export_to_game / install_game_export / complete_game_export。它们消费已有包、安装到用户选择的目标并记录 Agent 接入结果，不生成地图或启动通用 Agent。长期 MCP 进程需重连；新交付不会自行向 WorkBuddy 发送聊天消息。下一次相关对话按 [Godot 交付](godot-delivery.md)继续。

### WorkBuddy 显式客户端标识

在 WorkBuddy 的本项目 MCP 配置中追加 `"env": {"FORGE_MCP_HOST":"workbuddy"}`，不改命令、参数和其他连接器。保存配置后，先在 WorkBuddy 连接器管理中重新信任本 server，再重新连接。仅重启不会替新配置完成信任。重新连接后优先使用响应 `preview.hostAction`，而不是不带会话身份的首页链接。`preview_required` 表示制作尚未提交；预览连接成功后再继续。完整流程与例外见 [预览跟随](agent-preview-follow.md)。只有连接 MCP、不发消息不会打开浏览器。

## 配置存在但原生工具未挂载

WorkBuddy 5.5.4 的信任指纹包括 STDIO 命令、参数以及环境变量名称。新增 `FORGE_MCP_HOST` 会改变指纹；旧信任记录只对应旧配置，`disabled:false` 不表示新配置已经获信任。

1. 在 WorkBuddy 连接器/MCP 管理中找到 `2d-game-workbench`，查看更新后的命令和参数，再点击“信任”或“信任并启用”（以当前界面文案为准）。
2. 重新连接该 server，再新建或刷新项目会话。
3. 明确要求“只用原生 MCP 调用 workbench_get_environment，不使用 CLI”。成功证据是宿主实际工具调用，而非终端 doctor 或手写 STDIO 客户端成功。
4. 原生 MCP 成功后，再验收内部浏览器开页和任务跟随。CLI 共用生产运行时，但不验证 WorkBuddy 工具挂载及 MCP 会话预览流程。

信任确认由用户在宿主界面完成，不直接改写 mcp-approvals.json、不删除安全迁移标记、不伪造审批记录。排查时分清“独立 MCP 握手通过”“宿主挂载通过”“页面已展示”三种证据。
