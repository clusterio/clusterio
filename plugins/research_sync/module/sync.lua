local clusterio_api = require("modules/clusterio/api")
local compat = require("modules/clusterio/compat")

local v2_tech_progress = compat.version_ge("2.0.0")
-- on_research_queued and player_index on moved/cancelled arrived in 2.0.56
local research_queue_api = compat.version_ge("2.0.56")

local sync = {}

--- @param tech LuaTechnology
local function get_technology_progress(tech)
	if tech == tech.force.current_research then
		return tech.force.research_progress
	elseif v2_tech_progress then
		return tech.saved_progress
	else
		--- @diagnostic disable-next-line
		return tech.force.get_saved_technology_progress(tech.name)
	end
end

--- @param tech LuaTechnology
--- @param progress number
local function set_technology_progress(tech, progress)
	if tech == tech.force.current_research then
		tech.force.research_progress = progress
	elseif v2_tech_progress then
		tech.saved_progress = progress
	else
		--- @diagnostic disable-next-line
		tech.force.set_saved_technology_progress(tech.name, progress)
	end
end

--- @class ResearchSyncTechnology
--- @field level uint
--- @field researched boolean?
--- @field progress double?

--- @class ResearchSyncData
--- @field technologies table<string, ResearchSyncTechnology>
--- @field ignore_research_finished boolean
--- @field follow boolean? nil until the first queue_state sets it: shown ticked, but doesn't send or apply
--- @field ignore_queue_events boolean
--- @field queue_dirty boolean
--- @field queue_player string?

--- @param no_early_return boolean?
--- @return ResearchSyncData
local function get_script_data(no_early_return)
	local research_sync = compat.script_data.research_sync
	if research_sync and not no_early_return then
		return research_sync
	end

	research_sync = research_sync or {}
	research_sync.technologies = research_sync.technologies or {}

	if research_sync.ignore_research_finished == nil then
		research_sync.ignore_research_finished = false
	end
	if research_sync.ignore_queue_events == nil then
		research_sync.ignore_queue_events = false
	end
	if research_sync.queue_dirty == nil then
		research_sync.queue_dirty = false
	end

	local force = game.forces["player"]
	for _, tech in pairs(force.technologies) do
		local progress = get_technology_progress(tech)
		research_sync.technologies[tech.name] = {
			level = tech.level,
			researched = tech.researched,
			progress = progress,
		}
	end

	compat.script_data.research_sync = research_sync
	return research_sync
end

sync.events = {}
sync.events[clusterio_api.events.on_server_startup] = function(event)
	get_script_data(true)
end

--- @param tech LuaTechnology
local function get_contribution(tech)
	local progress = get_technology_progress(tech)
	if not progress then
		return 0, nil
	end

	local script_data = get_script_data()
	local prev_tech = script_data.technologies[tech.name]
	if prev_tech.progress and prev_tech.level == tech.level then
		return progress - prev_tech.progress, progress
	else
		return progress, progress
	end
end

--- @param tech LuaTechnology
local function send_contribution(tech)
	local contribution, progress = get_contribution(tech)
	if contribution ~= 0 then
		clusterio_api.send_json("research_sync:contribution", {
			name = tech.name,
			level = tech.level,
			contribution = contribution,
		})
		local script_data = get_script_data()
		script_data.technologies[tech.name].progress = progress
	end
end

--- @param event EventData.on_research_started
sync.events[defines.events.on_research_started] = function(event)
	local tech = event.last_research
	if tech then
		send_contribution(tech)
	end
end

--- @param event EventData.on_research_finished
sync.events[defines.events.on_research_finished] = function(event)
	local script_data = get_script_data()
	if script_data.ignore_research_finished then
		return
	end

	local tech = event.research
	script_data.technologies[tech.name] = {
		level = tech.level,
		researched = tech.researched,
	}

	local level = tech.level
	if not tech.researched then
		level = level - 1
	end

	clusterio_api.send_json("research_sync:finished", {
		name = tech.name,
		level = level,
	})
end

sync.on_nth_tick = {}
sync.on_nth_tick[79] = function(event)
	local tech = game.forces["player"].current_research
	if tech then
		send_contribution(tech)
	end
end

--- @param force LuaForce
--- @return string[]
local function queue_names(force)
	local names = {}
	for _, tech in ipairs(force.research_queue) do
		table.insert(names, tech.name)
	end
	return names
end

--- @param force LuaForce
--- @param names string[]
local function write_queue(force, names)
	local script_data = get_script_data()
	script_data.ignore_queue_events = true
	local ok, err = pcall(function() force.research_queue = names end)
	script_data.ignore_queue_events = false
	if not ok then
		log("research_sync: failed to write research queue: " .. tostring(err))
	end
end

--- @param names string[]
--- @return string
local function format_queue(names)
	if #names == 0 then
		return "(empty)"
	end
	local tags = {}
	for _, name in ipairs(names) do
		table.insert(tags, "[technology=" .. name .. "]")
	end
	return table.concat(tags, " ")
end

--- @param player LuaPlayer
local function ensure_gui(player)
	local frame = player.gui.relative["research_sync_queue"]
	if not frame then
		frame = player.gui.relative.add {
			type = "frame",
			name = "research_sync_queue",
			caption = "Research sync",
			anchor = {
				gui = defines.relative_gui_type.lab_gui,
				position = defines.relative_gui_position.right,
			},
		}
		frame.add {
			type = "checkbox",
			name = "research_sync_follow",
			caption = "Follow the cluster research queue",
			tooltip = "On: this server's research queue is replaced by the cluster's, "
				.. "and changes here change it on every following server.\n"
				.. "Off: this server's research queue is cleared and it picks its own research.\n"
				.. "Either way, all research progress is counted, whatever technology is selected.",
			state = true,
		}
	end
	frame["research_sync_follow"].state = get_script_data().follow ~= false
end

--- @param event EventData.on_player_created
sync.events[defines.events.on_player_created] = function(event)
	if not research_queue_api then
		return
	end
	ensure_gui(game.get_player(event.player_index) --[[@as LuaPlayer]])
end
sync.events[defines.events.on_player_joined_game] = sync.events[defines.events.on_player_created]

--- @param event EventData.on_gui_checked_state_changed
sync.events[defines.events.on_gui_checked_state_changed] = function(event)
	if not research_queue_api then
		return
	end
	if event.element.name == "research_sync_follow" then
		local player = game.get_player(event.player_index) --[[@as LuaPlayer]]
		research_sync.set_follow(event.element.state, player.name)
	end
end

-- The version check stays outside here: these defines don't exist before 2.0.56, so indexing them there would error.
if research_queue_api then
	--- @param event EventData.on_research_queued|EventData.on_research_moved|EventData.on_research_cancelled
	local function on_queue_event(event)
		if event.force.name ~= "player" then
			return
		end
		local script_data = get_script_data()
		if script_data.follow ~= true or script_data.ignore_queue_events or script_data.ignore_research_finished then
			return
		end
		script_data.queue_dirty = true
		-- the last event of the tick decides who gets named
		local player = event.player_index and game.get_player(event.player_index)
		script_data.queue_player = player and player.name or nil
	end
	sync.events[defines.events.on_research_queued] = on_queue_event
	sync.events[defines.events.on_research_moved] = on_queue_event
	sync.events[defines.events.on_research_cancelled] = on_queue_event
end

-- One send per tick however many events fired (a lab raises several at once).
--- @param event EventData.on_tick
sync.events[defines.events.on_tick] = function(event)
	if not research_queue_api then
		return
	end
	local script_data = get_script_data()
	if not script_data.queue_dirty then
		return
	end
	script_data.queue_dirty = false
	local player = script_data.queue_player
	script_data.queue_player = nil
	if script_data.follow ~= true then
		return
	end
	clusterio_api.send_json("research_sync:queue", {
		queue = queue_names(game.forces["player"]),
		player = player,
	})
end

research_sync = {}
function research_sync.dump_technologies()
	local force = game.forces["player"]

	local techs = {}
	for _, tech in pairs(force.technologies) do
		table.insert(techs, {
			name = tech.name,
			level = tech.level,
			progress = get_technology_progress(tech),
			researched = tech.researched,
		})
	end

	if #techs == 0 then
		rcon.print("[]")
	else
		rcon.print(compat.table_to_json(techs))
	end
end

--- @param data string
function research_sync.sync_technologies(data)
	local force = game.forces["player"]

	local nameIndex = 1
	local levelIndex = 2
	local progressIndex = 3
	local researchedIndex = 4

	local script_data = get_script_data()
	script_data.ignore_research_finished = true
	for _, tech_data in pairs(compat.json_to_table(data) --[[@as table]]) do
		local tech = force.technologies[tech_data[nameIndex]]
		if tech and tech.level <= tech_data[levelIndex] then
			local new_level = math.min(tech_data[levelIndex], tech.prototype.max_level)
			if new_level ~= tech.level then
				-- when the level of the current research changes the
				-- progress is not automatically reset.
				if force.current_research == tech then
					force.research_progress = 0
				end
				tech.level = new_level
			end

			local progress
			if tech_data[researchedIndex] then
				if force.current_research == tech then
					force.research_progress = 0
				end
				tech.researched = true
				progress = nil
			-- may have finished here since the dump this sync is answering
			elseif tech_data[progressIndex] and not tech.researched then
				send_contribution(tech)
				progress = tech_data[progressIndex]
				set_technology_progress(tech, progress)
			else
				progress = get_technology_progress(tech)
			end

			script_data.technologies[tech.name] = {
				level = tech.level,
				researched = tech.researched,
				progress = progress,
			}
		end
	end
	script_data.ignore_research_finished = false
end

--- @param data string
function research_sync.update_progress(data)
	local script_data = get_script_data()
	local techs = compat.json_to_table(data) --[[@as table]]
	local force = game.forces["player"]

	for _, controllerTech in ipairs(techs) do
		local tech = force.technologies[controllerTech.name]
		if tech and tech.level == controllerTech.level then
			send_contribution(tech)
			set_technology_progress(tech, controllerTech.progress)
			script_data.technologies[tech.name] = {
				level = tech.level,
				progress = controllerTech.progress
			}
		end
	end
end

--- @param name string
--- @param level number
function research_sync.research_technology(name, level)
	local force = game.forces["player"]
	local tech = force.technologies[name]
	if not tech or tech.level > level then
		return
	end

	if level > tech.prototype.max_level then
		level = tech.prototype.max_level
	end

	local script_data = get_script_data()
	script_data.ignore_research_finished = true
	if tech == force.current_research and tech.level == level then
		force.research_progress = 1

	elseif tech.level < level or tech.level == level and not tech.researched then
		tech.level = level
		tech.researched = true

		if tech.name:find("-%d+$") then
			game.print {"", "Researched ", {"technology-name." .. tech.name:gsub("-%d+$", "")}, " ", level}
		else
			game.print {"", "Researched ", {"technology-name." .. tech.name}}
		end
		game.play_sound { path = "utility/research_completed" }
	end
	script_data.ignore_research_finished = false

	script_data.technologies[tech.name] = {
		level = tech.level,
		researched = tech.researched,
	}
end

function research_sync.queue_state()
	if not research_queue_api then
		rcon.print('{"follow":false}')
		return
	end
	local script_data = get_script_data()
	local first = script_data.follow == nil
	if first then
		script_data.follow = true
	end
	rcon.print(compat.table_to_json({
		follow = script_data.follow,
		first = first,
		queue = queue_names(game.forces["player"]),
	}))
end

--- @param data string JSON {queue: string[], player?: string, instance?: string}
function research_sync.apply_queue(data)
	if not research_queue_api then
		return
	end
	local msg = compat.json_to_table(data) --[[@as table]]
	local queue = msg.queue or {}
	if msg.instance then
		local list = format_queue(queue)
		if msg.player then
			game.print(msg.player .. " changed the research queue on " .. msg.instance .. ": " .. list)
		else
			game.print("The research queue was changed on " .. msg.instance .. ": " .. list)
		end
	end

	if get_script_data().follow ~= true then
		return
	end
	local force = game.forces["player"]
	-- Names this tile has no technology for (a mod it lacks) would throw.
	local known = {}
	for _, name in ipairs(queue) do
		if force.technologies[name] then
			table.insert(known, name)
		end
	end
	local current = queue_names(force)
	local same = #known == #current
	for i = 1, #known do
		if known[i] ~= current[i] then
			same = false
			break
		end
	end
	if not same then
		write_queue(force, known)
	end
end

--- @param enabled boolean
--- @param player_name string?
function research_sync.set_follow(enabled, player_name)
	if not research_queue_api then
		return
	end
	local script_data = get_script_data()
	if script_data.follow == enabled then
		return
	end
	script_data.follow = enabled
	script_data.queue_dirty = false
	script_data.queue_player = nil
	for _, player in pairs(game.players) do
		ensure_gui(player)
	end

	local state = enabled and "on" or "off"
	if player_name then
		game.print(player_name .. " turned " .. state .. " following the cluster research queue")
	else
		game.print("Following the cluster research queue was turned " .. state)
	end

	local force = game.forces["player"]
	if enabled then
		clusterio_api.send_json("research_sync:follow", { queue = queue_names(force), player = player_name })
	else
		write_queue(force, {})
	end
end


return sync
