
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

if game.forces['player'].technologies['{tech_name}'] then
    if 1 == {tech_infinite} then
        if (game.forces['player'].technologies['{tech_name}'].level ~= level) then
            game.forces['player'].technologies['{tech_name}'].level = {tech_level}
            updateTech()
        end
    else
        if not game.forces['player'].technologies['{tech_name}'].researched then
            game.forces['player'].technologies['{tech_name}'].researched = true
            updateTech()
        end
    end
end
