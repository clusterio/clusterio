local progress_dialog = require("modules/player_sync/gui/progress_dialog")
local ensure_character = require("modules/player_sync/ensure_character")
local restore_position = require("modules/player_sync/restore_position")
local get_script_data = require("modules/player_sync/get_script_data")
local serialize = require("modules/player_sync/serialize")
local compat = require("modules/clusterio/compat")


--- @param components string? JSON of the components the instance sent the data with, given with the first part
local function download_inventory(player_name, data, number, total, components)
	local script_data = get_script_data()
	local record = script_data.active_downloads[player_name]
	local player = game.get_player(player_name)
	-- A prefetched copy (player_sync.prefetch_inventory) may be for a player who doesn't exist here yet
	if player == nil and not (record and record.prefetch) then
		rcon.print("Player " .. player_name .. " does not exist")
		return
	end

	if record == nil then
		rcon.print("No active download is in progress for " .. player_name)
		return
	end
	-- For the linter, which can't narrow through the check above. A prefetch record never reaches a line that indexes
	-- player while it is nil: it has no restart, never gets total 0, and shown below is false for it.
	--- @cast player LuaPlayer

	local player_record = script_data.players[player_name]
	-- The components changed after the download was started
	local sent_components = number == 1 and components and compat.json_to_table(components)
	if sent_components and not serialize.same_components(record.components, sent_components) then
		record.restart = true
	end
	if record.restart then
		rcon.print("Restarting outdated download")
		player_sync.initiate_inventory_download(player, player_record, record.generation, record.epoch)
		return
	end

	if total == 0 then
		-- Download was requested but the player had no data stored.
		log("ERROR: Player sync failed, got empty player data for " .. player.name .. " from the controller")
		player.print("ERROR: Player sync failed, got empty player data from the controller")

		progress_dialog.remove(player)

		-- Give the player a character and pretend that's the synced player data
		if serialize.syncs(record.components, "controller") or player_record.local_controller then
			ensure_character(player)
		end
		player_record.local_controller = nil

		-- Restore player position and driving state
		restore_position(player, record)

		script_data.active_downloads[player_name] = nil
		player_record.dirty = player.connected
		player_record.sync_in_progress = false
		player_record.sync = true
		player_record.components = record.components
		player_record.generation = record.generation
		player_record.epoch = record.epoch
		return
	end

	record.data = record.data .. data
	-- A prefetched copy shows progress, and is applied, only once the acquire reply has confirmed it for the player
	-- online here (player_sync.sync_player). A copy that finishes before then waits in finished_downloads for that reply.
	local shown = not record.prefetch or (record.confirmed and player.connected)

	-- Show progress in console
	-- player.print("Downloaded "..(number + 1).."/"..total.." parts")
	if number ~= total then
		-- Show progress in GUI
		if shown then
			progress_dialog.display(player, number, total)
		end

		-- Update activity to indicate this session is still going
		record.last_active = game.ticks_played
		return
	end

	-- Download is complete. The dialog goes even when this copy isn't shown now: it may have been shown before a leave
	if player then
		progress_dialog.remove(player)
	end

	-- Remove download session and store finished download
	script_data.active_downloads[player_name] = nil
	script_data.finished_downloads[player_name] = record

	local ticks = game.ticks_played - record.started
	if shown then
		player.print("Imported player data in " .. ticks .. " ticks")
	end
	local kind = record.prefetch and "Prefetched" or "Imported"
	log(kind .. " player data for " .. player_name .. " in " .. ticks .. " ticks")

	if shown and player.connected then
		player_sync.finish_download(player, record)
	end
end

return download_inventory
