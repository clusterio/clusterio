local compat = require("modules/clusterio/compat")

local v2_pollution = compat.version_ge("2.0.0")

local statistics = {
	"item_production_statistics",
	"fluid_production_statistics",
	"kill_count_statistics",
	"entity_build_count_statistics",
}

statistics_exporter = {}
function statistics_exporter.export()
	local stats = {
		game_tick = game.tick,
		player_count = #game.connected_players,
		game_flow_statistics = {
			pollution_statistics = {
				--- TODO support multi surface pollution statistics
				--- @diagnostic disable undefined-field
				input = v2_pollution and game.get_pollution_statistics(1).input_counts or game.pollution_statistics.input_counts,
				output = v2_pollution and game.get_pollution_statistics(1).output_counts or game.pollution_statistics.output_counts,
				--- @diagnostic enable undefined-field
			},
		},
		force_flow_statistics = {}
	}
	for _, force in pairs(game.forces) do
		local flow_statistics = {}
		for _, statName in pairs(statistics) do
			flow_statistics[statName] = {
				input = force[statName].input_counts,
				output = force[statName].output_counts,
			}
		end
		stats.force_flow_statistics[force.name] = flow_statistics
	end


	rcon.print(compat.table_to_json(stats))
end
