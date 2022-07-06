local api = require('modules/clusterio/api')

local impl = {}


impl.events = {}
impl.events[defines.events.on_tick] = function()
	if global.clusterio_patch_number ~= clusterio_patch_number then
		global.clusterio_patch_number = clusterio_patch_number
		script.raise_event(api.events.on_server_startup, {})
	end
end

impl.events[api.events.on_server_startup] = function()
	if not global.clusterio then
		global.clusterio = {
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
for name, i in pairs(defines.disconnect_reason) do
	disconnect_reason_name[i] = name
end

impl.events[defines.events.on_player_left_game] = function(event)
	local player = game.players[event.player_index]
	api.send_json("player_event", {
		type = "leave",
		name = player.name,
		reason = disconnect_reason_name[event.reason],
	})
end

-- Internal API
clusterio_private = {}
function clusterio_private.update_instance(new_id, new_name)
	global.clusterio.instance_id = new_id
	global.clusterio.instance_name = new_name
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
		return global.clusterio.instance_id
	end,

	get_instance_name = function()
		return global.clusterio.instance_name
	end,

	get_file_no = function()
		global.clusterio_file_no = (global.clusterio_file_no or 0) + 1
		return global.clusterio_file_no
	end,
})


return impl
