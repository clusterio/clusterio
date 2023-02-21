# Clusterio Command Line Interface


Provides a command line interface for managing a Clusterio cluster.

Note that this document only describes the options and commands for managing clusterioctl itself, see [Managing a cluster](/docs/managing-a-cluster.md) for the available commands used for managing a cluster.


## Usage

    npx clusterioctl <command>

Common options:

 * `--plugin-list <file>` JSON file to use for storing the list of plugins that are available to ctl.
   Defaults to `plugin-list.json` and will be created if it does not exist.
   See the `plugin` command for managing this list.

 * `--config <file>` JSON file to use for storing configuration for ctl.
   Defaults to `config-control.json` and will be created if it does not exist.
   See the `config` command for inspecting and modifying the configuration.


### `plugin <command>`

Configure plugins available to be loaded by ctl.
The available plugins will be automatically loaded and the commands they provide will be added to the ctl utility.


#### `plugin add <path>`

Add plugin either by require path or relative/absolute path to the plugin directory.
A relative path must start with ./ or ../ (or .\ and ..\ on Windows) otherwise it will be assumed to be a require path for an installed package in node_modules.

For example, installing the Subspace Storage plugin:

    npm install @clusterio/plugin-subspace_storage
    npx clusterioctl plugin add @clusterio/plugin-subspace_storage

Since the `plugin-list.json` is shared between controller, slave and ctl you usually only need to do this once per machine.


#### `plugin remove <name>`

Remove a plugin by its name.
This should be done before uninstalling the plugin, otherwise there will be an error when Clusterio tries to load the info from the plugin.
Removing and unistalling a plugin is usually not neccessary as the functions provided by the plugin can be disabled in the config.

For example, uninstalling the Subspace Storage plugin:

    npx clusterioctl plugin remove subspace_storage
    npm uninstall @clusterio/plugin-subspace_storage

Since the `plugin-list.json` is shared between controller, slave and ctl you usually only need to do this once per machine.


#### `plugin list`

Lists the plugins set up to be available by name followed by path.


### `config-control`

Manage the ctl configuration.
This allows setting the url and token to the controller to manage.


#### `config-control set <config-entry> [value]`

Set a config entry to the given value.
If value is not provided the entry is set to null.
If the config entry is of type object the value must be a valid JSON serialization of an object.

See docs/configuration.md in the main repositiory for the available configuration.


#### `config-control show <config-entry>`

Shows the value for a single config entry.


#### `config-control list`

Lists up all configuration entries with their currently configured values.


## See Also

[Managing a cluster](/docs/managing-a-cluster.md) for the available commands used for managing a cluster.

[The Clusterio repository](https://github.com/clusterio/clusterio) for instructions on how to set up a cluster.
