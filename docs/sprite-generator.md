# 序列帧生成工作区

> 状态：当前维护。机器契约以 `workbench/manifest.json` 中的 `sprite-generator` 为准。

项目把 `NativeFramesGeneration` 的完整本地工作台保存在 `Tools/SpritePipeline/`，并通过 `/tools/sprite-generator` 接入统一导航。上游来源为 `https://github.com/flxBurnOut/NativeFramesGeneration.git`，当前同步基线为提交 `e4df6f2de215f01db2e28ce1e175894186bb44f8`（2026-09-05，逐帧修补流程与操作界面更新），并保留工作台任务跳转、当前任务同步及帧图 / 导出产物下载接口。

当前集成包含原始资产与恢复记录校验、QA 算法版本门禁、修补前后问题差异、五状态逐帧时间线、问题帧导航，以及多标签页草稿的三方像素冲突合并。外部替换要求选择帧时捕获的 SHA-256，避免覆盖更晚版本。

## 原图参考入口

`/tools/reference-art` 可用 PixelLab 生成 128×128 透明角色图，并与本工具共用一次保存的 Key。点击“用于制作序列帧”后，创建可复用角色并在生成页预选参考图、名称和外观提示词；不会创建或提交动画任务。详见 [角色原图](reference-art.md)。

## PixelLab Key 的保存与恢复

Key 保存于当前数据目录的 `config/credentials.json`，Windows 使用当前用户的 DPAPI 加密；关闭页面或重启服务后自动读取，输入框留空不代表 Key 丢失。工作台默认数据目录为 `work/sprite-pipeline`。

工作台启动入口会在该凭据文件尚不存在时，从早期独立版的系统用户数据目录导入已有 PixelLab Key（Windows 默认 `%LOCALAPPDATA%/SpritePipeline/config`）。导入后保存到工作台目录；已有配置和主动清除留下的记录不会被覆盖，便携模式不会导入。原图与序列帧继续共用同一服务的配置。

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

嵌入界面采用上游的七页布局：开始、1 · 生成、2 · 播放检查、3 · 逐帧修补、4 · 导出，以及独立的资产库、设置。生成服务使用 PixelLab Animate with Text V3；像素级手工修补、已有 Sheet 导入与离线诊断不依赖收费生成。

手工像素修补可直接编辑未锁定、未导出的候选帧，无需先逐帧标记待修补；保存仍校验原版本 SHA-256、使该帧旧审核失效并重新执行 QA。外部整帧替换仍须先标记待修补。修补页支持采用当前帧并继续、处理完后返回整段播放确认；洋葱皮默认关闭，橡皮擦模式暂时隐藏洋葱皮以显示真实透明区域。内置地面攻击预设明确限定为一次纵向劈砍。

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

## 旧版资产恢复与任务栏

工作台把序列帧任务保存在项目的 `work/sprite-pipeline/jobs`，角色参考保存在 `work/sprite-pipeline/characters`。独立版默认使用 Windows 用户目录 `%LOCALAPPDATA%/SpritePipeline`。两个目录不同会造成旧任务没有出现在工作台列表中，不能仅凭列表数量判断文件已丢失。

工作台启动器默认启用 `SPRITE_PIPELINE_IMPORT_USER_ASSETS=1`：首次发现旧版的真实任务与角色参考时，校验并复制到项目目录。原目录保持不动；已有同名数据不覆盖，冲突副本放入 `work/sprite-pipeline/recovery`。导入结果记录在 `work/sprite-pipeline/config/user_library_import.json`。这是逐项的一次性导入：重复启动不会重复导入，删除已导入资产后不会从旧目录重新复活；后续仍在独立版修改同一个任务时不会双向同步。生成中的任务暂缓，fixture 流程测试不导入。设置该变量为 `0` 可关闭，显式 portable/test 根目录也不导入用户资产。

工具上方的上下文栏显示当前位置、当前任务和实际状态；“制作记录”按钮打开已有记录，可从具体作品继续。生成、播放检查、修补和导出使用序列帧工具自己的标签页，上下文栏不再展示无法操作的三步条。

验收时刷新页面，打开序列帧“资产库”，点击刷新后选择旧任务，再点“打开所选任务”，检查动画和逐帧图片。任务可能包含多个候选，任务数量不同于图片或候选数量。再点上方“制作记录”，确认可打开记录并返回对应作品。

## 攻击默认检查与有限补做

地面攻击（`attack`）和空中攻击（`attack_in_air`）的非循环生成默认启用：先生成完整动作，再由所选视觉服务检查判断提前挥刀、武器翻向、重复蓄力、额外挥刀及身体连续性。无需选择额外模式或上传关键姿势。

在设置中选择视觉检查服务并保存 **视觉检查 API Key**。默认使用 TokenHub 的混元 `hy-vision-2.0-instruct`，可复用服务端 `TOKENHUB_API_KEY`；如果 Key 仅保存在地图页面的运行时进程，请在视觉设置中再保存一次。也可选择 OpenAI `gpt-5.4-2026-03-05`，使用独立的 `OPENAI_API_KEY` 或本机保存的密钥。两家密钥分别存于受保护存储，不互相覆盖；不会在检查失败时自动切换提供方。图片发送至所选服务，按 API 用量另行计费。未配置时不提交新的攻击生成，低置信度、超时、截断或无有效结论均停止自动补做。

每个任务（多个候选共用）最多额外生成 **两次**，每次编辑包含邻帧的 4 帧短段，仅将问题帧放回完整动画复检。只有结论改善且本机检查无阻止问题，才自动采用。原始帧与未采用候选保留。检查请求最多为候选数加两次，不会自动重试结果未知的付费请求。次数记录先持久化，刷新与重启不会清零；旧任务不会自动触发新增费用。

达到上限仍有问题时，保留较好版本并标记至 **3 · 逐帧修补**。其中的 **AI 修补当前问题帧** 可生成、刷新和预览，再由用户明确采用；每帧最多手动请求两次，与自动阶段分别计数。采用时检查基础版本，防止覆盖补做期间的新修改。手工像素修补和上传替换继续可用。

旧 `/attack-plans` 接口及记录保留兼容，但复杂的方案面板已经从生成页移除。内部补做子任务只作为执行记录，不列入作品库。

视觉检查按候选的实际帧数工作，支持 1–64 帧；17 帧等结果全部按原顺序发送，不截断到 16 帧。非标准帧数按可见动作判断阶段边界，问题帧号不得越界。单帧无法证明连续性，因此不能判为通过。局部补做仍提交四个上下文槽位，少于四帧时只对上下文补齐，采用时保留原动画长度、原始帧和全部非目标帧。整个任务的自动补做上限仍为两次，不因帧数、刷新或重启而重置。

播放检查和逐帧修补明确区分本机基础检查与视觉检查状态。对于旧版本因非 16 帧而在发送前停止的任务，可在“播放检查”选中动画后点击“继续视觉检查”，或调用 `POST /jobs/{job_id}/motion-review/resume`。这会复用已有帧并排队检查，视觉请求及有限补做按用量计费。已发送但结果未知的请求不会借此重发；已完成的视觉检查不会重置补做预算。旧任务不会仅因更新程序而自动收费。
