/c 
local toDelete = game.surfaces[1].find_entities({{3,7},{4,8}})
for i, entity in pairs(toDelete) do
	entity.die()
end