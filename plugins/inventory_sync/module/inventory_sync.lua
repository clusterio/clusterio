--[[

When a player leaves the game, serialize their inventory and upload it to the master.

When a player joins the game, send a request to the master server for the players inventory.

When the master sends an inventory, parse it and give it to the player.

]]

local serialize = require("modules/clusterio/serialize")
local clusterio_api = require("modules/clusterio/api")
local progress_dialog = require("modules/inventory_sync/progress_dialog")

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
    local player = game.players[playerIndex]
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

-- This function is called by instance.js as /sc inventory_sync.downloadInventory("danielv", Escaped JSON string) with data from the master
function inventory_sync.downloadInventory(playerName, data, number, total)
    local player = game.players[playerName]
    if player == nil then return end
    if number then
        if global.download_cache[playerName] == nil then
            global.download_cache[playerName] = ""
        end
        -- Append data to download cache
        global.download_cache[playerName] = global.download_cache[playerName] .. data
    end

    if number ~= total then
        -- Show progress in console
        -- game.players[playerName].print("Downloaded "..(number + 1).."/"..total.." parts")
        -- Show progress in GUI
        progress_dialog(player, number+1, total)

        -- Request next segment
        rcon.print("Segment downloaded")
    else
        -- Recreate player character
        player.set_controller {
            type = defines.controllers.god,
        }
        player.create_character()
        -- Load downloaded inventory
        local serialized_player = game.json_to_table(global.download_cache[playerName])
        global.download_cache[playerName] = nil -- remove data to lower mapsize
        local player = game.players[playerName]
        -- Load inventories
        for _, inv in pairs(inventories) do
            local inventory = player.get_inventory(inv)
            if inventory ~= nil and serialized_player.inventories[tostring(inv)] ~= nil then
                serialize.deserialize_inventory(inventory, serialized_player.inventories[tostring(inv)])
            end
        end

        -- Load personal logistics slots
        for i = 1, 200 do
            local slot = serialized_player.personal_logistic_slots[tostring(i)]
            if slot ~= nil then
                player.set_personal_logistic_slot(i, slot)
            end
        end

        -- Load hotbar, don't overwrite empty slots
        for i = 1, 100 do
            -- if serialized_player.hotbar[i] ~= nil then
            player.set_quick_bar_slot(i, game.item_prototypes[serialized_player.hotbar[i]])
            -- end
        end

        -- Load crafting queue
        for _, queueItem in pairs(serialized_player.crafting_queue) do
            player.begin_crafting {
                count = queueItem.count,
                recipe = queueItem.recipe,
                silent = true, -- Fail silently if items are missing
            }
        end

        -- Misc
        player.cheat_mode = serialized_player.cheat_mode
        player.force = serialized_player.force -- Force by name as string
        player.tag = serialized_player.tag
        player.color = serialized_player.color
        player.chat_color = serialized_player.chat_color

        player.character_crafting_speed_modifier = serialized_player.character_crafting_speed_modifier
        player.character_mining_speed_modifier = serialized_player.character_mining_speed_modifier
        player.character_additional_mining_categories = serialized_player.character_additional_mining_categories
        player.character_running_speed_modifier = serialized_player.character_running_speed_modifier
        player.character_build_distance_bonus = serialized_player.character_build_distance_bonus
        player.character_item_drop_distance_bonus = serialized_player.character_item_drop_distance_bonus
        player.character_reach_distance_bonus = serialized_player.character_reach_distance_bonus
        player.character_resource_reach_distance_bonus = serialized_player.character_resource_reach_distance_bonus
        player.character_item_pickup_distance_bonus = serialized_player.character_item_pickup_distance_bonus
        player.character_loot_pickup_distance_bonus = serialized_player.character_loot_pickup_distance_bonus
        player.character_inventory_slots_bonus = serialized_player.character_inventory_slots_bonus
        player.character_trash_slot_count_bonus = serialized_player.character_trash_slot_count_bonus
        player.character_maximum_following_robot_count_bonus = serialized_player.character_maximum_following_robot_count_bonus
        player.character_health_bonus = serialized_player.character_health_bonus
        player.character_personal_logistic_requests_enabled = serialized_player.character_personal_logistic_requests_enabled

        if serialized_player.flashlight then
            player.enable_flashlight()
        else
            player.disable_flashlight()
        end

        local startTick = global["inv_sync_download_start_tick "..game.players[playerName].name]
        game.print("Imported inventory for "..playerName.." in "..game.tick - startTick.." ticks")
    end
end

-- Upload inventory when a player leaves the game. Triggers on restart after crash if player was online during crash.
inventory_sync.events[defines.events.on_player_left_game] = function(event)
    local playerIndex = event.player_index
    inventory_sync.uploadInventory(playerIndex)
    global.download_cache[playerIndex] = "" -- Clear cache to avoid leaking memory to people quitting during download
end

function inventory_sync.uploadInventory(playerIndex)
    local player = game.players[playerIndex]

    local serialized_player = {
        name = player.name,
        inventories = {},
        hotbar = {},
        color = player.color,
        chat_color = player.chat_color,
        tag = player.tag,
        -- admin = player.admin, -- This is handled by other parts of clusterio
        personal_logistic_slots = {},
        force = player.force.name,
        cheat_mode = player.cheat_mode,
        crafting_queue = {},
        character_crafting_speed_modifier = player.character_crafting_speed_modifier,
        character_mining_speed_modifier = player.character_mining_speed_modifier,
        character_additional_mining_categories = player.character_additional_mining_categories,
        character_running_speed_modifier = player.character_running_speed_modifier,
        character_build_distance_bonus = player.character_build_distance_bonus,
        character_item_drop_distance_bonus = player.character_item_drop_distance_bonus,
        character_reach_distance_bonus = player.character_reach_distance_bonus,
        character_resource_reach_distance_bonus = player.character_resource_reach_distance_bonus,
        character_item_pickup_distance_bonus = player.character_item_pickup_distance_bonus,
        character_loot_pickup_distance_bonus = player.character_loot_pickup_distance_bonus,
        character_inventory_slots_bonus = player.character_inventory_slots_bonus,
        character_trash_slot_count_bonus = player.character_trash_slot_count_bonus,
        character_maximum_following_robot_count_bonus = player.character_maximum_following_robot_count_bonus,
        character_health_bonus = player.character_health_bonus,
        character_personal_logistic_requests_enabled = player.character_personal_logistic_requests_enabled,

        flashlight = player.is_flashlight_enabled(),
    }

    -- Serialize hotbar
    for i = 1, 100 do
        serialized_player.hotbar[i] = {}
        local slot = player.get_quick_bar_slot(i)
        if slot ~= nil and slot.name ~= nil then
            serialized_player.hotbar[i] = slot.name
        end
    end

    -- Serialize personal logistics slots
    for i = 1, 200 do -- Nobody will have more than 200 logistics slots, right?
        local slot = player.get_personal_logistic_slot(i)
        if slot.name ~= nil then
            -- We leave [1] empty to force the JSON function to parse it as an object.
            -- When its parsed as an array we get inconsistent key datatypes depending
            -- on whether or not it is sparse.
            serialized_player.personal_logistic_slots[i+1] = {
                name = slot.name,
                min = slot.min,
                max = slot.max,
            }
        end
    end

    -- Serialize inventories
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
