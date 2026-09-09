## InputLockAdapter —— owner/token 输入锁（策划案 §8.3；适配 CopyWorms InputManager 方法）
## 持有者：交互（busy_changed）/ 暂停 / 演出，各自持有并只释放自己的锁。
## 禁止用一个全局 bool 替代各持有者的生命周期；owner 离树自动兜底释放。
class_name InputLockAdapter
extends RefCounted

var _locks: Dictionary = {}
var _next_token: int = 1
var _tracked: Dictionary = {}

func acquire(owner: Object, reason: String) -> int:
	var token := _next_token
	_next_token += 1
	_locks[token] = {"owner_id": _owner_id(owner), "owner": weakref(owner), "reason": reason}
	_track(owner)
	return token

func release_token(token: int) -> bool:
	if not _locks.has(token):
		return false
	_locks.erase(token)
	return true

func release_owner(owner: Object) -> void:
	var oid := _owner_id(owner)
	for token in _locks.keys():
		if int(_locks[token]["owner_id"]) == oid:
			_locks.erase(token)

func is_blocked() -> bool:
	_prune()
	return not _locks.is_empty()

func active_count() -> int:
	_prune()
	return _locks.size()

func _owner_id(owner: Object) -> int:
	return owner.get_instance_id() if owner != null and is_instance_valid(owner) else 0

func _track(owner: Object) -> void:
	if owner == null or not (owner is Node):
		return
	var oid := _owner_id(owner)
	if _tracked.has(oid):
		return
	_tracked[oid] = true
	(owner as Node).tree_exited.connect(_on_owner_exited.bind(oid), CONNECT_ONE_SHOT)

func _on_owner_exited(oid: int) -> void:
	for token in _locks.keys():
		if int(_locks[token]["owner_id"]) == oid:
			_locks.erase(token)
	_tracked.erase(oid)

func _prune() -> void:
	var stale: Array = []
	for token in _locks:
		var ref: WeakRef = _locks[token]["owner"]
		if int(_locks[token]["owner_id"]) != 0 and (ref == null or ref.get_ref() == null):
			stale.append(token)
	for token in stale:
		_locks.erase(token)
