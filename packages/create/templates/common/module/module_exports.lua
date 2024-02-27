local MyModule = require("./control")
//%if instance

--- Can contain anything you plan to use with send_rcon including functions, modules, or data
-- luacheck: globals ipc___plugin_name__
ipc___plugin_name__ = MyModule
//%endif

--- Can contain anything you want to allow other plugins to have access to, this example exposes the whole module
return MyModule
