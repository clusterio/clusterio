
local data = {};

for _, tech in pairs(game.forces["player"].technologies) do
    local tech_data = {
        tech.name,
        tostring(tech.researched),
        tostring(tech.level),
    }
    tech_data = table.concat(tech_data, ':')
    table.insert(data, tech_data);
end

game.write_file("researchSync.txt", table.concat(data, "\n"), false, 0)
