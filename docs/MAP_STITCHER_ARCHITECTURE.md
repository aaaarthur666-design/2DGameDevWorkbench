# 地图拼接工具架构（FrameRonin / Pixelwork v2 模式）

## 实施结论

当前主入口 `/tools/map-stitcher` 已采用模块化重建，不再把图片画笔伪装成“区域绘制”。旧实现保留在 `/tools/map-stitcher-legacy`，用于回退和迁移核对。

公开 FrameRonin 仓库中的地图组件是较早的单层实现；线上 V4.3 的高级图层与区域逻辑只存在于压缩后的浏览器构建中，且没有 source map。因此本项目采用可测试的 clean-room 行为重建：对齐线上可观察的数据结构、快捷键和导出语义，但不复制压缩实现。

## 模块边界

| 模块 | 职责 |
| --- | --- |
| `frame-ronin-types.ts` | 图片层、显示层、区域层、Pixelwork v2 状态契约 |
| `frame-ronin-geometry.ts` | 4 / 8 / 12 方位扩展、地图边界、卡片像素尺寸 |
| `region-engine.ts` | 矩形、多边形、自由路径的验证、命中测试、坐标迁移 |
| `layer-engine.ts` | 黑白底抠图、派生 Mask、遮挡扣除、Top 裁图、拼接渲染 |
| `state-package.ts` | Pixelwork v2 ZIP 读写、SceneMaker v5 迁移 |
| `engine-export.ts` | Godot 图片、区域清单和运行时辅助代码 |
| `psd-export.ts` | FrameRonin 图层语义的分层 PSD |
| `region-drawing-overlay.tsx` | SVG 区域绘制交互；不修改底层图片 |
| `frame-ronin-map-editor.tsx` | 页面状态、工具栏、图层与区域操作的薄编排层 |
| `lib/workbench/adapters/map-stitcher.mjs` | Agent 的本地 compose、接缝检查、状态包和引擎包输出；外部扩图协议翻译 |
| `scripts/workbench-http.mjs` | 仅监听回环地址，让 Worker 网页读取 Node runtime 的共享任务和产物 |

## 图片图层

可编辑图片层为：

- `overall`：导入或扩展得到的完整画面。
- `surface`：地表。
- `object`：透明物件层，可由黑白底参考恢复。
- `black` / `white`：物件提取的黑白底参考。

`mask` 是只读显示层，由 `overall alpha × object alpha` 派生。遮挡区域会用 `destination-out` 同时扣除 `object` 和 `mask`，所以预览与引擎导出共用同一合成规则。

像素精修是单独工具，只修改当前图片层。它与 SVG 区域标注没有共享写入路径。

## 矢量区域

四类区域均支持矩形、多边形和自由绘制：

- `occlusion`：从 object / mask 扣除。
- `collision`：导出为引擎碰撞多边形。
- `adjust`：作为运行时可调区域写入 `regions.json`。
- `top`：从 overall 裁出独立顶层图，Godot 中使用更高 `z_index`。

区域点使用“卡片本地像素坐标”。矩形按照线上状态格式只保存起点和终点两个点；渲染、命中测试和引擎导出时才展开为四角。多边形按 `C` 或 `Enter` 闭合，自由绘制使用指针轨迹。`Ctrl+Z` 撤销最近一次区域变更。

## 状态兼容

保存格式是 `pixelwork-map-stitch-state` v2 ZIP，内部清单为 `map_stitch_state.json`。关键兼容点：

- `tiles` 是以卡片 key 为键的几何对象。
- `tileUploads` 保存非中心卡片的 overall 图片。
- `tileLayerUploads` 使用“图层 -> 卡片 -> 图片引用”的结构，并为兼容线上状态缓存派生 mask。
- `drawShapes` 使用线上字段：`id`、`tileKey`、`mapLayer`、`layer`、`mode`、`points`。

加载器同时接受 Pixelwork v1/v2 和本项目旧 SceneMaker v5：

| SceneMaker v5 | 新模型 |
| --- | --- |
| `ground` | `surface`，并参与 overall 合成 |
| `object` | `object`，并参与 overall 合成 |
| `foreground` | 烘焙进 overall；不伪造无法推断的 top 区域 |
| `black` / `white` | 同名层 |
| 归一化碰撞矩形 | 像素坐标 `collision` 矩形区域 |

迁移若遇到 foreground 会给出明确警告。

## 导出

- 当前层 PNG：使用与预览相同的羽化和遮挡逻辑。
- Top PNG：只保留 top 区域裁出的画面。
- PSD：保存 overall、surface、object、mask、top、black、white 中实际存在的层；默认只显示 overall，避免重复合成。
- Godot：PNG、`map_scene.tscn`、`regions.json`、区域读取脚本和项目配置。

外部图像生成仍只经过 `/api/workbench/map-stitcher/generate` 服务端代理，并以网页同款 `image/prompt/tile/layer/mask_mode` 直接请求服务。连接器地址和令牌不进入客户端状态、日志或导出文件。

Agent 的 `compose` 操作不依赖浏览器或外部 URL。它通过 Manifest 选择本地适配器，产物落到任务专属的 `outputs/<task-id>/`。地图页面另有六个 WebMCP 工具，分别完成摘要、视图、导入、生成、区域创建和导出；这些工具调用与可见按钮相同的状态函数。

## 验证

核心回归命令：

```text
npm run test:map-stitcher
npm run test:adapters
npm run test:http
npm run workbench -- doctor --json
npm run test:mcp
npm run lint
npm run build
```

单元测试覆盖线上矩形状态格式、区域命中与坐标迁移、扩展几何、黑白底抠图、Pixelwork 清单解析和引擎世界坐标。浏览器冒烟测试覆盖图片导入、矩形碰撞绘制、撤销、图层流水线、派生 Mask、状态保存、PSD 与 Godot 导出。

## 有意保留的边界

- 本地生成是确定性回退：可完成扩展、参考层和整个数据流验证；整体层语义扩图可激活 Nano Banana 2 或 GPT Image 2，其他图层仍由本地流程派生。
- `adjust` 会完整导出为区域元数据，但其游戏内行为由具体项目决定。
- 旧编辑器暂不删除；在用户现有状态文件完成迁移验收前保留回退路径。
