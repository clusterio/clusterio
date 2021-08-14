local inventories = require("modules/inventory_sync/define_player_inventories")

--[[

Take a player with a dirty inventory, create chests with all the items, clear the player,
put them in ghost mode and mark the inventory as clean.

]]

function clean_dirty_inventory(player)
	global.inventory_sync.players[player.name].dirty_inventory = false

	local surface = player.surface
	local position = player.position
	local character = player.character
	player.disassociate_character(character)
	character.die()
	player.ticks_to_respawn = nil
	player.teleport(position, surface)

	-- Remove player character
	local character = player.character
	player.set_controller {
		type = defines.controllers.ghost,
	}
	if character ~= nil then character.destroy() end
end

return clean_dirty_inventory
