extends Node
## Hold this node in the game root and assign shared_state_store for session memory.
var _records: Dictionary = {}
var _files: Dictionary = {}

func read_state(key: String, persistent: bool, slot: String) -> Dictionary:
	if _records.has(key):
		return _records[key].duplicate(true)
	if persistent:
		var value = _file(slot).get_value("objects", key, {})
		if value is Dictionary:
			_records[key] = value.duplicate(true)
			return value.duplicate(true)
	return {}

func write_state(key: String, value: Dictionary, persistent: bool, slot: String) -> void:
	_records[key] = value.duplicate(true)
	if persistent:
		var file: ConfigFile = _file(slot)
		file.set_value("objects", key, value.duplicate(true))
		var error := file.save(_path(slot))
		if error != OK:
			push_warning("Workbench Interaction: state could not be saved (%s)" % error)

func clear_session() -> void:
	_records.clear()

func clear_slot(slot: String) -> void:
	var prefix := slot + "/"
	for key in _records.keys():
		if str(key).begins_with(prefix):
			_records.erase(key)
	var file := ConfigFile.new()
	_files[slot] = file
	file.save(_path(slot))

func _path(slot: String) -> String:
	return "user://workbench_interaction_" + slot.validate_filename() + ".cfg"

func _file(slot: String) -> ConfigFile:
	if not _files.has(slot):
		var file := ConfigFile.new()
		var error := file.load(_path(slot))
		if error != OK and error != ERR_FILE_NOT_FOUND:
			push_warning("Workbench Interaction: unreadable save slot " + slot)
		_files[slot] = file
	return _files[slot]
