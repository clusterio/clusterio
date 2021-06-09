--[[

When a player leaves the game, serialize their inventory and upload it to the master.

When a player joins the game, send a request to the master server for the players inventory.

When the master sends an inventory, parse it and give it to the player.


packages/slave/modules/clusterio
]]

local serialize = require("modules/clusterio/serialize")
local clusterio_api = require("modules/clusterio/api")

local inventories = {
    defines.inventory.character_main,	
    defines.inventory.character_guns,
    defines.inventory.character_ammo,
    defines.inventory.character_armor,
    defines.inventory.character_vehicle,
    defines.inventory.character_trash,
}

inventory_sync = {}

inventory_sync.events = {}
-- Download inventory from master
inventory_sync.events[defines.events.on_player_joined_game] = function(event)
	local playerIndex = event.player_index
    inventory_sync.initiateInventoryDownload(playerIndex)
end

function inventory_sync.initiateInventoryDownload(playerIndex)
    game.players[playerIndex].print("Initiating inventory download...")
    global["inv_sync_download_start_tick "..game.players[playerIndex].name] = game.tick
    clusterio_api.send_json("inventory_sync_download", {
        player_name = game.players[playerIndex].name
    })
end

-- This function is called by instance.js as /sc inventory_sync.downloadInventory("danielv", Escaped JSON string) with data from the master
function inventory_sync.downloadInventory(playerName, data)
    local serialized_player = game.json_to_table(data)
    local player = game.players[playerName]
    -- game.print(serpent.block(serialized_player))
    for _, inv in pairs(inventories) do
        local inventory = player.get_inventory(inv)
        if inventory ~= nil and serialized_player.inventories[tostring(inv)] ~= nil then
            serialize.deserialize_inventory(inventory, serialized_player.inventories[tostring(inv)])
        end
    end
    local startTick = global["inv_sync_download_start_tick "..game.players[playerName].name]
    game.print("Imported inventory for "..playerName.." in "..game.tick - startTick.." ticks")
end

-- Upload inventory when a player leaves the game. Triggers on restart after crash if player was online during crash.
inventory_sync.events[defines.events.on_player_left_game] = function(event)
    local playerIndex = event.player_index
    
    inventory_sync.uploadInventory(playerIndex)
end

function inventory_sync.uploadInventory(playerIndex)
    local player = game.players[playerIndex]

    local serialized_player = {
        name = player.name,
        inventories = {}
    }

    for _, inv in pairs(inventories) do
        local inventory = player.get_inventory(inv)
        if inventory ~= nil then
            local serialized_inventory = serialize.serialize_inventory(inventory)
            serialized_player.inventories[inv] = serialized_inventory
        end
    end
    clusterio_api.send_json("inventory_sync_upload", serialized_player)
end

return inventory_sync
