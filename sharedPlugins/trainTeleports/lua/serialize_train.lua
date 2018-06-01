local player = game.player
local station = player.selected

if not station or station.name ~= 'train-stop' then
    player.print('select train stop')
    return
end

local function find_train()
    for _, train in pairs(player.force.get_trains(player.surface)) do
        if train.station == station then
            return train
        end
    end
end
local train = find_train()
if not train then
    player.print('no train found')
    return
end

local inventory_types = {}
do
    local map = {}
    for _, inventory_type in pairs(defines.inventory) do
        map[inventory_type] = true
    end
    for t in pairs(map) do
        inventory_types[#inventory_types + 1] = t
    end
    table.sort(inventory_types)
end

local function serialize_equipment_grid(grid)
    local names, xs, ys = {}, {}, {}

    local position = {0,0}
    local width, height = grid.width, grid.height
    local processed = {}
    for y = 0, height - 1 do
        for x = 0, width - 1 do
            local base = (y + 1) * width + x + 1
            if not processed[base] then
                position[1], position[2] = x, y
                local equipment = grid.get(position)
                if equipment ~= nil then
                    local shape = equipment.shape
                    for j = 0, shape.height - 1 do
                        for i = 0, shape.width - 1 do
                            processed[base + j * width + i] = true
                        end
                    end

                    local idx = #names + 1
                    names[idx] = equipment.name
                    xs[idx] = x
                    ys[idx] = y
                end
            end
        end
    end
    return {
        names = names,
        xs = xs,
        ys = ys,
    }
end

local function serialize_inventory(inventory)
    local filters
    if inventory.supports_filters() then
        filters = {}
        for i = 1, #inventory do
            filters[i] = inventory.get_filter(i)
        end
    end
    local item_names, item_counts, item_durabilities,
        item_ammos, item_exports, item_labels, item_grids
        = {}, {}, {}, {}, {}, {}, {}

    for i = 1, #inventory do
        local slot = inventory[i]
        if slot.valid_for_read then
            if slot.is_item_with_inventory then
                print('sending items with inventory is not allowed')
            elseif slot.is_blueprint or slot.is_blueprint_book
                or slot.is_deconstruction_item or slot.is_item_with_tags then
                local success, export = pcall(slot.export_stack)
                if not success then
                    print('failed to export item')
                else
                    item_exports[i] = export
                end
            else
                item_names[i] = slot.name
                item_counts[i] = slot.count
                local durability = slot.durability
                if durability ~= nil then
                    item_durabilities[i] = durability
                end
                if slot.type == 'ammo' then
                    item_ammos[i] = slot.ammo
                end
                if slot.is_item_with_label then
                    item_labels[i] = {
                        label = slot.label,
                        label_color = slot.label_color,
                        allow_manual_label_change = slot.allow_manual_label_change,
                    }
                end

                local grid = slot.grid
                if grid then
                    item_grids[i] = serialize_equipment_grid(grid)
                end
            end
        end
    end

    return {
        filters = filters,
        item_names = item_names,
        item_counts = item_counts,
        item_durabilities = item_durabilities,
        item_ammos = item_ammos,
        item_exports = item_exports,
        item_labels = item_labels,
        item_grids = item_grids,
    }
end

local function serialize_train_contents(train)
    local station = train.station
    if not station then
        error('train must be stopped at a station')
    end

    local data = {}
    for _, carriage in pairs(train.carriages) do
        --[[ Manhathan distance to correctly order carriages from nearest to furthest from station ]]
        local carriage_index
        do
            local distance = math.abs(carriage.position.x - station.position.x) + math.abs(carriage.position.y - station.position.y)
            local index = (distance + 2) / 7
            carriage_index = math.floor(index + 0.5)
            assert(carriage_index >= 1 and carriage_index <= 50 and math.abs(index - carriage_index) <= 0.01)
        end

        --[[ Orientation of station and carriage to determine whether it's flipped ]]
        --[[ Being flipped means it's pointing away from the station, not towards ]]
        local is_flipped = math.floor(carriage.orientation * 4 + 0.5)
        is_flipped = bit32.bxor(bit32.rshift(station.direction, 2), bit32.rshift(is_flipped, 1))

        --[[ Check inventories ]]
        local inventories = {}
        for _, inventory_type in pairs(inventory_types) do
            local inventory = carriage.get_inventory(inventory_type)
            if inventory then
                inventories[inventory_type] = serialize_inventory(inventory)
            end
        end

        --[[ Handle fluids ]]
        local fluids
        do
            local fluidbox = carriage.fluidbox
            if #fluidbox > 0 then
                fluids = {}
                for i = 1, #fluidbox do
                    fluids[i] = fluidbox[i]
                end
            end
        end

        data[carriage_index] = {
            name = carriage.name,
            color = carriage.color,
            is_flipped = is_flipped,
            inventories = inventories,
            fluids = fluids,
        }
    end

    return data
end

local function serialize_train_schedule(train, current_world_id)
    local prefix = '[Clusterio ' .. tostring(current_world_id) .. '] '
    local schedule = train.schedule
    if schedule == nil then
        return
    end
    local pattern = '^%[Clusterio (%d+)%] ?(.+)$'
    for _, record in ipairs(schedule.records) do
        if not record.station:find(pattern) then
            record.station = prefix .. record.station
        end
    end
    return schedule
end

last_train_data = serialize_train_contents(train)
last_train_schedule = serialize_train_schedule(train, 69)
print(serpent.block(last_train_data))
