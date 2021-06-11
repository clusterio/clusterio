local progress_dialog = require("modules/inventory_sync/progress_dialog")
local serialize = require("modules/clusterio/serialize")
local load_crafting_queue = require("modules/inventory_sync/load_crafting_queue")
local inventories = require("modules/inventory_sync/define_player_inventories")

function download_inventory(playerName, data, number, total)
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
            local slot = serialized_player.personal_logistic_slots[tostring(i+1)] -- 1 is empty to force array to be spare
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
        load_crafting_queue(serialized_player.crafting_queue, player)        

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
        local log_line = "Imported inventory for "..playerName.." in "..game.tick - startTick.." ticks"
        player.print(log_line)
        log("[inventory_sync] "..log_line)
    end
end

return download_inventory
