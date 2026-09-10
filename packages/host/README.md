# Clusterio Host

Node hosting Factorio servers in a Clusterio cluster.
Clusterio hosts connect to the controller and waits for commands from the controller to start up and stop instances.
A cluster can have any number of hosts in it located on different computers, and each host can host any number of instances each of which is a Factorio server that talks with the rest of the cluster.


## Usage

    npx clusteriohost <command>

Common options:

 * `--plugin-list <file>` JSON file to use for storing the list of plugins that are available to the host.
   Defaults to `plugin-list.json` and will be created if it does not exist.
   See the `plugin` command for managing this list.

 * `--config <file>` JSON file to use for storing configuration for the host.
   Defaults to `config-host.json` and will be created if it does not exist.
   See the `config` command for inspecting and modifying the configuration.


### `plugin <command>`

Configure plugins available to be loaded by the host.
The available plugins will be loaded unless they have been disabled in the configuration, see the config command for disabling plugins.


#### `plugin add <path>`

Add plugin either by require path or relative/absolute path to the plugin directory.
A relative path must start with ./ or ../ (or .\ and ..\ on Windows) otherwise it will be assumed to be a require path for an installed package in node_modules.

For example, installing the Subspace Storage plugin:

    npm install @clusterio/plugin-subspace_storage
    npx clusteriohost plugin add @clusterio/plugin-subspace_storage

Since the `plugin-list.json` is shared between controller, host and ctl you usually only need to do this once per machine.


#### `plugin remove <name>`

Remove a plugin by its name.
This should be done before uninstalling the plugin, otherwise there will be an error when Clusterio tries to load the info from the plugin.
Removing and unistalling a plugin is usually not neccessary as the functions provided by the plugin can be disabled in the config.

For example, uninstalling the Subspace Storage plugin:

    npx clusteriohost plugin remove subspace_storage
    npm uninstall @clusterio/plugin-subspace_storage

Since the `plugin-list.json` is shared between controller, host and ctl you usually only need to do this once per machine.


#### `plugin list`

Lists the plugins set up to be available by name followed by path.


### `config`

Manage the host configuration offline.
This should only be used when the host is stopped, otherwise the config read might be out of date and config changes will be overwritten when the host shuts down.


#### `config set <config-entry> [value]`

Set a config entry to the given value.
If value is not provided the entry is set to null.
If the config entry is of type object the value must be a valid JSON serialization of an object.

See docs/configuration.md in the main repositiory for the available configuration.


#### `config show <config-entry>`

Shows the value for a single config entry.


### `create-scenario <output>`

Create a scenario with the Clusterio modules patched into it and write it to the `output` directory.
This is the same patching that is applied to saves when an instance starts, see docs/how-it-works.md in the main repository.
The result can be used as a regular scenario outside of Clusterio by copying it to the `scenarios` folder of Factorio or into a mod.

By default the freeplay scenario from the latest Factorio install in `host.factorio_directory` is patched with the modules from all plugins that are enabled in the host config.

 * `--scenario <path>` Scenario directory, zipped scenario or save to patch instead of freeplay.
   This has the same restrictions as save patching, the scenario must either use the event_handler library and have been seen by Clusterio before, or already have been patched by Clusterio.

 * `--factorio-version <version>` Factorio version to take the freeplay scenario from.
   Defaults to `latest`.

 * `--plugins <name>...` Only patch in modules from the given plugins.

For example, creating a scenario with only the inventory_sync module:

    npx clusteriohost create-scenario ~/.factorio/scenarios/inventory_sync --plugins inventory_sync


#### `config list`

Lists up all configuration entries with their currently configured values.


### `run`

Runs the host.


## See Also

[The Clusterio repository](https://github.com/clusterio/clusterio) for instructions on how to set up a cluster.
