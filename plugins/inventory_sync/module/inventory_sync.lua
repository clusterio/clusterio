--[[

Inventory Sync

When a player leaves the game, serialize the player state and upload it to the controller.
When a player joins the game, request the player data from controller and deserialize the player state from it.

]]

local compat = require("modules/clusterio/compat")
local clusterio_api = require("modules/clusterio/api")
local download_inventory = require("modules/inventory_sync/download_inventory")
local serialize = require("modules/inventory_sync/serialize")
local restore_position = require("modules/inventory_sync/restore_position")
local get_script_data = require("modules/inventory_sync/get_script_data")
local progress_dialog = require("modules/inventory_sync/gui/progress_dialog")
local dialog_failed_download = require("modules/inventory_sync/gui/dialog_failed_download")

-- Returns true if the player is currently in a cutscene
local function is_in_cutscene(player)
	return player.controller_type == defines.controllers.cutscene
end

-- Create player record for bookkeeping
local function create_player(player, dirty)
	local inventory_sync = get_script_data(true) -- no early return to support loading from single player
	inventory_sync.players[player.name] = {
		dirty = dirty, -- Player inventory has changes that should be persisted
		sync = false, -- Player inventory is synced from the controller
		generation = 0,
	}
end

-- Remove all stored player data by this module
local function remove_player(player)
	local inventory_sync = get_script_data()
	inventory_sync.players_waiting_for_acquire[player.name] = nil
	inventory_sync.players_in_cutscene_to_sync[player.name] = nil
	inventory_sync.active_downloads[player.name] = nil
	inventory_sync.finished_downloads[player.name] = nil
	inventory_sync.active_uploads[player.name] = nil
	inventory_sync.players[player.name] = nil
end


inventory_sync = {}
-- This function is called by instance.js as /sc inventory_sync.download_inventory("danielv", Escaped JSON string, package_number, total_packages_count) with data from the controller
inventory_sync.download_inventory = download_inventory

-- This function is called internally when a player leaves the game to
-- serialize the player for upload.
function inventory_sync.serialize_player(player, player_record)
	-- Editor mode is not supported.
	if player.controller_type == defines.controllers.editor then
		player.toggle_map_editor()
	end

	if player.controller_type == defines.controllers.editor then
		error("Unable to switch out of editor mode")
		return
	end

	-- mod-compat: Exit Space Exploration satellite view to restore the real character
	if remote.interfaces["space-exploration"] then
		local status, result = pcall(function()
			if remote.call("space-exploration", "remote_view_is_active", { player = player }) then
				remote.call("space-exploration", "remote_view_stop", { player = player })
			end
		end)
		if not status then
			log("ERROR: Exiting remote view failed for " .. player.name .. ": " .. result)
			player.print("ERROR: Exiting remote view failed: " .. result)
		end
	end

	local serialized_player = serialize.serialize_player(player)
	serialized_player.generation = player_record.generation

	return serialized_player
end

function inventory_sync.deserialize_player(player, finished_record)
	-- Editor mode is not supported.
	if player.controller_type == defines.controllers.editor then
		player.toggle_map_editor()
	end

	if player.controller_type == defines.controllers.editor then
		error("Unable to switch out of editor mode")
		return
	end

	-- Stash temporary inventory if it exists
	local stashed_corpse
	local inventory_sync = get_script_data()
	local player_record = inventory_sync.players[player.name]
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
	local serialized_player = compat.json_to_table(finished_record.data)
	serialize.deserialize_player(player, serialized_player)

	-- Restore player position and driving state
	restore_position(player, finished_record)

	-- Transfer items from stashed inventory
	if stashed_corpse then
		local main = player.get_main_inventory()
		local stash = stashed_corpse.get_inventory(defines.inventory.character_corpse)
		if main then
			for i = 1, #stash do
				-- Try transferring a stack
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
				"Your temporary inventory did not fit into your synced one and the remaining items have " ..
				"been placed in a corpse below you."
			)
		end
	end
end

inventory_sync.events = {}
inventory_sync.events[clusterio_api.events.on_server_startup] = function(event)
	local inventory_sync = get_script_data(true)
	inventory_sync.players_waiting_for_acquire = {}
	inventory_sync.players_in_cutscene_to_sync = {}

	for _, player in pairs(game.players) do
		if not inventory_sync.players[player.name] then
			create_player(player, true)
		end
	end
end

-- Cleanup
inventory_sync.events[defines.events.on_pre_player_removed] = function(event)
	remove_player(game.get_player(event.player_index))
end

inventory_sync.events[defines.events.on_player_created] = function(event)
	create_player(game.get_player(event.player_index), false)
end

function inventory_sync.acquire(player)
	local inventory_sync = get_script_data()
	inventory_sync.players_waiting_for_acquire[player.name] = {
		start_tick = game.ticks_played,
	}
	clusterio_api.send_json("inventory_sync_acquire", {
		player_name = player.name,
	})
end

function inventory_sync.check_players_waiting_for_acquire()
	local inventory_sync = get_script_data()
	for player_name, record in pairs(inventory_sync.players_waiting_for_acquire) do
		-- Check if the acquire player request timed out
		if game.ticks_played > record.start_tick + 600 then
			inventory_sync.acquire_response(compat.table_to_json({
				status = "timeout",
				player_name = player_name,
			}))
		end
	end
end

function inventory_sync.acquire_response(data)
	local inventory_sync = get_script_data()
	local response = assert(compat.json_to_table(data))
	if not inventory_sync.players_waiting_for_acquire[response.player_name] then
		clusterio_api.send_json("inventory_sync_release", { player_name = response.player_name })
		return
	end
	inventory_sync.players_waiting_for_acquire[response.player_name] = nil

	local player = game.get_player(response.player_name)
	if is_in_cutscene(player) then
		response.player = player
		inventory_sync.players_in_cutscene_to_sync[response.player_name] = response
	else
		inventory_sync.sync_player(response)
	end
end

function inventory_sync.check_players_in_cutscene()
	local inventory_sync = get_script_data()
	for player_name, response in pairs(inventory_sync.players_in_cutscene_to_sync) do
		if not is_in_cutscene(response.player) then
			inventory_sync.players_in_cutscene_to_sync[player_name] = nil
			inventory_sync.sync_player(response)
		end
	end
end

function inventory_sync.sync_player(acquire_response)
	local player = assert(game.get_player(acquire_response.player_name))

	-- Editor mode is not supported.
	if player.controller_type == defines.controllers.editor then
		player.toggle_map_editor()
	end

	if player.controller_type == defines.controllers.editor then
		log("ERROR: Inventory sync failed, unable to switch " .. player.name .. " out of editor mode")
		player.print("ERROR: Inventory sync failed, unable to switch out of editor mode")
		return
	end

	local inventory_sync = get_script_data()
	local finished_record = inventory_sync.finished_downloads[acquire_response.player_name]
	if finished_record then
		if acquire_response.status == "acquired" and finished_record.generation == acquire_response.generation then
			inventory_sync.finish_download(player, finished_record)
			return
		end

		-- The acquisition either failed or the current finished download is
		-- stale, delete it and try downloading it again.
		inventory_sync.finished_downloads[acquire_response.player_name] = nil
	end

	local download_record = inventory_sync.active_downloads[acquire_response.player_name]
	if download_record then
		-- Ignore the response if it affirms the current active download
		if acquire_response.status == "acquired" and download_record.generation == acquire_response.generation then
			game.print("Continuing active download")
			return
		end

		-- This is the excaptional case where a long download started from
		-- the previous time the player joined is still ongoing and we just
		-- received a message saying that it's not valid any more.

		if acquire_response.status == "error" or acquire_response.status == "timeout" then
			-- Let the current download finish or fail on its own, we may end up
			-- duplicating items or giving the player a stale inventory here
			-- but it's better than throwing away all the downloaded data.
			return
		end

		if acquire_response.status == "acquired" then
			-- The stored data on the controller has changed since the
			-- download was started. Restart it.
			game.print("Restarting download")
			download_record.restart = true
			return
		end

		if acquire_response.status == "busy" then
			-- Somehow another instance has claimed the player while we're
			-- downloading it. Abort it and send failure to the player.
			inventory_sync.active_downloads[acquire_response.player_name] = nil
		end
	end

	local player_record = inventory_sync.players[acquire_response.player_name]
	if acquire_response.status ~= "acquired" then
		if player_record.sync and not player_record.dirty then
			if player.controller_type == defines.controllers.character then
				local character = player.character
				player.set_controller({ type = defines.controllers.spectator })
				if character then character.destroy() end
			end
			player_record.sync = false
		end
		dialog_failed_download.create(player, acquire_response)
		return
	end

	if
		acquire_response.has_data
		and (not player_record.sync or acquire_response.generation > player_record.generation)
	then
		inventory_sync.initiate_inventory_download(player, player_record, acquire_response.generation)

	else
		if acquire_response.generation == 0 then
			player.print(
				"Your inventory will be automatically synchronized between servers in this cluster. " ..
				"To improve sync performance, please avoid storing large blueprints in your inventory.",
				{0.75, 0.75, 1}
			)
		end

		player_record.sync = true
		player_record.dirty = true
	end
end

function inventory_sync.finish_download(player, finished_record)
	local status, result = pcall(inventory_sync.deserialize_player, player, finished_record)
	if not status then
		log("ERROR: Deserializing player " .. player.name .. " failed: " .. result)
		player.print("ERROR: Deserializing player data failed: " .. result)
	end
	local inventory_sync = get_script_data()
	inventory_sync.finished_downloads[player.name] = nil

	local player_record = inventory_sync.players[player.name]
	player_record.dirty = true
	player_record.sync = true
	player_record.generation = finished_record.generation
end

-- Download inventory from controller
inventory_sync.events[defines.events.on_player_joined_game] = function(event)
	local player = assert(game.get_player(event.player_index))
	local inventory_sync = get_script_data()

	-- It's possible Factorio doesn't invoke the on_player_created event when loading a save in single player
	if not inventory_sync.players[player.name] then
		create_player(player, false)
	end

	-- Send acquire request even if an active download is currently in progress
	inventory_sync.acquire(player, false)

	-- Clear active upload if it exists
	inventory_sync.active_uploads[player.name] = nil
end

inventory_sync.on_nth_tick = {}
inventory_sync.on_nth_tick[33] = function(event)
	-- Periodically check players currently in the process of syncing
	inventory_sync.check_players_waiting_for_acquire()
	inventory_sync.check_players_in_cutscene()
	inventory_sync.check_active_downloads()
	inventory_sync.check_active_uploads()
end

inventory_sync.events[defines.events.on_cutscene_waypoint_reached] = function(event)
	inventory_sync.check_players_in_cutscene()
end

inventory_sync.events[defines.events.on_cutscene_cancelled] = function(event)
	inventory_sync.check_players_in_cutscene()
end

-- Upload inventory when a player leaves the game. Triggers on restart after crash if player was online during crash.
inventory_sync.events[defines.events.on_pre_player_left_game] = function(event)
	-- for some reason, on_pre_player_left_game gets called before on_server_startup so global isn't ready yet
	if not compat.script_data().inventory_sync then
		log("ERROR: Global inventory sync not defined")
		return
	end

	local inventory_sync = get_script_data()
	local player = assert(game.get_player(event.player_index))
	local player_record = inventory_sync.players[player.name]

	-- If player has an active download release our acquisition but let the download continue
	if inventory_sync.active_downloads[player.name] then
		clusterio_api.send_json("inventory_sync_release", { player_name = player.name })
		return
	end

	if not player_record.dirty or not player_record.sync then
		return
	end

	player_record.generation = player_record.generation + 1
	local status, result = pcall(inventory_sync.serialize_player, player, player_record)
	if not status then
		log("ERROR: Serializing player " .. player.name .. " failed: " .. result)
		player.print("ERROR: Serializing player data failed: " .. result)
		return
	end
	inventory_sync.active_uploads[player.name] = {
		serialized = result,
		last_attempt = game.ticks_played,
		timeout = math.random(600, 1200), -- Start with 10-20 seconds for the timeout
	}

	clusterio_api.send_json("inventory_sync_upload", result)
end

-- Invoked by the instance code to confirm the controller has received the uploaded data
function inventory_sync.confirm_upload(player_name, generation)
	local player = game.get_player(player_name)
	if not player or player.connected then
		log("no player, or player connected")
		return
	end
	local inventory_sync = get_script_data()
	local player_record = inventory_sync.players[player.name]
	if not player_record or player_record.generation ~= generation then
		return
	end

	if not player_record.dirty then
		log("ERROR: Received upload confirmation for " .. player_name .. " without the dirty flag")
	end
	if not player_record.sync then
		log("ERROR: Received upload confirmation for " .. player_name .. " without the sync flag")
	end
	log("Confirmed upload of " .. player_name)
	inventory_sync.active_uploads[player_name] = nil
	player_record.dirty = false
end

function inventory_sync.initiate_inventory_download(player, player_record, generation)
	player.print("Initiating inventory download...")
	local record = {
		started = game.ticks_played,
		last_active = game.ticks_played,
		generation = generation,
		data = ""
	}
	local inventory_sync = get_script_data()
	inventory_sync.active_downloads[player.name] = record

	clusterio_api.send_json("inventory_sync_download", {
		player_name = player.name
	})

	-- If this is a synced player turn them into a spectator while the
	-- player data is downloading
	if player_record.sync then
		-- Store original position to teleport back to
		record.surface = player.surface
		record.position = player.position
		if player.driving then
			record.vehicle = player.vehicle
		end

		local character = player.character
		player.set_controller({ type = defines.controllers.spectator })
		if character ~= nil then character.destroy() end

		-- Indicate this state shouldn't be persisted
		player_record.dirty = false
	end

	progress_dialog.display(player, 0, 1)
end

function inventory_sync.check_active_downloads()
	-- Used for detecting the inventory download failing, like when the map is saved and
	-- re-loaded in the middle of a download. The player will be returned to a playable state.
	local inventory_sync = get_script_data()
	for player_name, record in pairs(inventory_sync.active_downloads) do
		if record.last_active <= game.ticks_played - 600 then
			inventory_sync.active_downloads[player_name] = nil
			local player = game.get_player(player_name)
			if player then
				log("ERROR: Inventory download failed for " .. player_name)

				if player.connected then
					-- Show GUI with option to retry or abort download
					dialog_failed_download.create(player, {
						player_name = player_name,
						status = "error",
						message = "Inventory download failed",
					})
				end
			end
		end
	end
end

function inventory_sync.check_active_uploads()
	local inventory_sync = get_script_data()
	for player_name, record in pairs(inventory_sync.active_uploads) do
		if record.last_attempt + record.timeout < game.ticks_played then
			local player_record = inventory_sync.players[player_name]
			local player = game.get_player(player_name)
			if not player_record or not player then
				inventory_sync.active_uploads[player_name] = nil
			else
				log("Retrying upload for " .. player_name)
				record.last_attempt = game.ticks_played
				record.timeout = math.random(record.timeout, record.timeout * 2)
				clusterio_api.send_json("inventory_sync_upload", record.serialized)
			end
		end
	end
end

return inventory_sync
