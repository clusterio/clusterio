-- Load crafting queue from a table
function load_crafting_queue(crafting_queue, player)
    local inventory = player.get_main_inventory()

    -- Give player some more inventory space to avoid duplicating items
    player.character_inventory_slots_bonus = player.character_inventory_slots_bonus + 1000

    -- Add items to inventory
    for _, item in pairs(crafting_queue.ingredients) do
        inventory.insert(item)
    end

    -- Load crafting queue
    for _, queueItem in pairs(crafting_queue.crafting_queue) do
        -- Start crafting (consume items)
        player.begin_crafting {
            count = queueItem.count,
            recipe = queueItem.recipe,
            -- silent = true, -- Fail silently if items are missing
        }
    end

    -- Remove extra inventory slots
    player.character_inventory_slots_bonus = player.character_inventory_slots_bonus - 1000
end

return load_crafting_queue
