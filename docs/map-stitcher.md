# 地图拼接编辑器（原 SceneMaker）

主工作台内置的 2D 地图拼接、分层编辑、扩图和游戏引擎资源导出工具。图片默认只停留在当前浏览器内存中；只有主动激活图片 API 时，整体层重叠模板才会经本地 Runtime Bridge 发送给所选官方服务。

## 已实现功能

- PNG / JPG / JFIF / WebP 点击或拖拽导入，单张最大 30 MB
- 中键、右键或平移模式拖动画布；以鼠标位置为中心缩放；一键适配视图
- 4 / 8 / 12 分扩图卡片，横向和纵向重叠比例可独立设置
- 按“上方显示在最前”排列的遮挡层、碰撞层、物体层、地表层；各层可切换可见性和锁定状态
- 地图主界面是唯一的图层控制入口；选择图层后，区域绘制只编辑当前地图块的当前图层
- 单卡片上传、批量顺序填充、隐藏预览、卸载、继续向外扩展
- 四边 0–50% 像素级 Alpha 羽化
- 邻接重叠透明模板下载
- 本地镜像补全、物件提取与黑/白层生成，以及 Nano Banana 2 / GPT Image 2 整体层扩图
- 右下角水印区域的本地邻近像素修复
- 地表、物体和遮挡层使用 FrameRonin ImageFineEditor 工作流直接编辑实际像素：画笔、独立尺寸橡皮、吸色、带容差的超级橡皮擦、框选移动、透明区背景预览、撤销和恢复原图
- 碰撞层使用 FrameRonin ControlTest 工作流：在地图上拖出红色矩形，可选中删除、撤销或清空；碰撞只保存坐标，不保存图片蒙版
- 合成 PNG、带独立地图块图层的 PSD 导出
- 包含图片和全部编辑状态的 ZIP 保存/恢复
- 状态格式 v5 只保存矩形碰撞；加载临时 v4 碰撞蒙版时会自动迁移为矩形
- 兼容加载 FrameRonin v1/v2 状态 ZIP/JSON
- Godot 4 ZIP 导出与 Godot 清单 ZIP 重新加载
- 键盘快捷键：`H` 隐藏卡片、`0` 适配画布、`+/-` 缩放、`Esc` 取消选择

## 本地运行

```bash
npm install
npm run dev
```

浏览器访问 `http://localhost:3000/tools/map-stitcher`。

生产构建：

```bash
npm run build
```

## Agent / MCP 本地拼接

Manifest 中的地图输入以 `operation` 区分两条真实流程。`compose` 接收按行优先排列的 `images`（仓库相对路径或 `data:image` URL），由本地 `map-stitcher` 适配器生成拼接 PNG、接缝报告、Pixelwork v2 状态包、区域清单及可选引擎包，不需要配置外部 URL。

```json
{
  "operation": "compose",
  "images": ["assets/maps/tile_01.png", "assets/maps/tile_02.png"],
  "columns": 2,
  "tileSize": 16,
  "checkSeams": true,
  "engineTargets": ["godot"]
}
```

地图页面还注册读取摘要、调整视图、图片导入、图片层生成、区域批量创建和导出六个 WebMCP 工具。它们复用页面按钮的状态动作，不维护第二套编辑模型。

## 整体层图片 API

“生成与显示设置”已拆成 API 生成、唯一整体层提示词和显示设置三个区域。API 设置对齐 FrameRonin 的 API Key、API 模式、Host、Model 与“激活 API”概念，当前提供两个固定的真实协议：

| API 模式 | Host | Model | 密钥环境变量 |
| --- | --- | --- | --- |
| Nano Banana 2 | `https://generativelanguage.googleapis.com` | `gemini-3.1-flash-image` | `GEMINI_API_KEY` |
| GPT Image 2 | `https://api.openai.com` | `gpt-image-2` | `OPENAI_API_KEY` |

密钥可以在设置窗口输入，仅保存在当前 Runtime Bridge 进程内存；也可以通过环境变量提供。服务端只返回“已配置/未配置”，不会把密钥回传到页面、任务记录或日志。若要通过环境变量自动激活模型，再设置 `MAP_STITCHER_IMAGE_PROVIDER=nano-banana` 或 `gpt-image-2`。

Manifest `generate-layer` 操作只接受 `layer: "overall"`。页面提交的任务输入如下，随后适配器把图片和提示词转换为所选服务的原生请求：

```json
{
  "image": "data:image/png;base64,...",
  "prompt": "（设置窗口中的唯一整体层提示词）",
  "provider": "nano-banana",
  "tile": { "key": "0,-0.85", "x": 0, "y": -0.85, "w": 1, "h": 1 },
  "layer": "overall",
  "mask_mode": "white"
}
```

Nano Banana 2 使用 Google `generateContent` JSON 协议，以 `inline_data` 上传图片并读取响应中的 `inlineData`；GPT Image 2 使用 OpenAI `images/edits` multipart 协议并读取 `b64_json`。成功结果统一规范化为任务目录中的 `generated-layer.png`。地表、黑层、白层与物件层不调用外部 API，继续由现有本地流程派生。

## Godot 使用

将 Godot ZIP 内容复制到 Godot 4 项目目录，打开 `map_stitch_godot.tscn`。地表、物体、遮挡层分别导出为 `z_index` 递增的 `Sprite2D`；碰撞矩形直接导出为 `StaticBody2D` 与 `RectangleShape2D`。
