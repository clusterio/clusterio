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
	local stats = {
		game_tick = game.tick,
		player_count = #game.connected_players,
		surface_statistics = {},
		platforms = {}
	}

	for _, surface in pairs(game.surfaces) do
		local surface_stats = {
			game_flow_statistics = {
				pollution_statistics = {
					input = (v2_stats and game.get_pollution_statistics(surface.index) or surface.pollution_statistics).input_counts,
					output = (v2_stats and game.get_pollution_statistics(surface.index) or surface.pollution_statistics).output_counts,
				},
			},
			force_flow_statistics = {}
		}

		for _, force in pairs(game.forces) do
			local flow_statistics = {}
			for _, statName in pairs(statistics) do
				local stat = v2_stats and force["get_" .. statName](surface.index) or force[statName]
				flow_statistics[statName] = {
					input = stat.input_counts,
					output = stat.output_counts,
				}
			end
			surface_stats.force_flow_statistics[force.name] = flow_statistics
		end

		stats.surface_statistics[surface.name] = surface_stats
	end

	if v2_stats then
		for _, force in pairs(game.forces) do
			for _, platform in pairs(force.platforms) do
				stats.platforms[platform.name] = {
					force = force.name,
					surface = platform.surface.name
				}
			end
		end
	end

	rcon.print(compat.table_to_json(stats))
end
