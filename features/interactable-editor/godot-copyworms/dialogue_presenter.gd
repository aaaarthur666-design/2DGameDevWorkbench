extends "../../../runtime/v1/dialogue_presenter.gd"

func advance() -> void:
	if get_parent().can_advance_dialogue():
		super.advance()
