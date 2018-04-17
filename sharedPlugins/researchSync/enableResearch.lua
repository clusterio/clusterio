/silent-command
if game.forces['player'].technologies['{tech_name}'] then
	game.forces['player'].technologies['{tech_name}}'].researched={tech_researched}
	game.forces['player'].technologies['{tech_name}}'].level={tech_level}
	game.print("researcSync enabled research: {tech_name} to level {tech_level}")
end
