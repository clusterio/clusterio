function save_crafts(event)
    if event.player_index then
        local player = game.get_player(event.player_index)
        local crafting_queue = {}

        -- Avoid overwriting old save
        if global.inventory_sync.saved_crafting_queue[player.name] ~= nil then
            player.print("You already have a saved crafting queue, restore it with /restore-crafts")
            return
        end

        -- Give player some more inventory space to avoid duplicating items
        player.character_inventory_slots_bonus = player.character_inventory_slots_bonus + 1000

        -- Save current items
        local inventory = player.get_main_inventory()
        local old_items = inventory.get_contents()

        -- Cancel old crafts to get the items back
        while player.crafting_queue_size > 0 do
            local old_queue = player.crafting_queue
            local queueItem = player.crafting_queue[1]
            
            -- Cancel craft
            player.cancel_crafting {
                index = 1,
                count = 1,
            }

            local rightmost_right_index = 0 -- 0 indexed since it is subtractive in a 1 indexed language
            local new_queue = player.crafting_queue
            while 
                new_queue ~= nil and
                new_queue[#new_queue - rightmost_right_index] ~= nil and
                new_queue[#new_queue - rightmost_right_index].count >= old_queue[#old_queue - rightmost_right_index].count 
            do
                rightmost_right_index = rightmost_right_index + 1
            end
            local oldItem = old_queue[#old_queue - rightmost_right_index]
            local newItem = nil
            if new_queue ~= nil then
                newItem = new_queue[#new_queue - rightmost_right_index]
            end

            -- Figure out how many items to add to queue
            local added = oldItem.count
            if newItem ~= nil then
                added = oldItem.count - newItem.count
                if oldItem.recipe ~= newItem.recipe then
                    log("ERROR: Old item "..oldItem.recipe.." is not equal "..newItem.recipe)
                end    
            end

            -- If the last item we added was of the same type, merge them in the queue
            if #crafting_queue > 0 and crafting_queue[#crafting_queue].recipe == oldItem.recipe then
                crafting_queue[#crafting_queue].count = crafting_queue[#crafting_queue].count + added
            else
                -- If the last item was of a different type, add a new item to the queue
                table.insert(crafting_queue, {
                    recipe = oldItem.recipe,
                    count = added,
                })
            end
            -- game.print("Saved craft "..oldItem.recipe)
        end
        
        -- Find amount of items added and remove from inventory
        local new_items = inventory.get_contents()
        local difference = {}
        for k,v in pairs(new_items) do
            local old_count = old_items[k]
            local diff = v
            if old_count ~= nil then
                diff = diff - old_count
            end
            if diff > 0 then
                local ingredient = {
                    name = k,
                    count = diff,
                }
                inventory.remove(ingredient)
                table.insert(difference, ingredient)
            end
        end

        -- Remove extra inventory slots
        player.character_inventory_slots_bonus = player.character_inventory_slots_bonus - 1000

        global.inventory_sync.saved_crafting_queue[player.name] = {
            crafting_queue = crafting_queue,
            ingredients = difference,
        }
    end
end

return save_crafts
