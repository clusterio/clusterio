local clusterio_api = require("modules/clusterio/api")
local serialize = require("modules/clusterio/serialize")
local inventories = require("modules/inventory_sync/define_player_inventories")
local save_crafts = require("modules/inventory_sync/save_crafts")
local player_stat_keys = require("modules/inventory_sync/define_player_stat_keys")

function upload_inventory(playerIndex)
    local player = game.get_player(playerIndex)

    if player.character == nil then
        -- Panic!
        log("ERROR: Player "..player.name.." quit without a character. Inventory not uploaded")
        return false
    end

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
        flashlight = player.is_flashlight_enabled(),
    }

    -- Transfer player stats
    for _,v in pairs(player_stat_keys) do
        serialized_player[v] = player[v]
    end

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
