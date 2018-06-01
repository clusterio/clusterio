local fileName = "trainTeleports.txt"

local function update_train_stop(entity)
    local shared_train_stops = global.shared_train_stops
    if not shared_train_stops then
        shared_train_stops = {}
        global.shared_train_stops = shared_train_stops
    end

    local entity_position = entity.position
    local registration = shared_train_stops[entity.unit_number]
    if not registration then
        registration = {
            name = entity.backer_name,
            entity = entity,
            x = entity_position.x,
            y = entity_position.y,
        }
        shared_train_stops[entity.unit_number] = registration

		game.write_file(fileName, "event:trainstop_added|name:"..entity.backer_name.."|x:"..entity_position.x.."|y:"..entity_position.y, true, 0)
    elseif registration.name ~= entity.backer_name then
		game.write_file(fileName, "event:trainstop_edited|name:"..entity.backer_name.."|oldName:"..registration.name.."|x:"..entity_position.x.."|y:"..entity_position.y, true, 0)
		
		if string.find(entity.backer_name, "Clustersend ") then
			entity.color = {r = 0, g = 1, b = 0}
		end
        registration.name = entity.backer_name
    end
end
local function remove_train_stop(entity)
    global.shared_train_stops[entity.unit_number] = nil

    local entity_position = entity.position
	game.write_file(fileName, "event:trainstop_removed|name:"..entity.backer_name.."|x:"..entity_position.x.."|y:"..entity_position.y, true, 0)
end

global.config = { PlacableArea = 160 }
local function is_teleport_station(entity)
    if not entity.valid
        or entity.type ~= "train-stop"
        or entity.force ~= game.forces.player then
        return false
    end

    local spawn_position = entity.force.get_spawn_position(entity.surface)
    local entity_position = entity.position
    local max_distance = global.config.PlacableArea
    return math.abs(entity_position.x - spawn_position.x) <= max_distance
       and math.abs(entity_position.y - spawn_position.y) <= max_distance
end

local function on_entity_built(entity, player_index)
    if not is_teleport_station(entity) then
        return
    end

    if player_index ~= nil then
        game.players[player_index].print("[Clusterio] Train station built in teleportation range")
    end
    update_train_stop(entity)
end

local function on_entity_removed(entity)
    if not is_teleport_station(entity) then
        return
    end
    
    remove_train_stop(entity)
end

local function on_entity_built_event(event)
    on_entity_built(event.created_entity, event.player_index)
end
local function on_entity_mined_event(event)
    on_entity_removed(event.entity)
end
script.on_event(defines.events.on_built_entity, on_entity_built_event)
script.on_event(defines.events.on_robot_built_entity, on_entity_built_event)
script.on_event(defines.events.script_raised_built, function (event)
    if not event then return end
    local entity = event.created_entity or event.entity
    if type(entity) ~= "table" or type(entity.__self) ~= "userdata" or not entity.valid then return end
    on_entity_built(entity)
end)
script.on_event(defines.events.on_player_mined_entity, on_entity_mined_event)
script.on_event(defines.events.on_robot_mined_entity, on_entity_mined_event)
script.on_event(defines.events.script_raised_destroy, function (event)
    if not event then return end
    local entity = event.entity
    if type(entity) ~= "table" or type(entity.__self) ~= "userdata" or not entity.valid then return end
    on_entity_removed(entity)
end)
script.on_event(defines.events.on_entity_renamed, function (event)
    if is_teleport_station(event.entity) then
        update_train_stop(event.entity)
    end
end)