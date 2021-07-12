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
local welcome_new_player = require("modules/inventory_sync/welcome_new_player")

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
end

-- Download inventory from master
inventory_sync.events[defines.events.on_player_joined_game] = function(event)
    -- Add player to download queue. Inventory won't be downloaded before the player has a character
    global.inventory_sync.players_waiting_for_download[game.get_player(event.player_index).name] = true
    -- Don't wait for on_nth_tick if not required
    inventory_sync.check_player_character_before_download()
end

inventory_sync.on_nth_tick = {}
inventory_sync.on_nth_tick[33] = function(event)
    inventory_sync.check_player_character_before_download()
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

    -- Set player into ghost mode for duration of download
    local character = player.character
    player.set_controller {
        type = defines.controllers.ghost,
    }
    if character ~= nil then character.destroy() end
end

return inventory_sync
