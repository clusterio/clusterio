/silent-command

local lines = "";

for _, tech in pairs(game.forces["player"].technologies) do
    local dict = {};
    dict[tech.name] = tech.researched;
    lines = lines .. serpent.line(dict) .. "\n";
end

game.write_file("researchSync.txt",lines)

