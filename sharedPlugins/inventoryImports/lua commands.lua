-- Lua cheatsheet

/c game.write_file("test.txt",serpent.block(game.players["Danielv123"].get_quickbar().get_contents()))
/c game.write_file("test.txt",serpent.block(game.players["Danielv123"].get_inventory(defines.inventory.player_main).get_contents()))

-- print JSON of entire inventory and request slots to file
-- TODO: Get requester slot data as well
/c
local inventory = game.players["Danielv123"].get_inventory(defines.inventory.player_main).get_contents()
local quickbar = game.players["Danielv123"].get_quickbar().get_contents()
local requestSlots = {}
local o = "{inventory:{"
for k,v in pairs(inventory) do
	o = o.."['"..k.."']:"..v..","
end
for k,v in pairs(quickbar) do
	o = o.."['"..k.."']:"..v..","
end
o = o.."},requestSlots:{"
for k,v in pairs(requestSlots) do
o = o.."['"..k.."']:"..v..","
end
o = o.."}}"
game.write_file("test.txt", o)

