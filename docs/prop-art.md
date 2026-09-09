# 交互物品原图生成

> 当前能力：reference-art / generate / subject=prop。地图制作仍由用户在前端完成。

## 前端流程

进入“场景 → 制作交互物”，选择要编辑的物件，展开右侧“生成物品原图”。输入单个物品的描述，例如“深蓝金属外壳的复古工业电池，黄色指示灯，清晰轮廓”。默认使用 PixelLab Pixflux，输出 128×128、侧视、透明背景 PNG。

PixelLab 设置与角色原图、序列帧共用同一服务和受保护的 Key。已有 Key 自动复用；面板可以保存 Key 或刷新连接，已有 Key 不回显。需要完整工作台服务（`npm run dev`）；`dev:interactable` 不启动 Python，只有已运行 / 配置了 SpritePipeline 时才能生图。导入已有图片、保存交互物和导出仍可不依赖 PixelLab。

每次生成是新的付费请求。等待期间可以离开页面，从制作记录、资产库的“物品原图”或面板中的最近记录恢复；查询只跟踪原任务，断线不自动重新提交。原图不会自动覆盖物件。

预览确认后可下载 PNG，或点击“采用到「物件名称」”。采用时重新读取完成任务、校验图片与结果记录的 SHA-256，然后作为内嵌 PNG 加入项目。它保留项目 / 物件 ID、其他图片、动画帧和交互行为，替换默认图片并清空默认待机 / 聚焦动画选择。状态专用图片仍保持各自配置。若目标项目 / 物件已经删除或默认图在读取期间被更换，采用失败并保留现有内容。

采用后沿用本机草稿自动保存；如需跨机器交接，保存源文件或导出 Godot 包。素材的 `generation.sourceTaskId` 和 `generation.sha256` 会随源文件及源包保留。保存 / 导出发现已登记的生成图片内容变化会拒绝；有意修改图片时，应作为新素材导入，不能继续冒充原始生成结果。

## MCP 使用

先发现 reference-art 的当前 schema。调用示例：

```json
{
  "capabilityId": "reference-art",
  "input": {
    "operation": "generate",
    "subject": "prop",
    "name": "备用电池",
    "prompt": "blue metal battery, yellow indicator light, clear silhouette"
  }
}
```

原始物品提示词最多 1800 字符。服务端附加固定的独立非人物品、侧视、完整轮廓、透明背景、无场景和文字约束；不调用第二个模型、不自动翻译。实际请求描述记录在任务的 `adapter.effectivePrompt` 中。

随后使用 get_task 查询原任务。完成后 get_result 的链接直达 `/tools/interactable-editor?artTask=<task-id>`；它打开该原图预览，不自动把图采用到任意已有物件。list_assets 的 `kind=prop` 用于查找物品原图，角色原图仍是 kind=character。下载 ZIP 包含真实 prop.png。

用户只要图片时，在图片交付处结束。需要完整交互物时，读取真实 PNG 和结果 metadata，将其绑定到原项目中正确物件的 visual.assetId；资产 source 使用实际工作区路径或内嵌 data URL，可附 generation 来源字段，再执行 interactable-editor 的 save-project / export-godot。沿用 projectId / definitionId，不新建同名物件代替原目标。默认图更新不应静默覆盖状态专用图片。

物品图不是角色预设，transfer 会拒绝。生成一张 PNG 也不表示已经配置拾取、开关、动画、碰撞或游戏逻辑。

## 兼容与输出

省略 subject 的旧角色请求继续按 character 执行，角色页记录不混入物品。仍复用已有 `/v1/reference-art/jobs` 网关及 protected settings，不增加服务、依赖或另一份 Key。

成功输出仍为任务目录的 reference.png 与 result.json；result 增加 subject。物品保持独立任务身份，资产 ID 为 reference:<task-id>，其分类和编辑入口按 subject 区分。旧角色元数据没有 subject 也继续兼容。

## 验证

`npm run test:prop-art` 使用模拟网关、隔离任务目录与真实 MCP 协议，检查生成 / 原任务恢复、共享配置、正确分类与 PNG 下载、禁止角色移送、采用的完整性及目标保护、保存与 Godot 包往返、失败及不确定提交不自动重试。该测试不证明真实模型的画面质量，也不产生真实生图费用。

人工验收：

1. 在已有 PixelLab Key 的环境中打开面板，确认自动显示已配置，未生成空任务。
2. 给一个明确物品提交一次生成，查看等待、成功预览和 PNG 下载。
3. 采用到指定物件，确认预览、ID、交互行为及其他物件保持正确。
4. 刷新后检查草稿和生成记录，再保存源文件并导入，检查图像和来源保留。
5. 返回角色原图页，确认物品不出现在角色历史；在资产库用物品原图分类找到并打开同一张图片。
6. 对已有动画 / 状态图的物件，检查默认动画停用与状态专用图片保留符合预期。

最后记录本次采用是否经过真实 PixelLab 验证；没有真实模型调用时，明确记为模拟链路验收。

### 本地验收记录（2026-09-09）

模拟网关下的 MCP 生成、恢复、物品分类、PNG 下载、角色移送隔离、来源哈希与采用保护、保存及 Godot 源包往返已通过。相同像素来自不同生成任务时仍保留独立来源身份。

独立 Edge 无头浏览器通过实际前端执行描述、生成、预览、采用、刷新恢复，确认每次操作仅提交一个模拟生成任务；深浅色与 430px 窄屏已检查，无未处理页面错误。截图与本机报告保存在忽略的 work/prop-art-ui/；它们使用测试图片，不代表真实 PixelLab 画面质量。原图、交互物、工作台、适配器、HTTP、MCP、资产、展示和 Agent 回归，以及 lint、typecheck、构建、两个 Skill 校验均已通过。

本次没有真实 PixelLab 调用，也未做新游戏的 Godot 引擎验收。已运行的 Runtime Bridge 需要重启以加载服务端修改；仅刷新网页不会更新已加载的 Node 适配器。
