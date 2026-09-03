# 地图拼接编辑器（原 SceneMaker）

主工作台内置的 2D 地图拼接、分层编辑、扩图和游戏引擎资源导出工具。图片默认只停留在当前浏览器内存中；只有主动启用“外部图片 API”时，重叠模板才会经工作台服务端发送给已配置的 Connector。

## 已实现功能

- PNG / JPG / JFIF / WebP 点击或拖拽导入，单张最大 30 MB
- 中键、右键或平移模式拖动画布；以鼠标位置为中心缩放；一键适配视图
- 4 / 8 / 12 分扩图卡片，横向和纵向重叠比例可独立设置
- 整体层、地表层、物件层，以及可上传、生成、保存和导出的黑层/白层
- 单卡片上传、批量顺序填充、隐藏预览、卸载、继续向外扩展
- 四边 0–50% 像素级 Alpha 羽化
- 邻接重叠透明模板下载
- 本地镜像补全、物件提取与黑/白层生成，以及可配置的外部图片扩图 API
- 右下角水印区域的本地邻近像素修复
- 合成 PNG、带独立地图块图层的 PSD 导出
- 包含图片和全部编辑状态的 ZIP 保存/恢复
- 兼容加载 FrameRonin v1/v2 状态 ZIP/JSON
- Godot 4 ZIP 导出与 Godot 清单 ZIP 重新加载
- Unity ZIP 导出，包含 Point Filter Sprite `.meta`、JSON 清单和自动创建地图对象的 Editor 脚本
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

## 外部扩图 API 协议

在根项目环境中配置 `MAP_STITCHER_API_URL` 和可选的 `MAP_STITCHER_API_TOKEN`。浏览器不会读取这两个值；服务端会按统一 Connector 协议发送：

```json
{
  "taskId": "map-stitcher-1234abcd",
  "capabilityId": "map-stitcher",
  "input": {
    "image": "data:image/png;base64,...",
    "prompt": "保持原图像素风……",
    "tile": { "key": "0,-0.85", "x": 0, "y": -0.85, "w": 1, "h": 1 },
    "layer": "ground",
    "mask_mode": "white"
  }
}
```

服务响应本身或 `result` 中需包含 `image`、`data` 或 `url` 之一。图片值可以是 Data URL、纯 Base64 或可公开读取的 HTTPS URL。令牌只由工作台服务端通过 `Authorization: Bearer <token>` 发送。

## Unity 使用

将 Unity ZIP 解压到项目根目录，等待 Unity 导入完成，再执行：

`Tools → SceneMaker → Create Map From Manifest`

脚本会读取 `Assets/SceneMaker/Data/map_stitch_unity.json` 并按地图坐标创建所有 SpriteRenderer。

## Godot 使用

将 Godot ZIP 内容复制到 Godot 4 项目目录，打开 `map_stitch_godot.tscn`。每个图片块对应一个 `Sprite2D`，采用左上角定位。
