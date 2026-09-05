# MCP 第一阶段：功能与验收

目标：外部 WorkBuddy Agent 可以通过 MCP 发现环境、角色、动作和历史任务，执行制作，读取图片与检查结果，再审核并交付文件。Web 是预览和编辑面；不要求 Agent 点击页面按钮。

## 已实现

原有五个工具继续保留，第一阶段新增六个工具；后续增加前端启动工具，当前共 12 个（以 manifest 为准）：

| 工具 | 用途 |
| --- | --- |
| `workbench_get_environment` | 检查 Python 环境是否安装、服务是否在线、接口是否兼容、Key 是否已配置；不查询余额或发起生成 |
| `workbench_start_frontend` | 启动或复用本机前端与 Runtime Bridge；返回 WorkBuddy 内部预览参数；不生成素材 |
| `workbench_start_services` | 拉起已安装的本机 SpritePipeline；复用在线服务；不安装依赖、不接管远程服务、不提交生成 |
| `workbench_list_presets` | 查询真实角色/动作 ID、名称、尺寸、朝向、帧数、FPS 和描述 |
| `workbench_list_tasks` | 检索最近 200 条工作台记录，并查询页面创建的原生序列帧作业；两类 ID 分开返回 |
| `workbench_get_result` | 读取 result.json 为结构化数据，包含角色 ID、候选检查结果、建议后续操作和已验证文件 |
| `workbench_read_artifact` | 读取指定任务登记的产物，图片返回 MCP image 内容，其他文件返回交付路径 |

`sprite-generator` 增加 `check`、`safety`、`review-frame`、`approve`、`reject`、`recover`、`attach-provider-job`。参数必须先 describe 获取。`approve` 要求 Agent 填写实际查看候选图像后的 `reviewNote`，底层继续强制执行 QA、未处理帧和警告门槛。`acknowledgeWarnings` 只用于明确接受已检查的警告，不可用来跳过硬错误。

`recover` 只恢复已有 PixelLab 作业；`attach-provider-job` 只绑定已知真实的 providerJobId；两者不调用生成提交接口。离线 fixture 不支持 PixelLab 恢复，拒绝该操作是正确行为。创建成功、开始生成失败时，工作台仍保存 remoteJobId，可据此查看和恢复原作业。

## 自动验收

```powershell
npm run test:agent-acceptance
```

该测试启动真实但隔离的 Python 服务和全新的 STDIO MCP 会话，通过 MCP 完成发现预设、fixture 生成、断开重连、历史查询、图片读取、检查、审核及导出。测试验证审核前导出被拦截、缺少审核说明被拒绝、越界产物读取被拒绝，以及 HTTP/CLI 返回相同结果。安装了项目 Python 环境时，还测试服务冷启动与启动期重复调用。隔离服务关闭后，工作台下载的交付副本仍保留。

测试素材标记 `diagnostic_only`，只验收流程，不代表 PixelLab 生图质量。测试不使用真实 Key，不消耗 PixelLab 额度。报告位于 `work/agent-acceptance-*/report.json`，交付文件位于对应的 `outputs/<task-id>/`。

## 在 WorkBuddy 中手动验收

### 0. 加载本次更新

停止旧工作台后重新运行 `npm run dev`，并在 WorkBuddy 中重新连接 `2d-game-workbench` MCP。新会话应看到上述 12 个工具。重开聊天不一定重启 MCP 进程；若仍看到旧工具，应重新连接 server。

项目 Python 依赖已安装时，后续服务离线可由 Agent 调用启动工具；首次缺依赖仍需要 `npm run sprite-pipeline:setup`。连接器安装打包属于后续阶段。仓库当前 `.mcp.json`/`.codex/config.toml` 不等于已经替你配置了 WorkBuddy 客户端。

### 1. 环境与历史（无费用）

直接发送：

> 检查这个工作台能否使用。只用工作台 MCP，不读源码、不写脚本、不操作网页。告诉我序列帧服务是否在线、接口是否兼容、PixelLab 是否已配置，并列出已有角色、动作和最近制作记录。不要生成任何图片。

通过标准：正确报告真实状态；能列出实际角色/动作；能区分工作台任务 ID 与原生 jobId；不要求你提供这些内部 ID；不显示 Key，不发起生成。

### 2. 一次真实角色制作（会消耗 PixelLab 额度）

准备进行真实生图时发送：

> 制作一个绿色斗篷的小剑士，像素风，透明背景，朝右。先生成一张角色原图，再用这张原图制作一组待机动画，候选只要一个。允许本次一张原图和一个动画候选使用 PixelLab 额度，不要自动重生成。请你检查实际图片和帧序，合格后导出精灵表和 GIF 给我；发现硬错误就说明原因并保留任务。全过程只用工作台 MCP，不读源码、不写脚本、不操作网页。

通过标准：原图完成后，Agent 从结构化结果取得 characterId；选择真实待机预设；读取实际帧图再审核；成功时提供真实精灵表、GIF 和任务 ID；结果不合格时如实报告问题，不把失败伪装为交付，不擅自重做。

若只想先免费验证，可让 Agent 使用 `fixture` 和实际存在的 `diagnostic_dummy` 做离线演示；它只是诊断图形，不是 AI 生成的生产素材。

### 3. 新会话找回成果（无新生成）

重新开一个 WorkBuddy 会话，发送：

> 找到刚才做的绿色斗篷角色和待机动画，展示已经生成的结果，并给我现有下载文件。不要重新生成。

通过标准：通过历史任务与结果读取找回已有文件；原生 jobId 不变；没有新的付费提交。若上游任务仍在运行，继续查询原任务，不重新 run 生成。

### 4. 页面交接

打开工作台制作记录，确认任务、图片和聊天里一致；进入序列帧页面查看同一个原生作业，播放导出的 GIF。对比下载的精灵表与帧图，检查透明背景、帧序和角色一致性。

## 当前边界

- Key 已配置不等于余额充足或 Key 已向 PixelLab 验证；真实生成错误会按实际响应报告。
- GIF 的 MCP 图片内容是首帧预览，动作审核应读取 `orderedFrames` 中的逐帧 PNG；原始 GIF 文件保留动画。
- 这里只完成单项工具的制作闭环。跨能力流程持久化、后台自动推进、流程级预算和取消属于第二阶段；关闭 Agent 后不承诺自动串完全部步骤。
- 启动工具只负责 SpritePipeline，MCP 直接使用共享 Runtime，不必启动 Web/HTTP bridge。需要看页面时使用完整工作台入口。
- 自动拉起的本机服务在 MCP 会话结束后继续运行，进程 ID 和日志位置记录在 `work/services/`；已有外部进程不会被自动关闭。
