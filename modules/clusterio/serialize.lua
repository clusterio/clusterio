-- Library for serializing items in Factorio
-- Based on code from playerManager and trainTeleports
local serialize = {}

-- Equipment Grids are serialized into an array of equipment entries
-- where ench entry is a table with the following fields:
--   n: name
--   p: position (array of 2 numbers corresponding to x and y)
--   s: shield (optional)
--   e: energy (optional)
-- If the equipment is a burner the following is also present:
--   i: burner inventory
--   r: result inventory
--   b: curently burning (optional)
--   f: remaining_burning_fuel (optional)
function serialize.serialize_equipment_grid(grid)
    local serialized = {}
    local processed = {}
    for y = 0, grid.height - 1 do
        for x = 0, grid.width - 1 do
            local equipment = grid.get({x, y})
            if equipment ~= nil then
                local pos = equipment.position
                local combined_pos = pos.x + pos.y * grid.width + 1
                if not processed[combined_pos] then
                    processed[combined_pos] = true
                    local entry = {
                        n = equipment.name,
                        p = {pos.x, pos.y},
                    }
                    if equipment.shield > 0 then entry.s = equipment.shield end
                    if equipment.energy > 0 then entry.e = equipment.energy end
                    -- TODO: Test with Industrial Revolution
                    if equipment.burner then
                        local burner = equipment.burner
                        entry.i = serialize.serialize_inventory(burner.inventory)
                        entry.r = serialize.serialize_inventory(burner.burnt_result_inventory)
                        if burner.curently_burning then
                            entry.b = {}
                            serialize.serialize_item_stack(burner.curently_burning, entry.b)
                            entry.f = burner.remaining_burning_fuel
                        end
                    end
                    table.insert(serialized, entry)
                end
            end
        end
    end
    return serialized
end

function serialize.deserialize_equipment_grid(grid, serialized)
    grid.clear()
    for _, entry in ipairs(serialized) do
        local equipment = grid.put({
            name = entry.n,
            position = entry.p,
        })
        if equipment then
            if entry.s then equipment.shield = entry.s end
            if entry.e then equipment.energy = entry.e end
            if entry.i then
                if entry.b then serialize.deserialize_item_stack(burner.currently_burning, entry.b) end
                if entry.f then burner.remaining_burning_fuel = entry.f end
                serialize.deserialize_inventory(burner.burnt_result_inventory, entry.r)
                serialize.deserialize_inventory(burner.inventory, entry.i)
            end
        end
    end
end

-- Item stacks are serialized into a table with the following fields:
--   n: name
--   c: count
--   h: health (optional)
--   d: durability (optional)
--   a: ammo count (optional)
--   l: label (optional)
--   g: equipment grid (optional)
--   i: item inventory (optional)
-- If the item stack is exportable it has the following property instead
--   e: export string
-- Label is a table with the following fields:
--   t: label text (optional)
--   c: color (optional)
--   a: allow manual label change
function serialize.serialize_item_stack(slot, entry)
    if
        slot.is_blueprint
        or slot.is_blueprint_book
        or slot.is_upgrade_item
        or slot.is_deconstruction_item
        or slot.is_item_with_tags
    then
        local call_success, call_return = pcall(slot.export_stack)
        if not call_success then
            print("Error: '" .. call_return .. "' thrown exporting '" .. slot.name .. "'")
        else
            entry.e = call_return
        end

        return
    end

    entry.n = slot.name
    entry.c = slot.count
    if slot.health < 1 then entry.h = slot.health end
    if slot.durability then entry.d = slot.durability end
    if slot.type == "ammo" then entry.a = slot.ammo end
    if slot.is_item_with_label then
        local label = {}
        if slot.label then label.t = slot.label end
        if slot.label_color then label.c = slot.label_color end
        label.a = slot.allow_manual_label_change
        entry.l = label
    end

    if slot.grid then
        entry.g = serialize.serialize_equipment_grid(slot.grid)
    end

    if slot.is_item_with_inventory then
        local sub_inventory = slot.get_inventory(defines.inventory.item_main)
        entry.i = serialize.serialize_inventory(sub_inventory)
    end
end

function serialize.deserialize_item_stack(slot, entry)
    if entry.e then
        local success = slot.import_stack(entry.e)
        if success == 1 then
            print("Error: import of '" .. entry.e .. "' succeeded with errors")
        elseif success == -1 then
            print("Error: import of '" .. entry.e .. "' failed")
        end

        return
    end

    local item_stack = {
        name = entry.n,
        count = entry.c,
    }
    if entry.h then item_stack.health = entry.h end
    if entry.d then item_stack.durability = entry.d end
    if entry.a then item_stack.ammo = entry.a end

    local call_success, call_return = pcall(slot.set_stack, item_stack)
    if not call_success then
        print("Error: '" .. call_return .. "' thrown setting stack ".. serpent.line(entry))

    elseif not call_return then
        print("Error: Failed to set stack " .. serpent.line(entry))

    else
        if entry.l then
            -- TODO test this with AAI's unit-remote-control
            local label = entry.l
            if label.t then slot.label = label.t end
            if label.c then slot.label_color = label.c end
            slot.allow_manual_label_change = label.a
        end
        if entry.g then
            serialize.deserialize_equipment_grid(slot.grid, entry.g)
        end
        if entry.i then
            local sub_inventory = slot.get_inventory(defines.inventory.item_main)
            serialize.deserialize_inventory(sub_inventory, entry.i)
        end
    end
end

-- Inventories are serialized into a table with the following fields:
--   i: array of item stack or exportable item entries
--   b: bar position (optional)
-- Each item entry has the following fields
--   s: index (optional, equals to previous plus one if not present)
--   r: repeat count (optional)
--   f: slot filter (optional)
-- Pluss all the fields for item stacks (see deserialize_item_stack)
-- It's also possible that the slot is empty but has a slot filter.
function serialize.serialize_inventory(inventory)
    local serialized = {}
    if inventory.hasbar() and inventory.getbar() <= #inventory then
        serialized.b = inventory.getbar()
    end

    serialized.i = {}
    local previous_index = 0
    local previous_serialized = nil
    for i = 1, #inventory do
        local item = {}
        local slot = inventory[i]
        if inventory.supports_filters() then
            item.f = inventory.get_filter(i)
        end

        if slot.valid_for_read then
            serialize.serialize_item_stack(slot, item)
        end

        if item.n or item.f or item.e then
            local item_serialized = game.table_to_json(item)
            if item_serialized == previous_serialized then
                local previous_item = serialized.i[#serialized.i]
                previous_item.r = (previous_item.r or 0) + 1
                previous_index = i

            else
                if i ~= previous_index + 1 then
                    item.s = i
                end

                previous_index = i
                previous_serialized = item_serialized
                table.insert(serialized.i, item)
            end

        else
            -- Either an empty slot or serilization failed
            previous_index = 0
            previous_serialized = nil
        end
    end

    return serialized
end

function serialize.deserialize_inventory(inventory, serialized)
    if serialized.b and inventory.hasbar() then
        inventory.setbar(serialized.b)
    end

    local last_slot_index = 0
    for _, entry in ipairs(serialized.i) do
        local base_index = entry.s or last_slot_index + 1

        local repeat_count = entry.r or 0
        for offset = 0, repeat_count do
            -- XXX what if the inventory is smaller on this instance?
            local index = base_index + offset
            local slot = inventory[index]
            if entry.f then
                local call_success, call_return = pcall(inventory.set_filter, index, entry.f)
                if not call_success then
                    print("Error: '" .. call_return .. "' thrown setting filter " .. entry.f)

                elseif not call_return then
                    print("Error: Failed to set filter " .. entry.f)
                end
            end

            if entry.n or entry.e then
                serialize.deserialize_item_stack(slot, entry)
            end
        end
        last_slot_index = base_index + repeat_count
    end
end


return serialize
