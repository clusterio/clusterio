import path from "node:path";
import { fileURLToPath } from "node:url";
import { lua, lauxlib, lualib, to_luastring } from "fengari";

const moduleDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "module") + path.sep;

// Stubs for the Factorio and Clusterio APIs, then loads the real player_sync.lua
const harness = String.raw`
local module_dir = ...

defines = {
	controllers = { ghost = 0, character = 1, god = 2, editor = 3, cutscene = 4, spectator = 5, remote = 6 },
	events = setmetatable({}, { __index = function(_, k) return k end }),
	disconnect_reason = { quit = 0, switching_servers = 1 },
}

table.insert(package.searchers, 2, function(name)
	local rest = name:match("^modules/player_sync/(.*)")
	if rest then
		return assert(loadfile(module_dir .. rest .. ".lua"))
	end
end)

storage = {}
sent = {}
package.preload["modules/clusterio/compat"] = function()
	return {
		version_ge = function() return true end,
		script_data = storage,
		-- Tests send player data as Lua table constructors
		json_to_table = function(t)
			if type(t) == "string" then return assert(load("return " .. t))() end
			return t
		end,
		table_to_json = function(t) return t end,
	}
end
package.preload["modules/clusterio/api"] = function()
	return {
		send_json = function(channel, data) table.insert(sent, { channel = channel, data = data }) end,
		events = setmetatable({}, { __index = function(_, k) return k end }),
	}
end

local controller_names = {}
for name, value in pairs(defines.controllers) do controller_names[value] = name end

local function set_character(player, character)
	player.character = character
	if character then
		player.controller_type = defines.controllers.character
		player.physical_controller_type = defines.controllers.character
	end
end

-- Items live on the character, a spectator has none to upload
package.preload["modules/player_sync/serialize"] = function()
	return {
		syncs = function() return true end,
		newly_synced = function() return false end,
		same_components = function() return true end,
		serialize_crafting_notifications = function() return nil end,
		serialize_local_controller = function(player)
			return { controller = controller_names[player.physical_controller_type] }
		end,
		serialize_player = function(player)
			return {
				name = player.name,
				controller = controller_names[player.physical_controller_type],
				items = player.character and player.character.items,
			}
		end,
		deserialize_player = function(player, serialized)
			set_character(player, { items = serialized.items, destroy = function() end })
		end,
		spill_items = function() end,
	}
end
package.preload["modules/player_sync/ensure_character"] = function()
	return function(player)
		if not player.character then
			set_character(player, { destroy = function() end })
		end
	end
end
package.preload["modules/player_sync/gui/progress_dialog"] = function()
	return { display = function() end, remove = function() end }
end

log = function() end
rcon = { print = function() end }
remote = { interfaces = {}, add_interface = function() end }

local players = {}
game = {
	ticks_played = 0,
	print = function() end,
	is_multiplayer = function() return true end,
	players = players,
	get_player = function(name) return players[name] end,
}

local function gui_element()
	local element = { valid = true, style = {} }
	function element.add(spec)
		local child = gui_element()
		child.name = spec.name
		if spec.name then
			element[spec.name] = child
			function child.destroy() element[spec.name] = nil end
		end
		return child
	end
	function element.force_auto_center() end
	return element
end

local nauvis = { name = "nauvis" }
--- Creates a player with a character holding items, at position
function new_player(name, items, position)
	local player = {
		name = name,
		connected = true,
		driving = false,
		surface = nauvis,
		physical_surface = nauvis,
		position = position,
		physical_position = position,
		gui = { screen = gui_element() },
	}
	function player.print() end
	function player.set_controller(spec)
		player.controller_type = spec.type
		player.physical_controller_type = spec.type
		if spec.type ~= defines.controllers.character then
			player.character = nil
		end
	end
	function player.teleport(new_position, surface)
		player.position = new_position
		player.physical_position = new_position
		player.surface = surface
		player.physical_surface = surface
	end
	set_character(player, { items = items, destroy = function() end })
	players[name] = player
	player_sync.events[defines.events.on_player_created]({ player_index = name })
	return player
end

function join(player)
	player.connected = true
	player_sync.events[defines.events.on_player_joined_game]({ player_index = player.name })
end

function leave(player)
	player_sync.events[defines.events.on_pre_player_left_game]({
		player_index = player.name, reason = defines.disconnect_reason.quit,
	})
	player.connected = false
end

--- Advance time by ticks, running the periodic checks
function tick(ticks)
	game.ticks_played = game.ticks_played + ticks
	player_sync.on_nth_tick[33]()
end

--- Acquire reply for player "a"
function acquired(generation, has_data, token)
	player_sync.acquire_response({
		status = "acquired", player_name = "a", generation = generation, has_data = has_data, token = token,
	})
end

--- Moves the player as walking does, or as another mod's teleport does, and raises the position event
function move(player, position, surface)
	player.position = position
	player.physical_position = position
	player.surface = surface or player.surface
	player.physical_surface = player.surface
	player_sync.events[defines.events.on_player_changed_position]({ player_index = player.name })
end

function last_sent(channel)
	for i = #sent, 1, -1 do
		if sent[i].channel == channel then
			return sent[i].data
		end
	end
end

function clear_sent()
	for i = #sent, 1, -1 do sent[i] = nil end
end

function script_data()
	return storage.player_sync
end

require("modules/player_sync/player_sync")
-- The api stub names events by their key
player_sync.events.on_server_startup({})
`;

function createState() {
	const L = lauxlib.luaL_newstate();
	lualib.luaL_openlibs(L);
	if (lauxlib.luaL_loadstring(L, to_luastring(harness)) !== lua.LUA_OK) {
		throw new Error(lua.lua_tojsstring(L, -1));
	}
	lua.lua_pushstring(L, to_luastring(moduleDir));
	if (lua.lua_pcall(L, 1, 0, 0) !== lua.LUA_OK) {
		throw new Error(lua.lua_tojsstring(L, -1));
	}
	return L;
}

function run(L, code) {
	if (lauxlib.luaL_dostring(L, to_luastring(code)) !== lua.LUA_OK) {
		throw new Error(lua.lua_tojsstring(L, -1));
	}
}

// Player "a" holds generation 4 here and joins while the controller holds generation 5, the download then stalls
// after the player left, as when the controller crashes before saving generation 5.
const stalledDownload = `
	p = new_player("a", "local", { x = 1, y = 2 })
	local record = script_data().players.a
	record.sync = true
	record.generation = 4
	join(p)
	acquired(5, true)
	assert(script_data().active_downloads.a, "download started")
	assert(p.controller_type == defines.controllers.spectator and not p.character, "spectating while downloading")
	p.position = { x = 50, y = 50 }
	p.physical_position = p.position
	leave(p)
	assert(not last_sent("player_sync_upload"), "uploaded while downloading")
	tick(700)
	assert(not script_data().active_downloads.a, "stalled download dropped")
	clear_sent()
`;

describe("player_sync module", function() {
	describe("sync_player()", function() {
		it("should not download when the local copy matches the stored generation", function() {
			const L = createState();
			run(L, `
				local p = new_player("a", "local", { x = 1, y = 2 })
				script_data().players.a.sync = true
				script_data().players.a.generation = 4
				join(p)
				acquired(4, true)
				assert(not script_data().active_downloads.a, "download started")
				assert(p.character.items == "local", "body replaced")
			`);
		});
		it("should download again after a stalled download at an older stored generation", function() {
			const L = createState();
			run(L, stalledDownload);
			run(L, `
				join(p)
				acquired(4, true)
				local download = assert(script_data().active_downloads.a, "no download after the stalled one")
				assert(download.position.x == 1, "body place not kept")
				player_sync.download_inventory("a", '{ items = "stored" }', 1, 1)
				assert(p.character and p.character.items == "stored", "stored data not applied")
				assert(p.position.x == 1 and p.position.y == 2, "not restored where the body stood")
				local record = script_data().players.a
				assert(not record.sync_in_progress and not record.local_controller and not record.body_place)
				leave(p)
				assert(last_sent("player_sync_upload").items == "stored", "stored data not uploaded")
			`);
		});
		it("should give an empty character after a stalled download when nothing is stored", function() {
			const L = createState();
			run(L, stalledDownload);
			run(L, `
				join(p)
				acquired(4, false)
				assert(script_data().active_downloads.a, "no download after the stalled one")
				player_sync.download_inventory("a", nil, 0, 0)
				assert(p.character, "no character")
				assert(p.position.x == 1 and p.position.y == 2, "not restored where the body stood")
				local record = script_data().players.a
				assert(record.sync and not record.sync_in_progress and not record.local_controller)
			`);
		});
		it("should download after a failed acquire following a stalled download", function() {
			const L = createState();
			run(L, stalledDownload);
			run(L, `
				join(p)
				tick(700)
				assert(p.gui.screen.dialog_failed_download, "no failure dialog")
				leave(p)
				assert(not last_sent("player_sync_upload"), "uploaded a spectator")
				join(p)
				acquired(4, true)
				assert(script_data().active_downloads.a.position.x == 1, "no download from the body place")
			`);
		});
		it("should download from the body place after dropping a prefetched copy that took the body", function() {
			const L = createState();
			run(L, `
				local p = new_player("a", "local", { x = 1, y = 2 })
				script_data().players.a.sync = true
				script_data().players.a.generation = 4
				p.connected = false
				player_sync.prefetch_inventory("a", 5, '{ items = "copy" }', 1, 2, nil, "t1", 0)
				join(p)
				acquired(5, true, "t1")
				assert(p.controller_type == defines.controllers.spectator, "copy not confirmed")
				p.position = { x = 50, y = 50 }
				leave(p)
				assert(not last_sent("player_sync_upload"), "uploaded a spectator")
				join(p)
				acquired(5, true, "t2")
				local download = assert(script_data().active_downloads.a, "no download")
				assert(not download.prefetch and download.position.x == 1, "no download from the body place")
			`);
		});
	});

	describe("on_player_changed_position", function() {
		const downloading = `
			p = new_player("a", "local", { x = 1, y = 2 })
			script_data().players.a.sync = true
			script_data().players.a.generation = 4
			join(p)
			acquired(5, true)
			assert(p.controller_type == defines.controllers.spectator, "not spectating")
		`;
		it("should keep a downloading spectator where the body stood", function() {
			const L = createState();
			run(L, downloading);
			run(L, `
				move(p, { x = 2.5, y = 2 })
				assert(p.position.x == 1 and p.position.y == 2, "spectator walked away")
				player_sync.download_inventory("a", '{ items = "stored" }', 1, 1)
				assert(p.character.items == "stored" and p.position.x == 1, "not restored where the body stood")
			`);
		});
		it("should give the body back where another mod teleported the spectator", function() {
			const L = createState();
			run(L, downloading);
			run(L, `
				move(p, { x = 100, y = 100 })
				assert(p.position.x == 100, "teleport undone")
				move(p, { x = 101, y = 100 })
				assert(p.position.x == 100, "spectator walked away after the teleport")
				player_sync.download_inventory("a", '{ items = "stored" }', 1, 1)
				assert(p.position.x == 100 and p.position.y == 100, "not given back where it was teleported")
			`);
		});
		it("should follow a teleport to another surface and leave the vehicle behind", function() {
			const L = createState();
			run(L, `
				p = new_player("a", "local", { x = 1, y = 2 })
				script_data().players.a.sync = true
				script_data().players.a.generation = 4
				local car = { valid = true, surface = p.surface, position = { x = 1, y = 2 } }
				p.driving = true
				p.vehicle = car
				join(p)
				acquired(5, true)
				local other = { name = "other" }
				move(p, { x = 1, y = 2 }, other)
				player_sync.download_inventory("a", '{ items = "stored" }', 1, 1)
				assert(p.surface == other and p.position.x == 1, "not given back on the other surface")
			`);
		});
		it("should keep a teleport made while the failure dialog is open", function() {
			const L = createState();
			run(L, `
				p = new_player("a", "local", { x = 1, y = 2 })
				script_data().players.a.sync = true
				script_data().players.a.generation = 4
				join(p)
				acquired(5, true)
				tick(700)
				assert(p.gui.screen.dialog_failed_download, "no failure dialog")
				move(p, { x = 2, y = 2 })
				assert(p.position.x == 1, "spectator walked away")
				move(p, { x = 100, y = 100 })
				require("modules/player_sync/gui/dialog_failed_download").events[defines.events.on_gui_click]({
					player_index = "a", element = { valid = true, name = "player_sync_failed_download_abort" },
				})
				assert(p.character and p.position.x == 100, "not given back where it was teleported")
			`);
		});
		it("should keep the spectator from a failed acquire where the body stood", function() {
			const L = createState();
			run(L, `
				p = new_player("a", "local", { x = 1, y = 2 })
				script_data().players.a.sync = true
				script_data().players.a.generation = 4
				join(p)
				tick(700)
				assert(p.controller_type == defines.controllers.spectator, "not spectating")
				move(p, { x = 2, y = 2 })
				assert(p.position.x == 1, "spectator walked away")
				player_sync.acquire(p)
				acquired(4, true)
				local download = assert(script_data().active_downloads.a, "no download")
				assert(download.position.x == 1, "no download from the body place")
			`);
		});
		it("should leave other spectators alone", function() {
			const L = createState();
			run(L, `
				local p = new_player("a", "local", { x = 1, y = 2 })
				p.set_controller({ type = defines.controllers.spectator })
				move(p, { x = 2, y = 2 })
				assert(p.position.x == 2, "spectator pulled back")
			`);
		});
	});

	describe("on_pre_player_left_game", function() {
		it("should not upload a player whose body sync code took", function() {
			const L = createState();
			// The state the bug left behind in existing saves
			run(L, `
				local p = new_player("a", "local", { x = 1, y = 2 })
				local record = script_data().players.a
				record.sync = true
				record.dirty = true
				record.generation = 4
				record.local_controller = { controller = "character" }
				p.set_controller({ type = defines.controllers.spectator })
				leave(p)
				assert(not last_sent("player_sync_upload"), "uploaded a spectator")
				assert(last_sent("player_sync_release"), "not released")
				join(p)
				acquired(4, true)
				assert(script_data().active_downloads.a, "no download")
			`);
		});
	});

	describe("dialog_failed_download", function() {
		function click(name) {
			return `
				require("modules/player_sync/gui/dialog_failed_download").events[defines.events.on_gui_click]({
					player_index = "a", element = { valid = true, name = "${name}" },
				})
			`;
		}
		it("should restore the body place on abort after an online download stalls", function() {
			const L = createState();
			run(L, `
				p = new_player("a", "local", { x = 1, y = 2 })
				script_data().players.a.sync = true
				script_data().players.a.generation = 4
				join(p)
				acquired(5, true)
				p.position = { x = 50, y = 50 }
				tick(700)
				assert(p.gui.screen.dialog_failed_download, "no failure dialog")
			`);
			run(L, click("player_sync_failed_download_abort"));
			run(L, `
				assert(p.character, "no character")
				assert(p.position.x == 1 and p.position.y == 2, "not restored where the body stood")
				local record = script_data().players.a
				assert(not record.sync and not record.body_place and not record.local_controller)
			`);
		});
		it("should download from the body place on retry after an online download stalls", function() {
			const L = createState();
			run(L, `
				p = new_player("a", "local", { x = 1, y = 2 })
				script_data().players.a.sync = true
				script_data().players.a.generation = 4
				join(p)
				acquired(5, true)
				p.position = { x = 50, y = 50 }
				tick(700)
				clear_sent()
			`);
			run(L, click("player_sync_failed_download_retry"));
			run(L, `
				assert(last_sent("player_sync_acquire"), "no acquire")
				acquired(4, true)
				assert(script_data().active_downloads.a.position.x == 1, "no download from the body place")
			`);
		});
	});
});
