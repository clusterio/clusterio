function save_crafts(event)
    if event.player_index then
        local player = game.players[event.player_index]
        local crafting_queue = {}

        -- Avoid overwriting old save
        if global["saved_crafting_queue_"..player.name] ~= nil then
            player.print("You already have a saved crafting queue, restore it with /restore-crafts")
            return
        end

        -- Serialize crafting queue
        if player.crafting_queue == nil then
            player.print("You can't save nothing, you silly goose")
            return
        end
        for _, queueItem in pairs(player.crafting_queue) do
            crafting_queue[queueItem.index] = {
                count = queueItem.count,
                recipe = queueItem.recipe,
            }
        end

        -- Give player some more inventory space to avoid duplicating items
        player.character_inventory_slots_bonus = player.character_inventory_slots_bonus + 100
        -- Cancel old crafts to get the items back
        while player.crafting_queue_size > 0 do
            local queueItem = player.crafting_queue[1]
            local recipe = game.recipe_prototypes[queueItem.recipe]

            -- Cancel craft
            player.cancel_crafting {
                index = 1,
                count = 1,
            }

            -- Remove ingredients from inventory
            for _, item in pairs(recipe.ingredients) do
                local inventory = player.get_main_inventory()
                inventory.remove({
                    name = item.name,
                    count = item.amount,
                })
            end
            game.print("Canceled craft "..recipe.name)
        end

        -- Remove extra inventory slots
        player.character_inventory_slots_bonus = player.character_inventory_slots_bonus - 100

        global["saved_crafting_queue_"..player.name] = crafting_queue
    end
end

return save_crafts
