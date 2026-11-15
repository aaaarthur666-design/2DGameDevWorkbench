# Builder integration based on CopyWorms Level_02_SceneBuilder.
# The exported scene owns its textures, collisions and (if present) streaming runtime.
extends RefCounted

static func mount(parent: Node, scene_path: String, placement: Transform2D = Transform2D.IDENTITY) -> Node2D:
	if not is_instance_valid(parent) or not parent.is_inside_tree():
		push_error("Map parent must be in the scene tree")
		return null
	var packed: PackedScene = load(scene_path) as PackedScene
	if packed == null:
		push_error("Map entry is not a PackedScene: " + scene_path)
		return null
	var instance: Node = packed.instantiate()
	if not instance is Node2D:
		instance.free()
		push_error("Expected a Node2D map root")
		return null
	var map: Node2D = instance as Node2D
	map.transform = placement
	parent.add_child(map)
	return map

static func reparent_streamed_map(map: Node2D, parent: Node2D) -> bool:
	if not is_instance_valid(map) or not is_instance_valid(parent):
		return false
	if not map.is_inside_tree() or not parent.is_inside_tree() or map == parent or map.is_ancestor_of(parent):
		return false
	if map.get_parent() == parent:
		return true
	# Pixelwork unloads tiles in _exit_tree. Re-arm BEFORE reparent to rebuild on entry.
	map.request_ready()
	map.reparent(parent, true)
	return true
