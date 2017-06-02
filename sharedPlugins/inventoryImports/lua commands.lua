-- Lua cheatsheet

/c game.write_file("test.txt",serpent.block(game.players["Danielv123"].get_quickbar().get_contents()))
/c game.write_file("test.txt",serpent.block(game.players["Danielv123"].get_inventory(defines.inventory.player_main).get_contents()))

-- print JSON of entire inventory and request slots to file
-- TODO: Get requester slot data as well

-- requester slot data is game.players.character.get_request_slot(slot)
-- returns {name="copper-plate", count=47} or nil if nothing is set
-- maybe game.players.character.item_requests? http://lua-api.factorio.com/latest/LuaEntity.html#LuaEntity.item_requests

/c
local requests = {}
for i = 1, game.player.force.character_logistic_slot_count do
	requests[i] = game.players["Danielv123"].character.get_request_slot(i)
end

local o = "Requests: "
for k,v in pairs(requests) do
	o = o..v["name"]..": "..v["count"]..", "
end
game.print(o)

/c
local inventory = game.players["Danielv123"].get_inventory(defines.inventory.player_main).get_contents()
local quickbar = game.players["Danielv123"].get_quickbar().get_contents()
--[[ Get contents of requester slots into a table ]]
local requests = {}
for i = 1, game.player.force.character_logistic_slot_count do
	requests[i] = game.players["Danielv123"].character.get_request_slot(i)
end

--[[ generate JS table (not JSON) ]]
local o = "{inventory:{"
for k,v in pairs(inventory) do
	o = o.."['"..k.."']:"..v..","
end
for k,v in pairs(quickbar) do
	o = o.."['"..k.."']:"..v..","
end

o = o.."},requestSlots:{"
for k,v in pairs(requests) do
	o = o.."['"..v["name"].."']:"..v["count"]..", "
end
o = o.."}}"
game.print(o)
game.write_file("test.txt", o)

