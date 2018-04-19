/silent-command
if game.forces['player'].technologies['{tech_name}'] then
	if game.forces['player'].technologies['{tech_name}'].researched ~= {tech_researched} then
		game.forces['player'].technologies['{tech_name}'].researched={tech_researched}
	end
	if game.forces['player'].technologies['{tech_name}'].level ~= {tech_level} then
		game.forces['player'].technologies['{tech_name}'].level={tech_level }
	end
    script.raise_event(defines.events.on_research_finished, {research=game.forces['player'].technologies['{tech_name}'], by_script=true})
	game.play_sound({path="utility/research_completed"})
    if game.forces['player'].technologies['{tech_name}'].researched == false then
		game.print("Technology {tech_name} synced at level {tech_level}")
	else
		game.print("Technology {tech_name} synced")
	end
end
