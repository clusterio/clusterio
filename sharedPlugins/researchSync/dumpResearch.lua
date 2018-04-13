/silent-command

local lines = "";

for _, tech in pairs(game.forces["player"].technologies) do
    lines = lines .. tech.name .. ":" .. tostring(tech.researched) .. "\n";
end

game.write_file("researchSync.txt",lines)
