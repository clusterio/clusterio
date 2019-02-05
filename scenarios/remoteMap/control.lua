-- MIT License
-- 
-- Copyright (c) 2017 Florian Jung
-- 
-- Modified by Daniel Vestøl
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
	global.tileQueue = global.tileQueue .. data .. '\n'
	-- stringsToWriteNextTick = stringsToWriteNextTick .. data .. '\n'
	-- game.write_file("remoteMap.txt", data, true)
end

function dump_cached_writes()
	-- game.write_file("remoteMap.txt", stringsToWriteNextTick, true, 0)
end

function complain(text)
	if false then -- only print during development
		print(text)
		game.forces["player"].print(text)
	end
end

local todo_next_tick = {}
must_write_initstuff = true
function on_tick(event)
	dump_cached_writes()
	stringsToWriteNextTick = ''
	if must_write_initstuff then
		must_write_initstuff = false
		log("I must write init stuff!")
		writeout_initial_stuff()
	end
	if #todo_next_tick > 0 then
		complain("on_tick executing "..#todo_next_tick.." stored callbacks")
		for _,func in ipairs(todo_next_tick) do
			func()
		end
		todo_next_tick = {}
	end
end

function writeout_initial_stuff()
	log("Writing out initial stuff...")
	writeout_objects(game.surfaces['nauvis'], {left_top={x=-64,y=-64},right_bottom={x=64,y=64}})
end

function writeout_objects(surface, area)
	--if my_client_id ~= 1 then return end
	for idx, ent in pairs(surface.find_entities(area)) do
		if area.left_top.x <= ent.position.x and ent.position.x < area.right_bottom.x and area.left_top.y <= ent.position.y and ent.position.y < area.right_bottom.y then
			if ent.prototype.collision_mask ~= nil and ent.prototype.collision_mask['player-layer'] then
				-- line = line .. ent.name.." "..ent.position.x.." "..ent.position.y.."\n"
				-- local line = ent.name..","..ent.position.x..","..ent.position.y
				-- if ent.supports_direction then
					-- line = line .. ",rot="..ent.direction
				-- end
				-- write_file(line)
				on_some_entity_created(nil, ent)
			end
		end
	end
	--write_file(header..table.concat(lines,"").."\n")
	--write_file(table.concat(lines,"").."\n")
end
function on_chunk_generated(event)
	local area = event.area
	local surface = event.surface
	--print("chunk generated at ("..area.left_top.x..","..area.left_top.y..") -- ("..area.right_bottom.x..","..area.right_bottom.y..")")

	if surface ~= game.surfaces['nauvis'] then -- we only support one surface
		return
	end

	-- writeout_resources(surface, area)
	-- writeout_objects(surface, area)
	-- writeout_tiles(surface, area)
end
function on_some_entity_created(event, entp)
	local ent
	if entp then
		ent = entp
	else
		ent = event.entity or event.created_entity or nil
	end
	
	if ent == nil then
		complain("wtf, on_some_entity_created has nil entity")
		return
	end
	local entityData = "name="..ent.name..",x="..ent.position.x..",y="..ent.position.y
	if ent.supports_direction then
		entityData = entityData .. ",rot="..ent.direction
	end
	-- log(entityData)
	write_file(entityData)
	--writeout_objects(ent.surface, {left_top={x=math.floor(ent.position.x), y=math.floor(ent.position.y)}, right_bottom={x=math.floor(ent.position.x)+1, y=math.floor(ent.position.y)+1}})
	--complain("on_some_entity_created: "..ent.name.." at "..ent.position.x..","..ent.position.y)
end
function on_some_entity_deleted(event)
	local ent = event.entity
	if ent == nil then
		complain("wtf, on_some_entity_deleted has nil entity")
		return
	end

	-- we can't do this now, because the entity still exists at this point. instead, we schedule the writeout for the next tick
	
	--local surface = ent.surface
	--local area = {left_top={x=math.floor(ent.position.x), y=math.floor(ent.position.y)}, right_bottom={x=math.floor(ent.position.x)+1, y=math.floor(ent.position.y)+1}}

	--table.insert(todo_next_tick, function () writeout_objects(surface, area ) end)
	write_file("name=deleted,x="..ent.position.x..",y="..ent.position.y)
	--complain("on_some_entity_deleted: "..ent.name.." at "..ent.position.x..","..ent.position.y)
end

script.on_event(defines.events.on_tick, on_tick)
script.on_event(defines.events.on_chunk_generated, on_chunk_generated)

script.on_event(defines.events.on_biter_base_built, on_some_entity_created) --entity
script.on_event(defines.events.on_built_entity, on_some_entity_created) --created_entity
script.on_event(defines.events.on_robot_built_entity, on_some_entity_created) --created_entity
script.on_event(defines.events.on_player_rotated_entity, on_some_entity_created) --created_entity

script.on_event(defines.events.on_entity_died, on_some_entity_deleted) --entity
script.on_event(defines.events.on_player_mined_entity, on_some_entity_deleted) --entity
script.on_event(defines.events.on_robot_mined_entity, on_some_entity_deleted) --entity
script.on_event(defines.events.on_resource_depleted, on_some_entity_deleted) --entity

script.on_init(function()
	global.tileQueue = ""
end)

remote.remove_interface("remoteMap")
remote.add_interface("remoteMap", {
	exportTiles = function()
		rcon.print(global.tileQueue)
		global.tileQueue = ""
	end,
	exportChunk = function(xc, yc, ref)
		local data = ""
		local entities = game.surfaces[1].find_entities({{xc*32,yc*32},{xc*32+32,yc*32+32}})
		for _, ent in pairs(entities) do
			data = data .. "|name:"..ent.name..",direction:"..ent.direction..",x:"..ent.position.x..",y:"..ent.position.y
		end
		rcon.print(data)
	end
})
