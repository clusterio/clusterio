# Clusterio Slave

Node hosting Factorio servers in a Clusterio cluster.
Clusterio slaves connect to the master server and waits for commands from the master server to start up and stop instances.
A cluster can have any number of slaves in it located on different computers, and each slave can host any number of instances each of which is a Factorio server that talks with the rest of the cluster.


## Usage

    npx clusterioslave <command>

Common options:

 * `--plugin-list <file>` JSON file to use for storing the list of plugins that are available to the slave.
   Defaults to `plugin-list.json` and will be created if it does not exist.
   See the `plugin` command for managing this list.

 * `--config <file>` JSON file to use for storing configuration for the slave.
   Defaults to `config-slave.json` and will be created if it does not exist.
   See the `config` command for inspecting and modifying the configuration.


### `plugin <command>`

Configure plugins available to be loaded by the slave.
The available plugins will be loaded unless they have been disabled in the configuration, see the config command for disabling plugins.


#### `plugin add <path>`

Add plugin either by require path or relative/absolute path to the plugin directory.
A relative path must start with ./ or ../ (or .\ and ..\ on Windows) otherwise it will be assumed to be a require path for an installed package in node_modules.

For example, installing the Subspace Storage plugin:

    npm install @clusterio/plugin-subspace_storage
    npx clusterioslave plugin add @clusterio/plugin-subspace_storage

Since the `plugin-list.json` is shared between master, slave and ctl you usually only need to do this once per machine.


#### `plugin remove <name>`

Remove a plugin by its name.
This should be done before uninstalling the plugin, otherwise there will be an error when Clusterio tries to load the info from the plugin.
Removing and unistalling a plugin is usually not neccessary as the functions provided by the plugin can be disabled in the config.

For example, uninstalling the Subspace Storage plugin:

    npx clusterioslave plugin remove subspace_storage
    npm uninstall @clusterio/plugin-subspace_storage

Since the `plugin-list.json` is shared between master, slave and ctl you usually only need to do this once per machine.


#### `plugin list`

Lists the plugins set up to be available by name followed by path.


### `config`

Manage the slave configuration offline.
This should only be used when the slave is stopped, otherwise the config read might be out of date and config changes will be overwritten when the slave shuts down.


#### `config set <config-entry> [value]`

Set a config entry to the given value.
If value is not provided the entry is set to null.
If the config entry is of type object the value must be a valid JSON serialization of an object.

See docs/configuration.md in the main repositiory for the available configuration.


#### `config show <config-entry>`

Shows the value for a single config entry.


#### `config list`

Lists up all configuration entries with their currently configured values.


### `run`

Runs the slave.


## See Also

[The Clusterio repository](https://github.com/clusterio/clusterio) for instructions on how to set up a cluster.
