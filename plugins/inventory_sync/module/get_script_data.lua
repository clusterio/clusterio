local compat = require("modules/clusterio/compat")

--- @param no_early_return boolean? True to always setup data
return function(no_early_return)
	local script_data = compat.script_data()
	local inventory_sync = script_data.inventory_sync
	if inventory_sync and not no_early_return then
		return inventory_sync
	end

	inventory_sync = inventory_sync or {}
	inventory_sync.players = inventory_sync.players or {}
	inventory_sync.players_waiting_for_acquire = inventory_sync.players_waiting_for_acquire or {}
	inventory_sync.players_in_cutscene_to_sync = inventory_sync.players_in_cutscene_to_sync or {}

	inventory_sync.active_downloads = inventory_sync.active_downloads or {}
	inventory_sync.finished_downloads = inventory_sync.finished_downloads or {}
	inventory_sync.active_uploads = inventory_sync.active_uploads or {}

	script_data.inventory_sync = inventory_sync
	return inventory_sync
end
