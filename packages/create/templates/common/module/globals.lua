--[[
It is best practice to not expose any globals because all modules share a global environment
However, sometimes you need globals, for example to access functions within rcon commands
Therefore, we advise that this should be the only file in your module to expose globals
Typically this would be your control file as shown in the example below
]]

-- Access using `/sc __plugin_name__.foo()`
__plugin_name__ = require("modules/__plugin_name__/control")
