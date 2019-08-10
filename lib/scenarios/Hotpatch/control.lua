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
hotpatch_tools.static_mod('freeplay', '0.17.50', [===[
local util = require("util")
local silo_script = require("silo-script")

local created_items = function()
  return
  {
    ["iron-plate"] = 8,
    ["wood"] = 1,
    ["pistol"] = 1,
    ["firearm-magazine"] = 10,
    ["burner-mining-drill"] = 1,
    ["stone-furnace"] = 1
  }
end

local respawn_items = function()
  return
  {
    ["pistol"] = 1,
    ["firearm-magazine"] = 10
  }
end

for k,v in pairs(silo_script.get_events()) do
  script.on_event(k, v)
end

script.on_event(defines.events.on_player_created, function(event)
  local player = game.players[event.player_index]
  util.insert_safe(player, global.created_items)

  local r = global.chart_distance or 200
  player.force.chart(player.surface, {{player.position.x - r, player.position.y - r}, {player.position.x + r, player.position.y + r}})

  if not global.skip_intro then
    if game.is_multiplayer() then
      player.print({"msg-intro"})
    else
      game.show_message_dialog{text = {"msg-intro"}}
    end
  end

  silo_script.on_event(event)
end)

script.on_event(defines.events.on_player_respawned, function(event)
  local player = game.players[event.player_index]
  util.insert_safe(player, global.respawn_items)
  silo_script.on_event(event)
end)

script.on_configuration_changed(function(event)
  global.created_items = global.created_items or created_items()
  global.respawn_items = global.respawn_items or respawn_items()
  silo_script.on_configuration_changed(event)
end)

script.on_load(function()
  silo_script.on_load()
end)

script.on_init(function()
  global.created_items = created_items()
  global.respawn_items = respawn_items()
  silo_script.on_init()
end)

silo_script.add_remote_interface()
silo_script.add_commands()

remote.add_interface("freeplay",
{
  get_created_items = function()
    return global.created_items
  end,
  set_created_items = function(map)
    global.created_items = map
  end,
  get_respawn_items = function()
    return global.respawn_items
  end,
  set_respawn_items = function(map)
    global.respawn_items = map
  end,
  set_skip_intro = function(bool)
    global.skip_intro = bool
  end,
  set_chart_distance = function(value)
    global.chart_distance = tonumber(value)
  end
})

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