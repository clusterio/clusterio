local clusterio_api = require("modules/clusterio/api")
local serialize = require("modules/inventory_sync/serialize")
local save_crafts = require("modules/inventory_sync/save_crafts")

local function upload_inventory(player, player_record)
	-- Editor mode is not supported.
	if player.controller_type == defines.controllers.editor then
		player.toggle_map_editor()
	end

	if player.controller_type == defines.controllers.editor then
		log("ERROR: Inventory sync failed to upload, unable to switch " .. player.name .. " out of editor mode")
		player.print("ERROR: Inventory sync failed to upload, unable to switch out of editor mode")
		global.inventory_sync.active_uploads[player.name] = nil
		return
	end

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
