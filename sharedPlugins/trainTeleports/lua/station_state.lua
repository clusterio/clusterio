local player = game.player
local station = player.selected

if station == nil or station.type ~= 'train-stop' then
    player.print('hover over station')
    return
end

local CAN_SPAWN_RESULT = {
    ok = 0,
    blocked = 1,
    no_adjacent_rail = -1,
    not_enough_track = -2,
    no_signals = -3,
}

local function can_spawn_train(station, carriage_count)
    local surface = station.surface
    local expected_direction, expected_rail_direction
    local rotation

    if bit32.band(station.direction, 2) == 0 then
        rotation =  { 1, 0, 0, 1 }
        expected_direction = defines.direction.north
    else
        rotation = { 0, -1, 1, 0 }
        expected_direction = defines.direction.east
    end
    if bit32.band(station.direction, 4) == 4 then
        for i = 1, 4 do rotation[i] = -rotation[i] end
    end
    expected_rail_direction = 1 - bit32.rshift(station.direction, 2)

    local station_position = station.position

    local rail = surface.find_entity('straight-rail', {
        station_position.x - 2 * rotation[1],
        station_position.y - 2 * rotation[3]
    })
    if not rail or rail.direction ~= expected_direction then
        return CAN_SPAWN_RESULT.no_adjacent_rail
    end

    --[[ math.ceil((count * 7 - 1) / 2) ]]
    local rail_sections_count = bit32.rshift(carriage_count * 7, 1)

    --[[ Figure out if there's enough rails to spawn the train ]]
    local connection_table = {
        rail_direction = expected_rail_direction,
        rail_connection_direction = defines.rail_connection_direction.straight,
    }
    local connected_rail = rail
    for i = 2, rail_sections_count do
        connected_rail = connected_rail.get_connected_rail(connection_table)
        if not connected_rail then
            return CAN_SPAWN_RESULT.not_enough_track
        end
    end

    --[[
        Use a heuristic to determine whether the block is free
        This is a not-so-great approximation, but anything more than this
        would have a serious performance impact. Nexela is looking into
        adding something to the API to check this efficiently.
        https://forums.factorio.com/viewtopic.php?t=59901
    --]]
    local far_x, far_y = -1, math.max(112, rail_sections_count * 2 + 1)
    local near_x, near_y = -1, 1
    local area = {
        { near_x * rotation[1] + near_y * rotation[2], near_x * rotation[3] + near_y * rotation[4] },
        { far_x * rotation[1] + far_y * rotation[2], far_x * rotation[3] + far_y * rotation[4] },
    }
    if area[1][1] > area[2][1] then area[1][1], area[2][1] = area[2][1], area[1][1] end
    if area[1][2] > area[2][2] then area[1][2], area[2][2] = area[2][2], area[1][2] end
    area[1][1], area[1][2] = area[1][1] + station_position.x, area[1][2] + station_position.y
    area[2][1], area[2][2] = area[2][1] + station_position.x + 1, area[2][2] + station_position.y + 1

    local expected_signal_direction = bit32.bxor(station.direction, 4)
    local signals = surface.find_entities_filtered({
        type = 'rail-signal',
        area = area
    })
    local any_signal = false
    for _, signal in ipairs(signals) do
        if signal.direction == expected_signal_direction then
            if signal.signal_state ~= defines.signal_state.open then
                return CAN_SPAWN_RESULT.blocked
            end
        end
    end
    local chain_signals = surface.find_entities_filtered({
        type = 'rail-chain-signal',
        area = area
    })
    for _, chain_signal in ipairs(chain_signals) do
        if chain_signal.direction == expected_signal_direction then
            any_signal = true
            if chain_signal.chain_signal_state ~= defines.chain_signal_state.all_open then
                return CAN_SPAWN_RESULT.blocked
            end
        end
    end
    if not any_signal then
        return CAN_SPAWN_RESULT.no_signals
    end

    return CAN_SPAWN_RESULT.ok
end

player.print('can spawn: ' .. tostring(can_spawn_train(station, 4)))
