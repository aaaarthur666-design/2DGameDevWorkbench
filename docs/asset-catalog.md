# 阶段二：资产目录与交接清单

MCP 0.8.0 增加三个只读工具，前端入口为“资产库”。资产与执行任务分开：查询不会 prepare/run，不会调用生图或检查模型，也不会修改源文件。游戏架构设计和脚本编写由[第三阶段工程 Skill](game-engineering.md)承接。

## 资产来源与身份

- 扫描 manifest 配置的全部任务记录，不局限于最近 200 条；只纳入有已登记产物的记录。纯准备记录、空任务和明确的 fixture 诊断任务不算资产。
- 从 SpritePipeline 的 `/v1/artworks` 读取原生作品库。角色 preset、每个有画面的动画候选、原生作品库已导入地图分别有稳定 ID。
- 角色原图生成与 transfer 用明确的 sourceTaskId / characterId 关系合并展示；不同角色或独立生成不会因为像素相同被擅自合并。
- 动画 ID 为 `animation:<jobId>:<candidateIndex>`。创建、查询、检查和导出同一候选的多条任务不会增加资产数。旧的本地产物快照与当前原生资产区分标注。
- 交互物以 projectId + definitionId 标识。完整保存更新当前对象集合；导出部分对象不删除其余对象。重新保存后不把旧导出包声称为当前版本。
- 服务端地图原图、扩图和拼接产物可以盘点；地图 MCP 自动制作仍不开放。
- 完整场景读取 manifest 的 `workspace.sceneExportDirectory`（默认 `work/scene-exports/`）。每次成功导出以 `scene:<exportId>` 单独收录，保留 sceneId、sceneRevision 和导出时间；不同导出不会相互覆盖。新记录保存名称与素材/实例数量，旧记录从已有 `scene-source.zip` 读取这些信息。场景导出不是生产任务。

归档只隐藏执行历史，不删除或隐藏资产。任务扫描忽略 `.archived.json` 等内部索引；原生作品库读取包含已归档作业的完整素材记录。动画快照保留原始作业创建时间（旧数据缺少时采用最早关联任务时间），交互物重新保存保留首次创建时间及来源任务。详情中的 `history` 可追溯已归档的制作/导出记录；当前下载只提供当前版本文件，不夹带旧导出包。

浏览器 IndexedDB 草稿、浏览器下载和外部游戏目录没有自动扫描。仅在浏览器中保存的地图、场景与交互物需回原工具查看；不能把当前目录无匹配说成所有资产都不存在。浏览器交互物通过已有 save-project 保存到 runtime 后可被收录。

## 工具与共享接口

三个工具的输入校验由 [asset-contract.mjs](../lib/workbench/asset-contract.mjs) 共享。MCP、CLI `agent` 命令与 HTTP `POST /v1/agent/<operation>` 调用同一处理器。

| MCP | CLI / HTTP operation | 输入 |
| --- | --- | --- |
| workbench_list_assets | assets | query、kind、characterId、actionId、candidateCount、candidateIndex、status、availability、sortBy、limit、offset、snapshot，均可选 |
| workbench_get_asset | asset | assetId |
| workbench_get_asset_manifest | asset-manifest | assetIds，1–100 个；projectName 可选 |

kind 为 character / animation / map / interactable / scene。sortBy 为 createdAt（默认）或 updatedAt；原生素材没有创建时间时保留未知，不把最近打开时间伪装成生成时间。limit 默认为 24，最高 100。返回 nextOffset 不为空时继续分页，并带回 snapshot；目录变化时从第一页重新查询，避免重复或漏项。

`query` 是名称关键词。让 Agent 将“最新一组三个候选中的第二个”映射为 candidateCount=3、candidateIndex=2、kind=animation、sortBy=createdAt、limit=1；不要把整句指令作为关键词搜索。

get_asset 返回尺寸、朝向/帧率（来源提供时）、文件存在性、SHA-256、版本指纹、来源任务和精确预览/编辑链接。清单保留所选资产与文件校验值；修改文件后重新盘点会产生不同 revision。文件存在不等于通过动作审查或游戏引擎验证。

get_asset_manifest 返回 `manifest` 和 `markdown`，供 Agent 交接，不会写任务、复制文件或改动游戏工程。Agent 可在用户指定的位置保存返回内容，不能自动覆盖项目已有资产。

前端“下载所选素材”和详情页“下载素材（ZIP）”调用 `POST /api/workbench/assets/download`，由共享资产目录打包真实素材，再通过 `POST /v1/assets/download` 返回 `forge-assets.zip`。每件素材有独立文件夹：原图和地图提供图片，动画提供按顺序命名的 PNG 帧、已有 GIF、精灵图和 Godot SpriteFrames ZIP；交互物提供可重新打开的源工程及已有 Godot 包；完整场景提供原字节的 `scene-source.zip` 和 `scene-godot.zip`。将场景源包导入场景组装器可继续编辑。包内附可读的尺寸、帧率和当前状态说明，不以描述清单替代素材。

下载仅复制登记的当前文件字节到响应，不创建任务或重新执行审核、生成、引擎导出。未审核动画可以下载当前帧，审核状态保持原样。尚未导出的交互物只有源工程，不承诺已有引擎包。按来源及候选分别命名，避免同名覆盖；缺失文件或打包期间内容变化时明确报错。每次最多 100 件、普通素材源文件总量最多 128 MB；包含完整场景时总量上限为 768 MB，场景单文件上限为 512 MB。超过时分批下载。

## 执行历史分页

`workbench_list_tasks` / `agent tasks` 在全部未归档任务中搜索，再分页，不局限于最近 200 条。输入新增 offset、snapshot；每页 limit 上限仍为 200，返回 totalTasks、totalNativeJobs、searchedTasks、nextOffset、snapshot。两个来源各自按相同 offset 分页；nextOffset 为 null 才表示都已读完。目录变动时从第一页重新查询。

Web 的 `/api/workbench/tasks` 代理 `/v1/tasks`，支持相同的本地任务搜索和分页，返回 tasks、total、nextOffset、snapshot。工作台会读完各页后更新制作历史与本地搜索，不以首屏替代全量。归档后的具体记录仍可由资产详情链接读取，不重新加入历史列表。

## 前端与可用性

- [资产库](../components/workbench/asset-library.tsx) 提供类型/名称过滤、分页、勾选素材下载和单件详情。
- 点击动画原工具入口沿用阶段一的精确 job / candidate 跳转和自动展开详情。
- 文件缺失保留记录和提示；服务离线返回本地可读记录，并标注 coverage 不完整。浏览器草稿范围始终明确展示。
- 预览只通过真实资产 ID 定位登记文件，不能传任意路径读取文件；凭据不进入资产元数据、清单或前端。

## 阶段二专项验收

阶段一验收“找到作品并正确展示”；阶段二验收“把已有素材查全、分清版本、整理并交付”。候选跳转、自动打开前端、预览复用和提问工具继续作为开发回归检查，不再要求用户重复验收。

使用现有素材即可，无需重新生成、修改原件或手动阅读 JSON。以下四项只需验收一次；无相应素材的项目标记“不适用”，不要为了测试临时生成。

| 验收项 | 你做什么 / 对 WorkBuddy 说什么 | 通过条件 |
| --- | --- | --- |
| 1. 资产盘点是否完整 | “把已经保存的素材按角色原图、动画、地图、交互物盘点，统计每类数量和待处理项，不要生成。”对照资产库，并抽查一件自己记得的较早作品。 | 数量对应已保存素材，分类之和与同一范围的总数一致；有分页时读取全部页，能找到较早作品。未纳入目录的浏览器草稿应明确说明；不能把任务数当资产数，也不能把首屏当全部。 |
| 2. 版本与重复记录是否分清 | “把已有同名动作按制作批次整理，告诉我每批有几个候选，哪些是不同版本。”挑一个已有多个候选的批次核对。 | 同一批次的不同候选分别保留；同一候选的查询、检查、导出记录不增加素材数。名称相同的独立制作仍保留，不能仅凭同名合并。只有一个候选时如实说明。 |
| 3. 下载包能否实际使用 | 在资产库勾选一张原图及两个动画版本，点击“下载所选素材”，解压到一个新文件夹。 | 收到一个 ZIP，三件素材分别存放；图片能打开、已有 GIF 能播放、动画 PNG 帧数与所选作品一致，没有同名覆盖。已有精灵图或引擎包一并提供；尚未导出的作品不冒称已经有引擎包。不能仅下载描述 JSON。 |
| 4. 能否交给后续开发 | “用刚才这几件素材整理一份给开发使用的交接说明：尺寸、帧数、帧率、有哪些文件、还缺什么。先别写代码，也不要补生成。” | Agent 依据所选资产及文件证据，给出简明可读的素材表；未知信息标明未知，待修补、待检查、尚未导出分别说明。用户无需读原始 JSON；不能把‘文件存在’说成‘已通过质量或游戏引擎验收’。 |

验收反馈只需按“第几项 / 实际出现什么 / 预期是什么”描述，例如：“第 3 项，选了两版动画，解压只有一版的帧。”

### 开发者负责的回归

- `npm run test:assets` 和 SpritePipeline `tests/test_asset_catalog.py`：超过 200 条记录的扫描、分页、来源去重、对象版本、精确候选、文件校验、缺失/越界与离线范围。素材 ZIP 回归覆盖真实字节、候选隔离、下载错误和 HTTP 二进制响应。
- manifest / HTTP / MCP / Agent acceptance、前端 shell、lint、typecheck、build 按改动范围执行。下载与只读盘点不新增制作任务、不修改源文件，使用文件校验与隔离测试确认。
- 阶段一已验收的候选详情跳转继续回归；它通过只证明旧功能未退化，不能代替上述阶段二新增能力的验收。
- JSON 交接结构、哈希、异常输入等技术细节由开发者验证，不作为普通用户必做的手动步骤。WorkBuddy 对盘点、分组和交接说明的实际处理仍需以上四项宿主验收。

## 阶段二初版验收记录（2026-09-08，素材 ZIP 改动前）

- 新连接的 MCP server 为 0.8.0；三个新增工具的 readOnlyHint 均为 true。真实目录返回 25 件资产（4 件角色原图、21 个动画候选），分页无重复。这是当次服务端快照，不包括浏览器草稿。
- 隔离浏览器实际完成资产库翻页、类型/名称筛选、两件资产的 JSON 下载、候选详情与原工具跳转；原工具选中候选 B，页面无脚本错误或失败请求。
- 验收前后 1,203 个已跟踪文件的哈希保持一致；正式任务仍为 10 条、原生作业仍为 19 个。没有新建制作任务，没有调用付费生成。
- test:assets、doctor、adapters、HTTP、MCP、Agent acceptance、workbench-shell、lint、typecheck、build 通过；相关 Python 用例 27 项通过；Skill 校验通过。
- 协议和页面验收已经完成；WorkBuddy 的自然语言选择与宿主预览仍按上述步骤由使用者手动验收。重连 MCP 后才能发现新增工具。

## 素材下载改进验收（2026-09-08）

前端下载已改为真实 ZIP，JSON 交接工具继续供 Agent 使用。隔离浏览器实际勾选两个动画，收到一个 ZIP，解压得到两个作品文件夹、32 张 PNG 帧和 2 个 GIF；全部帧图逐个校验为源文件原字节。详情页单件原图下载也通过。模拟文件缺失时显示错误，没有下载 JSON 或残缺 ZIP。打包前后检查的 1,203 个文件无变化，正式任务没有增加。

自动化补充混合原图、动画、地图和交互物源工程打包，来源别名去重、候选隔离、路径越界拒绝、缺失文件、打包期间字节变化和 HTTP 二进制下载回归。
