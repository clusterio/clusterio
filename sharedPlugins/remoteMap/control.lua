-- MIT License
-- 
-- Copyright (c) 2017 Florian Jung
-- 
-- Permission is hereby granted, free of charge, to any person obtaining a
-- copy of this factorio lua stub and associated
-- documentation files (the "Software"), to deal in the Software without
-- restriction, including without limitation the rights to use, copy, modify,
-- merge, publish, distribute, sublicense, and/or sell copies of the
-- Software, and to permit persons to whom the Software is furnished to do
-- so, subject to the following conditions:
-- 
-- The above copyright notice and this permission notice shall be included in
-- all copies or substantial portions of the Software.
-- 
-- THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
-- IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
-- FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL
-- THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
-- LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
-- FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
-- DEALINGS IN THE SOFTWARE.

function write_file(data)
	if must_write_initstuff then
		must_write_initstuff = false
		writeout_initial_stuff()
	end

	game.write_file("remoteMap.txt", data, true)
end
function complain(text)
	print(text)
	game.forces["player"].print(text)
end

local todo_next_tick = {}
function on_tick(event)
	if #todo_next_tick > 0 then
		print("on_tick executing "..#todo_next_tick.." stored callbacks")
		for _,func in ipairs(todo_next_tick) do
			func()
		end
		todo_next_tick = {}
	end
end


function writeout_objects(surface, area)
	--if my_client_id ~= 1 then return end
	header = "objects "..area.left_top.x..","..area.left_top.y..";"..area.right_bottom.x..","..area.right_bottom.y..": "
	line = ''
	for idx, ent in pairs(surface.find_entities(area)) do
		if area.left_top.x <= ent.position.x and ent.position.x < area.right_bottom.x and area.left_top.y <= ent.position.y and ent.position.y < area.right_bottom.y then
			if ent.prototype.collision_mask ~= nil and ent.prototype.collision_mask['player-layer'] then
				line = line .. ent.name.." "..ent.position.x.." "..ent.position.y.."\n"
			end
		end
	end
	write_file(line)
	--write_file(header..table.concat(lines,"").."\n")
	--write_file(table.concat(lines,"").."\n")
	line=nil
end

function on_some_entity_created(event)
	local ent = event.entity or event.created_entity or nil
	if ent == nil then
		complain("wtf, on_some_entity_created has nil entity")
		return
	end
	write_file(ent.name.." "..ent.position.x.." "..ent.position.y)
	--writeout_objects(ent.surface, {left_top={x=math.floor(ent.position.x), y=math.floor(ent.position.y)}, right_bottom={x=math.floor(ent.position.x)+1, y=math.floor(ent.position.y)+1}})

	complain("on_some_entity_created: "..ent.name.." at "..ent.position.x..","..ent.position.y)
end
function on_some_entity_deleted(event)
	local ent = event.entity
	if ent == nil then
		complain("wtf, on_some_entity_deleted has nil entity")
		return
	end

	-- we can't do this now, because the entity still exists at this point. instead, we schedule the writeout for the next tick
	
	local surface = ent.surface
	local area = {left_top={x=math.floor(ent.position.x), y=math.floor(ent.position.y)}, right_bottom={x=math.floor(ent.position.x)+1, y=math.floor(ent.position.y)+1}}

	--table.insert(todo_next_tick, function () writeout_objects(surface, area ) end)
	write_file("deleted "..ent.position.x.." "..ent.position.y)
	complain("on_some_entity_deleted: "..ent.name.." at "..ent.position.x..","..ent.position.y)
end

script.on_event(defines.events.on_tick, on_tick)

script.on_event(defines.events.on_biter_base_built, on_some_entity_created) --entity
script.on_event(defines.events.on_built_entity, on_some_entity_created) --created_entity
script.on_event(defines.events.on_robot_built_entity, on_some_entity_created) --created_entity

script.on_event(defines.events.on_entity_died, on_some_entity_deleted) --entity
script.on_event(defines.events.on_player_mined_entity, on_some_entity_deleted) --entity
script.on_event(defines.events.on_robot_mined_entity, on_some_entity_deleted) --entity
script.on_event(defines.events.on_resource_depleted, on_some_entity_deleted) --entity
