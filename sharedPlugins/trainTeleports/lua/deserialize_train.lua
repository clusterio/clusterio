local player = game.player
local surface = player.surface

local station = player.selected
if not station or station.name ~= 'train-stop' then
    player.print('hover over station')
    return
end

local function deserialize_grid(grid, data)
    grid.clear()
    local names, xs, ys = data.names, data.xs, data.ys
    for i = 1, #names do
        grid.put({
            name = names[i],
            position = {xs[i], ys[i]}
        })
    end
end

local function deserialize_inventory(inventory, data)
    local item_names, item_counts, item_durabilities,
        item_ammos, item_exports, item_labels, item_grids
        = data.item_names, data.item_counts, data.item_durabilities,
        data.item_ammos, data.item_exports, data.item_labels, data.item_grids
    for idx, name in pairs(item_names) do
        local slot = inventory[idx]
        slot.set_stack({
            name = name,
            count = item_counts[idx]
        })
        if item_durabilities[idx] ~= nil then
            slot.durability = item_durabilities[idx]
        end
        if item_ammos[idx] ~= nil then
            slot.ammo = item_ammos[idx]
        end
        local label = item_labels[idx]
        if label then
            slot.label = label.label
            slot.label_color = label.label_color
            slot.allow_manual_label_change = label.allow_manual_label_change
        end

        local grid = item_grids[idx]
        if grid then
            deserialize_grid(slot.grid, grid)
        end
    end
    for idx, str in pairs(item_exports) do
        inventory[idx].import_stack(str)
    end
    if data.filters then
        for idx, filter in pairs(data.filters) do
            inventory.set_filter(idx, filter)
        end
    end
end

local function deserialize_train_contents(station, data)
    local rotation
    if bit32.band(station.direction, 2) == 0 then
        rotation = { 1, 0, 0, 1 }
    else
        rotation = { 0, -1, 1, 0 }
    end
    if bit32.band(station.direction, 4) == 4 then
        for i = 1, 4 do rotation[i] = -rotation[i] end
    end

    local created_entities = {}
    xpcall(function ()
        local sp = station.position
        for idx, carriage in ipairs(data) do
            local ox, oy = -2, 7 * idx - 4
            ox, oy = rotation[1] * ox + rotation[2] * oy, rotation[3] * ox + rotation[4] * oy
            
            local entity = surface.create_entity({
                name = carriage.name,
                force = game.forces.player,
                position = {x=sp.x + ox, y=sp.y + oy},
                direction = (station.direction + carriage.is_flipped * 4) % 8
            })

            if entity and entity.valid then
                created_entities[#created_entities + 1] = entity
            else
                log('failure to create carriage: ' .. tostring(idx))
                error('failed to create train carriage entity')
            end

            if carriage.color then
                entity.color = carriage.color
            end

            for inventory_id, inventory_data in pairs(carriage.inventories) do
                deserialize_inventory(entity.get_inventory(inventory_id), inventory_data)
            end

            if carriage.fluids then
                local fluidbox = entity.fluidbox
                for i = 1, #carriage.fluids do
                    fluidbox[i] = carriage.fluids[i]
                end
            end
        end
    end, function (error_message)
        for _, entity in ipairs(created_entities) do
            entity.destroy()
        end
        created_entities = nil
        print('\n\n\n')
        print(error_message .. '\ntraceback:\n' .. debug.traceback(), 2)
        print('\n\n\n')
    end)
        
    if created_entities[1] and created_entities[1].valid then
        return created_entities[1].train
    end
end

local function deserialize_train_schedule(train, data, current_world_id)
    if data == nil then
        return
    end
    local pattern = '^%[Clusterio ' .. tostring(current_world_id) .. '%] ?(.+)$'
    local originally_active_station = data.current
    for idx, record in ipairs(data.records) do
        local _, _, local_station_name = record.station:find(pattern)
        if local_station_name then
            record.station = local_station_name
        elseif idx == originally_active_station then
            data.current = data.current % #data.records + 1
        end
    end
    train.schedule = data
    train.manual_mode = false
end

local created_train = deserialize_train_contents(station, last_train_data)
deserialize_train_schedule(created_train, last_train_schedule, 42)
