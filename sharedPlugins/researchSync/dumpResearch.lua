/silent-command

for _, tech in pairs(game.forces["player"].technologies) do
    local dict = {};
    dict[tech.name] = tech.researched;
    game.write_file("researchSync.txt",serpent.line(dict));
end

