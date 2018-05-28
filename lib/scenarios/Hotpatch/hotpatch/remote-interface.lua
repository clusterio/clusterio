--[[

Copyright 2018 Chrisgbk
Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

]]
-- MIT License, https://opensource.org/licenses/MIT
local hotpatch_tools = require 'hotpatch.mod-tools'

--load private API
local install_mod = hotpatch_tools.install_mod
local install_mod_file = hotpatch_tools.install_mod_file
local run_mod = hotpatch_tools.run_mod
local uninstall_mod = hotpatch_tools.uninstall_mod

local loaded_mods = hotpatch_tools.loaded_mods
local mod_env = hotpatch_tools.mod_env

local mod_reset = hotpatch_tools.mod_reset
local mod_reset_events = hotpatch_tools.mod_reset_events
local mod_init = hotpatch_tools.mod_init
local mod_load = hotpatch_tools.mod_load
local mod_configuration_changed = hotpatch_tools.mod_configuration_changed

local debug_log = hotpatch_tools.debug_log

local remote_interface = {}

--IMPORTANT: WHEN COPY PASTING CODE TO CONSOLE THE CODE MUST HAVE SINGLE LINE COMMENTS REMOVED
-- FACTORIO CONSOLE STRIPS LINEFEEDS WHICH MAKES ALL THE CODE BECOME COMMENTED OUT
--TODO: gate these behind admin permissions; if (game.player and game.player.admin) should work for console commands?

debug_log('info: installing remote interface...')

remote_interface['install'] = function(mod_name, mod_version, mod_code, mod_files)
    -- this installs a new mod and runs on_init, then registers events
    -- Note that mods may expect that certain events haven't been called yet when their on_init is ran
    -- This may prevent them from functioning properly, without manually calling the events they expect
    -- examples: on_player_created
    local caller = game.player or _ENV
    if (caller == _ENV) or caller.admin then
        local old_version = global.mod_version[mod_name]
        if old_version then
            debug_log('WARNING: mod already exists: ' .. mod_name .. ' ' .. old_version)
            debug_log('WARNING: reinstalling mod in-place: ' .. mod_name .. ' ' .. mod_version)
        end
        
        install_mod(mod_name, mod_version, mod_code, mod_files)
        run_mod(mod_name)
        mod_init(mod_name)
        -- TODO: notify all mods
        -- TODO: determine vanilla behaviour and replicate it
        mod_configuration_changed(mod_name, {mod_changes = {mod_name={new_version=mod_version}}})
    end
end

remote_interface['run'] = function(mod_name)
    -- this runs on_init, then registers events
    -- Note that mods may expect that certain events haven't been called yet when their on_init is ran
    -- This may prevent them from functioning properly, without manually calling the events they expect
    -- examples: on_player_created
    local caller = game.player or _ENV
    if (caller == _ENV) or caller.admin then
        local mod = loaded_mods[mod_name]
        local version = ''
        if mod then
            debug_log('WARNING: mod already loaded: ' .. mod_name .. ' ' .. version)
            debug_log('WARNING: reinitializing: ' .. mod_name .. ' ' .. version)
        end
        
        run_mod(mod_name)
        mod_init(mod_name)
        -- TODO: notify all mods
        -- TODO: determine vanilla behaviour and replicate it
        mod_configuration_changed(mod_name, {mod_changes = {mod_name={new_version=mod_version}}})
    end
end

remote_interface['update'] = function(mod_name, mod_version, mod_code, mod_files)
    -- this updates an existing mod
    -- the current mods events are de-registered, the new code is installed, on_load is triggered, and then events are registered
    -- finally, the mod is informed of the update, so it can run migrations from the previous version
    -- TODO: validation
    local caller = game.player or _ENV
    if (caller == _ENV) or caller.admin then
        local old_version = global.mod_version[mod_name]
        
        mod_reset_events(mod_name)
        install_mod(mod_name, mod_version, mod_code, mod_files)
        run_mod(mod_name)
        if old_version then
            mod_load(mod_name)
            -- The mod must do any migrations here
            -- TODO: notify all mods
            mod_configuration_changed(mod_name, {mod_changes = {mod_name={old_version=old_version, new_version=mod_version}}})
        else
            -- first time install
            mod_init(mod_name)
            -- TODO: notify all mods
            mod_configuration_changed(mod_name, {mod_changes = {mod_name={new_version=mod_version}}})
        end
    end
end

remote_interface['install_mod_file'] = function(mod_name, mod_file, mod_file_code)
    install_mod_file(mod_name, mod_file, mod_file_code)
end

--TODO: most of this function
remote_interface['clean'] = function(mod_name)
    -- Removes ALL mod data and reinitializes
    -- doesn't remove things a mod may add like surfaces, etc
    local caller = game.player or _ENV
    if (caller == _ENV) or caller.admin then
        mod_reset(mod_name)
        run_mod(mod_name)
        mod_init(mod_name)
        mod_configuration_changed(mod_name, {mod_changes = {mod_name={new_version=mod_version}}})
    end
end

remote_interface['uninstall'] = function(mod_name)
    -- Uninstalls a mod
    local caller = game.player or _ENV
    if (caller == _ENV) or caller.admin then
        uninstall_mod(mod_name)
    end
end

remote.add_interface('hotpatch', remote_interface)

--[[

remote.call('hotpatch, 'install', 'test', '1.0.0', [===[ 
script.on_event(defines.events.on_player_changed_position, function(e) 
    game.print('changed position') 
end
]===]

local updated_code = ....
remote.call('hotpatch', 'update', 'test', '1.0.1', updated_code)


]]

debug_log('info: installing remote interface... Complete!')
return remote_interface