-- Third itteration of programmable day-night cycle for Factorio
-- Developed by Zr4g0n with help
-- Features needed:
-- Set 'maximum brightness' from rocket launches cluster wide
-- Set 'time until doomsday' to any time, in minutes. 
-- Set 'evolution target' to any number [0.0, 1.0]
-- Changing day-night cycle based on days
-- Handle 'next time' elegantly

-- lamps enable darkness: [0.595 - 0.425] scaled to [0.0 - 0.85] range from [0.0 - 1.0] range
global.pdnc = global.pdnc or {}
global.pdnc_enabled = true 
global.pdnc_stepsize = 53 -- also used for script.on_nth_tick. Cannot be changed at runtime! 
global.pdnc_surface = 1
global.pdnc_current_time = 0
global.pdnc_current_point = {x = 0, y = 1.0}
global.pdnc_last_point = {x = -1, y = 0.0}
global.pdnc_max_brightness = 0.5 -- for clusterio
global.pdnc_debug = false
global.pdnc_enable_brightness_limit = false
global.pdnc_enable_rocket_darkness = false
global.pdnc_rockets_launched = 0
global.pdnc_rockets_launched_step_size = 0.025
global.pdnc_rockets_launched_smooth = 0
global.pdnc_min_per_day = 15.0

function pdnc_setup()
	--game.surfaces[global.pdnc_surface].ticks_per_day = pdnc_min_to_ticks(10.0)
	doomsday_setup()
end

-- Returns true if the player is an admin
function check_admin(ctx)
	local player = game.players[ctx.player_index]
	if not player.admin then
		player.print("Only admins can use /"..ctx.name)
		return false
	end
	return true
end

function pdnc_toggle_debug(ctx)
	if not check_admin(ctx) then return end
	global.pdnc_debug = not global.pdnc_debug
	pdnc_print_status(ctx)
end

function pdnc_toggle(ctx)
	if not check_admin(ctx) then return end
	global.pdnc_enabled = not global.pdnc_enabled
	pdnc_print_status(ctx)
end

function pdnc_print_status(ctx)
	local player = game.players[ctx.player_index]
	if(global.pdnc_enabled)then
		player.print("PDNC is enabled")
	else
		player.print("PDNC is disabled")
	end
	
	if(global.pdnc_debug)then
		player.print("PDNC debug is enabled")
		pdnc_extended_status()
	else
		player.print("PDNC debug is disabled")
	end
end

function pdnc_extended_status()
	stats = {
		"global.pdnc_stepsize: " .. global.pdnc_stepsize,
		"global.pdnc_surface: " .. global.pdnc_surface,
		"global.pdnc_current_time: " .. global.pdnc_current_time,
		"global.pdnc_max_brightness: " .. global.pdnc_max_brightness,
		"global.pdnc_enable_brightness_limit: " .. pdnc_bool_to_string(global.pdnc_enable_brightness_limit),
		"global.pdnc_enable_rocket_darkness: " .. pdnc_bool_to_string(global.pdnc_enable_rocket_darkness),
		"global.pdnc_rockets_launched: " .. global.pdnc_rockets_launched,
		"global.pdnc_rockets_launched_step_size: " .. global.pdnc_rockets_launched_step_size,
		"global.pdnc_rockets_launched_smooth: " .. global.pdnc_rockets_launched_smooth,
		"ticks per day: " .. game.surfaces[global.pdnc_surface].ticks_per_day,
		"current tick: " .. game.tick,
	}
	return stats
end

function pdnc_bool_to_string(b)
	if(b)then
		return "true"
	else
		return "false"
	end
end

function pdnc_core()
	if(global.pdnc_enabled)then
		doomsday_core()
		local current_surface = game.surfaces[global.pdnc_surface]
		pdnc_freeze_check(current_surface)
		current_surface.ticks_per_day = pdnc_min_to_ticks(global.pdnc_min_per_day) -- move this somewhere else; doesn't need to run every nth tick!
		global.pdnc_current_time = game.tick / current_surface.ticks_per_day
		
		-- get current Y coordinate. X = 0 always. 
		local current_point = {x = global.pdnc_current_time, y = pdnc_program(global.pdnc_current_time)}
		-- get next Y coordinate, X = 'step size'
		local next_point = {x = (global.pdnc_current_time + (global.pdnc_stepsize/current_surface.ticks_per_day)), y = pdnc_program(global.pdnc_current_time + (global.pdnc_stepsize/current_surface.ticks_per_day))}
		
		local top_point = pdnc_intersection_top(current_point, next_point)
		local bot_point = pdnc_intersection_bot(current_point, next_point)
		
		-- the order is dusk - evening - morning - dawn. They *must* be in that order and they cannot be equal
		if(top_point < bot_point) then -- dusk -> evening
			pdnc_cleanup_last_tick(current_surface)
			current_surface.evening = bot_point - current_point.x
			current_surface.dusk = top_point - current_point.x
		elseif(top_point > bot_point) then -- morning -> dawn
			pdnc_cleanup_last_tick(current_surface)
			current_surface.morning = bot_point - current_point.x
			current_surface.dawn = top_point - current_point.x
		elseif(top_point == bot_point) then
			pdnc_debug_message("PDNC: Top and bot point equal")
			-- no cleanup is done here
			-- if the points are equal, use last value until not equal
			-- this should never be reached unless the pdnc_program() is broken.
		else
			pdnc_debug_message("Top and bot not different nor equal. probably a NaN error")
			pdnc_debug_message("bot_point: " .. bot_point)
			pdnc_debug_message("top_point: " .. top_point)
			-- this should never be reached.
		end
	else
	end
end

function pdnc_cleanup_last_tick(current_surface)
	current_surface.daytime = 0
	-- must be in this  spesific order to 
	-- preserve the order at all times
	-- dusk < evening < morning < dawn.
	-- DO NOT CHANGE THE ORDER!
	current_surface.dusk = -999999999999
	current_surface.dawn = 999999999999
	current_surface.evening = -999999999998
	current_surface.morning = 999999999998
end

function pdnc_disable_and_reset(ctx)
	if not check_admin(ctx) then return end
	local current_surface = game.surfaces[global.pdnc_surface]
	pdnc_cleanup_last_tick(current_surface)
	-- DO NOT CHANGE THIS ORDER! 
	current_surface.evening = 0.45
	current_surface.morning = 0.55
	current_surface.dusk = 0.25
	current_surface.dawn = 0.75
	current_surface.ticks_per_day = 25000
	global.pdnc_enabled = false
	pdnc_debug_message("PDNC Programable Day-Night Cycle disabled, normal day-night cycle enabled")
end

function pdnc_freeze_check(current_surface)
	if(current_surface.freeze_daytime)then
		current_surface.freeze_daytime = false
		game.print("Can't use freeze_daytime while programmable day-night cycle is active; time has been unfrozen")
	end
end

function pdnc_program(x)
	return pdnc_scaler(pdnc_c_boxy(x*6.28318530717958647692)) -- that's Tau, aka 2xPi
end

function pdnc_c_boxy(x)
	return pdnc_normalize((math.sin(x) + (0.111 * math.sin(3 * x))) * 1.124859392575928)
	-- magic numbers to make it scale to (-1, 1)
end

function pdnc_normalize(n)
	return (n + 1)/2
end

function pdnc_scaler(r) -- a bit messy, but simplifies a lot elsewhere
	if(pdnc_check_valid(r, "pdnc_scaler"))then
	
		local a = 1
		local b = 1
		
		if(global.pdnc_enable_brightness_limit) then
			a = global.pdnc_max_brightness
		end
		
		if(global.pdnc_enable_rocket_darkness) then
			b = 1 -  pdnc_rocket_launch_darkness()
		end
		
		return r * 0.85 * a * b	-- 0 -> 0.85 is the 'brightness range' of factorio
	end
end

function pdnc_intersection (s1, e1, s2, e2)
  local d = (s1.x - e1.x) * (s2.y - e2.y) - (s1.y - e1.y) * (s2.x - e2.x)
  local a = s1.x * e1.y - s1.y * e1.x
  local b = s2.x * e2.y - s2.y * e2.x
  local x = (a * (s2.x - e2.x) - (s1.x - e1.x) * b) / d
  --local y = (a * (s2.y - e2.y) - (s1.y - e1.y) * b) / d
  return x--, y
end

function pdnc_intersection_top (s2, e2)
	local s1, e1 = {x = -999999999, y = 0.85}, {x = 999999999, y = 0.85}
	return pdnc_intersection (s1, e1, s2, e2)
end

function pdnc_intersection_bot (s2, e2)
	local s1, e1 = {x = -999999999, y = 0.0}, {x = 999999999, y = 0.0}
	return pdnc_intersection (s1, e1, s2, e2)
end

function pdnc_set_max_brightness(n)
	if(pdnc_check_valid(n, "pdnc_set_max_brightness")) then
		global.pdnc_max_brightness = n
		pdnc_debug_message("global.pdnc_max_brightness set to " .. global.pdnc_max_brightness)
	end
end

function pdnc_min_to_ticks(m)
	return 60*60*m
end

function pdnc_rocket_launch_counter()
	global.pdnc_rockets_launched = 1 + global.pdnc_rockets_launched
end

function pdnc_rocket_launch_darkness()
	if (global.pdnc_rockets_launched_smooth < global.pdnc_rockets_launched)then
		global.pdnc_rockets_launched_smooth = global.pdnc_rockets_launched_step_size + global.pdnc_rockets_launched_smooth
	end
	return (1 - (50/(global.pdnc_rockets_launched_smooth+50)))
end

function pdnc_check_valid(n, s)
	if (n == nil) then
		pdnc_debug_message(s .. " set to nil! Set to 1.0 instead")
		return false
	elseif (n < 0) then
		pdnc_debug_message(s .. " cannot be " .. n .. " limited to 0.0 instead")
		return false
	elseif (n > 1) then
		pdnc_debug_message(s .. " cannot be " .. n .. " limited to 1.0 instead")
		return false
	elseif (n ~= n) then
		pdnc_debug_message(s .. " cannot be " .. n .. " since it's not a valid number!")
	else return true
	end
end

function pdnc_debug_message(s)
	if(global.pdnc_debug) then
		game.print(s)
	end
end


local PDNC_init = {}

local script_events = {
	--place the here what you would normaly use Event.register for
	-- Event.register(defines.events.on_player_created, testfunction)
	-- is the same as 
	-- [defines.events.on_player_created] = testfunction,
	-- where testfunction is | local functuin testfunction() { }
	--[Event] = function, 
	--put stuff here

}

PDNC_init.on_nth_ticks = {
	--place the here what you would normaly use 
	--[tick] = function,
	--put stuff here
	[global.pdnc_stepsize] = pdnc_core,
}

PDNC_init.add_commands = function()
	commands.add_command("pdnc", "gives PDNC's status", pdnc_print_status)
	commands.add_command("pdnc_toggle", "toggles pdnc", pdnc_toggle)
	commands.add_command("pdnc_toggle_debug", "toggles pdnc debug mode", pdnc_toggle_debug)
	commands.add_command("pdnc_disable_and_reset", "Disabled pdnc and resets the dnc to the vanilla default", pdnc_disable_and_reset)
end

PDNC_init.on_init = function() -- this runs when Event.core_events.init
	log("PDNC init")
	--put stuff here
	global.PDNC_data = global.PDNC_data or script_data  -- NO TOUCHY

end

PDNC_init.on_load = function() -- this runs when Event.core_events.load
	log("PDNC load")

	--put stuff here

	script_data = global.PDNC_data or script_data  -- NO TOUCHY
end

PDNC_init.get_events = function()
	return script_events
end

return PDNC_init
