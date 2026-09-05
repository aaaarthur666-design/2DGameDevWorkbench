# 序列帧生成工作区

> 状态：当前维护。机器契约以 `workbench/manifest.json` 中的 `sprite-generator` 为准。

项目把 `NativeFramesGeneration` 的完整本地工作台保存在 `Tools/SpritePipeline/`，并通过 `/tools/sprite-generator` 接入统一导航。上游来源为 `https://github.com/flxBurnOut/NativeFramesGeneration.git`，当前同步基线为提交 `b5cd0a4`（功能版本 `c2c505c`、MIT 许可 `322a6ae`、测试依赖修复 `b5cd0a4`）。

当前集成包含原始资产与恢复记录校验、QA 算法版本门禁、修补前后问题差异、五状态逐帧时间线、问题帧导航，以及多标签页草稿的三方像素冲突合并。外部替换要求选择帧时捕获的 SHA-256，避免覆盖更晚版本。

## 两种使用面

- 外部 Agent 通过仓库 STDIO MCP 或 CLI 调用结构化任务，任务记录进入 `work/`，交付副本进入 `outputs/<task-id>/`。
- 人通过 Web 中嵌入的 SpritePipeline 工作区选择预设、逐帧检查、修补和导出。Web 不包含主 Agent 对话。

二者连接同一个 SpritePipeline 服务，但浏览器内部草稿/原生 job 与仓库任务记录仍是不同数据来源，由工作台状态栏按已知身份合并展示。

## 本地启动

环境要求：Node.js 22.13+、Python 3.11+；CI 使用 Python 3.12。

首次使用安装 Python 依赖：

```powershell
npm run sprite-pipeline:setup
```

随后只需启动主站。启动器会自动启动本地序列帧管线；如果 7860 上已经有健康的 SpritePipeline，则直接复用：

```powershell
npm run dev
```

只需独立调试 Python 管线时才运行 `npm run sprite-pipeline`。主站托管的管线会随主站退出；已在启动前运行的外部管线不会被主站关闭。7860 被其他程序占用时，启动器会明确报出端口冲突，不会误连。

管线默认监听 `http://127.0.0.1:7860`。如需连接另一个可信地址，在本地 `.env` 中设置：

```dotenv
NEXT_PUBLIC_SPRITE_PIPELINE_UI_URL=https://your-private-sprite-pipeline.example
SPRITE_PIPELINE_API_URL=https://your-private-sprite-pipeline.example
SPRITE_PIPELINE_API_TOKEN=optional-bearer-token
```

`NEXT_PUBLIC_SPRITE_PIPELINE_UI_URL` 会进入浏览器，只能保存 URL，绝不能放 token。`SPRITE_PIPELINE_API_TOKEN` 仅由服务端读取。

## 功能边界

嵌入界面保留上游的六阶段流程：指引与示例、生成动画、播放检查、逐帧修补、导出、API 与项目设置。生成服务使用 PixelLab Animate with Text V3；像素级手工修补、已有 Sheet 导入与离线诊断不依赖收费生成。

通过根目录 npm 命令启动时，Python 管线只监听回环地址，任务和角色包写入 `work/sprite-pipeline/`，成品写入 `outputs/sprite-pipeline/`；两者都不会提交到 Git。直接使用上游启动器时仍沿用其用户数据与文档导出目录。公开部署的 Cloudflare 页面不能启动本机 Python；若要远程使用，需要把管线单独部署到可信 HTTPS 服务，并补充访问控制和持久存储。

## Agent / MCP 接线

`sprite-generator` 由 `sprite-pipeline` 本地适配器驱动。Manifest 输入必须包含 `operation`；创建作业时还要提供真实预设的 `characterId` 和 `actionId`。适配器会将它们转换为 Python 所需的 `character_id` / `action_id` 并调用 `/v1/jobs`，不会再把通用 Workbench envelope 直接发给 FastAPI。

```json
{
  "operation": "create-and-generate",
  "characterId": "player_cyber",
  "actionId": "idle",
  "provider": "pixellab",
  "candidateCount": 1,
  "wait": false
}
```

| operation | 必要意图 | 结果语义 |
| --- | --- | --- |
| `create` | 用真实角色/动作 preset 新建 job | job 已保存，不代表帧已生成 |
| `create-and-generate` | 新建并启动生成 | 通常先返回 `running` |
| `generate-existing` | 为已有 `jobId` 启动生成 | 复用已有 job |
| `get` | 查询已有 `jobId` | 不创建第二个生成请求 |
| `export` | 导出指定候选与排列 | 返回真实 Sheet/预览等文件 |

用户只要求校验，或外部生成尚未授权时使用 `workbench_prepare_task`；已明确要求执行时使用 `workbench_run_task`。异步生成返回 `running` 后，重复调用 `workbench_get_task` 会轮询同一个上游作业，不会再次提交付费生成。候选帧以及导出的 Sheet/预览会被复制到 `outputs/<task-id>/`，任务只有在记录中的每个输出文件真实存在时才会持久化为相应状态。健康指示灯通过同源 `/api/workbench/sprite-pipeline/health` 代理验证 `ok` 与 `version`，端口上其他服务或 404 不会被误报为已连接。

标准输出类别为 `jobRecord`、`orderedFrames`、`spriteSheet`、`preview` 和 `metadata`。实际 operation 不一定一次产生所有类别；只报告任务 `outputs` 中真实存在的路径。`created`、`review_required`、`approved` 是 SpritePipeline job 阶段，仓库任务仍以 `running/completed/failed` 等状态报告；只有实际导出后才能把可交付文件描述为完成。

如需无网络、无付费地验证整条 Agent 接线，可运行 `examples/requests/sprite-generator-fixture.json`；其 `diagnostic_dummy` 产物仅用于诊断，不是可交付美术资源。

上游仓库所有者已于 2026-09-04 确认以 MIT License 发布，当前集成副本包含 `Tools/SpritePipeline/LICENSE`；来源与许可记录见根目录 `THIRD_PARTY_NOTICES.md`。

## 更新与验证

`Tools/SpritePipeline/` 内 README 和 API 文档属于上游组件文档，更新组件时尽量按独立提交同步，不在工作台文档中复制其全部内部实现。工作台接入发生变化时同步更新 manifest、适配器、本文和 [连接器契约](connector-contract.md)。

```powershell
npm run test:dev-supervisor
npm run test:adapters
npm run test:http
npm run test:mcp
npm run workbench -- doctor --json
```

修改上游组件时还应在 `Tools/SpritePipeline` 中按其锁定依赖运行 `python -m pytest -q` 和 `python -m pip check`。整体开发入口见 [开发与验证指南](development.md)。
