-- Load crafting queue from a table
function load_crafting_queue(crafting_queue, player)
    local inventory = player.get_main_inventory()

    -- Give player some more inventory space to avoid duplicating items
    player.character_inventory_slots_bonus = player.character_inventory_slots_bonus + 100

    -- Load crafting queue
    for _, queueItem in pairs(crafting_queue) do
        local recipe = game.recipe_prototypes[queueItem.recipe]
        game.print("Crafting "..queueItem.recipe)
        -- Add items to inventory
        for _, item in pairs(recipe.ingredients) do
            local count = math.floor(item.amount * queueItem.count / math.max(recipe.main_product.amount, 1))
            if count > 0 then
                inventory.insert({
                    name = item.name,
                    count = count,
                })
            end
        end

        -- Start crafting (consume items)
        player.begin_crafting {
            count = queueItem.count,
            recipe = queueItem.recipe,
            silent = true, -- Fail silently if items are missing
        }
    end

    -- Remove extra inventory slots
    player.character_inventory_slots_bonus = player.character_inventory_slots_bonus - 100
end

return load_crafting_queue
