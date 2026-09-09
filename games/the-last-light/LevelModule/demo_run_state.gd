## DemoRunState —— 局内状态唯一来源（策划案 §4.2 / §4.3 / §8.4）
## 职责：电池集合、线路值、点灯条件、phase 与 run_id。
## 不承担：播放音效、移动节点或改图像。
class_name DemoRunState
extends RefCounted

signal state_changed(snapshot: Dictionary)
signal phase_changed(phase: StringName, run_id: int)

const PHASE_INIT := &"INITIALIZING"
const PHASE_PLAYING := &"PLAYING"
const PHASE_LIGHTING := &"LIGHTING"
const PHASE_WON := &"WON"

var run_id: int = 0
var phase: StringName = PHASE_INIT
var paused: bool = false
var collected_cell_ids: Array[String] = []
var line_enabled: bool = false

var _config: TllDemoConfig

func _init(config: TllDemoConfig, p_run_id: int) -> void:
	_config = config
	run_id = p_run_id

## §4.2 配置校验：必须拒绝非法配置，不静默改默认值后继续（T25）。
static func validate_config(config: TllDemoConfig) -> Array[String]:
	var errors: Array[String] = []
	if config == null:
		return ["demo_config 缺失或类型错误"]
	if config.required_cells < 1:
		errors.append("required_cells 小于 1: %d" % config.required_cells)
	var unique: Dictionary = {}
	for id in config.available_cell_ids:
		if id.is_empty():
			errors.append("available_cell_ids 含空 ID")
		elif unique.has(id):
			errors.append("available_cell_ids 重复实例 ID: " + id)
		unique[id] = true
	if config.required_cells > unique.size():
		errors.append("required_cells(%d) 大于可用唯一电池数(%d)" % [config.required_cells, unique.size()])
	if config.line_switch_instance_id.is_empty():
		errors.append("line_switch_instance_id 缺失")
	return errors

func begin_playing() -> void:
	if phase != PHASE_INIT:
		return
	phase = PHASE_PLAYING
	_emit()

func collected_total() -> int:
	return collected_cell_ids.size()

func cells_ready() -> bool:
	return collected_total() >= _config.required_cells

func can_start() -> bool:
	return phase == PHASE_PLAYING and not paused and cells_ready() and line_enabled

## §8.4 register_cell：只在未暂停的 PLAYING 受理；非当前局、非白名单、重复实例均不得改变数量（T08）。
func register_cell(instance_id: String, p_run_id: int) -> bool:
	if p_run_id != run_id or phase != PHASE_PLAYING or paused:
		return false
	if not _config.available_cell_ids.has(instance_id):
		return false
	if collected_cell_ids.has(instance_id):
		return false
	collected_cell_ids.append(instance_id)
	_emit()
	return true

## §8.4 set_line_enabled：写入当前真实开关值；相同值幂等，不自行反转（§4.5）。
func set_line_enabled(enabled: bool, p_run_id: int) -> bool:
	if p_run_id != run_id or phase != PHASE_PLAYING or paused:
		return false
	if line_enabled == enabled:
		return false
	line_enabled = enabled
	_emit()
	return true

## §8.4 request_start：§4.4 终端判定表。当前局且未暂停的 PLAYING 才判定。
func request_start(p_run_id: int) -> StringName:
	if p_run_id != run_id or phase != PHASE_PLAYING or paused:
		return &"IGNORED"
	if not cells_ready() and not line_enabled:
		return &"MISSING_BOTH"
	if not cells_ready():
		return &"MISSING_CELLS"
	if not line_enabled:
		return &"LINE_OFF"
	phase = PHASE_LIGHTING
	phase_changed.emit(phase, run_id)
	_emit()
	return &"STARTED"

## §8.4 presentation_finished：只在 LIGHTING 且匹配当前局时进入 WON。
func presentation_finished(p_run_id: int) -> void:
	if p_run_id != run_id or phase != PHASE_LIGHTING:
		return
	phase = PHASE_WON
	phase_changed.emit(phase, run_id)
	_emit()

func snapshot() -> Dictionary:
	return {
		"phase": phase,
		"run_id": run_id,
		"collected": collected_total(),
		"required": _config.required_cells,
		"line_enabled": line_enabled,
		"paused": paused,
	}

func _emit() -> void:
	state_changed.emit(snapshot())
