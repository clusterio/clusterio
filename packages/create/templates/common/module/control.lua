local clusterio_api = require("modules/clusterio/api")
local compat = require("modules/clusterio/compat")

--- Top level module table, contains event handlers and public methods
--- @class __plugin_name__
local MyModule = {
}

--- script_data is 'synced' between players, you should use your plugin name to avoid name conflicts
-- The following helper function is desync safe and avoids name conflicts after being called during on_server_startup
-- There are edge cases in the following events: pre player left, player left, console command, and config changed
-- If you use any of these events and access globalData then make sure to call this function first
local script_data = {}
local function setup_script_data()
	if compat.script_data["__plugin_name__"] == nil then
		compat.script_data["__plugin_name__"] = {
			-- starting values go here
		}
	end
	MyModule.on_load()
end

--- The on_load function is called independently for each client when they first load the map
-- It should be used to restore global aliases and metatables not registered with script.register_metatable
function MyModule.on_load()
	script_data = compat.script_data["__plugin_name__"]
end

--- Public methods should be available though your top level module table
function MyModule.foo()
	game.print("foo")
end

--- Private methods should be local to the file, this will prevent others from calling it
local function bar()
	game.print("bar")
end

--- Clusterio provides a few custom events, on_server_startup is the most useful and should be used in place of on_init
--- @param event EventData.on_server_startup
local function on_server_startup(event)
	setup_script_data()
	game.print(compat.table_to_json(event))
end

--- Triggered every time a player crafts an item, see below for how handlers are registered
--- @param event EventData.on_player_crafted_item
local function on_player_crafted_item(event)
	game.print(compat.table_to_json(event))
//%if instance
	local player = assert(game.get_player(event.player_index))
	clusterio_api.send_json("__plugin_name__-plugin_example_ipc", {
		tick = game.tick, player_name = player.name
	})
//%endif
end

--- Run bar every 5 seconds, see below for how handlers are registered
local function on_nth_tick_300()
	game.print(game.tick)
	bar()
end

--- Factorio events are accessible through defines.events, you can have one handler per event per module
local e = defines.events
local events = {
	[clusterio_api.events.on_server_startup] = on_server_startup,
	[e.on_player_crafted_item] = on_player_crafted_item,
}

--- Nth tick is a special case that requires its own table, the index represents the time period between calls in ticks
local on_nth_tick = {
	[300] = on_nth_tick_300,
}

--- Always return the top level module table from control, this is how clusterio will access your event handlers
MyModule.events = events --- @package
MyModule.on_nth_tick = on_nth_tick --- @package
return MyModule
