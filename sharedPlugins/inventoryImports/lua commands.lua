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

-- sum up our inventory and request slots and print it as valid JSON
-- turns out the valid part is important
/c
local o = '{"players":{'
local notFirst = false
for a,b in pairs(game.players) do
	if b.connected and b.character then
		if notFirst then
			o = o .. ','
		else
			notFirst = true
		end
		local inventory = game.players[a].get_inventory(defines.inventory.player_main).get_contents()
		local quickbar = game.players[a].get_quickbar().get_contents()
		--[[ Get contents of requester slots into a table ]]
		local requests = {}
		for i = 1, game.players[a].force.character_logistic_slot_count do
			requests[i] = game.players[a].character.get_request_slot(i)
		end

		o = o..'"'..a..'":{"inventory":{'
		--[[ generate JSON table ]]
		local addComma = false
		for k,v in pairs(inventory) do
			if addComma then
				o = o..','
			else
				addComma = true
			end
			o = o..'"'..k..'":'..v
		end
		for k,v in pairs(quickbar) do
			if addComma then
				o = o..','
			else
				addComma = true
			end
			o = o..'"'..k..'":'..v
		end

		o = o..'},"requestSlots":{'
		addComma = false
		for k,v in pairs(requests) do
			if addComma then
				o = o..','
			else
				addComma = true
			end
			o = o..'"'..v['name']..'":'..v['count']
		end
		o = o..'}}' --[[ We need a comma after these two if there is more than 1 player, handled up top by notFirst]]
	end
end
o = o.."}}"
game.write_file("t.txt", o, true, 0)
game.print(o)

--[[
Example output
{"players":{"1":{"inventory":{"stone":12,"iron-ore":120,"raw-wood":10,"iron-plate":8,"steel-plate":480},"requestSlots":{}}}}

Minification procedure:

Run through https://mothereff.in/lua-minifier
Replace ' with '+"'"+'
Prepend /silent-command
remove game.print(o)
replace "t.txt" with "'+outputFile+'"
enclose in ''

]]

-- minified strings (newest on the top)
local a='+"'"+'{"players":{'+"'"+'local b=false;for c,d in pairs(game.players)do if d.connected then if b then a=a..'+"'"+','+"'"+'else b=true end;local e=game.players[c].get_inventory(defines.inventory.player_main).get_contents()local f=game.players[c].get_quickbar().get_contents()local g={}for h=1,game.players[c].force.character_logistic_slot_count do g[h]=game.players[c].character.get_request_slot(h)end;a=a..'+"'"+'"'+"'"+'..c..'+"'"+'":{"inventory":{'+"'"+'local i=false;for j,k in pairs(e)do if i then a=a..'+"'"+','+"'"+'else i=true end;a=a..'+"'"+'"'+"'"+'..j..'+"'"+'":'+"'"+'..k end;for j,k in pairs(f)do if i then a=a..'+"'"+','+"'"+'else i=true end;a=a..'+"'"+'"'+"'"+'..j..'+"'"+'":'+"'"+'..k end;a=a..'+"'"+'},"requestSlots":{'+"'"+'i=false;for j,k in pairs(g)do if i then a=a..'+"'"+','+"'"+'else i=true end;a=a..'+"'"+'"'+"'"+'..k['+"'"+'name'+"'"+']..'+"'"+'":'+"'"+'..k['+"'"+'count'+"'"+']end;a=a..'+"'"+'}}'+"'"+'end end;a=a.."}}"game.write_file("'+outputFile+'",a,true,0)
-- offline playes
local a="{"for b,c in pairs(game.players)do if c.connected then local d=game.players[b].get_inventory(defines.inventory.player_main).get_contents()local e=game.players[b].get_quickbar().get_contents()local f={}for g=1,game.players[b].force.character_logistic_slot_count do f[g]=game.players[b].character.get_request_slot(g)end;a=a..b..":{inventory:{"for h,i in pairs(d)do a=a.."['+"'"+'"..h.."'+"'"+']:"..i..","end;for h,i in pairs(e)do a=a.."['+"'"+'"..h.."'+"'"+']:"..i..","end;a=a.."},requestSlots:{"for h,i in pairs(f)do a=a.."['+"'"+'"..i["name"].."'+"'"+']:"..i["count"]..", "end;a=a.."}},"end end;a=a.."}"game.print(a)
-- multiple players
local a="{"for b,c in pairs(game.players)do local d=game.players[b].get_inventory(defines.inventory.player_main).get_contents()local e=game.players[b].get_quickbar().get_contents()local f={}for g=1,game.players[b].force.character_logistic_slot_count do f[g]=game.players[b].character.get_request_slot(g)end;a=a..b..":{inventory:{"for h,i in pairs(d)do a=a.."['+"'"+'"..h.."'+"'"+']:"..i..","end;for h,i in pairs(e)do a=a.."['+"'"+'"..h.."'+"'"+']:"..i..","end;a=a.."},requestSlots:{"for h,i in pairs(f)do a=a.."['+"'"+'"..i["name"].."'+"'"+']:"..i["count"]..", "end;a=a.."}},"end;a=a.."}"game.print(a)
local a=game.players["Danielv123"].get_inventory(defines.inventory.player_main).get_contents()local b=game.players["Danielv123"].get_quickbar().get_contents()local c={}for d=1,game.players["Danielv123"].force.character_logistic_slot_count do c[d]=game.players["Danielv123"].character.get_request_slot(d)end;local e="{inventory:{"for f,g in pairs(a)do e=e.."['+"'"+'"..f.."'+"'"+']:"..g..","end;for f,g in pairs(b)do e=e.."['+"'"+'"..f.."'+"'"+']:"..g..","end;e=e.."},requestSlots:{"for f,g in pairs(c)do e=e.."['+"'"+'"..g["name"].."'+"'"+']:"..g["count"]..", "end;e=e.."}}"game.print(e)
local inventory = game.players["Danielv123"].get_inventory(defines.inventory.player_main).get_contents()local quickbar = game.players["Danielv123"].get_quickbar().get_contents()local requests = {}for i = 1, game.player.force.character_logistic_slot_count do requests[i] = game.players["Danielv123"].character.get_request_slot(i) end local o = "{inventory:{" for k,v in pairs(inventory) do o = o.."['+"'"+'"..k.."'+"'"+']:"..v.."," end for k,v in pairs(quickbar) do o = o.."['+"'"+'"..k.."'+"'"+']:"..v.."," end o = o.."},requestSlots:{" for k,v in pairs(requests) do o = o.."['+"'"+'"..v["name"].."'+"'"+']:"..v["count"]..", " end o = o.."}}" game.write_file("test.txt", o,true,0)


-- insert items in players inventory and export leftovers
-- name should be players[i]

/c
local name = "1"
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
	game.write_file("t.txt", serpent.line({["exports"]=items_failed}, {["comment"]=false, ["compact"]=true}),true,0)
end

--[[
Writes something like 

{exports={["1"]={["iron-ore"]=0,["steel-plate"]=0}}}

converting to JS would be
replace "[" and "]" with ""???
replace "=" with ":"
]]

--[[
JSON edition

{"exports":{"1":[{"name":"iron-ore","count":0},{"name":"steel-plate","count":0}]}}

Should always return valid JSON
]]
/c
local name = "1"
local items = {["iron-ore"]=30, ["steel-plate"]=120}
if(game.players[name] and game.players[name].connected) then
	local o = '{"exports":{"'..name..'":['
	local addComma = false
	for item,count in pairs(items) do
		local i = game.players[name].insert{name=item,count=count}
		if addComma then
			o = o..','
		else
			addComma = true
		end
		o = o .. '{"name":"'..item..'","count":'..count - i..'}'
	end
	o = o .. ']}}'
	game.write_file("t.txt", o,true,0)
end

--[[
Minification procedure:

Run through https://mothereff.in/lua-minifier
Replace ' with '+"'"+'
Prepend /silent-command
replace "t.txt" with "'+outputFile+'"
enclose in ''
]]


-- JSON outputFile
local a="1"local b={["iron-ore"]=30,["steel-plate"]=120}local c={}if game.players[a]and game.players[a].connected then local d='+"'"+'{"exports":{"'+"'"+'..a..'+"'"+'":['+"'"+'local e=false;for f,g in pairs(b)do local h=game.players[a].insert{name=f,count=g}if e then d=d..'+"'"+','+"'"+'else e=true end;d=d..'+"'"+'{"name":"'+"'"+'..f..'+"'"+'","count":'+"'"+'..g-h..'+"'"+'}'+"'"+'end;d=d..'+"'"+']}}'+"'"+'game.write_file("'+outputFile+'",d,true,0)end
-- output to serpented LUA table
local a="Danielv123"local b={["iron-ore"]=30,["steel-plate"]=120}local c={}if game.players[a]and game.players[a].connected then for d,e in pairs(b)do local f=game.players[a].insert{name=d,count=e}if not c[a]then c[a]={}end;if c[a][d]then c[a][d]=c[a][d]+e-f else c[a][d]=e-f end end;game.write_file("'+outputFile+'",serpent.line(c,{["comment"]=false,["compact"]=true}),true,0)end

