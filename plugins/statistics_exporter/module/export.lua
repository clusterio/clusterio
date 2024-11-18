local compat = require("modules/clusterio/compat")

local v2_stats = compat.version_ge("2.0.0")

local statistics = {
	"item_production_statistics",
	"fluid_production_statistics",
	"kill_count_statistics",
	"entity_build_count_statistics",
}

statistics_exporter = {}
function statistics_exporter.export()
	--- @diagnostic disable-next-line undefined-field
	local pollution = v2_stats and game.get_pollution_statistics(1) or game.pollution_statistics
	local stats = {
		game_tick = game.tick,
		player_count = #game.connected_players,
		game_flow_statistics = {
			pollution_statistics = {
				--- TODO support multi surface pollution statistics
				input = pollution.input_counts,
				output = pollution.output_counts,
			},
		},
		force_flow_statistics = {}
	}
	for _, force in pairs(game.forces) do
		local flow_statistics = {}
		for _, statName in pairs(statistics) do
			local stat = v2_stats and force["get_" .. statName](1) or force[statName]
			flow_statistics[statName] = {
				input = stat.input_counts,
				output = stat.output_counts,
			}
		end
		stats.force_flow_statistics[force.name] = flow_statistics
	end


	rcon.print(compat.table_to_json(stats))
end
