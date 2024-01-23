local clusterio_api = require("modules/clusterio/api")

local MyModule = {
	events = {},
	on_nth_tick = {},
}

function MyModule.foo()
	game.print("foo")
end

MyModule.events[clusterio_api.events.on_server_startup] = function(event)
	game.print(game.table_to_json(event))
end

MyModule.events[defines.events.on_player_crafted_item] = function(event)
	game.print(game.table_to_json(event))
end

MyModule.on_nth_tick[300] = function()
	game.print(game.tick)
end

return MyModule
