local compat = require("modules/clusterio/compat")

local can_enter_vehicle = {
	[defines.controllers.character] = true,
	[defines.controllers.god] = true,
	[defines.controllers.editor] = true,
}

if defines.controllers.remote then
	-- Does not exist in 1.1, so we need this nil check
	can_enter_vehicle[defines.controllers.remote] = true
end

local v2_surface_platform = compat.version_ge("2.0.0")

--- @param player LuaPlayer
--- @param record table
return function(player, record)
	if record.vehicle and record.vehicle.valid and can_enter_vehicle[player.controller_type] then
		player.teleport(record.vehicle.position, record.vehicle.surface)
		player.driving = true

		-- Teleport to safe location if unable to enter vehicle
		if not player.driving and player.controller_type == defines.controllers.character then
			local safe_position = record.vehicle.surface.find_non_colliding_position(
				player.character.name, player.position, 32, 1/8
			)
			if safe_position then
				player.teleport(safe_position, player.surface)
			end
		end
	elseif v2_surface_platform and record.surface and record.surface.platform and can_enter_vehicle[player.controller_type] then
		player.enter_space_platform(record.surface.platform)
	elseif record.surface and record.position then
		player.teleport(record.position, record.surface)
	end
end
