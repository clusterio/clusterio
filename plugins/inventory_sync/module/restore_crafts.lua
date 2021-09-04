local load_crafting_queue = require("modules/inventory_sync/load_crafting_queue")

local restore_crafts = {}

function restore_crafts.command(event)
	if event.player_index then
		local player = game.get_player(event.player_index)
		local crafting_queue = global.inventory_sync.saved_crafting_queue[player.name]

		if crafting_queue == nil then
			player.print("No saved crafting queue")
			return
		end

		load_crafting_queue(crafting_queue, player)

		global.inventory_sync.saved_crafting_queue[player.name] = nil
	end
end

function restore_crafts.add_commands()
	commands.add_command("restore-crafts", "Load crafting queue from global", restore_crafts.command)
	commands.add_command("crc", "Shorthand for /restore-crafts", restore_crafts.command)
end

return restore_crafts
