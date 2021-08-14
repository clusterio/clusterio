local ensure_character = require("modules/inventory_sync/ensure_character")

-- on_gui_click
local handle_gui_events = function(event)
	if not event.element.valid then
		return
	end
	local player = game.get_player(event.player_index)
	if event.element.name == "inventory_sync_failed_download_abort" then
		-- Give the player a new inventory and mark it as dirty
		-- Show dirty status and an explanation in a GUI

		-- Remove GUI element
		player.gui.screen.dialog_failed_download.destroy()
		-- Handle inventory dirtying
		if not global.inventory_sync.players[player.name].dirty_inventory then
			global.inventory_sync.players[player.name].dirty_inventory = true

			-- Restore player character
			ensure_character(player)
		end
	end
end

return handle_gui_events
