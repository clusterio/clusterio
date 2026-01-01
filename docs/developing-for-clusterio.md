# Developing for Clusterio

This document describes the various different types of content that can be created for Factorio and/or Clusterio and how this is made compatible with Clusterio.


## Contents

- [Factorio Mods](#factorio-mods)
- [Factorio Scenarios](#factorio-scenarios)
    - [event_handler interface](#event_handler-interface)
- [Communicating with Clusterio](#communicating-with-clusterio)
- [Clusterio Modules](#clusterio-modules)
- [Clusterio Lua API](#clusterio-lua-api)
- [Clusterio Plugins](#clusterio-plugins)


## Factorio Mods

Factorio mods that do not interact with Clusterio should not have any considerations that need to be taken into account for them to work with Clusterio.


## Factorio Scenarios

Clusterio patches saves and because of this scenarios have a few limitations and must explicitly mark themselves as compatible with Clusterio to work.
The main limitation is that the [event_handler](https://github.com/wube/factorio-data/blob/master/core/lualib/event_handler.lua) lib must be used, and control.lua cannot contain any code other than calls to event_handler loading the relevant libs of the scenario.
This is because the control.lua file will be overwritten by the save patcher.
Scenarios also cannot use the event registering functions exposed by `script` such as `script.on_event` or `script.on_nth_tick` as using these will overwrite the handlers registered by the event_handler lib.

A brief description of the usage of the event_handler library is provided in the [event_handler interface](#event_handler-interface) section.

Once a scenario is made using the event_handler it should have a control.lua file that looks something like this:

```lua
-- control.lua
local event_handler = require("event_handler")
event_handler.add_lib(require("module_foo"))
event_handler.add_lib(require("module_bar"))
```

To make Clusterio recognize and correctly handle this scenario it needs to include a clusterio.json file with following content:

```json
{
    "scenario": {
        "name": "example-scenario",
        "modules": [
            "module_foo",
            "module_bar"
        ]
    }
}
```

This tells Clusterio that it should load both module_foo and module_bar by passing the result of requiring them to the `add_lib` function when writing a new control.lua file to the save.


### event_handler interface

<sub>**Note:** At the time of writing the event_handler lib has been a part of Factorio since at least 0.17.4, and was moved from base to core in 0.17.63 but is still not documented anywhere.
A brief description is provided here for this reason.</sub>

The event_handler lib provides a simple interface for registering multiple callbacks to the same events without having to be concerned with callback chaining or overwriting callbacks defined elsewhere.
It works by taking over the task of registering the actual callbacks with Factorio, providing its own interface for the rest of the code to use.

The sole function of interest exported by event_handler is `add_lib` which accepts a table with event handler callbacks definitions that it will register.
The following entries are recognized by `add_lib`, all of which are optional:

- `on_init`:
    Callback called when the callback of `script.on_init` is invoked.
- `on_load`:
    Callback called when the callback of `script.on_load` is invoked.
- `on_configuration_changed`:
    Callback called when the callback of `script.on_configuration_changed` is invoked.
- `events`:
    Table mapping event ids as defined in `defines.events` to callbacks.
    For example the table `{ [defines.events.on_player_died] = foo }` will call bar with the usual `event` table as argument every time a player dies.
- `on_nth_tick`:
    Table mapping the nth tick number to a callback.
    For example the table `{ [30] = bar }` will call bar every 30th tick.
- `add_remote_interface`:
    Callback called before on_init/on_load callbacks<sup>[1]</sup>.
    It has no special meaning and receives no arguments but should be used for registering remote interfaces.
- `add_commands`:
    Callback called before on_init/on_load callbacks<sup>[1]</sup>.
    It has no special meaning and receives no arguments but should be used for registering commands.

<sub>1: Before 0.17.69 these callbacks were called after on_init/on_load.</sub>

The usual way to use `add_lib` is to define the table of events to register in a separate file and return it, then load it in control.lua via `require` before passing it to `add_lib`.
For example a module could be defined as

```lua
-- example.lua
local function my_handler(event)
    local name = game.player[event.player_index].name
    game.print("It appears that " .. name .. " has died")
end

return {
    on_init = function() game.print("example_lib init") end,
    events = {
        [defines.events.on_player_died] = my_handler,
    },
}
```

And then in control.lua the following used to load it with `add_lib`:

```lua
-- control.lua
local event_handler = require("event_handler")
event_handler.add_lib(require("example"))
```

Because the event_handler lib registers events itself you may not use `script.on_load` or `script.on_init` at all in your code and any usage of `script.on_configuration_changed`, `script.on_nth_tick` and/or `script.on_event` will cause the corresponding events registered with event_handler to break and should therefore not be used.

There's also the `add_libraries` function exported by event_handler, which accepts a table and calls `add_lib` for each value in the table.


## Communicating with Clusterio

Clusterio uses a homebrew protocol based on sending JSON payloads over a WebSocket connection.
See [protocol.md](devs/protocol.md) for the implementation details of it.

It's also possible to write a plugin for Clusterio that exposes a custom interface over HTTP, WebSocket or any other technology supported by Node.js.


## Clusterio Modules

Modules are primarily used by plugins to inject code into Factorio games with the save patcher, though it's also possible to make stand alone modules that are loaded into the game if you don't need the capabilites of the plugin system.
The save patcher puts modules into the `modules` folder of the Factorio save and adds code to `control.lua` to load the module according to the `load` and `require` options to the module.json file.
Like with scenarios for Clusterio the [event_handler interface](#event_handler-interface) has to be used for any event subscriptions in modules.

Stand alone modules are placed into the modules folder of Clusterio, plugin modules are located in the module folder of the plugin.
In either case a `module.json` file is required and has the following structure:

```json
{
    "name": "my_module",
    "version": "1.2.0",
    "dependencies": {
        "clusterio": "*",
        "foo": ">=0.4.2"
    },
    "require": ["bar.lua"],
    "load": ["foo.lua"]
}
```

The following entries are supported in the module.json file:

- `name`:
    Name of the module, must match the folder the module is located in for stand alone modules or the name of the plugin the module is located in.
- `version`:
    Version of the module.
    Must be compatible with [Semantic Versioning 2.0.0](https://semver.org/).
    In plugin modules this defaults to the version of the plugin otherwise it's required.
- `dependencies`:
    Optional mapping of modules this module depends on and their version.
    In the example `>=0.4.2` means that the foo module must be at least version 0.4.2.
    See the [Ranges syntax](https://www.npmjs.com/package/semver#ranges) of the node-semver package for a full description of what operators are supported.
    The events for dependencies is invoked before the events of the dependent, and starting an instance will fail if the dependencies cannot be satisfied.
    If not specified it will default to depending on `clusterio`.
    Make sure to add `clusterio` to your dependencies if you add other dependencies and depend on the Lua API.
- `require`:
    Lua files to require in `control.lua`.
    This should only really be needed if you want to make a global function available for use in Lua commands.
    The paths are relative to the module's own folder and should be specified using forward slashes as directory sepparators if it's located in a sub directory in the module.
- `load`:
    Lua files to load with the `event_handler` lib, the result of requiring the file will be passed to the `add_lib` function of the `event_handler` lib in `control.lua`.
    See the section on the [event_handler interface](#event_handler-interface) for a detailed description on how the `event_handler` lib works.
    The paths are relative to the module's own folder and should be specified using forward slashes as directory sepparators if it's located in a sub directory in the module.

It's recommended to use the new style of defining modules in Lua, as well as avoid the use of global variables as much as possible.
This means always declearing your top level variables and functions local and exporting only the things you need in other files.
You can require other files in your module by prefixing your require paths with `modules/your_module_name/`.
It's also possible to require files from other modules this way too.

The global variables and data stored in the global table is shared by all Clusterio modules as well as the scenario, so it's important that you use unique names.
It's recommended to prefix the global variables and data in the global table that your module has with the name of your module.

Because modules can be patched into an existing game you cannot rely on the `on_init` callback to be called in Clusterio Modules.
Nor can you rely on the `on_configuration_changed` callback, as this is not called when level code changes.
The Clusterio Lua API provides the custom `on_server_startup` event that can be used as a substitute, see the next section.


## Clusterio Lua API

Clusterio provides a save patched module as well as a regular Factorio mod for interfacing with Clusterio.
This includes tools sending data to plugins, script events to listen for, and an item serialization module.


### clusterio_api library

**require path**  
From a module  
`local clusterio_api = require("modules/clusterio/api")`  
From a mod  
`local clusterio_api = require("__clusterio_lib__/api")`

Provides the main interface to Clusterio from within the game.
When using the mod version you must call `init` before it'll function properly.

#### init

<sub>Mod version only</sub>

Initialize the API.
This should be called from both the `on_init` and `on_load` events in your mod, and before this is called certain features will not be available, most notably the events table.

#### clusterio_api.events

Table of events raised by clusterio.
If the game is started outside of Clusterio then none of these events will be raised.

In the mod version this table does not exist before the `init` function is called.

##### on_instance_updated

Raised after the name and id of an instance has been updated.
This may occur even if the id and name didn't change.

Event data:
- `instance_id`: the id of the instance.
- `instance_name`: the name of the instance.

##### on_server_startup

Raised when Clusterio is starting up the server.
It can be used to initialize clusterio related features in a mod, and as a stand-in for the `on_init` and `on_configuration_changed` event for modules.
It is invoked on the first tick the server runs after the save has been patched, before most other events.

Use this event to initialize and/or migrate the data structures you need.
Keep in mind that both mods and Clusterio modules can switch from any version to any version so it should be able to handle both forwards and backwards migrations gracefully.

#### clusterio_api.send_json(channel, data)

Send JSON data to Clusterio over the given channel.
The `data` argument should be table that can be serialized with `game.table_to_json`.
Clusterio plugins can listen to channels and will receive an event with the data sent here.
See the [Communicating with Factorio section](writing-plugins.md#communicating-with-factorio) in the Writing Plugins document for more information.

If the game is started outside of Clusterio the data will be sent, but since there's no code following stdout to pick it up it will be lost.

**Note**: Payloads greater than 4 MB will cause stuttering in the game.

**Note**: This is not a binary safe way of sending data.
Strings embedded into the tables sent must be valid UTF-8 text.

Parameters:
- `channel`: string identifying which channel to send it on.
- `data`: table that can be converted to JSON with game.table_to_json


### serialize library

**require path**  
From a module  
`local serialize = require("modules/clusterio/serialize")`  
From a mod  
`local serialize = require("__clusterio_lib__/serialize")`

Serializes inventories and item stacks into a table that in turn can be converted into JSON with `game.table_to_json`.
Properly handles the extra data for most items.

#### serialize.serialize_equipment_grid(LuaEquipmentGrid)

Returns a table containing a serialized representation of the equipment grid passed.

#### serialize.deserialize_equipment_grid(LuaEquipmentGrid, serialized_grid)

Deserialize a previously serialized equipment grid into the target LuaEquipmentGrid.
Overwrites all content in the target.

#### serialize.serialize_item_stack(LuaItemStack, destination_table)

Serialize the LuaItemStack passed into the target destination_table.
The destination_table should be a new empty table.

#### serialize.deserialize_item_stack(LuaItemStack, serialized_stack)

Deserialize a previously serialized item stack into the target LuaItemStack.
Overwrites the content of the item stack.

#### serialize.serialize_inventory(LuaInventory)

Returns a table containing a serialized representation of the inventory passed.

#### serialize.deserialize_inventory(LuaInventory, serialized_inventory)

Deserialize a previously serialized inventory into the target LuaInventory.
Overwrites slots that have content in the serialized inventory.


## Clusterio Plugins

See the [Writing Plugins](writing-plugins.md) document for details on the plugin interface and how to write plugins for Clusterio.
