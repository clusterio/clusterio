--[[

Player Sync

When a player leaves the game, serialize the player state and upload it to the controller.
When a player joins the game, request the player data from controller and deserialize the player state from it.

]]

local compat = require("modules/clusterio/compat")
local clusterio_api = require("modules/clusterio/api")
local download_inventory = require("modules/player_sync/download_inventory")
local serialize = require("modules/player_sync/serialize")
local restore_position = require("modules/player_sync/restore_position")
local get_script_data = require("modules/player_sync/get_script_data")
local progress_dialog = require("modules/player_sync/gui/progress_dialog")
local dialog_failed_download = require("modules/player_sync/gui/dialog_failed_download")

local v2_remote_controller = compat.version_ge("2.0.0")
local recipe_notifications_api = compat.version_ge("2.0.67")

-- Returns true if the player is currently in a cutscene
local function is_in_cutscene(player)
	return player.controller_type == defines.controllers.cutscene
end

-- Remember the components a player's synced session uses, uploads are serialized with these
local function start_sync(player_record, components)
	player_record.sync = true
	player_record.components = components
end

-- Remember the controller the player had before sync code replaced it, restored when the controller is not synced
local function save_local_controller(player, player_record)
	if not player_record.local_controller then
		player_record.local_controller = serialize.serialize_local_controller(player)
	end
end

-- Create player record for bookkeeping
local function create_player(player, dirty)
	local script_data = get_script_data(true) -- no early return to support loading from single player
	script_data.players[player.name] = {
		dirty = dirty, -- Player inventory has changes that should be persisted
		sync = false, -- Player inventory is synced from the controller
		generation = 0,
	}
end

-- Remove all stored player data by this module
local function remove_player(player)
	local script_data = get_script_data()
	script_data.players_waiting_for_acquire[player.name] = nil
	script_data.players_in_cutscene_to_sync[player.name] = nil
	script_data.failed_deserialization[player.name] = nil
	script_data.active_downloads[player.name] = nil
	script_data.finished_downloads[player.name] = nil
	script_data.active_uploads[player.name] = nil
	script_data.players[player.name] = nil
end


player_sync = {}
-- This function is called by instance.js as /sc player_sync.download_inventory("danielv", Escaped JSON string, package_number, total_packages_count) with data from the controller
player_sync.download_inventory = download_inventory

-- This function is called by instance.js with the components synced on this instance
function player_sync.set_components(data)
	get_script_data().components = assert(compat.json_to_table(data))
end

-- This function is called internally when a player leaves the game to
-- serialize the player for upload.
function player_sync.serialize_player(player, player_record)
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

	local failed_deserialization = get_script_data().failed_deserialization[player.name] or {}
	local serialized_player = serialize.serialize_player(player, failed_deserialization, player_record.components)
	serialized_player.generation = player_record.generation

	return serialized_player
end

function player_sync.deserialize_player(player, finished_record)
	-- Editor mode is not supported.
	if player.controller_type == defines.controllers.editor then
		player.toggle_map_editor()
	end

	if player.controller_type == defines.controllers.editor then
		error("Unable to switch out of editor mode")
		return
	end

	local script_data = get_script_data()
	local player_record = script_data.players[player.name]
	local local_controller = player_record.local_controller or serialize.serialize_local_controller(player)

	-- Stash temporary inventory if it exists, without inventory sync the current inventory is the one to keep
	local stashed_corpse
	if serialize.syncs(finished_record.components, "inventories") and player_record.dirty and player.character then
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
	assert(type(serialized_player) == "table", "wrong type for serialized_player")
	local failed, spill =
		serialize.deserialize_player(player, serialized_player, finished_record.components, local_controller)
	script_data.failed_deserialization[player.name] = failed
	player_record.local_controller = nil

	-- Restore player position and driving state
	restore_position(player, finished_record)
	serialize.spill_items(player, spill)

	-- Transfer items from stashed inventory
	if stashed_corpse then
		local stash = stashed_corpse.get_inventory(defines.inventory.character_corpse)
		if player.character then
			local main = player.character.get_main_inventory()
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

player_sync.events = {}
player_sync.events[clusterio_api.events.on_server_startup] = function(event)
	local script_data = get_script_data(true)
	script_data.players_waiting_for_acquire = {}
	script_data.players_in_cutscene_to_sync = {}

	for _, player in pairs(game.players) do
		if not script_data.players[player.name] then
			create_player(player, true)
		end

		-- migrate: dialogs created before inventory_sync was renamed to player_sync
		local screen = player.gui.screen
		if screen.inventory_sync_progress then
			screen.inventory_sync_progress.destroy()
		end
		if screen.dialog_failed_download and screen.dialog_failed_download.inventory_sync_failed_download_content then
			screen.dialog_failed_download.destroy()
		end
	end
end

-- Cleanup
player_sync.events[defines.events.on_pre_player_removed] = function(event)
	remove_player(game.get_player(event.player_index))
end

player_sync.events[defines.events.on_player_created] = function(event)
	create_player(game.get_player(event.player_index), false)
end

function player_sync.acquire(player)
	local script_data = get_script_data()
	script_data.players_waiting_for_acquire[player.name] = {
		start_tick = game.ticks_played,
	}
	clusterio_api.send_json("player_sync_acquire", {
		player_name = player.name,
	})
end

function player_sync.check_players_waiting_for_acquire()
	local script_data = get_script_data()
	for player_name, record in pairs(script_data.players_waiting_for_acquire) do
		-- Check if the acquire player request timed out
		if game.ticks_played > record.start_tick + 600 then
			player_sync.acquire_response(compat.table_to_json({
				status = "timeout",
				player_name = player_name,
			}))
		end
	end
end

function player_sync.acquire_response(data)
	local script_data = get_script_data()
	local response = assert(compat.json_to_table(data))
	if not script_data.players_waiting_for_acquire[response.player_name] then
		clusterio_api.send_json("player_sync_release", { player_name = response.player_name })
		return
	end
	script_data.players_waiting_for_acquire[response.player_name] = nil

	local player = game.get_player(response.player_name)
	if is_in_cutscene(player) then
		response.player = player
		script_data.players_in_cutscene_to_sync[response.player_name] = response
	else
		player_sync.sync_player(response)
	end
end

function player_sync.check_players_in_cutscene()
	local script_data = get_script_data()
	for player_name, response in pairs(script_data.players_in_cutscene_to_sync) do
		if not is_in_cutscene(response.player) then
			script_data.players_in_cutscene_to_sync[player_name] = nil
			player_sync.sync_player(response)
		end
	end
end

function player_sync.sync_player(acquire_response)
	local player = assert(game.get_player(acquire_response.player_name))

	-- Editor mode is not supported.
	if player.controller_type == defines.controllers.editor then
		player.toggle_map_editor()
	end

	if player.controller_type == defines.controllers.editor then
		log("ERROR: Player sync failed, unable to switch " .. player.name .. " out of editor mode")
		player.print("ERROR: Player sync failed, unable to switch out of editor mode")
		return
	end

	local script_data = get_script_data()
	local finished_record = script_data.finished_downloads[acquire_response.player_name]
	if finished_record then
		if acquire_response.status == "acquired" and finished_record.generation == acquire_response.generation then
			player_sync.finish_download(player, finished_record)
			return
		end

		-- The acquisition either failed or the current finished download is
		-- stale, delete it and try downloading it again.
		script_data.finished_downloads[acquire_response.player_name] = nil
	end

	local download_record = script_data.active_downloads[acquire_response.player_name]
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
			script_data.active_downloads[acquire_response.player_name] = nil
		end
	end

	local player_record = script_data.players[acquire_response.player_name]
	if acquire_response.status ~= "acquired" then
		if player_record.sync and not player_record.dirty then
			if serialize.syncs(player_record.components, "inventories")
				and player.controller_type == defines.controllers.character
			then
				save_local_controller(player, player_record)
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
		and (
			not player_record.sync
			or acquire_response.generation > player_record.generation
			or serialize.newly_synced(player_record.components, script_data.components)
		)
	then
		player_sync.initiate_inventory_download(player, player_record, acquire_response.generation)

	else
		if acquire_response.generation == 0 then
			player.print(
				"Your inventory will be automatically synchronized between servers in this cluster. " ..
				"To improve sync performance, please avoid storing large blueprints in your inventory.",
				{0.75, 0.75, 1}
			)
		end

		start_sync(player_record, script_data.components)
		player_record.dirty = true
	end
end

function player_sync.finish_download(player, finished_record)
	local script_data = get_script_data()
	script_data.finished_downloads[player.name] = nil
	local player_record = script_data.players[player.name]

	local status, result = xpcall(player_sync.deserialize_player, debug.traceback, player, finished_record)
	if not status then
		log("ERROR: Deserializing player " .. player.name .. " failed: " .. result)
		player.print("ERROR: Deserializing player data failed: " .. result)
		-- Treat this as a temporary inventory so the incomplete state is not uploaded over the synced data
		player_record.dirty = true
		player_record.sync = false
		return
	end

	player_record.dirty = true
	start_sync(player_record, finished_record.components)
	player_record.generation = finished_record.generation
end

-- Download inventory from controller
player_sync.events[defines.events.on_player_joined_game] = function(event)
	local player = assert(game.get_player(event.player_index))
	local script_data = get_script_data()

	if not game.is_multiplayer() then
		return player.print("Player sync deactivated: game is single player")
	end

	-- Send acquire request even if an active download is currently in progress
	player_sync.acquire(player)

	-- Clear active upload if it exists
	script_data.active_uploads[player.name] = nil
end

player_sync.on_nth_tick = {}
player_sync.on_nth_tick[33] = function(event)
	-- Periodically check players currently in the process of syncing
	player_sync.check_players_waiting_for_acquire()
	player_sync.check_players_in_cutscene()
	player_sync.check_active_downloads()
	player_sync.check_active_uploads()
end

player_sync.events[defines.events.on_cutscene_waypoint_reached] = function(event)
	player_sync.check_players_in_cutscene()
end

player_sync.events[defines.events.on_cutscene_cancelled] = function(event)
	player_sync.check_players_in_cutscene()
end

-- Upload inventory when a player leaves the game. Triggers on restart after crash if player was online during crash.
player_sync.events[defines.events.on_pre_player_left_game] = function(event)
	-- for some reason, on_pre_player_left_game gets called before on_server_startup so script_data isn't ready yet
	-- migrate: saves from before the rename still have their data under inventory_sync
	if not compat.script_data.player_sync and not compat.script_data.inventory_sync then
		log("ERROR: script data for player sync is not defined")
		return
	end

	local script_data = get_script_data()
	local player = assert(game.get_player(event.player_index))
	local player_record = script_data.players[player.name]

	-- If player has an active download release our acquisition but let the download continue
	if script_data.active_downloads[player.name] then
		clusterio_api.send_json("player_sync_release", { player_name = player.name })
		return
	end

	if not player_record.dirty or not player_record.sync then
		-- Nothing to upload, release the acquisition so other instances are not blocked
		clusterio_api.send_json("player_sync_release", { player_name = player.name })
		return
	end

	player_record.generation = player_record.generation + 1
	local status, result = xpcall(player_sync.serialize_player, debug.traceback, player, player_record)
	if not status then
		log("ERROR: Serializing player " .. player.name .. " failed: " .. result)
		player.print("ERROR: Serializing player data failed: " .. result)
		return
	end
	script_data.active_uploads[player.name] = {
		serialized = result,
		last_attempt = game.ticks_played,
		timeout = math.random(600, 1200), -- Start with 10-20 seconds for the timeout
	}

	clusterio_api.send_json("player_sync_upload", result)
end

-- Invoked by the instance code to confirm the controller has received the uploaded data
function player_sync.confirm_upload(player_name, generation)
	local player = game.get_player(player_name)
	if not player or player.connected then
		log("no player, or player connected")
		return
	end
	local script_data = get_script_data()
	local player_record = script_data.players[player.name]
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
	script_data.active_uploads[player_name] = nil
	player_record.dirty = false
end

function player_sync.initiate_inventory_download(player, player_record, generation)
	player.print("Initiating inventory download...")
	local record = {
		started = game.ticks_played,
		last_active = game.ticks_played,
		generation = generation,
		data = "",
	}
	local script_data = get_script_data()
	record.components = script_data.components
	script_data.active_downloads[player.name] = record

	-- The plugin only sends back what differs from the current notification state
	local recipe_notifications
	if recipe_notifications_api and serialize.syncs(record.components, "recipe_notifications") then
		recipe_notifications = serialize.serialize_crafting_notifications(player)
	end

	clusterio_api.send_json("player_sync_download", {
		player_name = player.name,
		recipe_notifications = recipe_notifications,
	})

	-- If this is a synced player turn them into a spectator while the
	-- player data is downloading
	if player_record.sync and serialize.syncs(record.components, "inventories") then
		-- Store original position to teleport back to
		if v2_remote_controller then
			record.surface = player.physical_surface
			record.position = player.physical_position
		else
			record.surface = player.surface
			record.position = player.position
		end
		if player.driving then
			record.vehicle = player.vehicle
		end

		save_local_controller(player, player_record)
		local character = player.character
		player.set_controller({ type = defines.controllers.spectator })
		if character ~= nil then character.destroy() end

		-- Indicate this state shouldn't be persisted
		player_record.dirty = false
	end

	progress_dialog.display(player, 0, 1)
end

function player_sync.check_active_downloads()
	-- Used for detecting the inventory download failing, like when the map is saved and
	-- re-loaded in the middle of a download. The player will be returned to a playable state.
	local script_data = get_script_data()
	for player_name, record in pairs(script_data.active_downloads) do
		if record.last_active <= game.ticks_played - 600 then
			script_data.active_downloads[player_name] = nil
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

function player_sync.check_active_uploads()
	local script_data = get_script_data()
	for player_name, record in pairs(script_data.active_uploads) do
		if record.last_attempt + record.timeout < game.ticks_played then
			local player_record = script_data.players[player_name]
			local player = game.get_player(player_name)
			if not player_record or not player then
				script_data.active_uploads[player_name] = nil
			else
				log("Retrying upload for " .. player_name)
				record.last_attempt = game.ticks_played
				record.timeout = math.random(record.timeout, record.timeout * 2)
				clusterio_api.send_json("player_sync_upload", record.serialized)
			end
		end
	end
end

return player_sync
