-- Ensures that the given player has a character if one doesn't exist
local function ensure_character(player)
	if not player.character and not player.ticks_to_respawn then
		if player.controller_type ~= defines.controllers.ghost then
			player.set_controller({ type = defines.controllers.ghost })
		end
		player.ticks_to_respawn = 0
		player.ticks_to_respawn = nil
	end
end

return ensure_character
