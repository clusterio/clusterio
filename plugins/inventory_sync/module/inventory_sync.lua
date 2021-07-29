--[[

When a player leaves the game, serialize their inventory and upload it to the master.

When a player joins the game, wait until they have a character, then send a request to 
the master server for the players inventory.

When the master sends an inventory, parse it and give it to the player.
If the master responds that its a new player, show a welcome message.

]]

local clusterio_api = require("modules/clusterio/api")
local add_commands = require("modules/inventory_sync/commands")
local upload_inventory = require("modules/inventory_sync/upload_inventory")
local download_inventory = require("modules/inventory_sync/download_inventory")
local welcome_new_player = require("modules/inventory_sync/gui/welcome_new_player")
local handle_gui_events = require("modules/inventory_sync/gui/handle_gui_events")
local dialog_failed_download = require("modules/inventory_sync/gui/dialog_failed_download")
local clean_dirty_inventory = require("modules/inventory_sync/script/clean_dirty_inventory")

inventory_sync = {}
inventory_sync.welcome_new_player = welcome_new_player
-- This function is called by instance.js as /sc inventory_sync.download_inventory("danielv", Escaped JSON string, package_number, total_packages_count) with data from the master
inventory_sync.download_inventory = download_inventory
-- This function is called internally when a player leaves the game for their inventory to upload to the master
inventory_sync.upload_inventory = upload_inventory

inventory_sync.add_commands = add_commands
inventory_sync.events = {}
inventory_sync.events[clusterio_api.events.on_server_startup] = function(event)
	-- set up global table
	if not global.inventory_sync then
		global.inventory_sync = {
			download_start_tick = {},
			saved_crafting_queue = {},
			download_cache = {},
			players_waiting_for_download = {},
			players = {},
		}
	end
end

-- Cleanup
inventory_sync.events[defines.events.on_player_removed] = function(event)
	local player = game.get_player(event.player_index)

	-- Remove inventory download performance counter
	global.inventory_sync.download_start_tick[player.name] = nil
	-- Remove stored crafting queue
	global.inventory_sync.saved_crafting_queue[player.name] = nil
	-- Remove other player data
	global.inventory_sync.players[player.name] = nil
end

inventory_sync.events[defines.events.on_player_created] = function(event)
	local player = game.get_player(event.player_index)
	global.inventory_sync.players[player.name] = {
		dirty_inventory = false, -- Player has a temporary non-synced inventory that should be persisted
		sync_start_tick = 0, -- To track download failure timeout
	}
end

inventory_sync.events[defines.events.on_gui_click] = handle_gui_events

-- Download inventory from master
inventory_sync.events[defines.events.on_player_joined_game] = function(event)
	-- Add player to download queue. Inventory won't be downloaded before the player has a character
	global.inventory_sync.players_waiting_for_download[game.get_player(event.player_index).name] = true
	-- Don't wait for on_nth_tick if not required
	inventory_sync.check_player_character_before_download()
end

inventory_sync.on_nth_tick = {}
inventory_sync.on_nth_tick[33] = function(event)
	-- Periodically check if player has a character to download to. False in cutscenes.
	inventory_sync.check_player_character_before_download()

	-- Check if download has failed and we should create a dirty inventory
	inventory_sync.check_inventory_download_failed()
end

-- Upload inventory when a player leaves the game. Triggers on restart after crash if player was online during crash.
inventory_sync.events[defines.events.on_pre_player_left_game] = function(event)
	-- for some reason, on_pre_player_left_game gets called before on_server_startup so global isn't ready yet
	if not global.inventory_sync then 
		log("ERROR: Global inventory sync not defined")
		return
	end

	local player_index = event.player_index
	local player = game.get_player(player_index)
	-- Avoid uploading for unsynced players (due to not having a character, ex during freeplay cutscene)
	if global.inventory_sync.players_waiting_for_download[player.name] == nil then
		inventory_sync.upload_inventory(player_index)
		global.inventory_sync.download_cache[player_index] = "" -- Clear cache to avoid leaking memory to people quitting during download
	end
	global.inventory_sync.players_waiting_for_download[player.name] = nil
end

function inventory_sync.check_player_character_before_download()
	-- Check if players waiting for download have a valid character
	for name in pairs(global.inventory_sync.players_waiting_for_download) do
		local player = game.get_player(name)
		if player.character ~= nil then
			global.inventory_sync.players_waiting_for_download[name] = nil
			inventory_sync.initiate_inventory_download(player)
		end
	end
end

function inventory_sync.initiate_inventory_download(player)
	player.print("Initiating inventory download...")
	global.inventory_sync.download_start_tick[player.name] = game.tick
	global.inventory_sync.download_cache[player.name] = ""
	clusterio_api.send_json("inventory_sync_download", {
		player_name = player.name
	})

	-- Handle dirty inventories. A dirty inventory is a temporary inventory that has been used while waiting
	-- for sync. It should be taken care of in some way, like putting it in a corpse or a chest.
	if global.inventory_sync.players[player.name].dirty_inventory then
		clean_dirty_inventory(player)
	end

	-- Set player into ghost mode for duration of download
	local character = player.character
	player.set_controller {
		type = defines.controllers.ghost,
	}
	if character ~= nil then character.destroy() end

	-- Start timeout for detecting master connection failure
	global.inventory_sync.players[player.name].sync_start_tick = game.tick
end
function inventory_sync.check_inventory_download_failed()
	-- Used for letting the master report the inventory download failing, like when the master is offline or an 
	-- error occurs somewhere in the server code. The player will be returned to a playable state.
	for name, data in pairs(global.inventory_sync.players) do
		if data.sync_start_tick ~= 0 and data.sync_start_tick <= game.tick - 600 then
			-- Stop refreshing timer
			data.sync_start_tick = 0

			local player = game.get_player(name)
			player.print("Inventory download failed due to master connection")
			-- Show GUI with option to retry or abort download
			dialog_failed_download(player)
		end
	end
end

return inventory_sync
