local clusterio_api = require("modules/clusterio/api")
local compat = require("modules/clusterio/compat")
local mod_gui = require("mod-gui")

--- @class LobbyServer
--- @field id integer
--- @field name string
--- @field status string
--- @field version string?
--- @field players integer

--- @class LobbyScriptData
--- @field is_lobby boolean
--- @field instance_id integer?
--- @field web_login boolean Show button for logging into the web interface with the player_auth plugin
--- @field servers LobbyServer[]
--- @field status table<string, string> Status text by player name

local status_captions = {
	running = "Online",
	stopped = "Offline",
	starting = "Starting",
	stopping = "Stopping",
	creating_save = "Creating save",
	exporting_data = "Exporting data",
}

--- Idempotent accessor for the persistent state of the module
--- @return LobbyScriptData
local function get_script_data()
	local data = compat.script_data.lobby
	if not data then
		data = {}
		compat.script_data.lobby = data
	end
	data.servers = data.servers or {}
	data.status = data.status or {}
	if data.is_lobby == nil then
		data.is_lobby = false
	end
	return data
end

--- Reason a server can't be joined from here, or nil if it can
--- @param data LobbyScriptData
--- @param server LobbyServer
--- @return string?
local function unjoinable_reason(data, server)
	if server.id == data.instance_id then
		return "You are on this server"
	end
	local version = compat.active_mods["base"]
	if server.version and server.version ~= version then
		return "Runs Factorio " .. server.version .. ", you have " .. version
	end
	if not status_captions[server.status] then
		return "Not available"
	end
	return nil
end

--- @param player LuaPlayer
--- @param data LobbyScriptData
local function build_content(player, data, content)
	content.clear()
	local status = data.status[player.name]
	if status then
		local label = content.add { type = "label", caption = status }
		label.style.single_line = false
		label.style.maximal_width = 500
		label.style.bottom_margin = 8
	end

	if #data.servers == 0 then
		content.add { type = "label", caption = "There are no servers to join right now." }
		return
	end

	local servers = content.add { type = "table", name = "lobby_servers", column_count = 4, style = "bordered_table" }
	servers.style.minimal_width = 420
	for _, caption in ipairs({ "Server", "Players", "Status", "" }) do
		servers.add { type = "label", caption = caption, style = "caption_label" }
	end
	for _, server in ipairs(data.servers) do
		servers.add { type = "label", caption = server.name }
		servers.add { type = "label", caption = tostring(server.players) }
		servers.add { type = "label", caption = status_captions[server.status] or server.status }
		local reason = unjoinable_reason(data, server)
		servers.add {
			type = "button",
			caption = server.status == "stopped" and "Start and join" or "Join",
			tooltip = reason,
			enabled = reason == nil,
			tags = { lobby_instance_id = server.id },
		}
	end
end

--- @param player LuaPlayer
local function open_browser(player)
	local data = get_script_data()
	local frame = player.gui.screen.lobby_frame
	if not frame then
		frame = player.gui.screen.add { type = "frame", name = "lobby_frame", direction = "vertical",
			caption = data.is_lobby and "Pick a server to join" or "Servers" }
		frame.auto_center = true
		local inner = frame.add { type = "frame", name = "content", direction = "vertical",
			style = "inside_shallow_frame_with_padding" }
		inner.style.horizontally_stretchable = true
		local buttons = frame.add { type = "flow", name = "buttons", direction = "horizontal" }
		buttons.style.top_margin = 8
		if data.web_login then
			buttons.add { type = "button", name = "lobby_web_login", caption = "Log in to web interface",
				tooltip = "Same as the /web-login command" }
		end
		local filler = buttons.add { type = "empty-widget" }
		filler.style.horizontally_stretchable = true
		if not data.is_lobby then
			buttons.add { type = "button", name = "lobby_close", caption = "Close" }
		end
	end
	build_content(player, data, frame.content)
end

--- @param player LuaPlayer
local function close_browser(player)
	if player.gui.screen.lobby_frame then
		player.gui.screen.lobby_frame.destroy()
	end
end

--- @param player LuaPlayer
local function refresh_player(player)
	local data = get_script_data()
	local button_flow = mod_gui.get_button_flow(player)
	if data.is_lobby then
		if button_flow.lobby_toggle then
			button_flow.lobby_toggle.destroy()
		end
		open_browser(player)
	else
		if not button_flow.lobby_toggle then
			button_flow.add { type = "button", name = "lobby_toggle", caption = "Servers", style = mod_gui.button_style }
		end
		if player.gui.screen.lobby_frame then
			open_browser(player)
		end
	end
end

local function refresh_all()
	for _, player in pairs(game.connected_players) do
		refresh_player(player)
	end
end

--- Keep players in a lobby from interacting with its world
--- @param player LuaPlayer
local function make_spectator(player)
	if player.controller_type == defines.controllers.cutscene then
		player.exit_cutscene()
	end
	if player.character then
		player.character.destroy()
	end
	if player.controller_type ~= defines.controllers.spectator then
		player.set_controller { type = defines.controllers.spectator }
	end
end

local lobby_module = {}
lobby_module.events = {}

lobby_module.events[clusterio_api.events.on_server_startup] = function()
	get_script_data()
end

lobby_module.events[defines.events.on_player_joined_game] = function(event)
	local player = game.get_player(event.player_index)
	local data = get_script_data()
	data.status[player.name] = nil
	if data.is_lobby then
		make_spectator(player)
	end
	refresh_player(player)
end

lobby_module.events[defines.events.on_gui_click] = function(event)
	local element = event.element
	if not element.valid then
		return
	end
	local player = game.get_player(event.player_index)
	if element.name == "lobby_toggle" then
		if player.gui.screen.lobby_frame then
			close_browser(player)
		else
			open_browser(player)
		end
	elseif element.name == "lobby_close" then
		close_browser(player)
	elseif element.name == "lobby_web_login" then
		clusterio_api.send_json("player_auth", { type = "open_dialog", player = player.name })
	elseif element.tags and element.tags.lobby_instance_id then
		local data = get_script_data()
		local instance_id = element.tags.lobby_instance_id
		local name = tostring(instance_id)
		for _, server in ipairs(data.servers) do
			if server.id == instance_id then
				name = server.name
			end
		end
		data.status[player.name] = "Connecting to " .. name .. "..."
		clusterio_api.send_json("lobby:connect", { player = player.name, instance_id = instance_id })
		open_browser(player)
	end
end

-- Interface used by the instance plugin through RCON
lobby = {}

--- @param is_lobby boolean
--- @param instance_id integer
--- @param web_login boolean?
function lobby.configure(is_lobby, instance_id, web_login)
	local data = get_script_data()
	data.is_lobby = is_lobby
	data.instance_id = instance_id
	data.web_login = web_login == true
	-- Rebuilt so the frame matches the new configuration
	for _, player in pairs(game.players) do
		close_browser(player)
	end
	refresh_all()
end

--- @param json string
function lobby.set_servers(json)
	local data = get_script_data()
	data.servers = compat.json_to_table(json) or {}
	refresh_all()
end

--- @param player_name string
--- @param text string
function lobby.set_player_status(player_name, text)
	local data = get_script_data()
	data.status[player_name] = text
	local player = game.get_player(player_name)
	if player and player.connected then
		open_browser(player)
	end
end

--- @param player_name string
--- @param address string
--- @param server_name string
function lobby.connect_player(player_name, address, server_name)
	local data = get_script_data()
	local player = game.get_player(player_name)
	if not player or not player.connected then
		return
	end
	data.status[player_name] = "Moving you to " .. server_name .. "..."
	open_browser(player)
	player.connect_to_server { address = address, name = server_name }
end

return lobby_module
