--[[

When a player leaves the game, serialize their inventory and upload it to the master.

When a player joins the game, send a request to the master server for the players inventory.

When the master sends an inventory, parse it and give it to the player.

]]

local clusterio_api = require("modules/clusterio/api")
local add_commands = require("modules/inventory_sync/commands")
local upload_inventory = require("modules/inventory_sync/upload_inventory")
local download_inventory = require("modules/inventory_sync/download_inventory")

inventory_sync = {}

inventory_sync.add_commands = add_commands
inventory_sync.events = {}
-- Cleanup
inventory_sync.events[defines.events.on_player_removed] = function(event)
    local player = game.get_player(event.player_index)

    -- Remove inventory download performance counter
    global["inv_sync_download_start_tick "..player.name] = nil
    -- Remove stored crafting queue
    global["saved_crafting_queue_"..player.name] = nil
end

-- Download inventory from master
inventory_sync.events[defines.events.on_player_joined_game] = function(event)
	local playerIndex = event.player_index
    inventory_sync.initiateInventoryDownload(playerIndex)
end

-- Upload inventory when a player leaves the game. Triggers on restart after crash if player was online during crash.
inventory_sync.events[defines.events.on_pre_player_left_game] = function(event)
    local playerIndex = event.player_index
    inventory_sync.uploadInventory(playerIndex)
    global.download_cache[playerIndex] = "" -- Clear cache to avoid leaking memory to people quitting during download
end

function inventory_sync.initiateInventoryDownload(playerIndex)
    local player = game.get_player(playerIndex)
    player.print("Initiating inventory download...")
    global["inv_sync_download_start_tick "..player.name] = game.tick
    if global.download_cache == nil then
        global.download_cache = {}
    end
    global.download_cache[playerIndex] = ""
    clusterio_api.send_json("inventory_sync_download", {
        player_name = player.name
    })

    -- Set player into ghost mode for duration of download
    local character = player.character
    player.set_controller {
        type = defines.controllers.ghost,
    }
    if character ~= nil then character.destroy() end
end

-- This function is called by instance.js as /sc inventory_sync.downloadInventory("danielv", Escaped JSON string, package_number, total_packages_count) with data from the master
inventory_sync.downloadInventory = download_inventory
-- This function is called internally when a player leaves the game for their inventory to upload to the master
inventory_sync.uploadInventory = upload_inventory

return inventory_sync
