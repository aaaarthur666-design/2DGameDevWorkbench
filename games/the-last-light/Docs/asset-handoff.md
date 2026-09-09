# asset-handoff.md — 《最后一盏灯》资产交接表

> 按策划案 §9.3 建立：设计 ID 与 Forge 实际身份（projectId / definitionId / taskId / exportId）在此对应，不互相替代。
> 最终锁定版本以 `asset-lock.json` 为准（资产未锁定前本表为工作记录）。

## INT-01 交互物首批：备用电池 + 线路开关（v02，2026-09-09）

| 字段 | 备用电池 | 线路开关 |
| --- | --- | --- |
| 设计 ID / 版本 | `tll_cell` / v02（实例 `tll_cell_a`、`tll_cell_b` 待 WP-08 摆放，共用本定义） | `tll_line_switch` / v02（实例 `tll_line_01`） |
| 实际来源 | workbench interactable-editor（本机）；projectId `project-c27bcf4b-6a4a-4e6b-ae02-8d30a8ad8f06`；definitionId `object-2d9c7f0c-3181-4aa2-8373-3eb9ede088ad` | 同项目；definitionId `object-8fd4964d-ac00-443d-a0d7-6c272af9fc1c` |
| 任务身份 | v01 保存 `…061715-xe7y` / 导出 `…061800-5umo`（占位视觉，已被 v02 取代，仅留痕）；**v02 保存 `interactable-editor-20260909065040-qpd1` / 导出 `interactable-editor-20260909065056-bg2t`（generic profile，DEC-04）** | 同左 |
| 源文件 | `outputs/interactable-editor-20260909065056-bg2t/interactable-project.json`（源工程）、`interactables.zip`（Godot 包：runtime v1 + 两对象 tres/tscn + **真实 PNG** + 源 + INSTALL.md） | 同左 |
| 校验 | v02 ZIP SHA-256：`aabafa4f57fc22d5901415f3a625e71f1b5e9f20fcadbdd2c44132ab9df8463c`；包内 PNG 与生成原图字节一致（2978 / 2093 / 3698 B） | 同左 |
| 规格 | pickup；完成后隐藏；「E 拾取备用电池」/「已取得备用电池」；感知 64×40 偏移 (0,-48)；mask=2；无实体碰撞；冷却 0.2s；memory=instance；视觉 24×32 真图 | toggle 初始关；断开「线路已断开」（白面板红灯图）、接通「线路已接通」（深面板金灯图）；「E 接通线路」；感知 96×112 偏移 (0,-48)；mask=2；无实体碰撞；冷却 0.2s；memory=instance；视觉 48×64 真图，两态图形+颜色同时变化 |
| 审核 | 2026-09-09 阿沃：配置序列化核对一致（V1）；原图目检——深蓝壳体+暖黄条纹命中 §7.1 色板，轮廓清晰无文字/角色，偏 ¾ 轴测视角，24×32 下读感良好，**通过** | 同左；两图同种子未对齐面板设计（异形异色两态，区分度反而更强），**通过**；**接通图旋钮周围米色块全尺寸下略似人手，48×64 下读作旋钮座——标记待 James 人工终检** |
| 引擎引用 | 未接入。包内 `addons/workbench_interaction/objects/object-2d9c7f0c…/`（WP-08/WP-09 接入） | `addons/workbench_interaction/objects/object-8fd4964d…/` |
| 授权 / 来源说明 | PixelLab prop 生成 ×3 由 James 于 2026-09-09 授权（§9.4 记为道具原图预算）；任务 `reference-art-20260909062920-cwsy` / `…062939-2ng0` / `…062958-nyte`；PNG SHA-256 与 result.json 元数据一致；generation provenance 已写入项目 assets | 同左 |

### 已知限制与待办

- [ ] 接通图米色块待 James 人工终检（如不通过，单独重生成接通图 1 张，需新授权）。
- [ ] per-state 提示（`line.off_prompt` / `line.on_prompt`）通用运行时不支持；按 §8.5 由游戏侧 TextBinder 处理。
- [ ] 音效 `SFX-PICKUP-01` / `SFX-SWITCH-01`（§7.4 必需）未配置（无音频资产）。
- [ ] 电池两实例与开关实例的真实 instanceId：待 WP-08 scene-composer 摆放导出后登记（§6.1）。
- [ ] V3 引擎行为测试：Godot 安装后执行（拾取只计一次并隐藏、toggle 两态图切换与 toggleState 新值）。

## SCN-01 场景包：港口灯塔场景（地图 + 三实例）v01（2026-09-09）

| 字段 | 内容 |
| --- | --- |
| 设计 ID / 版本 | `MAP-01` + WP-08 场景组装 / v01 |
| 实际来源 | 地图：队友工作台 `map-stitcher-20260909041720-qirx`；组装：scene-composer（本机）；交付 `delivery-923bcbdf2e90bc4e4a14a884edd585c1`；packageId `scene-12477bf099b2f8e4e5d944e3`；sceneId `scene-fe3fd0ff-8b14-4020-8c2a-9083dfda4275` |
| 源文件 | `scenes/scene-fe3fd0ff…/`（scene.tscn、map/map_overall.png、scene-source.zip 编辑源、scene-manifest.json、INSTALL.md）；原始交付与备份 `forge_imports/delivery-923bcbdf…/`（不删除） |
| 校验 | 交付包 SHA-256：`f8963abae262eb635a74bafe108bb0860b176966af46d6f3f4cff5cba9264ac0`（install 时服务端复核）；地图 PNG `b269e053…`（2,721,597 B） |
| 实例映射（§6.1） | `tll_cell_a` → `instance-8eb5dd2b…`（313,849 左码头地面）；`tll_cell_b` → `instance-67959b63…`（1246,831 右侧地面）；`tll_line_01` → `instance-65c3867d…`（1039,459 高台，须经平台链）；`tll_notice_01` / `tll_terminal_01` → **未组装（待制，REQ-04 缺 2/5）** |
| 规格 | 画布 1536×1024 pixel-world-y-down；9 个碰撞多边形（世界坐标）；ActorSlot（actorZIndex 5）；共享 interaction runtime v1 已含 |
| 审核 | 2026-09-09 阿沃：安装计划 20 文件零冲突；Godot 4.6.2 headless `--editor --import` exit 0（V2）；`tests/headless_smoke.gd` 59/59 PASS（V3，含 T06/T08/T09/T10-T14/T18/T20/T21/T24/T25 + 挂载/朝向/重开）；V4 人工游玩未执行 |
| 引擎引用 | `LevelModule/level_root.gd::SCENE_PATH`；GameRoot → LevelSlot → LevelRoot → 场景实例 |
| 接入记录 | `workbench_complete_game_export` status=`integrated`（2026-09-09T10:04:42Z，evidenceSource=agent-reported） |

### 偏差登记（§5.1 坐标变换要求；待 CR 确认）

1. **地图尺寸**：1536×1024 ≠ §5.1 设计区 1920×360 → §5.2 全部锚点改由实际场景派生（spawn_main 现为 (96,872) 左码头脚底）。
2. **镜头**：§5.4「纵向保持稳定」不可行（地图高 1024，开关在 y=459）→ 改为双向跟随 + `limit 0/1536/0/1024`；若策划坚持固定纵向需走变更单并改地图。
3. **跳跃灰盒 v0**：§5.3 初值（160/1000/-400，h=80px）无法到达高台开关（平台间隙最大 192px）→ 调整为 160/1200/-720（h=216px），已记录待实机游玩确认（§5.3 允许调整后记录）。
4. **点灯演出**：2.8s 定时器占位（WP-10 BeaconPresentation 前）。

## CHR-01 守灯人角色：原图 + idle/walk/jump 三动作 v01（2026-09-09）

| 字段 | idle | walk | jump |
| --- | --- | --- | --- |
| 设计 ID / 版本 | `ANIM-IDLE-01` / v01 | `ANIM-WALK-01` / v01 | `ANIM-JUMP-01` / v01 |
| 实际来源 | 角色预设 `reference_6f84e3e6e116560d2c75f9fb`「守灯人」（原图 `ART-CHAR-01` = task `reference-art-20260909102006-7shn`，128×128 透明朝右，transfer `…102121-7k2t`）；作业 `20260909_…_idle_001` candidate 1 | 同角色；作业 `…_walk_001` candidate 1 | 同角色；作业 `…_jump_001` candidate 1 |
| 导出 | `sprite-generator-20260909103029-rha9` | `sprite-generator-20260909105149-7aoy` | `sprite-generator-20260909105200-rwgd` |
| 校验（sheet SHA-256） | `0f20894d321089ad750557cab3192897293f584e19026b84eb637ab4fd930075` | `e12bd2b0cf85c30b454f9d16c7ec88493cb1619f37a58b083a51650d4fdb2bef` | `daf31ca7ab5289ec630a930e8c9f7b257af841a09ed4ee19be3f223910e4a65f` |
| 规格 | 17 帧（provider 16→17 全保留）；8 FPS；loop=true；锚点 (62,124)，visual_offset (2,-60)；cell 128×128 | 17 帧；5 FPS（§7.2 目标 12，差异登记，未导入后改速）；loop=true | 17 帧；6 FPS（目标 10，差异登记）；**loop=false**（请求即非循环，§7.2 ✓） |
| 审核 | 阿沃亲读 0/8/16：身份一致、脚底稳定、循环闭合 ✅ | 阿沃亲读 0/1/4/8/12/15/16：身份一致；**循环接缝轻-中度跳变**（15/16 未回到站立）——James 2026-09-09 决策原样接受，标记实机复核 | 阿沃亲读 0/4/9/12/16：身份一致、动作链清晰；**画布内纵向位移约 27px**（与 §7.2 偏差）——同决策原样接受，备选 re-anchor 后处理可执行 |
| 引擎引用 | `Assets/Characters/maintainer/maintainer_frames.tres`（`merge_clips` 合并，来源包未改；SHA-256 `737749604b…0b09`）；`Player_Maintainer.tscn` 的 AnimatedSprite2D（唯一视觉节点，offset (2,-60)，**scale 0.74**） | 同左 | 同左 |
| 授权 / 来源说明 | James 2026-09-09 指令「生成灯塔看守人的序列帧」＝ 原图×1 + 动作×3 预算；PixelLab 生成 + 有效视觉审核（阿沃逐帧）+ James 终判 | 同左 | 同左 |

**scale 推导（实测非拍脑袋）**：三动作内容包围盒 idle 44×119、walk 62×119、jump 77×124（PIL 全帧 alpha 实测）；§7.2 有效高度目标 80–96 逻辑像素，取中值 88 → `88/119 ≈ 0.74`。缩放后 idle/walk 高 ≈88.1、jump ≈91.8，碰撞体 28×72 不变，宽/高比例协调。

**引擎验收（Godot 4.7.stable.official.5b4e0cb0f，James 迁移后基线）**：`tests/headless_smoke.gd` **69/69**（含动画合同 14 项：别名/帧数/FPS/loop/偏移/scale/状态映射/起跳重播/落地切回）；`tests/view_boundary.gd` **15/15**。V4 人工游玩待 James 实机（F5 运行 GameRoot）。

**已知缺陷（实机复核清单）**：①walk 循环 16→0 接缝跳变；②jump 峰帧 27px 画布内位移（顶点过冲约 12.5%）；③jump 剪辑 2.8s vs 物理腾空约 1.2s（落地即切回 idle/walk，不出问题但值得看）；④walk 5 FPS 偏慢（§7.2 目标 12，变速属导出环节决策）。

## 生成预算登记（§9.4）

| 类别 | 预计 | 实际 | 选用 | 余额 |
| --- | --- | --- | --- | --- |
| 道具原图（PixelLab prop） | 3 | 3 | 3/3 全部选用 | 9/8 时为 29，本批后约 26 |
| 角色原图 + 三动作（PixelLab character） | 4 | 4 | 4/4 全部选用（walk/jump 缺陷经 James 决策接受） | 40 额度制：本批后余 9 |

## CHR-01 守灯人粗像素替换 v02（2026-09-09，当前使用）

用户确认：老练的港口守灯人，深蓝与暗金配色。原角色造型和像素颗粒不符合地图，因此重新生成原图与 idle/walk/jump 三动作。

- 原图：reference-art-20260909113209-osic，原生 64×64；角色 preset reference_a9f5fd6d9344b2322a9d4623。先前试制的 128px 原图 reference-art-20260909112442-4kah 未采用，因为颗粒仍过细。
- 动作：20260909_reference_a9f5fd6d9344b2322a9d4623_{idle,walk,jump}_001，均为候选 1，全部 17 帧保留。导出任务 idle …114526-xsti、walk …114546-o2rx、jump …114537-k7d6。
- 当前资源：Assets/Characters/maintainer/maintainer_frames_v02.tres；机器清单 maintainer_v02.json 保留来源、导出速度和最终运行速度。源导出 FPS 为 8/5/6，游戏在本次开工前实际已调为 10/10/10，合并时保留该现状；idle/walk 循环，jump 不循环。
- 唯一视觉节点仍为 Sprite/AnimatedSprite2D，nearest 过滤，scale 1.5、offset (1,-28)，对应 64px 画布锚点 (31,60)；普通站姿高度约 84px，像素在相同游戏高度下约放大一倍。
- 原 maintainer_frames.tres、旧 forge_sprites 和交付包均保留。控制器、物理参数、镜头、空气墙及 project.godot 的 SHA-256 与替换前完全相同。
- 三份交付已通过 MCP 安装并完成，baselineValidated=true，实际引擎 4.7。包装层旧 MCP 进程曾写入 4.6.x 标签，该历史包装元数据未篡改；内层新 SpriteFrames 包由 4.7 导出器产生，并以 4.7 实际运行验证。后续使用重连后的客户端加载当前代码。

审核：逐帧查看 51 帧。轮廓完整、身份与配色一致，无硬失败。边距 2–3px 警告经目检无裁切；行走接缝处质心速度变化约 4.54px，保留为轻微顿挫；部分帧含少量脚下灰色接触像素。跳跃有画布内起伏，保留原有物理跳跃和落地切回，不新增游戏位移。未把这些瑕疵宣称为已消除。

验证：Godot 4.7 真实导入、合并及 OpenGL 游戏画面对比；headless_smoke 73 项、view_boundary 15 项通过。原测试对帧数与 FPS 的旧断言在替换前就有两项失败，现按当前游戏实际速度和新导出帧合同更新。日志、逐帧审核图、前后对比与备份位于 work/keeper-restyle-v02/。最终人工风格与手感由 James 验收。
