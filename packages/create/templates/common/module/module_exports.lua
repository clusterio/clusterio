--- Can contain anything you want to allow other plugins to have access to, this example exposes the control file
--- If you only export a single file then it may be better to rename that file to module_exports and save the redirection
-- Access the exports from other modules using require("modules/__plugin_name__")
return require("modules/__plugin_name__/control")
