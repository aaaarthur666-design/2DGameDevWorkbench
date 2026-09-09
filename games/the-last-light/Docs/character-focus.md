# 人物跟随聚光遮罩

2026-09-09：当前关卡使用跟随人物的径向聚光渐变。中心保持明亮，原圆框范围内轻微衰减，圈外更快变暗，无描边。

## 效果与尺寸

- 圆心对齐人物身体中部。使用 idle 第 0 帧的实际透明区域测量人物高度，并缓存结果，避免动画切换时圆圈忽大忽小或偏移。
- 当前原帧可见高度 56 px，Sprite 缩放 1.5，世界高度为 84 px；圆直径为其 3 倍，即 252 世界 px。Camera2D 当前缩放为 1.2，圆直径为 302.4 逻辑视口 px，占 360 px 视口高度的 84%。
- 原圆框半径 R 作为轻微衰减的参考范围，不再作为窄边界：中心保留 100% 亮度，0.5R 约 99%，R 处 88%；圈外 1.5R 约 53%、2R 约 18%，远处渐近 8%。全程连续、单调，圈内变化缓、圈外变化陡。
- 圆圈会随镜头缩放一起改变尺寸，始终保持与人物的比例；窗口尺寸变化时仍为圆形。
- 收齐两块电池并成功操作开关后，圆形亮区以玩家为中心向外扩散，默认 1.6 秒后覆盖整个视口并隐藏遮罩。扩散期间继续跟随玩家；本局后续切换开关不恢复遮罩，重开关卡恢复初始聚光。
- 镜头共用扩散动画的同一进度，从初始 1.2 拉远至当前地图允许的最小缩放（目前约 0.4167）。保持画面铺满，允许纵向裁切，具体边界规则与验证见[窗口与镜头记录](view-boundary-adjustment.md)。

## 实现与接入

[CharacterFocus.tscn](../LevelModule/presentation/CharacterFocus.tscn) 由 [LevelRoot](../LevelModule/level_root.gd) 创建并绑定本局玩家。`CanvasLayer.layer=30`，位于世界与雨幕上方、对话的 50 层下方；场景、雨滴与雷电按相同径向渐变压暗，对话正常显示。全屏 ColorRect 使用 `MOUSE_FILTER_IGNORE`。

[character_focus.gdshader](../LevelModule/presentation/character_focus.gdshader) 使用 `canvas_item`、`unshaded`、`blend_mix`。它以逻辑像素计算到圆心的距离，并以 `max_darkness × (1 - exp(-coefficient × ratio^falloff_power))` 输出黑色遮罩透明度。系数由 `inner_darkness` 反算，使原半径处恰好达到指定的轻微暗度；默认四次方使内部平缓、外部明显加深。不采样屏幕纹理，无额外贴图依赖。

[character_focus.gd](../LevelModule/presentation/character_focus.gd) 通过玩家 Sprite 的 `get_global_transform_with_canvas()`，再转入遮罩局部坐标，以包含当前镜头平移、缩放和边界限制。在 `RenderingServer.frame_pre_draw` 更新 uniform，避免早于镜头更新导致跟随滞后。失去玩家引用时隐藏遮罩；退出关卡时解除绘制信号，重开后绑定新玩家。

[InteractionBridge](../LevelModule/interaction_bridge.gd) 仅在实际开关 `toggled` 被本局状态接受后发出 `line_switch_used`，由 LevelRoot 连接至 `expand_and_dismiss()`。退场使用绑定到遮罩节点的 Tween，以二次缓入缓出推进圆半径；渐变整体向外推移，形成不断扩大的完全明亮区域 `reveal_radius`。覆盖目标包含最远视口角及完整渐变半径，保证隐藏遮罩前所有角落均已完全明亮。扩散半径不回缩；重复调用不重启动画，节点释放时 Tween 随之清理。

`dismissal_progressed` 将同一个 Tween 进度交给关卡的 `MapRevealCamera` 调整相机缩放；相机先更新投影，遮罩在绘制前使用最新坐标继续对齐玩家。两者同时完成，重复触发不会创建第二段镜头动画。

在 Godot 打开 `CharacterFocus.tscn` 并选择根节点，可调整：

| 参数 | 默认值 | 用途 |
| --- | --- | --- |
| `diameter_in_character_heights` | 3.0 | 轻微渐变参考范围的直径，相对人物可见高度的倍数 |
| `outside_brightness` | 0.08 | 远处渐近的亮度比例，越小越暗 |
| `inner_darkness` | 0.12 | 原圆框半径处的变暗比例 |
| `falloff_power` | 4.0 | 非线性衰减指数，越大则圈内越平缓、圈外越陡 |
| `dismissal_seconds` | 1.6 | 开关成功交互后圆形亮区向外扩散的秒数 |
| `effect_enabled` | true | 启用/关闭遮罩 |

## 初版遮罩验证

在隔离工程副本使用 Godot `4.7.2.stable.official.ed1daf0bf`、Apple M4 / OpenGL Compatibility 实际运行：

- [character_focus.gd 测试](../tests/character_focus.gd) 检查真实 alpha 高度、三倍直径、身体中心、移动、镜头缩放、窗口缩放、目标丢失与重新绑定、关卡重开。
- GPU 像素检查使用纯色背景，验证圆内亮度不变、圆外变暗、横纵半径一致，以及边缘亮度只向外递减而无描边。截图采样使用纹素中心与双线性插值，避免半像素偏移误判圆形边缘。
- 本轮聚光测试 24 项全部通过；既有关卡冒烟 73 项、天气行为 13 项全部通过。无聚光脚本或 shader 编译错误。无头运行仍有本机沙箱的系统证书读取提示，不影响这些检查。
- 实际引擎录制走动、跳跃、镜头移动及现有雷电下的 8 秒 / 60 FPS 预览。仅预览脚本安排输入及首闪时间，未写入正式玩法。
- 日志、截图和预览位于忽略目录 `work/verification/the-last-light-focus-20260909/`。未执行发布打包或全游戏人工验收。

## 镜头匹配更新

后续按用户要求将镜头从 0.5 改为 1.4，并把跟随位置移至人物身体中部 `(0,-42)`。聚光圆仍保持原来的三倍人物高度，无需缩小圆框；窗口内可见世界高度约 257，与圆直径 252 相差约 2%。新的镜头范围和动态验证见[窗口与镜头记录](view-boundary-adjustment.md)，原 126 逻辑像素圆直径的截图属于初版广角证据。

随后按用户要求将缩放调整为 1.2，可见世界高度为 300；本次数值调整未运行测试。上述 1.4 验证与预览属于历史记录。

## 开关交互后的扩散退场验证（2026-09-09）

在隔离副本使用 Godot 4.7.2 运行一次现有冒烟脚本及一次 OpenGL 聚光检查，全部通过：真实拾取两块电池、完成开关交互后才触发扩散；圆半径逐步变大且圆心继续跟随玩家，柔边越过全部视口角后遮罩消失；重复开关不重启动画，重开恢复遮罩。此次图形检查也覆盖当前 1.2 缩放。已查看扩散前、中、后三张实际渲染截图；未追加完整人工游玩或录制。证据目录为 `work/verification/the-last-light-focus-expand-20260909/`（工作台根目录）。

在已导入的隔离副本运行 GPU 检查：

```sh
"$GODOT_47_BIN" --path . --rendering-method gl_compatibility --script res://tests/character_focus.gd -- --capture-dir=/absolute/path/to/captures
```

API 核对：[CanvasItem 坐标转换](https://docs.godotengine.org/en/latest/classes/class_canvasitem.html#class-canvasitem-method-get-global-transform-with-canvas)、[绘制前信号](https://docs.godotengine.org/en/latest/classes/class_renderingserver.html#class-renderingserver-signal-frame-pre-draw)。文档为 latest，实际兼容性以上述 4.7.2 渲染结果为准。

## 非线性径向渐变（2026-09-09）

用户明确选择「圈内缓慢变暗，圈外明显加深」。已将窄圆周过渡改为上述连续衰减，替换旧 `edge_softness` 参数，并适配扩散退场。只运行一次现有 Godot 4.7.2 / OpenGL 聚光检查，全部通过：中心与内半径亮度、原半径轻度变暗、外部更陡且连续单调的衰减、扩散清除全屏及重开恢复。已查看静止及扩散中的实际截图；未运行完整玩法测试。证据位于 `work/verification/the-last-light-focus-gradient-20260909/`（工作台根目录）。
