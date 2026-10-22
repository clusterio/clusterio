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
local function save_local_controller(player, player_record, components)
	if not player_record.local_controller then
		player_record.local_controller = serialize.serialize_local_controller(player, components)
	end
end

-- Create player record for bookkeeping
local function create_player(player, dirty)
	local script_data = get_script_data(true) -- no early return to support loading from single player
	script_data.players[player.name] = {
		dirty = dirty, -- Player inventory has changes that should be persisted
		sync_in_progress = false, -- Player data is being downloaded, the current state should not be persisted
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

-- Remove the temporary inventory bonus a deserialized character got to fit its main inventory
local function remove_inventory_bonus_raise(script_data, player_name)
	local raises = script_data.inventory_bonus_raises
	local raise = raises and raises[player_name]
	if raise then
		raises[player_name] = nil
		local character = raise.character
		if character.valid then
			character.character_inventory_slots_bonus = character.character_inventory_slots_bonus - raise.bonus
		end
	end
end

-- Turn a synced player into a spectator while their player data is downloaded or applied, if this instance syncs
-- inventories, and keep where their body stood in record for restore_position. The old body goes, with its crafting
-- queue. Until the data is applied, the player's state isn't persisted.
local function spectate(player, player_record, record)
	-- Indicate the current state shouldn't be persisted
	player_record.sync_in_progress = true

	if player_record.sync and serialize.syncs(record.components, "inventories") then
		-- Store original position to teleport back to. Only once per record: a rejoin while a prefetched copy is held
		-- spectates again, and the spectator's position then isn't where the body stood
		if record.position == nil then
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
		end

		save_local_controller(player, player_record, record.components)
		local character = player.character
		player.set_controller({ type = defines.controllers.spectator })
		if character ~= nil then character.destroy() end
	end
end


player_sync = {}
-- This function is called by instance.js as /sc player_sync.download_inventory("danielv", Escaped JSON string, package_number, total_packages_count) with data from the controller
player_sync.download_inventory = download_inventory

-- This function is called by instance.js with the components synced on this instance
function player_sync.set_components(data)
	get_script_data().components = assert(compat.json_to_table(data))
end

-- For plugins that move players to another instance: remote.call("player_sync", "set_destination", player_name,
-- instance_id) just before LuaPlayer.connect_to_server, with the destination's Clusterio instance id. It only records
-- it; if the player then leaves to switch servers, the upload carries it and the controller sends the player's data
-- on to that instance (README, "Sending player data ahead"). A later call replaces it, and every leave clears it.
remote.add_interface("player_sync", {
	set_destination = function(player_name, instance_id)
		-- Integers only: table_to_json writes inf and nan bare, which the host can't parse, so the upload carrying it
		-- would fail on every retry and the session would be lost (inf % 1 and nan % 1 are nan, never 0)
		if type(instance_id) ~= "number" or instance_id % 1 ~= 0 then
			return
		end
		local player_record = get_script_data().players[player_name]
		if player_record then
			player_record.destination = instance_id
		end
	end,
})

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
	-- Always sent so the controller can tell this instance supports epochs
	serialized_player.epoch = player_record.epoch or 0

	-- Leaving on the tick of a download the temporary bonus is still there and must not be uploaded. Removing it
	-- from the character here would shrink the main inventory before the armor's bonus applies and spill items.
	local raises = get_script_data().inventory_bonus_raises
	local raise = raises and raises[player.name]
	local character = serialized_player.character
	if raise and character and raise.character == player.character then
		character.character_inventory_slots_bonus = character.character_inventory_slots_bonus - raise.bonus
	end

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
	local local_controller = player_record.local_controller
		or serialize.serialize_local_controller(player, finished_record.components)

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
	-- An earlier raise not removed yet is replaced, the character's inventory bonus is restored with the data
	script_data.inventory_bonus_raises[player.name] = nil
	local failed, spill, inventory_bonus_raise =
		serialize.deserialize_player(player, serialized_player, finished_record.components, local_controller)
	script_data.failed_deserialization[player.name] = failed
	player_record.local_controller = nil
	if inventory_bonus_raise and inventory_bonus_raise > 0 then
		script_data.inventory_bonus_raises[player.name] = {
			character = player.character,
			bonus = inventory_bonus_raise,
		}
	end

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

-- Whether a join should take the stored data: there is some, and this save hasn't synced the player in that epoch at
-- that generation or newer with every component synced here now. A player without a record here has nothing to keep.
local function download_needed(player_record, acquire_response, script_data)
	return acquire_response.has_data
		and (
			not player_record
			or not player_record.sync
			or (player_record.epoch or 0) ~= (acquire_response.epoch or 0)
			or acquire_response.generation > player_record.generation
			or serialize.newly_synced(player_record.components, script_data.components)
		)
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
	-- Epoch is bumped when an admin replaces or deletes the stored data
	local epoch = acquire_response.epoch or 0
	-- A prefetched copy (player_sync.prefetch_inventory) is used only if this reply acquires the player at the copy's
	-- generation and epoch, from the controller run that sent it (token), and the copy was sent with the components
	-- synced here now. The generation alone isn't enough: a controller that crashed before saving it restarts at the
	-- last saved generation, and another instance's upload can then reuse the same number with other data. Otherwise
	-- the copy goes, and the join carries on as if it had never come: today's download or failure dialog, never the
	-- restart path below, which only sees a different generation or epoch. A copy this save doesn't need goes too,
	-- keeping the local data: an upload from an instance with older data can take the generation this save already
	-- holds.
	-- A copy confirmed at an earlier join already took the body (spectate keeps where it stood), and the local data
	-- went with it, so a join that drops that copy downloads.
	local body_taken -- the dropped copy that took the body
	for _, downloads in ipairs({ script_data.finished_downloads, script_data.active_downloads }) do
		local record = downloads[acquire_response.player_name]
		if record and record.prefetch and (not (
			acquire_response.status == "acquired" and record.generation == acquire_response.generation
			and (record.epoch or 0) == epoch and record.token == acquire_response.token
			and serialize.same_components(record.components, script_data.components)
		) or not download_needed(script_data.players[acquire_response.player_name], acquire_response, script_data)) then
			if record.position ~= nil then
				body_taken = record
			end
			downloads[acquire_response.player_name] = nil
		end
	end

	local finished_record = script_data.finished_downloads[acquire_response.player_name]
	if finished_record then
		if
			acquire_response.status == "acquired"
			and finished_record.generation == acquire_response.generation
			and (finished_record.epoch or 0) == epoch
		then
			if finished_record.prefetch then
				-- As a download does: the body left here goes, and the copy makes a new character where it stood
				spectate(player, script_data.players[player.name], finished_record)
				if player_sync.finish_download(player, finished_record) then
					log("Applied prefetched player data for " .. player.name)
				end
				return
			end
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
		if
			acquire_response.status == "acquired"
			and download_record.generation == acquire_response.generation
			and (download_record.epoch or 0) == epoch
		then
			if download_record.prefetch then
				-- The copy is still arriving: spectate as a download does, and its last chunk applies it
				spectate(player, script_data.players[player.name], download_record)
				progress_dialog.display(player, 0, 1)
				download_record.confirmed = true
				return
			end
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
			download_record.generation = acquire_response.generation
			download_record.epoch = epoch
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
		if player_record.sync and (not player_record.dirty or player_record.sync_in_progress) then
			if serialize.syncs(player_record.components, "inventories")
				and player.controller_type == defines.controllers.character
			then
				save_local_controller(player, player_record, player_record.components)
				local character = player.character
				player.set_controller({ type = defines.controllers.spectator })
				if character then character.destroy() end
			end
			player_record.sync = false
		end
		player_record.sync_in_progress = false
		dialog_failed_download.create(player, acquire_response)
		return
	end

	local stale = (player_record.epoch or 0) ~= epoch
	if body_taken or download_needed(player_record, acquire_response, script_data) then
		player_sync.initiate_inventory_download(player, player_record, acquire_response.generation, epoch)
		if body_taken then
			-- spectate kept the spectator's place, the body stood where the dropped copy kept
			local download = script_data.active_downloads[player.name]
			download.surface = body_taken.surface
			download.position = body_taken.position
			download.vehicle = body_taken.vehicle
		end

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
		player_record.sync_in_progress = false
		-- Deleted data keeps its generation and epoch so the next upload is accepted as the new baseline
		player_record.epoch = epoch
		-- A copy from another epoch has nothing to do with the stored generation
		if stale then
			player_record.generation = acquire_response.generation
		else
			player_record.generation = math.max(player_record.generation, acquire_response.generation)
		end
	end
end

--- @return boolean? applied true when the player data was deserialized
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
		player_record.sync_in_progress = false
		return
	end

	player_record.dirty = true
	player_record.sync_in_progress = false
	start_sync(player_record, finished_record.components)
	player_record.generation = finished_record.generation
	player_record.epoch = finished_record.epoch
	return true
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

-- Raised for a restored armor after its equipment's inventory bonus applied, the temporary bonus is no longer needed
player_sync.events[defines.events.on_player_armor_inventory_changed] = function(event)
	local player = assert(game.get_player(event.player_index))
	remove_inventory_bonus_raise(get_script_data(), player.name)
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
	-- Recorded by set_destination. Every leave clears it; only an uploading switching_servers leave sends it on.
	local destination = player_record.destination
	player_record.destination = nil

	local download = script_data.active_downloads[player.name]
	if download and download.prefetch then
		-- A prefetched copy is confirmed per join: the next join's acquire reply confirms it again. Until then it has
		-- replaced nothing here, so the checks below decide the upload. One whose join took the body (spectate) left
		-- sync_in_progress set, and uploads nothing.
		download.confirmed = nil

	elseif download then
		-- If player has an active download release our acquisition but let the download continue
		clusterio_api.send_json("player_sync_release", { player_name = player.name })
		return
	end

	if not player_record.dirty or not player_record.sync or player_record.sync_in_progress then
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
	-- The controller sends the stored data on to that instance while the client reconnects. In the serialized table,
	-- so a retried upload (check_active_uploads) carries it too.
	if destination and event.reason == defines.disconnect_reason.switching_servers then
		result.destination_instance_id = destination
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

function player_sync.initiate_inventory_download(player, player_record, generation, epoch)
	player.print("Initiating inventory download...")
	local record = {
		started = game.ticks_played,
		last_active = game.ticks_played,
		generation = generation,
		epoch = epoch,
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

	spectate(player, player_record, record)

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

-- Called by instance.ts as /sc player_sync.prefetch_inventory('name', generation, 'chunk', number, total, components,
-- token, epoch) with a copy of a player's stored data that the controller sent ahead (PrefetchEvent) while they switch
-- to this server. It holds the copy for a player who is offline here or doesn't exist yet. Every chunk carries the
-- token and epoch, so chunks of another copy never land in this one. It prints only when it refuses or ignores a chunk,
-- which stops the host sending the rest.
--- @param components string? JSON of the components the instance stripped the copy by, given with the first chunk
--- @param token string? The controller run that sent the copy
--- @param epoch integer? The stored data's epoch, bumped when an admin replaces or deletes it
function player_sync.prefetch_inventory(player_name, generation, data, number, total, components, token, epoch)
	epoch = epoch or 0
	local script_data = get_script_data()
	if number == 1 then
		local player = game.get_player(player_name)
		local active = script_data.active_downloads[player_name]
		local finished = script_data.finished_downloads[player_name]
		if player and player.connected then
			rcon.print("Refused prefetch for " .. player_name .. ": online here, their join downloads")
			return
		end
		if active and not active.prefetch then
			-- download_inventory has no generation check, so its remaining chunks would land in the copy
			rcon.print("Refused prefetch for " .. player_name .. ": a download is in progress")
			return
		end
		-- Two copies can reach here out of order (applyRecipeNotificationDelta awaits zlib). A held finished copy of the
		-- same generation is replaced: the newer copy of the same number is what the controller holds now. A copy
		-- with another token came from an earlier controller run, which may have crashed before saving that
		-- generation, and one with another epoch from the other side of an admin's import or delete, which can start
		-- the generations over. Either way the generations don't compare, and the arriving copy replaces the held one
		local function comparable(held)
			return held.token == token and (held.epoch or 0) == epoch
		end
		local active_newer = active and comparable(active) and active.generation >= generation
		local finished_newer = finished and comparable(finished) and finished.generation > generation
		if active_newer or finished_newer then
			rcon.print("Refused prefetch for " .. player_name .. ": generation " .. generation .. " is not newer")
			return
		end
		-- A held copy (or offline-finished download) whose join took the body knows where it stood, and that the body
		-- is gone (sync_player's body_taken): the copy replacing it keeps both
		local held = active or finished
		script_data.finished_downloads[player_name] = nil
		script_data.active_downloads[player_name] = {
			started = game.ticks_played,
			last_active = game.ticks_played,
			generation = generation,
			data = "",
			prefetch = true,
			token = token,
			epoch = epoch,
			components = components and compat.json_to_table(components),
			surface = held and held.surface,
			position = held and held.position,
			vehicle = held and held.vehicle,
		}
	end

	local record = script_data.active_downloads[player_name]
	if not (
		record and record.prefetch and record.generation == generation and record.token == token
		and (record.epoch or 0) == epoch
	) then
		-- Refused at chunk 1, dropped by the acquire reply or the inactivity check, or replaced by a newer copy
		rcon.print("Ignored prefetch chunk " .. number .. " for " .. player_name)
		return
	end
	download_inventory(player_name, data, number, total)
end

return player_sync
