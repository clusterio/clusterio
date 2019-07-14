
local function get_tech_progress(tech)
    if tech == force.current_research then
        return force.research_progress
    else
        return force.get_saved_technology_progress(tech.name);
    end
end
local function set_tech_progress(tech, progress)
    if tech == force.current_research then
        force.research_progress = progress
    else
        force.set_saved_technology_progress(tech.name, progress);
    end
end

local force = game.force['player']
local tech_name = {tech_name}
local tech = force.technologies[tech_name]
local last_check_progress = {last_check_progress}
local new_progress = {new_progress}

local progress_delta = get_tech_progress(tech) - last_check_progress
new_progress = new_progress + progress_delta
if new_progress > 1 then
    new_progress = 1
end
set_tech_progress(tech, new_progress)
