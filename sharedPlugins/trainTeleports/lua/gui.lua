local alphanumcmp
do
    local function padnum(d) return ("%012d"):format(d) end
    alphanumcmp = function (a, b)
        return tostring(a):gsub("%d+",padnum) < tostring(b):gsub("%d+",padnum)
    end
end
local function gui_create(self)
    local root = self.player.gui.left.add({
        type = "frame",
        caption = "Clusterio",
        direction = "vertical",
    })
    self.root = root
    root.add({
        type = "label",
        caption = "Loading stations from other servers...",
    })
end
local function gui_destroy(self)
    if self.root.valid then
        self.root.destroy()
    end
end

local function gui_createlist(self)
    if not self.list then
        self.root.clear()

        local wrapper = self.root.add({
            type = "flow",
            direction = "vertical",
        })
        self.wrapper = wrapper
        self.label = wrapper.add({
            type = "label",
            caption = ""
        })
        local list = wrapper.add({
            type = "scroll-pane",
            horizontal_scroll_policy = "never",
            vertical_scroll_policy = "auto",
        })
        list.style.vertical_scrollbar_spacing = 5
        list.style.maximal_height = 400
        self.list = list
    end
    self.list.clear()
end

local function gui_createlistitem(self, name, caption, tooltip)
    if not self.list then
        gui_createlist(self)
    end

    local button = self.list.add({
        type = "button",
        name = name,
        caption = caption,
        tooltip = tooltip,
    })
    button.style = "tracking_on_button"
    local style = button.style
    style.font = "default-bold"
    style.minimal_height, style.minimal_width = 32, 32
    style.maximal_width = 0
    style.horizontally_stretchable = true
    style.align = "left"
    style.top_padding, style.right_padding, style.bottom_padding, style.left_padding =
        3, 32, 3, 3
end

local function gui_showlist(self)
    self.server = nil
    self.root.caption = "Clusterio"
    gui_createlist(self)
    self.label.caption = "Select a server"

    if self.back_button then
        self.back_button.destroy()
        self.back_button = nil
    end

    for _, server in ipairs(self.remote_data) do
        gui_createlistitem(self,
            "clusterio_locomotive_showserver_" .. tostring(server.id),
            server.name,
            server.name .. " (ID " .. tostring(server.id) .. ")"
        )
    end
end

local function gui_showserver(self, server_id)
    local server
    for _, s in ipairs(self.remote_data) do
        if s.id == server_id then
            server = s
        end
    end
    if not server then
        return
    end
    
    self.server = server
    self.root.caption = "Clustorio - " .. server.name .. " (ID " .. tostring(server.id) .. ")"
    self.label.caption = "Select a station"

    if not self.back_button then
        self.back_button = self.wrapper.add({
            type = "button",
            name = "clusterio_locomotive_showlist",
            caption = "Back",
        })
        self.back_button.style.horizontally_stretchable = true
    end

    gui_createlist(self)

    for _, station in ipairs(server.stations) do
        gui_createlistitem(
            self,
            "clusterio_locomotive_addstation_" .. tostring(server.id) .. "_" .. station,
            station
        )
    end
end

local function gui_populate(self, remote_data)
    table.sort(remote_data, function (a, b) return alphanumcmp(a.name, b.name) end)
    for _, server in ipairs(remote_data) do
        table.sort(server.stations, alphanumcmp)
    end
    self.remote_data = remote_data

    gui_showlist(self)
end
remote.remove_interface("trainTeleportsGui");
remote.add_interface("trainTeleportsGui", {
	runCode = function(code)
		load(code, "trainTeleports code injection failed!", "bt", _ENV)()
	end
})


script.on_event(defines.events.on_gui_opened, function(event)
    local player = game.players[event.player_index]
    local entity = event.entity
    if not entity or entity.type ~= "locomotive" then
        return
    end
    local train = entity.train

    if global.custom_locomotive_gui == nil then
        global.custom_locomotive_gui = {}
    end

    local state = global.custom_locomotive_gui[player.index]
    if state ~= nil then
        gui_destroy(state)
    end
    state = {}
    global.custom_locomotive_gui[player.index] = state

    state.player = player
    state.train = train

    gui_create(state)
    local dummy_data = {
        {
            id = 69,
            name = "Manufactorum Ajakis",
            stations = {
                "Copper Ore Depot",
                "Iron Ore Depot",
                "Coal Depot",
                "Uranium Depot",
            },
        },
        {
            id = 42,
            name = "Isengard",
            stations = {
                "Iron Ore Dropoff",
                "Outpost Train Origin",
            },
        },
    }
    gui_populate(state, global.trainstopsData)
end)

script.on_event(defines.events.on_gui_closed, function (event)
    local player_index = event.player_index
    local entity = event.entity
    if not entity or entity.type ~= "locomotive" then
        return
    end

    if global.custom_locomotive_gui then
        local state = global.custom_locomotive_gui[player_index]
        global.custom_locomotive_gui[player_index] = nil
        gui_destroy(state)
    end
end)

script.on_event(defines.events.on_player_removed, function (event)
    if global.custom_locomotive_gui then
        global.custom_locomotive_gui[event.player_index] = nil
    end
end)

script.on_event(defines.events.on_gui_click, function (event)
    local state = global.custom_locomotive_gui and global.custom_locomotive_gui[event.player_index]
    if not state then
        return
    end

    local element_name = event.element.name
    if element_name == "clusterio_locomotive_showlist" then
        gui_showlist(state)
        return
    end
    if #element_name <= 32 then
        return
    end
    local substr = element_name:sub(1, 32)
    if substr == "clusterio_locomotive_showserver_" then
        local server_id = tonumber(element_name:sub(33))
        gui_showserver(state, server_id)
    elseif substr == "clusterio_locomotive_addstation_" then
        local split_point = string.find(element_name, "_", 33, true)
        if split_point then
            local server_id = tonumber(element_name:sub(33, split_point - 1))
            local station_name = element_name:sub(split_point + 1)
            local schedule = state.train.schedule
            if schedule == nil then
                schedule = {
                    current = 1,
                    records = {}
                }
            end
            schedule.records[#schedule.records + 1] = {
                station = "[Clusterio " .. tostring(server_id) .. "] " .. station_name,
                wait_conditions = {}
            }
            state.train.schedule = schedule
            game.players[event.player_index].print(("Station %q added to train schedule."):format(station_name))
        end
    end
end)
 

