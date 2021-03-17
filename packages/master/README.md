# Clusterio Master Server

Communication hub for Clusterio clusters.
The master server forwards data between Clusterio slaves connected to it and allows the cluster to be remotely managed through WebSocket connections to it either by using the included web interface or the Clusterio ctl command line utility.


# Usage

    npx clusteriomaster <command>

Common options:

 * `--plugin-list <file>` JSON file to use for storing the list of plugins that are available to the master server.
   Defaults to `plugin-list.json` and will be created if it does not exist.
   See the `plugin` command for managing this list.

 * `--config <file>` JSON file to use for storing configuration for the master server.
   Defaults to `config-master.json` and will be created if it does not exist.
   See the `config` command for inspecting and modifying the configuration.


### `plugin <command>`

Configure plugins available to be loaded by the master server.
The available plugins will be loaded unless they have been disabled in the configuration, see the config command for disabling plugins.


#### `plugin add <path>`

Add plugin either by require path or relative/absolute path to the plugin directory.
A relative path must start with ./ or ../ (or .\ and ..\ on Windows) otherwise it will be assumed to be a require path for an installed package in node_modules.

For example, installing the Subspace Storage plugin:

    npm install @clusterio/plugin-subspace_storage
    npx clusteriomaster plugin add @clusterio/plugin-subspace_storage

Since the `plugin-list.json` is shared between master, slave and ctl you usually only need to do this once per machine.


#### `plugin remove <name>`

Remove a plugin by its name.
This should be done before uninstalling the plugin, otherwise there will be an error when Clusterio tries to load the info from the plugin.
Removing and unistalling a plugin is usually not neccessary as the functions provided by the plugin can be disabled in the config.

For example, uninstalling the Subspace Storage plugin:

    npx clusteriomaster plugin remove subspace_storage
    npm uninstall @clusterio/plugin-subspace_storage

Since the `plugin-list.json` is shared between master, slave and ctl you usually only need to do this once per machine.


#### `plugin list`

Lists the plugins set up to be available by name followed by path.


### `config`

Manage the master server configuration offline.
This should only be used when the master server is stopped, otherwise the config read might be out of date and config changes will be overwritten when the master server shuts down.


#### `config set <config-entry> [value]`

Set a config entry to the given value.
If value is not provided the entry is set to null.
If the config entry is of type object the value must be a valid JSON serialization of an object.

See docs/configuration.md in the main repositiory for the available configuration entries.


#### `config show <config-entry>`

Shows the value for a single config entry.


#### `config list`

Lists up all configuration entries with their currently configured values.


### `bootstrap`

Commands for setting up initial admin acount and access to the cluster.


#### `bootstrap create-admin <name>`

Creates a new user account with the given name if it does not already exist in the cluster and grant it full cluster admin permission.
You should be using your own Factorio multiplayer username here.


#### `bootstrap generate-user-token <name>`

Generate an access token for logging in and possibly managing the cluster from the given user account.
This can be used both in the web interface and as the `master_token` to connect with clusterioctl.


#### `bootstrap create-ctl-config <name>`

Creates a clusterioctl config for the given user with url and token set up for connecting to the cluster.


### `run`

Runs the master server.


## See Also

[The Clusterio repository](https://github.com/clusterio/factorioClusterio) for instructions on how to set up a cluster.
