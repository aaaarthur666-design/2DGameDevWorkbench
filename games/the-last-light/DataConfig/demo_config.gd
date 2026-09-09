## TllDemoConfig —— 本关修复规则唯一来源（策划案 §4.2）
## 电池数量修改只动本资源：提示牌 / HUD 分母 / 缺项反馈 / 启动判定同步派生（§8.5）。
class_name TllDemoConfig
extends Resource

## 点灯所需的不同电池实例数量；v1.0 只允许 1 或 2
@export var required_cells: int = 2
## 本关可计入修复条件的电池实例白名单（scene-composer 导出的真实 instanceId）
@export var available_cell_ids: Array[String] = []
## 线路开关实例（真实 instanceId）
@export var line_switch_instance_id: String = ""
