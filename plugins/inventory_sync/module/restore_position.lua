local can_enter_vehicle = {
	[defines.controllers.character] = true,
	[defines.controllers.god] = true,
	[defines.controllers.editor] = true,
}

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
	elseif record.surface and record.position then
		player.teleport(record.position, record.surface)
	end
end
