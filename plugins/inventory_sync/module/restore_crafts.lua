local load_crafting_queue = require("modules/inventory_sync/load_crafting_queue")

function restore_crafts(event)
    if event.player_index then
        local player = game.get_player(event.player_index)
        local crafting_queue = global.inventory_sync.saved_crafting_queue[player.name]

        if crafting_queue == nil then
            player.print("No saved crafting queue")
            return
        end

        load_crafting_queue(crafting_queue, player)

        global.inventory_sync.saved_crafting_queue[player.name] = nil
    end
end

return restore_crafts
