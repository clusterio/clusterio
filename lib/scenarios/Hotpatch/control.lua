--[[

Copyright 2018 Chrisgbk
Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

]]
-- MIT License, https://opensource.org/licenses/MIT

-- Hotpatchable control.lua for scenarios
-- Supports multiple simultaneously loaded softmods
-- This is a WIP
-- Version 1.1 alpha
-- probably some performance improvements to be made

_ENV.debug_settings = {
    level = 'info',
    log_to_console_only = false,
    log_to_RCON = false,
    log_on_tick = false,
}

local hotpatch_tools = require 'hotpatch.mod-tools'
require 'hotpatch.remote-interface'
require 'hotpatch.commands'
require 'hotpatch.gui'

-- mod code goes here

-- This is the Factorio Freeplay scenario
-- This code, and the freeplay locale files in the zip file, is the property of Wube
-- As this is part of the base mod, the developers have given permission for modders to use/adapt the assets therein, for modding Factorio
-- Any other use would require licensing/permission from Wube
-- If you don't want to run this, either comment this out before creating your scenario, OR uninstall freeplay at runtime
hotpatch_tools.static_mod('freeplay', '1.0.0', [===[
local silo_script = require("silo-script")
local version = 1

script.on_event(defines.events.on_player_created, function(event)
  local player = game.players[event.player_index]
  player.insert{name="iron-plate", count=8}
  player.insert{name="pistol", count=1}
  player.insert{name="firearm-magazine", count=10}
  player.insert{name="burner-mining-drill", count = 1}
  player.insert{name="stone-furnace", count = 1}
  player.force.chart(player.surface, {{player.position.x - 200, player.position.y - 200}, {player.position.x + 200, player.position.y + 200}})
  if (#game.players <= 1) then
    game.show_message_dialog{text = {"msg-intro"}}
  else
    player.print({"msg-intro"})
  end
  silo_script.on_player_created(event)
end)

script.on_event(defines.events.on_player_respawned, function(event)
  local player = game.players[event.player_index]
  player.insert{name="pistol", count=1}
  player.insert{name="firearm-magazine", count=10}
end)

script.on_event(defines.events.on_gui_click, function(event)
  silo_script.on_gui_click(event)
end)

script.on_init(function()
  global.version = version
  silo_script.on_init()
end)

script.on_event(defines.events.on_rocket_launched, function(event)
  silo_script.on_rocket_launched(event)
end)

script.on_configuration_changed(function(event)
  if global.version ~= version then
    global.version = version
  end
  silo_script.on_configuration_changed(event)
end)

silo_script.add_remote_interface()
silo_script.add_commands()
]===])

-- Multi-file test
--[[
local files = {}

files['testfolder.anothertest.test'] = [===[
    script.on_event(defines.events.on_player_changed_position, function(e) game.print('position changed') end)
]===]

files['testfolder.test'] = [===[
    require 'anothertest.test'
]===]

files['test'] = [===[
    require 'testfolder.test'
]===]

hotpatch_tools.static_mod('require-test', '1.0.0', [===[
    require 'test'
]===], files)
--]]

-- end of mod code