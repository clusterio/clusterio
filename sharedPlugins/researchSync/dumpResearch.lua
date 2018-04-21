/silent-command

local data = {};

for _, tech in pairs(game.forces["player"].technologies) do
    table.insert(data, tech.name .. ":" .. tostring(tech.researched) .. ":" .. tostring(tech.level));
end

game.write_file("researchSync.txt", table.concat(data, "\n"), false, 0)
