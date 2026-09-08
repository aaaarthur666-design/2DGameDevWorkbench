extends Node2D
var ready_count: int = 0
var exit_count: int = 0
func _ready() -> void:
	ready_count += 1
	set_process(true)
func _exit_tree() -> void:
	exit_count += 1
	set_process(false)
