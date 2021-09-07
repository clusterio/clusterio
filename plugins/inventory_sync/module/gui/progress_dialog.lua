-- Show inventory download progressbar
local progress_dialog = {}

function progress_dialog.create(player, progress, total)
	local frame = player.gui.screen.add {
		name = "inventory_sync_progress",
		type = "frame",
		direction = "vertical",
	}

	local titlebar = frame.add {
		type = "flow",
	}
	titlebar.drag_target = frame

	local title = titlebar.add {
		type = "label",
		style = "frame_title",
		caption = "Inventory sync",
	}
	title.drag_target = frame

	local filler = titlebar.add {
		type = "empty-widget",
		style = "draggable_space_header",
	}
	filler.style.horizontally_stretchable = "on"
	filler.style.right_margin = 4
	filler.style.height = 24
	filler.drag_target = frame

	local content = frame.add {
		name = "inventory_sync_progress_dialog_content",
		type = "frame",
		direction = "vertical",
		style = "inside_shallow_frame_with_padding",
	}
	content.style.width = 400

	local p1 = content.add {
		type = "label",
		caption = "Downloading inventory chunk " .. progress .. " / " .. total,
	}
	p1.style.single_line = false
	p1.style.bottom_margin = 8

	local progressbar = content.add {
		type = "progressbar",
		value = progress / total,
	}
	progressbar.style.width = 376 -- inside_shallow_frame_with_padding has 12px padding on each side

	frame.force_auto_center()
	player.opened = frame
end

function progress_dialog.remove(player)
	if player.gui.screen.inventory_sync_progress then
		player.gui.screen.inventory_sync_progress.destroy()
	end
end

function progress_dialog.update(player, progress, total)
	-- Be defensive here in case an old GUI is present
	local frame = player.gui.screen.inventory_sync_progress
	if not frame then
		return false
	end

	local content = frame.inventory_sync_progress_dialog_content
	if not content then
		return false
	end

	local p1 = content.children[1]
	if not p1 or p1.type ~= "label" then
		return false
	end

	local progressbar = content.children[2]
	if not progressbar or progressbar.type ~= "progressbar" then
		return false
	end

	p1.caption = "Downloading inventory chunk " .. progress .. " / " .. total
	progressbar.value = progress / total

	return true
end

function progress_dialog.display(player, progress, total)
	if not progress_dialog.update(player, progress, total) then
		progress_dialog.remove(player)
		progress_dialog.create(player, progress, total)
	end
end

return progress_dialog
