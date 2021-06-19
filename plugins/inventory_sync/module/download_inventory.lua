local progress_dialog = require("modules/inventory_sync/progress_dialog")
local serialize = require("modules/clusterio/serialize")
local load_crafting_queue = require("modules/inventory_sync/load_crafting_queue")
local inventories = require("modules/inventory_sync/define_player_inventories")
local ensure_character = require("modules/inventory_sync/ensure_character")

function download_inventory(player_name, data, number, total)
    local player = game.get_player(player_name)
    if player == nil then
        log("Player not found! "..player_name)
        return
    end
    if number then
        if global.inventory_sync.download_cache[player_name] == nil then
            global.inventory_sync.download_cache[player_name] = ""
        end
        -- Append data to download cache
        global.inventory_sync.download_cache[player_name] = global.inventory_sync.download_cache[player_name] .. data
    end

    if number ~= total then
        -- Show progress in console
        -- player.print("Downloaded "..(number + 1).."/"..total.." parts")
        -- Show progress in GUI
        progress_dialog(player, number+1, total)

        -- Request next segment
        rcon.print("Segment downloaded")
    else
        -- Recreate player character
        ensure_character(player)

        -- Remove freeplay skip cutscene label
        if player.gui.screen.skip_cutscene_label then
            player.gui.screen.skip_cutscene_label.destroy()
        end

        local character = player.character or player.cutscene_character

        -- Load downloaded inventory
        local serialized_player = game.json_to_table(global.inventory_sync.download_cache[player_name])
        global.inventory_sync.download_cache[player_name] = nil -- remove data to lower mapsize

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

        character.character_crafting_speed_modifier = serialized_player.character_crafting_speed_modifier
        character.character_mining_speed_modifier = serialized_player.character_mining_speed_modifier
        character.character_additional_mining_categories = serialized_player.character_additional_mining_categories
        character.character_running_speed_modifier = serialized_player.character_running_speed_modifier
        character.character_build_distance_bonus = serialized_player.character_build_distance_bonus
        character.character_item_drop_distance_bonus = serialized_player.character_item_drop_distance_bonus
        character.character_reach_distance_bonus = serialized_player.character_reach_distance_bonus
        character.character_resource_reach_distance_bonus = serialized_player.character_resource_reach_distance_bonus
        character.character_item_pickup_distance_bonus = serialized_player.character_item_pickup_distance_bonus
        character.character_loot_pickup_distance_bonus = serialized_player.character_loot_pickup_distance_bonus
        character.character_inventory_slots_bonus = serialized_player.character_inventory_slots_bonus
        character.character_trash_slot_count_bonus = serialized_player.character_trash_slot_count_bonus
        character.character_maximum_following_robot_count_bonus = serialized_player.character_maximum_following_robot_count_bonus
        character.character_health_bonus = serialized_player.character_health_bonus
        character.character_personal_logistic_requests_enabled = serialized_player.character_personal_logistic_requests_enabled

        if serialized_player.flashlight then
            player.enable_flashlight()
        else
            player.disable_flashlight()
        end

        local startTick = global.inventory_sync.download_start_tick[player.name]
        local log_line = "Imported inventory for "..player_name.." in "..game.tick - startTick.." ticks"
        player.print(log_line)
        log("[inventory_sync] "..log_line)
    end
end

return download_inventory
