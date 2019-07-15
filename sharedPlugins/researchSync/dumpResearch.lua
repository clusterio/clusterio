
local data = {};
local force = game.forces["player"];

for _, tech in pairs(force.technologies) do
    local progress;
    if tech == force.current_research then
        progress = force.research_progress
    else
        progress = force.get_saved_technology_progress(tech.name);
    end
    local infinite = tech.enabled == true and tech.prototype.max_level == 4294967295;
    local tech_data = {
        tech.name,
        tostring(tech.researched),
        tostring(tech.level),
        tostring(progress),
        tostring(infinite),
    }
    tech_data = table.concat(tech_data, ':')
    table.insert(data, tech_data);
end

game.write_file("researchSync.txt", table.concat(data, "\n"), false, 0)
