# Migrating from 2.0.0-alpha.13 to 2.0.0-alpha.14

Alpha 14 comes with significant breaking changes for existing clusters, most notably the rename of master and slave to controller and host.
Please study the entire migration guide carefully before attempting to update an existing cluster.

## Before updating

If you're using mods you need to create mod pack string for the mod configurations you're currently running.
You can do this by running the follow RCON command on an instance that is currently running the mod configuration you want to use (you can also run this command in single player and find the string printed in Factorio's [Log file](https://wiki.factorio.com/Log_file)):

    /sc local a={name="pack",description="",factorio_version=script.active_mods.base,mods={},settings={startup={},["runtime-global"]={},["runtime-per-user"]={}}}for b,c in pairs(script.active_mods)do table.insert(a.mods,{name=b,enabled=true,version=c})end;local function d(e,f)for b,c in pairs(e)do a.settings[f][b]=c end end;d(settings.startup,"startup")d(settings.global,"runtime-global")if game.player then d(game.player.mod_settings,"runtime-per-user")else d(settings.player,"runtime-per-user")end;local g=helpers.encode_string(helpers.table_to_json(a))log(g)rcon.print(g)

This should produce a [Mod Pack String](https://forums.factorio.com/viewtopic.php?f=96&t=103578) which you need to copy and paste somewhere to keep it for later.
Mod Pack strings looks something like this:

    eNqFketuwyAMhd/Fv0OUVpW25lWmqSLESdAIRNh0l4h3n9mlitZt5QdCx/7so8MKXs8ILSzaPEEFPZKJdmEbvIgiDNpwiDaczhjpU93Vu/r+Tmpz6Anah/V7RqcJRUavO4c9tBwTVnAF5upCGJeIsYx3tvsPbQTdb0lKHYlnPJHY0+ONvcdjvW8gP1ZAyGz9KL5XINaR0yLPXEFMnu2ManSh0+6j/GOFitqXG4mjNSUidVm5wlm7JMYG7Qhl3BX8FjyqZ9vztOk+NM2fvRPaceLbzbN+UejQFFOWXzfArvk6v2HWD9ZLv5JfxA1UwsubPBaMKhHGklLO76vAwfQ=

If you have multiple mod configuration create a mod pack string for each and note them down.

Double check that you are on a supported version of Node.js by running `node --version`, the version should be v18 or later, if not you will need to update Node.js before continuing.


## Migrate installations

**Note:** Check that plugins you are using have updates avaialble for alpha 14 before attempting to update, if they do not either wait for the plugin to be updated or uninstall the plugin from all places it is installed on first.

Shutdown all slaves and the master server and then migrate each installations by running the following command:

    npm exec @clusterio/create -y -- --migrate-rename --log-level=verbose

This will convert the existing installation's usage of the master and slave names in packages, configs, database and logs to the new controller and host terms and update the installed packages.

If you're using systemd then copy the generated clusteriocontroller.service and/or clusteriohost.service files from the systemd folder to /etc/systemd/system/ and remove the old clusteriomaster.service and clusterioslave.service files.

Once the installations have been migrated start up the controller and hosts again.


## Post installation

Import the Mod Pack strings that was created beforehand on the controller and upload the mods needed by those mod packs to the controller.
You can assign a default mod pack in the controller config which instances use by default or set the mod pack on the per instance basis in the instance config.
Once you have assigned a mod pack to an instance run a data export on the instance in order to properly populate the mod settings in the mod and get item icons and item names resolved in the web interface.
