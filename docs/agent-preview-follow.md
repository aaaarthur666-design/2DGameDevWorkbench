# Agent 执行过程与页面跟随

2026-09-09：MCP 0.9.0 增加工作步骤展示与前端确认。首次打开仍使用 WorkBuddy 宿主的 present_files；后续由当前工作台页面接收展示请求，经过保存保护后在同一标签页切换。

## 用户操作

1. 更新后重启 Runtime Bridge 和 WorkBuddy 的本项目 MCP 连接，刷新已有前端页面。无需重新输入 Key 或重新生成资产。
2. 向 WorkBuddy 正常描述制作或查看需求。它在执行开始时调用 workbench_present，页面右下角出现当前步骤卡片。
3. 原图生成、动画检查、交互物保存和导出时，展示对应的工具、原任务或指定候选。步骤文字使用真实状态，不编造百分比。
4. “暂停跟随”停止自动切换；“继续跟随”恢复当前未过期步骤。手动通过工作台导航离开会暂停跟随；重新恢复前不争抢页面。
5. 正在输入时稍后切换，工具忙碌时等待；切换前保存浏览器草稿。保存失败时保留原页面，处理后点“继续”。关闭预览不会被此通道重新打开。

## Agent 操作顺序

- 首次就绪和宿主开页沿用现有流程；后续不要为每步再调 present_files 新开标签。
- 先 list/describe 确定能力或读取已选作品，再调用 workbench_present。恰好传 taskId、jobId、assetId、capabilityId 中一个；candidateIndex 只能配 taskId/jobId。仅进入工具时用 discovery 的 capabilityId；已有作品用精确身份。
- 首次 present 成功启用本 MCP 连接的自动跟随。随后 run_task 与 get_task 将真实 presentation 发布给前端，返回 frontendPresentation；失败任务有可读记录时也展示原失败步骤。未启用的诊断客户端不会因查询而改变页面。
- get_result/get_asset/list_assets 仍只读，没有导航副作用。用户选择旧作品或另一候选时，Agent 明确调用 present；不得把作品库首页当作指定作品详情。
- 用 workbench_get_frontend_context 的 requestId 查询确认。等待通常 1–2 秒，最多等待 10 秒再说明状态；不要阻塞长时间任务，不要通过再次 run 来催促展示。视觉审核仍须读取真实画面，不以展示确认代替。
- 页面暂停或阻塞时继续必要的后台工作并报告原因；不得改用宿主强行刷新页面绕过保护。用户要求暂停时不自动恢复。请求约两分钟过期；恢复很久以前的步骤需新的明确 present。
- 前端未连接：若本会话尚未按用户要求打开预览，沿用首次开页流程；已被用户关闭的预览只给精确链接。不要因重连而重新打开。
- 普通回复采用“当前正在做什么 → 真实展示状态 → 下一步”。不把工具 JSON 和内部身份堆进聊天，也不把工作过程全部留到最后再展示。

## 两个新工具

| 工具 | 输入 | 行为 |
| --- | --- | --- |
| workbench_present | 一个 taskId / jobId / assetId / capabilityId；可选 candidateIndex | 校验真实目标，保存短期展示请求，不生成、不导出、不创建任务 |
| workbench_get_frontend_context | 可选 requestId | 只读查看活跃页面身份、编辑状态和展示确认 |

CLI 对应 agent present / agent frontend-context；HTTP 对应 POST /v1/agent/present 和 /v1/agent/frontend-context。前端用 /api/workbench/frontend 转发到 /v1/frontend/heartbeat。自动跟随启用状态属于 MCP 连接；CLI/HTTP 的 present 只提交指定的一次展示。

| 状态 | 含义 |
| --- | --- |
| waiting_for_frontend | 没有活跃目标页面；未展示 |
| pending / navigating | 等待页面接收或切换中；未确认到达 |
| displayed | 目标页面已回报当前地址；不代表图片加载成功、动作通过审查或用户已经看过 |
| paused | 用户暂停；不可强制导航 |
| blocked | 正在编辑、工具忙碌或保存失败；保留原页 |
| superseded / expired | 已被更新步骤替代或过期，不再自动执行 |
| unavailable | 展示通道失败；不改变原生产任务的成功/失败状态，不应重提交生成 |

browserOpened 始终为 false，因为此通道不打开浏览器窗口。displayed 是已有页面的地址确认，两者并不矛盾。多个打开的工作台中选择最近活跃的可见页面，一次请求固定到该页，不会让全部标签一起跳转。连续相同步骤去重，当前地址相同时只更新步骤卡，不刷新编辑器。

## 当前地图为什么以前看不到

此前 MCP 可读服务端作品，浏览器草稿并未同步到 MCP，也没有持续的当前页反馈。现在页面摘要包含地址、已发布的编辑条目名称/身份及 dirty/busy 状态，可帮助确认用户说的“这一张”。它不上传地图像素、草稿完整内容或浏览器存储，不把草稿登记为资产。地图制作与场景摆放仍为人工流程；需要完整检查或接入游戏时使用用户导出的源包/Godot 包，或宿主确实提供的只读画面能力。

## 开发与验收

短期握手文件位于 manifest.workspace.presentationDirectory（默认 work/presentation），与任务、素材隔离；活跃页面约 20 秒失效，旧记录定期清理。测试使用 WORKBENCH_TEST_RUN 隔离，不访问正式任务目录，不调用付费模型。

自动检查：npm run test:preview-follow，加 MCP / HTTP / presentation / Agent acceptance 和壳层、lint、typecheck、隔离 build。

WorkBuddy 人工验收：

1. 先打开首页，对它说“展示我已有的一个交互物，不要生成”。应在同一标签进入该作品，而非只贴链接。
2. 说“把它的提示文字改成指定内容并保存，让我看到过程”。应展示该项目，保存后定位到新保存记录，保留项目和物件身份；页面提示已保存而非已导出。
3. 查看已有连续三个候选动画的第 2 个，检查 URL 和播放器确为候选 2；连续查询状态不刷新、不跳回作品库首页。
4. 点暂停跟随后要求查看另一已有作品：仍停在原页，Agent 说明暂停；点继续后再展示。不要为验收额外生成图片。
5. 修改草稿期间切换作品，检查修改先保存。模拟保存失败时应停留并提示；恢复保存后继续。
6. 关闭预览，再让 Agent 查询进度，不应自行新开窗口。已保存资产和浏览器草稿不能混为一谈。

本地自动检查和浏览器模拟不能替代真实 WorkBuddy 宿主验收。

同时修复交互物任务恢复中的原生 fetch 绑定问题，防止已跳到任务地址却仍显示默认物件。验收必须检查编辑器实际项目名称与内容，不能只看步骤卡或地址。

### 本地验证记录（2026-09-09）

通过：test:preview-follow、test:presentation、test:workbench-shell（15 项）、doctor、test:adapters、test:http、test:mcp、test:assets、test:prop-art、test:agent-acceptance（fixture）、test:engineering（引擎跳过）、lint、typecheck、隔离生产构建、两项 Skill validator 和文档链接检查。

独立 Edge 浏览器通过：同一标签进入真实保存的交互物（核对项目名称与实际内容）、三次状态查询不刷新、暂停/继续、保存失败保持原页、手动导航暂停、430px 窄屏不溢出。使用隔离任务及模拟提供方，真实付费调用为 0。宿主浏览器测试连接不可用；真实 WorkBuddy 选择工具及开页行为尚需按上述流程人工验收。
