local MyModule = require("./control")// [instance] //

--- Can contain anything you plan to use with send_rcon including functions, modules, or data
-- luacheck: globals ipc_// plugin_name //
ipc_// plugin_name // = MyModule// [] //

--- Can contain anything you want to allow other plugins to have access to, this example exposes the whole module
return MyModule
