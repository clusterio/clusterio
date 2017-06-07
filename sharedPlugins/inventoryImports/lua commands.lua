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

-- sum up our inventory and request slots
/c
local o = "{"
for a,b in pairs(game.players) do
	if b.connected then
		local inventory = game.players[a].get_inventory(defines.inventory.player_main).get_contents()
		local quickbar = game.players[a].get_quickbar().get_contents()
		--[[ Get contents of requester slots into a table ]]
		local requests = {}
		for i = 1, game.players[a].force.character_logistic_slot_count do
			requests[i] = game.players[a].character.get_request_slot(i)
		end

		o = o..a..":{inventory:{"
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
		o = o.."}},"
	end
end
o = o.."}"
game.print(o)
game.write_file("test.txt", o)

--[[

Minification procedure:

Run through https://mothereff.in/lua-minifier
Replace ' with '+"'"+'
Prepend /silent-command
remove game.print(o)
replace "test.txt" with "'+outputFile+'"
enclose in ''

]]

-- minified strings (newest on the top)
-- offline playes
local a="{"for b,c in pairs(game.players)do if c.connected then local d=game.players[b].get_inventory(defines.inventory.player_main).get_contents()local e=game.players[b].get_quickbar().get_contents()local f={}for g=1,game.players[b].force.character_logistic_slot_count do f[g]=game.players[b].character.get_request_slot(g)end;a=a..b..":{inventory:{"for h,i in pairs(d)do a=a.."['+"'"+'"..h.."'+"'"+']:"..i..","end;for h,i in pairs(e)do a=a.."['+"'"+'"..h.."'+"'"+']:"..i..","end;a=a.."},requestSlots:{"for h,i in pairs(f)do a=a.."['+"'"+'"..i["name"].."'+"'"+']:"..i["count"]..", "end;a=a.."}},"end end;a=a.."}"game.print(a)
-- multiple players
local a="{"for b,c in pairs(game.players)do local d=game.players[b].get_inventory(defines.inventory.player_main).get_contents()local e=game.players[b].get_quickbar().get_contents()local f={}for g=1,game.players[b].force.character_logistic_slot_count do f[g]=game.players[b].character.get_request_slot(g)end;a=a..b..":{inventory:{"for h,i in pairs(d)do a=a.."['+"'"+'"..h.."'+"'"+']:"..i..","end;for h,i in pairs(e)do a=a.."['+"'"+'"..h.."'+"'"+']:"..i..","end;a=a.."},requestSlots:{"for h,i in pairs(f)do a=a.."['+"'"+'"..i["name"].."'+"'"+']:"..i["count"]..", "end;a=a.."}},"end;a=a.."}"game.print(a)
local a=game.players["Danielv123"].get_inventory(defines.inventory.player_main).get_contents()local b=game.players["Danielv123"].get_quickbar().get_contents()local c={}for d=1,game.players["Danielv123"].force.character_logistic_slot_count do c[d]=game.players["Danielv123"].character.get_request_slot(d)end;local e="{inventory:{"for f,g in pairs(a)do e=e.."['+"'"+'"..f.."'+"'"+']:"..g..","end;for f,g in pairs(b)do e=e.."['+"'"+'"..f.."'+"'"+']:"..g..","end;e=e.."},requestSlots:{"for f,g in pairs(c)do e=e.."['+"'"+'"..g["name"].."'+"'"+']:"..g["count"]..", "end;e=e.."}}"game.print(e)
local inventory = game.players["Danielv123"].get_inventory(defines.inventory.player_main).get_contents()local quickbar = game.players["Danielv123"].get_quickbar().get_contents()local requests = {}for i = 1, game.player.force.character_logistic_slot_count do requests[i] = game.players["Danielv123"].character.get_request_slot(i) end local o = "{inventory:{" for k,v in pairs(inventory) do o = o.."['+"'"+'"..k.."'+"'"+']:"..v.."," end for k,v in pairs(quickbar) do o = o.."['+"'"+'"..k.."'+"'"+']:"..v.."," end o = o.."},requestSlots:{" for k,v in pairs(requests) do o = o.."['+"'"+'"..v["name"].."'+"'"+']:"..v["count"]..", " end o = o.."}}" game.write_file("test.txt", o)


-- insert items in players inventory and export leftovers
-- name should be players[i]

/c
local name = "Danielv123"
local items = {["iron-ore"]=30, ["steel-plate"]=120}
local items_failed = {}
if(game.players[name] and game.players[name].connected) then
	for item,count in pairs(items) do
		local i = game.players[name].insert{name=item,count=count}
		if not items_failed[name] then
			items_failed[name] = {}
		end
		if items_failed[name][item] then
			items_failed[name][item] = items_failed[name][item] + count - i
		else
			items_failed[name][item] = count - i
		end
	end
	game.write_file("t.txt", serpent.line(items_failed, {["comment"]=false, ["compact"]=true}))
end

--[[
Minification procedure:

Run through https://mothereff.in/lua-minifier
Prepend /silent-command
replace "t.txt" with "'+outputFile+'"
enclose in ''
]]

local a="Danielv123"local b={["iron-ore"]=30,["steel-plate"]=120}local c={}if game.players[a]and game.players[a].connected then for d,e in pairs(b)do local f=game.players[a].insert{name=d,count=e}if not c[a]then c[a]={}end;if c[a][d]then c[a][d]=c[a][d]+e-f else c[a][d]=e-f end end;game.write_file("'+outputFile+'",serpent.line(c,{["comment"]=false,["compact"]=true}))end

