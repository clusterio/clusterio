/silent-command

local data = {};

for _, tech in pairs(game.forces["player"].technologies) do
    if tech.enabled == true and tech.prototype.max_level == 4294967295 then
        table.insert(data, tech.name .. ":" .. tostring(tech.researched) .. ":" .. tostring(tech.level) .. ":true");
    else
        table.insert(data, tech.name .. ":" .. tostring(tech.researched) .. ":" .. tostring(tech.level) .. ":false");
    end
end

game.write_file("researchSync.txt", table.concat(data, "\n"), false, 0)
