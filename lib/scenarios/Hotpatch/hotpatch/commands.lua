local hotpatch_tools = require 'hotpatch.mod-tools'
hotpatch_tools.static_mod('hotpatch-commands', '1.0.1', [===[
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

local help_commands = {
    help = '/hotpatch help\nYou got this far, you probably know all you need to know',
    list = '/hotpatch list [type]\nLists \'installed\', \'loaded\' or \'running\' mods',
}

local sub_commands
sub_commands = {
    help = function(player_index, param)
        local caller = (player_index and game.players[player_index]) or console
        if (not param) or (param == '') then
            caller.print('Usage: /hotpatch [command] [parameters]')
            caller.print('Available commands:')
            for k, v in pairs(sub_commands) do caller.print(k) end
            caller.print('Use /hotpatch help [command] for help on a particular command')
        else
            local text = help_commands[param]
            if text then 
                caller.print(text)
            end
        end
    end,
    list = function(player_index, param)
        local caller = (player_index and game.players[player_index]) or console
        if not param or (param == '') then
            caller.print('Installed mods:')
            for k, v in pairs(installed_mods) do
                caller.print(table.concat{'[', k, '] ', v.name, ' ', v.version})
            end
            caller.print('Loaded/Running mods:')
            for k, v in pairs(loaded_mods) do
                caller.print(table.concat{'[', k, '] ', v.name, ' ', v.version, ' ', (v.loaded and 'loaded') or 'not loaded', ' ', (v.running and 'running') or 'not running'})
            end
        else
        
        end
    end,
}

local admin_commands = {
    reinstall = function(player_index, param)
        local caller = (player_index and game.players[player_index]) or console
        local mod
        local installed_index
        local loaded_index
        for i = 1, #static_mods do
            mod = static_mods[i]
            if mod.name:match('^hotpatch%-.*$') then
                loaded_index = find_loaded_mod(mod.name)
                if loaded_index then
                    unload_mod(loaded_index)
                end
                install_mod(mod.name, mod.version, mod.code, mod.files)
                installed_index = find_installed_mod(mod.name)
                load_mod(installed_index)
                loaded_index = find_loaded_mod(mod.name)
                run_mod(loaded_index)
                mod_on_init(loaded_index)
            end
        end
    end,
}

_ENV.commands.add_command('hotpatch', 'Commands for hotpatch. Run /hotpatch help for details.', function(e)
    local caller = (e.player_index and game.players[e.player_index]) or console
    if (not e.parameter) or (e.parameter == '') then 
        sub_commands['help'](e.player_index)
        return
    end
    local sub_command, rest = e.parameter:match('(.-)%s(.*)')
    if not sub_command then
        sub_command = e.parameter
    end

    local f = sub_commands[sub_command]
    if f then f(e.player_index, rest) end
    if caller.admin then
        f = admin_commands[sub_command]
        if f then f(e.player_index, rest) end
    end
end)

]===])

return true