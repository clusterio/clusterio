--[[
It is typical for a module to have a control file as the entry point, although this is not a requirement
Therefore, Clusterio allows you to specify a single default export that can be accessed by other modules
You are not required to specify any default export, but note that a module can still require yours directly
]]

-- Access using `local __plugin_name__ = require("modules/__plugin_name__")`
return require("modules/__plugin_name__/control")
