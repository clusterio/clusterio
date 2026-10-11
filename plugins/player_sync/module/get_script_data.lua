local compat = require("modules/clusterio/compat")

--- @param no_early_return boolean? True to always setup data
return function(no_early_return)
	local player_sync = compat.script_data.player_sync
	if player_sync and not no_early_return then
		return player_sync
	end

	-- migrate: inventory_sync was renamed to player_sync in 2.0.0-alpha.28
	if not player_sync and compat.script_data.inventory_sync then
		player_sync = compat.script_data.inventory_sync
		compat.script_data.inventory_sync = nil
	end

	player_sync = player_sync or {}
	player_sync.players = player_sync.players or {}
	player_sync.players_waiting_for_acquire = player_sync.players_waiting_for_acquire or {}
	player_sync.players_in_cutscene_to_sync = player_sync.players_in_cutscene_to_sync or {}
	player_sync.failed_deserialization = player_sync.failed_deserialization or {}

	player_sync.active_downloads = player_sync.active_downloads or {}
	player_sync.finished_downloads = player_sync.finished_downloads or {}
	player_sync.active_uploads = player_sync.active_uploads or {}

	compat.script_data.player_sync = player_sync
	return player_sync
end
