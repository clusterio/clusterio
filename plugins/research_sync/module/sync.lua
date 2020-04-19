local clusterio_api = require("modules/clusterio/api")

local sync = {}


local function get_technology_progress(tech)
    if tech == tech.force.current_research then
        return tech.force.research_progress
    else
        return tech.force.get_saved_technology_progress(tech.name)
    end
end

local function set_technology_progress(tech, progress)
    if tech == tech.force.current_research then
        tech.force.research_progress = progress
    else
        tech.force.set_saved_technology_progress(tech.name, progress)
    end
end

sync.events = {}
sync.events[clusterio_api.events.on_server_startup] = function(event)
    if not global.research_sync then
        global.research_sync = {
            technologies = {},
        }
    end

    -- Used when syncing completed technologies from the master
    global.research_sync.ignore_research_finished = false

    local force = game.forces["player"]
    for _, tech in pairs(force.technologies) do
        if tech.enabled then
            local progress = get_technology_progress(tech)
            global.research_sync.technologies[tech.name] = {
                level = tech.level,
                researched = tech.researched,
                progress = progress,
            }
        end
    end
end

local function get_contribution(tech)
    local progress = get_technology_progress(tech)
    if not progress then
        return 0, nil
    end

    local prev_tech = global.research_sync.technologies[tech.name]
    if prev_tech.progress and prev_tech.level == tech.level then
        return progress - prev_tech.progress, progress
    else
        return progress, progress
    end
end

local function send_contribution(tech)
    local contribution, progress = get_contribution(tech)
    if contribution ~= 0 then
        clusterio_api.send_json("research_sync:contribution", {
            name = tech.name,
            level = tech.level,
            contribution = contribution,
        })
        global.research_sync.technologies[tech.name].progress = progress
    end
end

sync.events[defines.events.on_research_started] = function(event)
    local tech = event.last_research
    if tech then
        send_contribution(tech)
    end
end

sync.events[defines.events.on_research_finished] = function(event)
    if global.research_sync.ignore_research_finished then
        return
    end

    local tech = event.research
    global.research_sync.technologies[tech.name] = {
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

research_sync = {}
function research_sync.dump_technologies()
    local force = game.forces["player"]

    local techs = {}
    for _, tech in pairs(force.technologies) do
        if tech.enabled then
            table.insert(techs, {
                name = tech.name,
                level = tech.level,
                progress = get_technology_progress(tech),
                researched = tech.researched,
            })
        end
    end

    if #techs == 0 then
        rcon.print("[]")
    else
        rcon.print(game.table_to_json(techs))
    end
end

function research_sync.sync_technologies(data)
    local force = game.forces["player"]

    local nameIndex = 1
    local levelIndex = 2
    local progressIndex = 3
    local researchedIndex = 4

    global.research_sync.ignore_research_finished = true
    for _, tech_data in pairs(game.json_to_table(data)) do
        local tech = force.technologies[tech_data[nameIndex]]
        if tech and tech.enabled and tech.level <= tech_data[levelIndex] then
            tech.level = tech_data[levelIndex]
            local progress
            if tech_data[researchedIndex] then
                tech.researched = true
                progress = nil
            elseif tech_data[progressIndex] then
                send_contribution(tech)
                progress = tech_data[progressIndex]
                set_technology_progress(tech, progress)
            else
                progress = get_technology_progress(tech)
            end

            global.research_sync.technologies[tech.name] = {
                level = tech.level,
                researched = tech.researched,
                progress = progress,
            }
        end
    end
    global.research_sync.ignore_research_finished = false
end

function research_sync.update_progress(data)
    local techs = game.json_to_table(data)
    local force = game.forces["player"]

    for _, masterTech in ipairs(techs) do
        local tech = force.technologies[masterTech.name]
        if tech and tech.enabled and tech.level == masterTech.level then
            send_contribution(tech)
            set_technology_progress(tech, masterTech.progress)
            global.research_sync.technologies[tech.name] = {
                level = tech.level,
                progress = masterTech.progress
            }
        end
    end
end

function research_sync.research_technology(name, level)
    local force = game.forces["player"]
    local tech = force.technologies[name]
    if not tech or not tech.enabled or tech.level > level then
        return
    end

    global.research_sync.ignore_research_finished = true
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
    global.research_sync.ignore_research_finished = false

    global.research_sync.technologies[tech.name] = {
        level = tech.level,
        researched = tech.researched,
    }
end


return sync
