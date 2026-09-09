# source_地图原图-map-stitcher-20260909041720-qirx

将包解压到 Godot 4.6.x 项目根目录，打开 res://scenes/scene-fe3fd0ff-8b14-4020-8c2a-9083dfda4275/scene.tscn。地图、交互物和碰撞已摆放完成。

人物放在 ActorSlot 下，保持人物相对 Z 为 0；或使用 Z=5。靠近交互的物理节点加入 interaction_actor group，默认碰撞层为 1（请与物件的 detection mask 对应）。默认按 E，点击物件沿用其配置。ActorSlot 只是挂接点，没有附带人物。

各物件保留独立节点和 instance_id；移动、改名时保留此 ID。拾取、开关等通过物件信号接入游戏；没有自动背包或剧情逻辑。

scene-source.zip 可在场景组装中重新打开。隐藏的编辑辅助内容不影响导出，取消“参与导出”的节点不会输出。没有 project.godot，不覆盖项目配置。

重新导出会更新 scenes/scene-fe3fd0ff-8b14-4020-8c2a-9083dfda4275/ 内的生成资源。自定义脚本放在外层场景或独立文件中。所有场景共用 addons/workbench_interaction/runtime/v1/，导入时保持同一运行时版本；不要重复放置交互运行时。
