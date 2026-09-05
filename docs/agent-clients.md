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
| Repository Skill | 三项生产能力的选择与操作流程 | `.agents/skills/2d-game-workbench/SKILL.md` |
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

Server 暴露只读资源 `workbench://manifest`，以及五个工具：

| 工具 | 行为 |
| --- | --- |
| `workbench_list_capabilities` | 列出能力、适配器和外部提供方就绪情况 |
| `workbench_describe_capability` | 返回某一能力的输入 schema、输出与工作流契约 |
| `workbench_prepare_task` | 校验输入并写入任务记录，不运行适配器 |
| `workbench_run_task` | 对已授权请求运行清单选定的适配器 |
| `workbench_get_task` | 读取任务；运行中时安全刷新已有上游作业一次 |

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

序列帧生成可能异步返回。此时调用 `workbench_get_task` 刷新原来的上游 job；不要再次调用 `workbench_run_task`。查询是幂等刷新，短暂轮询错误不会改写已有任务为虚假成功，也不会提交第二次生成。

Agent 的最终报告至少包括：能力和操作、任务 ID、当前状态、错误或缺失配置、确认存在的输出路径。不能把 `prepared`、`running` 或 `awaiting_configuration` 描述为完成。

## 6. CLI 后备

客户端不能加载 MCP 时，在仓库根目录使用同一运行时：

```powershell
npm run workbench -- list --json
npm run workbench -- describe map-stitcher --json
npm run workbench -- prepare map-stitcher --input examples/requests/map-stitcher.json --json
npm run workbench -- run map-stitcher --input examples/requests/map-stitcher.json --json
npm run workbench -- status <task-id> --json
```

具体样例文件以 `examples/requests/` 当前内容为准。CLI 与 MCP 共享任务目录、状态机、适配器和输出验证，不是另一套实现。

## 7. 三项能力的 Agent 选择

### 序列帧

选择 `sprite-generator`。先描述 capability，再使用真实声明的 `create`、`create-and-generate`、`generate-existing`、`get` 或 `export` 操作。preset ID 必须来自 SpritePipeline，不从自然语言猜测。详见 [序列帧生成](sprite-generator.md)。

### 地图

选择 `map-stitcher`。确定性本地拼接与导出使用 `compose`；只有整体图层外部生成使用 `generate-layer`。外部 provider 未配置不影响本地 compose。详见 [地图拼接](map-stitcher.md)。

### 交互物

选择 `interactable-editor` 的 `export-godot`，提交 `project` 和可选 `selectedDefinitionIds`。这是本地导出，不要求 API key、SpritePipeline 或 Godot。完成只证明资源包已生成，不证明目标游戏已通过回归测试。详见 [独立交互物编辑器](interactable-editor.md)。

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
