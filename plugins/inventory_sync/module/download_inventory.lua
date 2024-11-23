local progress_dialog = require("modules/inventory_sync/gui/progress_dialog")
local ensure_character = require("modules/inventory_sync/ensure_character")
local restore_position = require("modules/inventory_sync/restore_position")
local get_script_data = require("modules/inventory_sync/get_script_data")


local function download_inventory(player_name, data, number, total)
	local player = game.get_player(player_name)
	if player == nil then
		rcon.print("Player " .. player_name .. " does not exist")
		return
	end

	local script_data = get_script_data()
	local record = script_data.active_downloads[player_name]
	if record == nil then
		rcon.print("No active download is in progress for " .. player_name)
		return
	end

	local player_record = script_data.players[player_name]
	if record.restart then
		rcon.print("Restarting outdated download")
		inventory_sync.initiate_inventory_download(player, player_record, record.generation)
		return
	end

	if total == 0 then
		-- Download was requested but the player had no data stored.
		log("ERROR: Inventory sync failed, got empty player data for " .. player.name .. " from the controller")
		player.print("ERROR: Inventory sync failed, got empty player data from the controller")

		progress_dialog.remove(player)

		-- Give the player a character and pretend that's the synced player data
		ensure_character(player)

		-- Restore player position and driving state
		restore_position(record, player)

		script_data.active_downloads[player_name] = nil
		player_record.dirty = player.connected
		player_record.sync = true
		player_record.generation = record.generation
		return
	end

	record.data = record.data .. data

	-- Show progress in console
	-- player.print("Downloaded "..(number + 1).."/"..total.." parts")
	if number ~= total then
		-- Show progress in GUI
		progress_dialog.display(player, number, total)

		-- Update activity to indicate this session is still going
		record.last_active = game.ticks_played
		return
	end

	-- Download is complete
	progress_dialog.remove(player)

	-- Remove download session and store finished download
	script_data.active_downloads[player_name] = nil
	script_data.finished_downloads[player_name] = record

	local ticks = game.ticks_played - record.started
	player.print("Imported player data in " .. ticks .. " ticks")
	log("Imported player data for " .. player_name .. " in " .. ticks .. " ticks")

	if player.connected then
		inventory_sync.finish_download(player, record)
	end
end

return download_inventory
