local api = require('modules/clusterio/api')
local compat = require("modules/clusterio/compat")

--- @class (exact) EventData.on_server_startup:EventData

local function check_patch()
	if compat.script_data.clusterio_patch_number ~= clusterio_patch_number then
		compat.script_data.clusterio_patch_number = clusterio_patch_number
		-- Initialize clusterio table synchronously BEFORE raising async event
		-- This prevents race condition where update_instance() accesses the table
		-- before the on_server_startup event handler has run
		if not compat.script_data.clusterio then
			compat.script_data.clusterio = {
				instance_id = nil,
				instance_name = nil,
			}
		end
		script.raise_event(api.events.on_server_startup, {
			name = api.events.on_server_startup, tick = game.tick
		})
	end
end

local impl = {}
impl.events = {}

impl.events[defines.events.on_tick] = check_patch

impl.events[api.events.on_server_startup] = function()
	if not compat.script_data.clusterio then
		compat.script_data.clusterio = {
			instance_id = nil,
			instance_name = nil,
		}
	end

	-- Replay will just desync after the save is patched
	game.disable_replay()
end

impl.events[defines.events.on_player_joined_game] = function(event)
	local player = game.players[event.player_index]
	api.send_json("player_event", { type = "join", name = player.name })
end

local disconnect_reason_name = {}
if defines.disconnect_reason then
	for name, i in pairs(defines.disconnect_reason) do
		disconnect_reason_name[i] = name
	end
end

impl.events[defines.events.on_player_left_game] = function(event)
	local player = game.players[event.player_index]
	api.send_json("player_event", {
		type = "leave",
		name = player.name,
		reason = disconnect_reason_name[event.reason] or "quit",
	})
end

impl.events[defines.events.on_player_banned] = function(event)
	api.send_json("player_event", {
		type = "BAN",
		name = event.player_name,
		reason = event.reason,
	})
end

impl.events[defines.events.on_player_unbanned] = function(event)
	api.send_json("player_event", { type = "UNBANNED", name = event.player_name })
end

impl.events[defines.events.on_player_promoted] = function(event)
	local player = game.players[event.player_index]
	api.send_json("player_event", { type = "PROMOTE", name = player.name })
end

impl.events[defines.events.on_player_demoted] = function(event)
	local player = game.players[event.player_index]
	api.send_json("player_event", { type = "DEMOTE", name = player.name })
end

-- Internal API
clusterio_private = {}
function clusterio_private.update_instance(new_id, new_name)
	check_patch()
	local script_data = compat.script_data
	script_data.clusterio.instance_id = new_id
	script_data.clusterio.instance_name = new_name
	script.raise_event(api.events.on_instance_updated, {
		instance_id = new_id,
		instance_name = new_name,
	})
end


-- This is not part of the add_remote_interface callback to ensure it is
-- available when the clusterio_lib mod is loaded.  The reason this is
-- neccessary is that on_init for newly added mods happen before on_load
-- for existing mods, and the add_remote_interface callback is done in
-- on_load.  See https://forums.factorio.com/viewtopic.php?f=25&t=81552 for
-- more details.
remote.add_interface('clusterio_api', {
	get_events = function()
		return api.events
	end,

	get_instance_id = function()
		return compat.script_data.clusterio.instance_id
	end,

	get_instance_name = function()
		return compat.script_data.clusterio.instance_name
	end,

	get_file_no = function()
		local script_data = compat.script_data
		script_data.clusterio_file_no = (script_data.clusterio_file_no or 0) + 1
		return script_data.clusterio_file_no
	end,
})


return impl
