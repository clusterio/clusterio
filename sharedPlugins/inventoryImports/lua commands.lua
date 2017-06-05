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

local o = ""

for a,b in pairs(game.players) do
local inventory = game.players["Danielv123"].get_inventory(defines.inventory.player_main).get_contents()
local quickbar = game.players["Danielv123"].get_quickbar().get_contents()
--[[ Get contents of requester slots into a table ]]
local requests = {}
for i = 1, game.players["Danielv123"].force.character_logistic_slot_count do
	requests[i] = game.players["Danielv123"].character.get_request_slot(i)
end

o = o.."{inventory:{"
--[[ generate JS table (not JSON) ]]
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
end
game.print(o)
game.write_file("test.txt", o)


--[[

Minification procedure:

Run through https://mothereff.in/lua-minifier
Replace ' with '+"'"+'
Prepend /silent-command
enclose in ''

]]

-- minified strings

local a=game.players["Danielv123"].get_inventory(defines.inventory.player_main).get_contents()local b=game.players["Danielv123"].get_quickbar().get_contents()local c={}for d=1,game.players["Danielv123"].force.character_logistic_slot_count do c[d]=game.players["Danielv123"].character.get_request_slot(d)end;local e="{inventory:{"for f,g in pairs(a)do e=e.."['+"'"+'"..f.."'+"'"+']:"..g..","end;for f,g in pairs(b)do e=e.."['+"'"+'"..f.."'+"'"+']:"..g..","end;e=e.."},requestSlots:{"for f,g in pairs(c)do e=e.."['+"'"+'"..g["name"].."'+"'"+']:"..g["count"]..", "end;e=e.."}}"game.print(e)
local inventory = game.players["Danielv123"].get_inventory(defines.inventory.player_main).get_contents()local quickbar = game.players["Danielv123"].get_quickbar().get_contents()local requests = {}for i = 1, game.player.force.character_logistic_slot_count do requests[i] = game.players["Danielv123"].character.get_request_slot(i) end local o = "{inventory:{" for k,v in pairs(inventory) do o = o.."['+"'"+'"..k.."'+"'"+']:"..v.."," end for k,v in pairs(quickbar) do o = o.."['+"'"+'"..k.."'+"'"+']:"..v.."," end o = o.."},requestSlots:{" for k,v in pairs(requests) do o = o.."['+"'"+'"..v["name"].."'+"'"+']:"..v["count"]..", " end o = o.."}}" game.write_file("test.txt", o)