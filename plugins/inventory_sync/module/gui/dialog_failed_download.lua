local ensure_character = require("modules/inventory_sync/ensure_character")

local dialog_failed_download = {}

function dialog_failed_download.create(player, acquire_response)
	if player.gui.screen.dialog_failed_download then
		player.gui.screen.dialog_failed_download.destroy()
	end

	local frame = player.gui.screen.add {
		name = "dialog_failed_download",
		type = "frame",
		direction = "vertical",
	}

	local titlebar = frame.add {
		type = "flow",
	}
	titlebar.drag_target = frame

	local title_caption = "Inventory sync download failed"
	if acquire_response.status == "busy" then
		title_caption = "Inventory is in use on " .. acquire_response.message
	end

	local title = titlebar.add {
		type = "label",
		style = "frame_title",
		caption = title_caption,
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
		name = "inventory_sync_failed_download_content",
		type = "frame",
		direction = "vertical",
		style = "inside_shallow_frame_with_padding",
	}
	content.style.width = 400

	local reason
	if acquire_response.status == "timeout" then
		reason = "Timed out fetching inventory from the master server."

	elseif acquire_response.status == "busy" then
		reason =
			"Your synced inventory is in in use on " .. acquire_response.message .. ". " ..
			"If you are logged in there you will have to log out there before you can sync the inventory here. " ..
			"If you just logged out from there it might take some time before the inventory is available."

	elseif acquire_response.status == "error" then
		reason = "Error fetching inventory from the master server: " .. acquire_response.message .. "."

	else
		reason = "Unknown status " .. acquire_response.status .. " fetching inventory from the master server."
	end

	local p1 = content.add {
		type = "label",
		caption = reason
	}
	p1.style.single_line = false

	local p2 = content.add {
		type = "label",
		caption =
			"You may choose to retry fetching the inventory or play with a temporary inventory which will be merged " ..
			"with your synced inventory the next time you join this server."
		,
	}
	p2.style.single_line = false
	p2.style.top_margin = 8

	local dialog_row = frame.add {
		type = "flow",
	}
	dialog_row.style.top_margin = 8
	dialog_row.drag_target = frame

	local abort = dialog_row.add {
		name = "inventory_sync_failed_download_abort",
		type = "button",
		style = "back_button",
		caption = "Use temporary inventory",
		tooltip = "Items you obtain here will be merged with your synced inventory the next time you join this server.",
	}

	local dialog_filler = dialog_row.add {
		type = "empty-widget",
		style = "draggable_space_header",
	}
	dialog_filler.style.horizontally_stretchable = "on"
	dialog_filler.style.right_margin = 4
	dialog_filler.style.height = 28
	dialog_filler.drag_target = frame

	local retry = dialog_row.add {
		name = "inventory_sync_failed_download_retry",
		type = "button",
		style = "forward_button",
		caption = "Retry",
	}

	frame.force_auto_center()
	player.opened = frame
end

dialog_failed_download.events = {
	[defines.events.on_gui_click] = function(event)
		if not event.element.valid then
			return
		end

		if event.element.name == "inventory_sync_failed_download_abort" then
			-- Give the player a charatcer and let them play with that
			local player = game.get_player(event.player_index)
			ensure_character(player)
			player.gui.screen.dialog_failed_download.destroy()
			global.inventory_sync.players[player.name].dirty = true
			global.inventory_sync.players[player.name].sync = false

		elseif event.element.name == "inventory_sync_failed_download_retry" then
			-- Retry acquiring the player from the master
			local player = game.get_player(event.player_index)
			inventory_sync.acquire(player)
			player.gui.screen.dialog_failed_download.destroy()
		end
	end,

	[defines.events.on_player_left_game] = function(event)
		local player = game.get_player(event.player_index)
		if player.gui.screen.dialog_failed_download then
			player.gui.screen.dialog_failed_download.destroy()
		end
	end,
}

return dialog_failed_download
