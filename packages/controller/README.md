# Clusterio Controller

Communication hub for Clusterio clusters.
The controller forwards data between Clusterio hosts connected to it and allows the cluster to be remotely managed through WebSocket connections to it either by using the included web interface or the Clusterio ctl command line utility.


# Usage

    npx clusteriocontroller <command>

Common options:

 * `--plugin-list <file>` JSON file to use for storing the list of plugins that are available to the controller.
   Defaults to `plugin-list.json` and will be created if it does not exist.
   See the `plugin` command for managing this list.

 * `--config <file>` JSON file to use for storing configuration for the controller.
   Defaults to `config-controller.json` and will be created if it does not exist.
   See the `config` command for inspecting and modifying the configuration.


### `plugin <command>`

Configure plugins available to be loaded by the controller.
The available plugins will be loaded unless they have been disabled in the configuration, see the config command for disabling plugins.


#### `plugin install <package>`

Install a plugin from npm and add it to the plugin list.
The package is passed to `npm install --save` so anything npm accepts works, including a version like `@clusterio/plugin-subspace_storage@2.0.0`.
This command refuses to run outside the directory Clusterio was installed in, as the plugin has to end up in that directory's node_modules to be found.

For example, installing the Subspace Storage plugin:

    npx clusteriocontroller plugin install @clusterio/plugin-subspace_storage

Since the `plugin-list.json` is shared between controller, host and ctl you usually only need to do this once per machine.


#### `plugin add <path>`

Add plugin either by require path or relative/absolute path to the plugin directory.
A relative path must start with ./ or ../ (or .\ and ..\ on Windows) otherwise it will be assumed to be a require path for an installed package in node_modules.
This is mainly useful for plugins under development, packages published on npm are better installed with `plugin install`.

For example, adding a plugin checked out in the external_plugins directory:

    npx clusteriocontroller plugin add ./external_plugins/my_plugin


#### `plugin remove <name>`

Remove a plugin by its name.
This should be done before uninstalling the plugin, otherwise there will be an error when Clusterio tries to load the info from the plugin.
Removing and unistalling a plugin is usually not neccessary as the functions provided by the plugin can be disabled in the config.

For example, uninstalling the Subspace Storage plugin:

    npx clusteriocontroller plugin remove subspace_storage
    npm uninstall @clusterio/plugin-subspace_storage

Since the `plugin-list.json` is shared between controller, host and ctl you usually only need to do this once per machine.


#### `plugin list`

Lists the plugins set up to be available by name followed by path.


### `config`

Manage the controller configuration offline.
This should only be used when the controller is stopped, otherwise the config read might be out of date and config changes will be overwritten when the controller shuts down.


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
This can be used both in the web interface and as the `controller_token` to connect with clusterioctl.


#### `bootstrap create-ctl-config <name>`

Creates a clusterioctl config for the given user with url and token set up for connecting to the cluster.


### `copy-static [target]`

Copies the static web assets to the given target folder (which defaults to `./static/`).
Useful in case you want to host the assets on a CDN or separate web server and want provide the files directly instead of fetching them from the controller.

Note that mod pack exports will create additional static files that also have to be hosted, these are written to the `./static/` folder in the clusterio installation directory.

See also the `controller.public_url` config option for setting where static assets are loaded from.


### `run`

Runs the controller.


## See Also

[The Clusterio repository](https://github.com/clusterio/clusterio) for instructions on how to set up a cluster.
