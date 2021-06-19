local clusterio_api = require("modules/clusterio/api")
local serialize = require("modules/clusterio/serialize")
local inventories = require("modules/inventory_sync/define_player_inventories")
local save_crafts = require("modules/inventory_sync/save_crafts")
local ensure_character = require("modules/inventory_sync/ensure_character")

function upload_inventory(playerIndex)
    local player = game.get_player(playerIndex)

    -- Force player to have a character to prevent access errors
    ensure_character(player)

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

    -- Serialize crafting queue saved by /csc or /save-crafts OR automatically
    save_crafts({player_index = player.name})
    serialized_player.crafting_queue = global.inventory_sync.saved_crafting_queue[player.name]
    if serialized_player.crafting_queue == nil then
        serialized_player.crafting_queue = {}
    end

    clusterio_api.send_json("inventory_sync_upload", serialized_player)
    
    -- Clear saved crafting queue
    global.inventory_sync.saved_crafting_queue[player.name] = nil
end

return upload_inventory
