local statisticsData = "["
for _, force in pairs(game.forces) do
	statisticsData = statisticsData .. '{"forceName":"'..force.name..'","data":{'
	local statistics = {"item_production_statistics", "fluid_production_statistics", "kill_count_statistics", "entity_build_count_statistics"}
	for key, stat in pairs(statistics) do
		statisticsData = statisticsData..'"'..stat..'":{"input":{'
		for name, value in pairs(force[stat].input_counts) do
			statisticsData = statisticsData..'"'..name..'":'..value..','
		end
		statisticsData = statisticsData..'},"output":{'
		for name, value in pairs(force[stat].output_counts) do
			statisticsData = statisticsData..'"'..name..'":'..value..','
		end
		statisticsData = statisticsData .. '}},'
	end
	statisticsData = statisticsData..'}},'
end
statisticsData = statisticsData..']'
rcon.print(statisticsData)
