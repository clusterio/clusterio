
local function updateTech()
    script.raise_event(defines.events.on_research_finished, {research=game.forces['player'].technologies['{tech_name}'], by_script=true})
    if {notify} then
        if 1 == {tech_infinite} then
            game.print("Infinite technology {tech_name} level {tech_level} unlocked")
        else
            game.print("Technology {tech_name} researched")
        end
        game.play_sound({path="utility/research_completed"})
    end
end

local force = game.forces['player']
local tech = force.technologies['{tech_name}']
if tech then
    if 1 == {tech_infinite} then
        if (tech.level ~= level) then
            tech.level = {tech_level}
            if tech == force.current_research then
                force.research_progress = {tech_progress}
            else
                force.set_saved_technology_progress(tech.name, {tech_progress});
            end
            updateTech()
        end
    else
        if not tech.researched then
            tech.researched = true
            updateTech()
        end
    end
end
