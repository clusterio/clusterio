local hotpatch_tools = require 'hotpatch.mod-tools'
hotpatch_tools.static_mod('hotpatch-gui', '1.0.4', [===[
--[[

Copyright 2018 Chrisgbk
Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

]]
-- MIT License, https://opensource.org/licenses/MIT

local hotpatch_tools = require 'hotpatch.mod-tools'
local mod_gui = require 'mod-gui'

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

script.on_event(defines.events.on_player_joined_game, function(e)
    local player = game.players[e.player_index]
    local top = mod_gui.get_button_flow(player)
    local left = mod_gui.get_frame_flow(player)
    local center = player.gui.center

    local button = top['hotpatch-button']
    if button then
        button.destroy()
    end
    local menu = left['hotpatch-menu']
    if menu then
        menu.destroy()
    end

    local IDE = center['hotpatch-IDE']
    if IDE then
        IDE.destroy()
    end

    local main = center['hotpatch-main']
    if main then
        main.destroy()
    end

    button = top.add{type = 'sprite-button', name = 'hotpatch-button', sprite='utility/heat_exchange_indication', tooltip = 'Hotpatch', style = mod_gui.button_style}
end)

local on_gui_click_handlers
local on_gui_selection_state_changed_handlers

on_gui_click_handlers = {
    ['hotpatch-button'] = function(e)
        --on_gui_click_handlers['hotpatch-menu.IDE'](e)
        --do return end
        local player = game.players[e.player_index]
        local top = mod_gui.get_button_flow(player)
        local left = mod_gui.get_frame_flow(player)
        local center = player.gui.center

        local menu = left['hotpatch-menu']
        if not menu then
            menu = left.add{type = 'frame', name = 'hotpatch-menu', direction = 'vertical'}
            menu.add{type = 'button', name = 'hotpatch-menu.IDE', caption = 'Mod IDE', tooltip = 'Open debugging GUI'}
            menu.add{type = 'button', name = 'hotpatch-menu.console', caption = 'Mod Console', tooltip = 'Open debugging console'}
            menu.visible = true
            return
        end
        menu.visible = not menu.visible
    end,
    ['hotpatch-menu'] = function(e)
        local player = game.players[e.player_index]
        local top = mod_gui.get_button_flow(player)
        local left = mod_gui.get_frame_flow(player)
        local center = player.gui.center

        local menu = left['hotpatch-menu']
        menu.visible = not menu.visible

        on_gui_click_handlers[e.element.name](e)
    end,
    ['hotpatch-menu.IDE'] = function(e)
        local player = game.players[e.player_index]
        local top = mod_gui.get_button_flow(player)
        local left = mod_gui.get_frame_flow(player)
        local center = player.gui.center

        local IDE = center['hotpatch-IDE']
        if not IDE then
            IDE = center.add{type = 'frame', name = 'hotpatch-IDE', direction = 'vertical', caption = 'Hotpatch IDE', style = mod_gui.frame_style}
            local top_flow = IDE.add{type = 'flow', name = 'hotpatch-IDE-top', direction = 'horizontal'}
            top_flow.add{type = 'label', name = 'hotpatch-IDE-mod-label', caption = 'Mod: '}
            local IDE_dropdown = top_flow.add{type = 'drop-down', name = 'hotpatch-IDE-mod-selector'}
            top_flow.add{type = 'label', name = 'hotpatch-IDE-mod-version', caption = 'Version: No mod selected'}
            local IDE_table = IDE.add{type = 'table', name = 'hotpatch-IDE-table', column_count = 2}
            local files = IDE_table.add{type = 'scroll-pane', name = 'hotpatch-IDE-files', direction='vertical'}
            files.style.height = 600
            files.vertical_scroll_policy = 'always'
            files = files.add{type = 'table', name = 'hotpatch-IDE-files-table', column_count = 1}
            local code = IDE_table.add{type = 'text-box', name = 'hotpatch-IDE-code'}
            code.word_wrap = true
            files.style.width = 400
            files.style.cell_padding = 0
            files.style.top_padding = 0
            files.style.bottom_padding = 0
            code.style.width = 600
            code.style.height = 600
            IDE.visible = false
        end

        local IDE_dropdown = IDE['hotpatch-IDE-top']['hotpatch-IDE-mod-selector']
        IDE_dropdown.clear_items()
        for _, v in ipairs(installed_mods) do
            IDE_dropdown.add_item(v.name)
        end

        IDE.visible = not IDE.visible
        if IDE.visible then
            player.opened = IDE
        else
            player.opened = nil
        end
    end,
    ['hotpatch-menu.console'] = function(e)
        local player = game.players[e.player_index]
        local top = mod_gui.get_button_flow(player)
        local left = mod_gui.get_frame_flow(player)
        local center = player.gui.center

        local hotpatch_console = center['hotpatch-console']
        if not hotpatch_console then
            hotpatch_console = center.add{type = 'frame', name = 'hotpatch-console', direction = 'vertical', caption = 'Hotpatch Console'}
            local top_flow = hotpatch_console.add{type = 'flow', name = 'hotpatch-console-top', direction = 'horizontal'}
            top_flow.add{type = 'label', name = 'hotpatch-console-mod-label', caption = 'Mod: '}
            local console_dropdown = top_flow.add{type = 'drop-down', name = 'hotpatch-console-mod-selector'}
            top_flow.add{type = 'label', name = 'hotpatch-console-mod-version', caption = 'Version: No mod selected'}
            local bottom_flow = hotpatch_console.add{type = 'flow', name = 'hotpatch-console-bottom', direction = 'vertical'}
            local output = bottom_flow.add{type = 'text-box', name = 'hotpatch-console-output'}
            local bottom_input_flow = bottom_flow.add{type = 'flow', name = 'hotpatch-console-bottom-input', direction = 'horizontal'}
            local input = bottom_input_flow.add{type = 'textfield', name = 'hotpatch-console-input'}
            bottom_input_flow.add{type = 'button', name = 'hotpatch-console-run', caption = 'Run', tooltip = 'Run Lua Code'}
            output.style.width = 800
            output.style.height = 600
            input.style.width = 600
			hotpatch_console.visible = false
        end

        local console_dropdown = hotpatch_console['hotpatch-console-top']['hotpatch-console-mod-selector']
        console_dropdown.clear_items()
        for _, v in ipairs(loaded_mods) do
            console_dropdown.add_item(v.name)
        end

        hotpatch_console.visible = not hotpatch_console.visible
        if hotpatch_console.visible then
            player.opened = hotpatch_console
        else
            player.opened = nil
        end
    end,
    ['hotpatch-console-run'] = function(e)
        local player = game.players[e.player_index]

        local top = mod_gui.get_button_flow(player)
        local left = mod_gui.get_frame_flow(player)
        local center = player.gui.center

        local hotpatch_console = center['hotpatch-console']
        local output = hotpatch_console['hotpatch-console-bottom']['hotpatch-console-output']
        local input = hotpatch_console['hotpatch-console-bottom']['hotpatch-console-bottom-input']['hotpatch-console-input']
        local console_dropdown = hotpatch_console['hotpatch-console-top']['hotpatch-console-mod-selector']

        if not player.admin then
            output.text = table.concat{output.text, '\n', 'Only admins!'}
            return
        end

        if not (console_dropdown.selected_index > 0) then
            output.text = table.concat{output.text, '\n', 'Select a mod!'}
            return
        end

        local mod_name = console_dropdown.items[console_dropdown.selected_index]
        local loaded_index = find_loaded_mod(mod_name)
        local env = loaded_mods[loaded_index].env
        local old_print = env.print
        local old_log = env.log





        env.print = function(...)
            --local count = select('#', ...)
            local t = table.pack(...)
            for k, v in pairs(t) do
                t[k] = tostring(v)
            end
            local text = table.concat(t, '\t')
            output.text = table.concat{output.text, '\n', text}
        end

        env.log = function(text)
            output.text = table.concat{output.text, '\n', text}
        end

        local success
        local code, err = load(input.text, input.text, 't', env)
        if code then
            success, err = pcall(code)
            if not success then
                output.text = table.concat{output.text, '\n', err}
            end
        else
            output.text = table.concat{output.text, '\n', err}
        end

        env.print = old_print
        env.log = old_log
    end,
    ['hotpatch-IDE-file'] = function(e)
        local player = game.players[e.player_index]
        local top = mod_gui.get_button_flow(player)
        local left = mod_gui.get_frame_flow(player)
        local center = player.gui.center

        local element = e.element
        local previous
        for _, v in pairs(center['hotpatch-IDE']['hotpatch-IDE-table']['hotpatch-IDE-files']['hotpatch-IDE-files-table'].children) do
            if table.compare(v.style.font_color or {}, {r=1.0, g=1.0, b=0.0, a=1.0}) then
                previous = v
                break
            end
        end
        if previous then
            previous.style.font_color = {r=1.0, g=1.0, b=1.0, a=1.0}
        end
        element.style.font_color = {r=1.0, g=1.0, b=0.0, a=1.0}
        local file = element.name:match('.-%.(.*)')
        local selected = center['hotpatch-IDE']['hotpatch-IDE-top']['hotpatch-IDE-mod-selector']
        local mod_name = selected.items[selected.selected_index]
        local code = center['hotpatch-IDE']['hotpatch-IDE-table']['hotpatch-IDE-code']
        local index = find_installed_mod(mod_name)
        if index then
            local mod = installed_mods[index]
            if file == 'control' then
                code.text = mod.code
            else
                code.text = mod.files[file]
            end
        end
    end,
}

script.on_event(defines.events.on_gui_click, function(e)
    local element = e.element
    if element.valid then
        local name = element.name:match('([^%.]*)%.?.-')
        local handler = on_gui_click_handlers[name]
        if handler then handler(e) end
    end
end)

on_gui_selection_state_changed_handlers = {
    ['hotpatch-console-mod-selector'] = function(e)
        local player = game.players[e.player_index]
        local top = mod_gui.get_button_flow(player)
        local left = mod_gui.get_frame_flow(player)
        local center = player.gui.center

        local element = e.element
        local name = element.items[element.selected_index]
        if name then
            local index = find_loaded_mod(name)
            if index then
                local mod = loaded_mods[index]
                local version_label = center['hotpatch-console']['hotpatch-console-top']['hotpatch-console-mod-version']
                version_label.caption = 'Version: ' .. mod.version
                local hotpatch_console = center['hotpatch-console']
                local output = hotpatch_console['hotpatch-console-bottom']['hotpatch-console-output']
                output.text = ''
            end
        end
    end,
    ['hotpatch-IDE-mod-selector'] = function(e)
        local player = game.players[e.player_index]
        local top = mod_gui.get_button_flow(player)
        local left = mod_gui.get_frame_flow(player)
        local center = player.gui.center

        local element = e.element

        local name = element.items[element.selected_index]
        if name then
            local index = find_installed_mod(name)
            if index then
                local mod = installed_mods[index]
                local version_label = center['hotpatch-IDE']['hotpatch-IDE-top']['hotpatch-IDE-mod-version']
                version_label.caption = 'Version: ' .. mod.version
                local list = center['hotpatch-IDE']['hotpatch-IDE-table']['hotpatch-IDE-files']['hotpatch-IDE-files-table']
                list.clear()
                local file = list.add{type = 'label', style = 'hoverable_bold_label', caption = 'control', name = 'hotpatch-IDE-file.control'}
                file.style.bottom_padding = 0
                file.style.top_padding = 0
                for k, _ in pairs(mod.files) do
                    file = list.add{type = 'label', style = 'hoverable_bold_label', caption = k, name = 'hotpatch-IDE-file.' .. k}
                    file.style.bottom_padding = 0
                    file.style.top_padding = 0
                end
                local code = center['hotpatch-IDE']['hotpatch-IDE-table']['hotpatch-IDE-code']
                code.text = ''
            end
        end
    end,
}

script.on_event(defines.events.on_gui_selection_state_changed, function(e)
    local element = e.element
    local handler = on_gui_selection_state_changed_handlers[element.name]
    if handler then handler(e) end
end)

script.on_event(defines.events.on_gui_closed, function(e)
    local player = game.players[e.player_index]
    local element = e.element
    if e.gui_type == defines.gui_type.custom then
        if element and element.valid then
            if element.name == 'hotpatch-IDE' then
                if element.visible then
                    player.play_sound{path = "utility/gui_click"}
                end
                element.visible = false
            elseif element.name == 'hotpatch-console' then
                if element.visible then
                    player.play_sound{path = "utility/gui_click"}
                end
                element.visible = false
            end
        end
    end
end)

--]===])

return true