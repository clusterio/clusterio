local mod_gui = require 'mod-gui'

-- ADDS DOOMSDAY STATS BUTTON
local function gui_update_DOOM(player)
	local gui = mod_gui.get_frame_flow(player)
	local frame = gui.doomsday_stats
	if not frame then
		return
	end
	
	frame.clear()
	for i,stat in ipairs(doomsday_status()) do
		frame.add{
			type = "label",
			caption = stat
		}
	end
end

local function toggle_frame_DOOM(player)
	local gui = mod_gui.get_frame_flow(player)
	local frame = gui.doomsday_stats
	
	if frame then
		frame.destroy()
		return
	end
	
	frame = gui.add{
		type = "frame",
		name = "doomsday_stats",
		direction = "vertical",
		caption = "Doomsday stats",
		style = mod_gui.frame_style,
	}
	
	frame.style.horizontally_stretchable = false
	frame.style.vertically_stretchable = false
	gui_update_DOOM(player)
end

local function get_sprite_button_DOOM(player)
	local button_flow = mod_gui.get_button_flow(player)
	button_DOOM = button_flow.doomsday_stats_button

	if button_DOOM then
		button_DOOM.destroy()
	end

	if player.admin then
		button_DOOM = button_flow.add{
			type = "sprite-button",
			name = "doomsday_stats_button",
			sprite = "item/raw-fish",
			style = mod_gui.button_style,
			tooltip = "Show debug stats for doomsday",
		}
	end
end

--ADDS PDNC STATS BUTTON
local function gui_update_PDNC(player)
	local gui = mod_gui.get_frame_flow(player)
	local frame_PDNC = gui.PDNC_stats
	if not frame_PDNC then
		return
	end
	
	frame_PDNC.clear()
	for i,stat in ipairs(pdnc_extended_status()) do
		frame_PDNC.add{
			type = "label",
			caption = stat
		}
	end
end

local function toggle_frame_PDNC(player)
	local gui = mod_gui.get_frame_flow(player)
	local frame_PDNC = gui.PDNC_stats
	
	if frame_PDNC then
		frame_PDNC.destroy()
		return
	end
	
	frame_PDNC = gui.add{
		type = "frame",
		name = "PDNC_stats",
		direction = "vertical",
		caption = "PDNC stats",
		style = mod_gui.frame_style,
	}
	
	frame_PDNC.style.horizontally_stretchable = false
	frame_PDNC.style.vertically_stretchable = false
	gui_update_PDNC(player)
end

local function get_sprite_button_PDNC(player)
	local button_flow = mod_gui.get_button_flow(player)
	local button_PDNC = button_flow.PDNC_stats_button

	if button_PDNC then
		button_PDNC.destroy()
	end

	if player.admin then
		button_PDNC = button_flow.add{
			type = "sprite-button",
			name = "PDNC_stats_button",
			sprite = "item/raw-fish",
			style = mod_gui.button_style,
			tooltip = "Show debug stats for PDNC",
		}
	end
end

-- ADDS DOOMSDAY TIME LEFT COUNTER
local function gui_update_counter(player)
	local gui = player.gui.screen --mod_gui.get_frame_flow(player)
	local frame_counter = gui.doomsday_counter
	if not frame_counter then
		return
	end
	
	frame_counter.clear()
	frame_counter.add{
		type = "label",
		caption = doomsday_time_left()
	}
	frame_counter.location = {player.display_resolution.width/2 - 59, 10}
	frame_counter.visible = true
end

local function toggle_frame_counter(player)
	--local player = player
	local gui = player.gui.screen --mod_gui.get_frame_flow(player)
	local frame_counter = gui.doomsday_counter
	-- if frame_counter then
	--     frame_counter.destroy()
	--     return
	-- end
	
	frame_counter = gui.add{
		type = "frame",
		name = "doomsday_counter",
		direction = "horizontal",
		--caption = "Doomsday counter",
		style = mod_gui.frame_style,
	}

	--frame_counter.style.horizontally_stretchable = false
	frame_counter.style.vertically_stretchable = false
	frame_counter.visible = false
	gui_update_counter(player)
end

local function update_buttons(event)
	local player = game.players[event.player_index]
	if not (player and player.valid) then
		return
	end

	get_sprite_button_DOOM(player)
	get_sprite_button_PDNC(player)

	-- Make sure the frames are not visible to players
	if not player.admin then
		local gui = mod_gui.get_frame_flow(player)
		local frame_PDNC = gui.PDNC_stats
		
		if frame_PDNC then
			frame_PDNC.destroy()
		end

		local frame_DOOM = gui.doomsday_stats
		
		if frame_DOOM then
			frame_DOOM.destroy()
		end
	end
end

-- ON GUI CLICK AND OTHERS
local function on_gui_click(event)
	local gui = event.element
	local player = game.players[event.player_index]
	if not (player and player.valid and gui and gui.valid) then
		return
	end
	
	if gui.name == "doomsday_stats_button" then
		toggle_frame_DOOM(player)
	end
	if gui.name == "PDNC_stats_button" then
		toggle_frame_PDNC(player)
	end
end

local function on_player_created(event)
	local player = game.players[event.player_index]
	if not (player and player.valid) then
		return
	end
	
	update_buttons(event)
	toggle_frame_counter(player)
end

local function gui_update_all()
	for _, player in pairs(game.players) do
		if player and player.valid then
			gui_update_DOOM(player)
			gui_update_PDNC(player)
			gui_update_counter(player)  
		end
	end
end

local function on_gui_tick(event)
	gui_update_all()
end

local doomsdaygui_init = {}
local script_events = {
	--place the here what you would normaly use Event.register for
	-- Event.register(defines.events.on_player_created, testfunction)
	-- is the same as 
	-- [defines.events.on_player_created] = testfunction,
	-- where testfunction is | local functuin testfunction() { }
	--[Event] = function, 
	--put stuff here
	[defines.events.on_gui_click] = on_gui_click,
	[defines.events.on_player_created] = on_player_created,
	[defines.events.on_player_promoted] = update_buttons,
	[defines.events.on_player_demoted] = update_buttons,
}

doomsdaygui_init.on_nth_ticks = {
	--place the here what you would normaly use 
	--[tick] = function,
	--put stuff here
	[1] = on_gui_tick,
}

doomsdaygui_init.on_init = function() -- this runs when Event.core_events.init
	log("doomsdaygui init")
	--put stuff here

	global.doomsdaygui_data = global.doomsdaygui_data or script_data  -- NO TOUCHY

end

doomsdaygui_init.on_load = function() -- this runs when Event.core_events.load
	log("doomsdaygui load")
	--put stuff here

	script_data = global.doomsdaygui_data or script_data  -- NO TOUCHY
end

doomsdaygui_init.get_events = function()
	return script_events
end

return doomsdaygui_init