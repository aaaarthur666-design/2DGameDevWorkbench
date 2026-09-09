# 关卡雨幕与雷电

2026-09-09：按用户要求，为当前关卡加入清晰、轻薄的雨滴与屏幕雷电闪光。

## 挂载与职责

- [LevelRoot](../LevelModule/level_root.gd) 在完成场景、玩家和交互桥挂载后，创建一个 [RainStorm](../LevelModule/weather/RainStorm.tscn)。重开时随整关释放和重建，无 Autoload、外部服务或新增素材依赖。
- `RainStorm` 是 `CanvasLayer(layer=20)`；世界在默认层，对话在 50 层。全屏 ColorRect 使用全锚点和 `MOUSE_FILTER_IGNORE`，不接管键鼠输入。
- 叠加[人物聚光遮罩](character-focus.md)后，30 层遮罩会将圆外的雨幕和闪屏一起压暗；雨滴分布及雷电时序仍由天气独立管理。
- [控制脚本](../LevelModule/weather/rain_storm.gd) 管理局部时间、随机雷电间隔及闪光包络；每个实例的 ShaderMaterial 独立。雨幕继承场景暂停状态，不使用不会随暂停停止的 shader 内置 `TIME`。
- 雨滴在世界空间采样：绘制前将全屏 ColorRect 的位置经当前视口逆变换映射回世界，镜头移动只改变看见哪片雨幕。雨滴下落由天气自身计时驱动，不读取玩家位置或速度；雷电仍作为全屏闪光呈现。
- [着色器](../LevelModule/weather/rain_storm.gdshader) 使用 `canvas_item`、`unshaded`、`blend_premul_alpha`。最终输出的 RGB 已乘透明度；不读取屏幕纹理、不需要 BackBufferCopy，也不使用 3D shader 的输出变量。

## 视觉与调节

雨幕固定在世界空间。两层细雨以不同速度斜向下落，带淡尾、亮头和导数抗锯齿。前景使用低频噪声形成成簇的密集区与留白区；各行水平错位，雨滴纵向位置随机，并独立变化长度、宽度和透明度。相邻行一同采样，避免长雨滴经过网格边缘时被截断。密度按每颗雨滴的位置确定，并随雨滴运动，避免雨滴自身亮度闪变。

尺寸按世界像素计算，镜头缩放时雨滴与场景同步缩放，窗口等比拉伸不改变世界尺寸。远层长度约 4–8 px、宽度基准 0.45 px；近层长度约 5.5–19 px、宽度约 0.45–0.88 px。

在 Godot 中打开 `RainStorm.tscn`，选择根节点即可调整并保存以下参数：

| 参数 | 默认值 | 效果 |
| --- | --- | --- |
| `rain_density` | 0.62 | 雨滴出现比例 |
| `rain_opacity` | 0.62 | 雨滴透明度上限，尾部及远层更淡 |
| `rain_speed` | 1.0 | 相对于远层 125、近层 220 世界 px/s 的速度倍率 |
| `wind_slant` | 0.16 | 向右倾斜；负数向左 |
| `lightning_enabled` | true | 开关闪光，不影响下雨 |
| `lightning_strength` | 0.52 | 雷电峰值；每次再乘 0.85–1.0 随机强度 |
| `lightning_interval` | (7, 14) 秒 | 上一次闪光结束后的随机间隔 |

首次闪光在进入关卡约 3.5–6 秒后出现。单次包络持续 0.85 秒：短前闪、间隙、主闪、柔和余光；主闪约在 0.145–0.20 秒，并于 0.36 秒前退去。顶部提亮较强，底部保留顶部 78% 的强度，短促闪光中仍能看见场景纹理。静态夜色覆盖仅 4.5%。颜色和夜色覆盖参数位于 ColorRect 的 ShaderMaterial 中。

这是画面气氛层，未加入雷声音频、实体闪电形状、雨滴碰撞或积水模拟。导出地图、角色动画和游戏规则沿用原有内容。

## 初版验证（2026-09-09）

引擎实际版本：`4.7.2.stable.official.ed1daf0bf`。在临时目录的工程副本执行，避免改写正在使用的工程缓存。图形验证采用 Apple M4 / OpenGL Compatibility 渲染器。

- 隔离导入完成；沙箱下出现系统证书读取和全局编辑器设置写入提示，后续图形运行未出现脚本或着色器编译错误。
- 新增 [weather.gd](../tests/weather.gd)：13 项无头行为检查通过，覆盖输入穿透配置、图层、独立材质、雷电强度/间隔/关闭、暂停、重开。
- 同一测试在真实 GPU 下执行，包含无雨、下雨、雷电、后续雨帧及变更宽高比的截图，共 25 项检查通过。截图确认雨幕覆盖完整、雨线清楚、闪光保留场景细节。
- 原有 `tests/headless_smoke.gd`：73 项全部通过。
- 真实渲染录制 7 秒、60 FPS 预览。预览只在隔离脚本中将首闪设为约 2.5 秒，便于展示；正式关卡使用上述随机默认值。
- 验证日志、画面和视频保存在仓库忽略目录 `work/verification/the-last-light-weather-20260909/`；没有执行发布打包或全游戏人工验收。

## 分布与闪屏调整（2026-09-09，第二版）

- 用户要求前景雨滴分布更加不均匀、错落有致，并增强闪屏。前景从均匀网格抖动改为噪声成簇、行错位与全行高度随机位置，增强雨滴长短和明暗差异。
- 闪屏峰值由 0.28 提高到 0.52，下部强度系数从 0.60 提高到 0.78；前闪和余光增强，主闪高亮段稍延长。闪光间隔沿用初版。
- 同一 Godot 4.7.2 / Apple M4 Compatibility 环境，在新的隔离副本执行真实 GPU 渲染和天气检查，25 项全部通过。核看普通雨幕、后续雨帧、增强闪光及缩放画面；没有脚本或 shader 编译错误。
- 第二版验证和 7 秒预览保存在 `work/verification/the-last-light-weather-20260909-v2/`。初版的 73 项玩法冒烟结果保留为历史证据，本轮没有更改玩法和关卡挂载逻辑。

复核命令（在已导入的隔离工程根目录运行，将 `GODOT_47_BIN` 指向实际 4.7.x 可执行文件）：

```sh
"$GODOT_47_BIN" --headless --path . --script res://tests/weather.gd
"$GODOT_47_BIN" --headless --path . --script res://tests/headless_smoke.gd
"$GODOT_47_BIN" --path . --rendering-method gl_compatibility --script res://tests/weather.gd -- --capture-dir=/absolute/path/to/captures
```

语法核对依据：[CanvasItem shader 参考](https://docs.godotengine.org/en/latest/tutorials/shaders/shader_reference/canvas_item_shader.html)、[Godot 着色语言规则](https://docs.godotengine.org/en/latest/tutorials/shaders/shader_reference/shading_language.html)、[CanvasLayer](https://docs.godotengine.org/en/latest/classes/class_canvaslayer.html)。文档为 latest，实际兼容性以上述本机 4.7.2 渲染结果为准。

## 世界空间雨幕与加强遮罩（2026-09-09）

雨滴由屏幕坐标采样改为世界坐标采样，聚光圈外亮度由 42% 降为 20%，边缘柔化比例由 0.12 收紧至 0.10。仅进行一次简短的 Godot 4.7.2 / OpenGL 渲染检查：冻结天气时间后横移镜头 100 世界像素，雨滴画面对应平移 522 输出像素，平移对齐后采样差为 0，确认雨幕保持世界位置。已查看加强遮罩后的实际截图；未重跑完整测试。证据位于 `work/verification/the-last-light-world-rain-20260909/`（工作台根目录）。
