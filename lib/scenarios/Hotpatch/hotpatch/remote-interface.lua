local hotpatch_tools = require 'hotpatch.mod-tools'
hotpatch_tools.static_mod('hotpatch-remote-interface', '1.0.2', [===[
--[[

Copyright 2018 Chrisgbk
Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

]]
-- MIT License, https://opensource.org/licenses/MIT

local hotpatch_tools = require 'hotpatch.mod-tools'

--load private API
-- mod installation/uninstallation support functions
-- These take a mod NAME as a first argument
local install_mod = hotpatch_tools.install_mod
local find_installed_mod = hotpatch_tools.find_installed_mod
local install_mod_file = hotpatch_tools.install_mod_file
local uninstall_mod = hotpatch_tools.uninstall_mod

-- mod interaction functions
-- These take a LOADED INDEX as a first argument, except load_mod, which takes an INSTALLED INDEX
local load_mod = hotpatch_tools.load_mod
local find_loaded_mod = hotpatch_tools.find_loaded_mod
local run_mod = hotpatch_tools.run_mod
local reset_mod = hotpatch_tools.reset_mod
local reset_mod_events = hotpatch_tools.reset_mod_events
local register_mod_events = hotpatch_tools.register_mod_events
local unload_mod = hotpatch_tools.unload_mod

-- internal callbacks when a mod registers events
local register_event = hotpatch_tools.register_event
local register_nth_tick = hotpatch_tools.register_nth_tick
local register_on_tick = hotpatch_tools.register_on_tick

-- mod bootstrap functions
-- These take a LOADED INDEX as a first argument
local mod_on_init = hotpatch_tools.mod_on_init
local mod_on_load = hotpatch_tools.mod_on_load
local mod_on_configuration_changed = hotpatch_tools.mod_on_configuration_changed

local static_mods = hotpatch_tools.static_mods
local console = hotpatch_tools.console
local debug_log = hotpatch_tools.debug_log
local loaded_mods = hotpatch_tools.loaded_mods
local installed_mods = hotpatch_tools.installed_mods

local remote_interface = {}

--IMPORTANT: WHEN COPY PASTING CODE TO CONSOLE THE CODE MUST HAVE SINGLE LINE COMMENTS REMOVED
-- FACTORIO CONSOLE STRIPS LINEFEEDS WHICH MAKES ALL THE CODE BECOME COMMENTED OUT
--TODO: gate these behind admin permissions; if (game.player and game.player.admin) should work for console commands?

debug_log({'hotpatch-info.remote-installing'})

remote_interface['install'] = function(mod_name, mod_version, mod_code, mod_files, only_install)
    -- this installs a new mod and runs on_init, then registers events
    -- Note that mods may expect that certain events haven't been called yet when their on_init is ran
    -- This may prevent them from functioning properly, without manually calling the events they expect
    -- examples: on_player_created
    local caller = game.player or console
    if caller.admin then
		if mod_files then
			for k,v in pairs(mod_files) do
				if k == 'control' then
					caller.print('ERROR: control.lua loaded twice for mod ' .. mod_name)
					return
				end
			end
		end
        local installed_index = find_installed_mod(mod_name)
        local loaded_index = find_loaded_mod(mod_name)
        if installed_index then
            local old_version = installed_mods[installed_index].version
            if old_version then
                debug_log('WARNING: mod already exists: ' .. mod_name .. ' ' .. old_version)
                debug_log('WARNING: reinstalling mod in-place: ' .. mod_name .. ' ' .. mod_version)
            end
            if loaded_index then
                unload_mod(loaded_index)
            end
        end
        
        install_mod(mod_name, mod_version, mod_code, mod_files)
        if not only_install then
            installed_index = find_installed_mod(mod_name)
            if installed_index then
                if not load_mod(installed_index) then
                    caller.print('compilation failed for mod ' .. mod_name)
                    return
                end
                loaded_index = find_loaded_mod(mod_name)
                if loaded_index then
                    if not run_mod(loaded_index) then
                        caller.print('execution failed for mod ' .. mod_name)
						unload_mod(loaded_index)
                        return
                    end
                    if not mod_on_init(loaded_index) then
                        caller.print('on_init failed for mod ' .. mod_name)
						unload_mod(loaded_index)
                        return
                    end
                    -- TODO: notify all mods
                    -- TODO: determine vanilla behaviour and replicate it
                    if not mod_on_configuration_changed(loaded_index, {mod_changes = {mod_name={new_version=mod_version}}}) then
                        caller.print('on_configuration_changed failed for mod ' .. mod_name)
						unload_mod(loaded_index)
                        return
                    end
                else
                end
            else
            end
        end
    else
        caller.print('You must be an admin to run this command.')
    end
end

remote_interface['run'] = function(mod_name)
    -- this runs on_init, then registers events
    -- Note that mods may expect that certain events haven't been called yet when their on_init is ran
    -- This may prevent them from functioning properly, without manually calling the events they expect
    -- examples: on_player_created
    local caller = game.player or console
    if caller.admin then
        local installed_index = find_installed_mod(mod_name)
        local loaded_index = find_loaded_mod(mod_name)
        if installed_index and not loaded_index then
            if not load_mod(installed_index) then
                caller.print('compilation failed for mod ' .. mod_name)
                return
            end
            loaded_index = find_loaded_mod(mod_name)
        else
            if loaded_index then
                local mod = loaded_mods[loaded_index]
                local version = mod.version
                debug_log('WARNING: mod already loaded: ' .. mod_name .. ' ' .. version)
                debug_log('WARNING: reinitializing: ' .. mod_name .. ' ' .. version)
            end
        end
        
        if loaded_index then
            if not run_mod(loaded_index) then
                caller.print('execution failed for mod ' .. mod_name)
				unload_mod(loaded_index)
                return
            end
            if not mod_on_init(loaded_index) then
                caller.print('on_init failed for mod ' .. mod_name)
				unload_mod(loaded_index)
                return
            end
            -- TODO: notify all mods
            -- TODO: determine vanilla behaviour and replicate it
            if not mod_on_configuration_changed(loaded_index, {mod_changes = {mod_name={new_version=version}}}) then
                caller.print('on_configuration_changed failed for mod ' .. mod_name)
				unload_mod(loaded_index)
                return
            end
        end    
    else
        caller.print('You must be an admin to run this command.')
    end
end

remote_interface['update'] = function(mod_name, mod_version, mod_code, mod_files)
    -- this updates an existing mod
    -- the current mods events are de-registered, the new code is installed, on_load is triggered, and then events are registered
    -- finally, the mod is informed of the update, so it can run migrations from the previous version
    -- TODO: validation
    local caller = game.player or console
    if caller.admin then
		if mod_files then
			for k,v in pairs(mod_files) do
				if k == 'control' then
					caller.print('ERROR: control.lua loaded twice for mod ' .. mod_name)
					return
				end
			end
		end
        local installed_index = find_installed_mod(mod_name)
        local loaded_index = find_loaded_mod(mod_name)
        local old_version
        if loaded_index then
            old_version = loaded_mods[loaded_index].version
            unload_mod(loaded_index)
        end
        install_mod(mod_name, mod_version, mod_code, mod_files)
        installed_index = find_installed_mod(mod_name)
        if not load_mod(installed_index) then
            caller.print('compilation failed for mod ' .. mod_name)
            return
        end
        loaded_index = find_loaded_mod(mod_name)
        if not run_mod(loaded_index) then
            caller.print('execution failed for mod ' .. mod_name)
			unload_mod(loaded_index)
            return
        end
        if old_version then
            if not mod_on_load(loaded_index) then
                caller.print('on_load failed for mod ' .. mod_name)
				unload_mod(loaded_index)
                return
            end
            -- The mod must do any migrations here
            -- TODO: notify all mods
            if not mod_on_configuration_changed(loaded_index, {mod_changes = {mod_name={old_version=old_version, new_version=mod_version}}}) then
                caller.print('on_configuration_changed failed for mod ' .. mod_name)
				unload_mod(loaded_index)
                return
            end
        else
            -- first time install
            if not mod_on_init(loaded_index) then
                caller.print('on_init failed for mod ' .. mod_name)
				unload_mod(loaded_index)
                return
            end
            -- TODO: notify all mods
            if not mod_on_configuration_changed(loaded_index, {mod_changes = {mod_name={new_version=mod_version}}}) then
                caller.print('on_configuration_changed failed for mod ' .. mod_name)
				unload_mod(loaded_index)
                return
            end
        end
    else
        caller.print('You must be an admin to run this command.')
    end
end

remote_interface['install_mod_file'] = function(mod_name, mod_file, mod_file_code)
    local caller = game.player or console
    if caller.admin then
        install_mod_file(mod_name, mod_file, mod_file_code)
    else
        caller.print('You must be an admin to run this command.')
    end
end

--TODO: most of this function
remote_interface['clean'] = function(mod_name)
    -- Removes ALL mod data and reinitializes
    -- doesn't remove things a mod may add like surfaces, etc
    local caller = game.player or console
    if caller.admin then
        mod_reset(mod_name)
        run_mod(mod_name)
        mod_on_init(mod_name)
        mod_on_configuration_changed(mod_name, {mod_changes = {mod_name={new_version=mod_version}}})
    else
        caller.print('You must be an admin to run this command.')
    end
end

remote_interface['uninstall'] = function(mod_name)
    -- Uninstalls a mod
    local caller = game.player or console
    if caller.admin then
        uninstall_mod(mod_name)
    else
        caller.print('You must be an admin to run this command.')
    end
end

remote.add_interface('hotpatch', remote_interface)

debug_log({'hotpatch-info.complete', {'hotpatch-info.remote-installing'}})

]===])

--[[

remote.call('hotpatch, 'install', 'test', '1.0.0', [===[ 
script.on_event(defines.events.on_player_changed_position, function(e) 
    game.print('changed position') 
end
]===]

local updated_code = ....
remote.call('hotpatch', 'update', 'test', '1.0.1', updated_code)


]]

return true