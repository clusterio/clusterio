local progress_dialog = require("modules/inventory_sync/gui/progress_dialog")
local ensure_character = require("modules/inventory_sync/ensure_character")
local serialize = require("modules/inventory_sync/serialize")
local load_crafting_queue = require("modules/inventory_sync/load_crafting_queue")


local can_enter_vehicle = {
	[defines.controllers.character] = true,
	[defines.controllers.god] = true,
	[defines.controllers.editor] = true,
}

local function restore_position(record, player)
	if record.vehicle and record.vehicle.valid and can_enter_vehicle[player.controller_type] then
		player.teleport(record.vehicle.position, record.vehicle.surface)
		player.driving = true

		-- Teleport to safe location if unable to enter vehicle
		if not player.driving and player.controller_type == defines.controllers.character then
			local safe_position = record.vehicle.surface.find_non_colliding_position(
				player.character.name, player.position, 32, 1/8
			)
			if safe_position then
				player.teleport(safe_position, player.surface)
			end
		end
	elseif record.surface and record.position then
		player.teleport(record.position, record.surface)
	end
end

local function download_inventory(player_name, data, number, total)
	local player = game.get_player(player_name)
	if player == nil then
		rcon.print("Player " .. player_name .. " does not exist")
		return
	end

	local record = global.inventory_sync.active_downloads[player_name]
	if record == nil then
		rcon.print("No active download is in progress for " .. player_name)
		return
	end

	local player_record = global.inventory_sync.players[player_name]
	if record.restart then
		rcon.print("Restarting outdated download")
		inventory_sync.initiate_inventory_download(player, player_record, record.generation)
		return
	end

	if total == 0 then
		-- Download was requested but the player had no data stored.
		log("ERROR: Inventory sync failed, got empty player data for " .. player.name .. " from the master")
		player.print("ERROR: Inventory sync failed, got empty player data from the master")

		progress_dialog.remove(player)

		-- Give the player a character and pretend that's the synced player data
		ensure_character(player)

		-- Restore player position and driving state
		restore_position(record, player)

		global.inventory_sync.active_downloads[player_name] = nil
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

	progress_dialog.remove(player)

	-- Editor mode is not supported.
	if player.controller_type == defines.controllers.editor then
		player.toggle_map_editor()
	end

	if player.controller_type == defines.controllers.editor then
		log("ERROR: Inventory sync failed, unable to switch " .. player.name .. " out of editor mode")
		player.print("ERROR: Inventory sync failed, unable to switch out of editor mode")
		return
	end

	-- Stash temporary inventory if it exists
	local stashed_corpse
	if player_record.dirty and player.character then
		local character = player.character
		local surface = character.surface
		local position = character.position
		local corpse_name = character.prototype.character_corpse.name
		player.character = nil
		character.die()
		stashed_corpse = surface.find_entity(corpse_name, position)
	end

	-- Deserialize downloaded player data
	local serialized_player = game.json_to_table(record.data)
	serialize.deserialize_player(player, serialized_player)

	-- Restore player position and driving state
	restore_position(record, player)

	-- Load crafting queue
	if player.character then
		load_crafting_queue(serialized_player.crafting_queue, player)
	end

	-- Transfer items from stashed inventory
	if stashed_corpse then
		local main = player.get_main_inventory()
		local stash = stashed_corpse.get_inventory(defines.inventory.character_corpse)
		if main then
			for i = 1, #stash do
				-- Try transfering a stack
				local source = stash[i]
				if source and source.valid_for_read then
					local target = main.find_empty_stack()
					if not target then
						break
					end
					target.transfer_stack(source)
				end
			end
		end

		if stash.is_empty() then
			stashed_corpse.destroy()
		else
			player.print(
				"Your temprorary inventory did not fit into your synced one and the remaining items have " ..
				"been placed in a corpse below you."
			)
		end
	end

	-- Player may have left before the download completed
	player_record.dirty = player.connected
	player_record.sync = true
	player_record.generation = serialized_player.generation

	-- Remove download session and data
	global.inventory_sync.active_downloads[player_name] = nil

	local ticks = game.ticks_played - record.started
	player.print("Imported player data in " .. ticks .. " ticks")
	log("Imported player data for " .. player_name .. " in " .. ticks .. " ticks")
end

return download_inventory
