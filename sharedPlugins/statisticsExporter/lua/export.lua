local statistics = {
	"item_production_statistics",
	"fluid_production_statistics",
	"kill_count_statistics",
	"entity_build_count_statistics",
}

local function export()
	local stats = {}
	for _, force in pairs(game.forces) do
		local data = {}
		for _, statName in pairs(statistics) do
			data[statName] = {
				input = force[statName].input_counts,
				output = force[statName].output_counts,
			}
		end
		table.insert(stats, {
			forceName = force.name,
			data = data,
		})
	end
	rcon.print(game.table_to_json(stats))
end

return {
	add_remote_interface = function()
		remote.add_interface("statisticsExporter", { export = export })
	end
}
