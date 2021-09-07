local clusterio_api = require("modules/clusterio/api")
local serialize = require("modules/inventory_sync/serialize")
local save_crafts = require("modules/inventory_sync/save_crafts")

local function upload_inventory(player, player_record)
	local serialized_player = serialize.serialize_player(player)
	serialized_player.generation = player_record.generation

	-- Serialize crafting queue saved by /csc or /save-crafts OR automatically
	if player.character then
		save_crafts.command({player_index = player.name})
	end
	serialized_player.crafting_queue = global.inventory_sync.saved_crafting_queue[player.name]
	global.inventory_sync.saved_crafting_queue[player.name] = nil

	clusterio_api.send_json("inventory_sync_upload", serialized_player)
end

return upload_inventory
