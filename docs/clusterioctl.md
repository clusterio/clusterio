# Clusterioctl

Clusterio clusters can be managed from the command line with `clusterioctl`, which is invoked by running `npx clusterioctl <command>` in the clusterio directory.
It connects to the controller the same way the web interface does, and what it is allowed to do depends on the roles of the user it logs in as.
See [Managing a Cluster](managing-a-cluster.md) for a guide to the day to day tasks.
This document uses the shorthand `ctl> foo` to indicate `npx clusterioctl foo` should be executed.
Mandatory parameters are shown in `<angles bracket>` and optional pameters are in `[square brackets]`.
Hosts, instances, roles and mod packs can be given by name or by ID.

Run `npx clusterioctl --help` for the list of commands and `npx clusterioctl <command> --help` for the options of a command.
Plugins may add their own commands, these are documented in the plugin's README.


## Setting up

clusterioctl is installed separately from the controller and host.
Run the installer as described in the [README](/README.md#installation) and choose "Ctl only" as the operating mode, either in the same directory as the controller or on another computer.
The installer asks for the controller URL and an authentication token, these are the same as you would use to log in to the web interface, and saves them to `config-ctl.json`.

When clusterioctl is installed in the same directory as the controller, `npx clusteriocontroller bootstrap create-ctl-config <username>` writes `config-ctl.json` for managing the cluster as the given user.
The config created this way connects to `localhost`, so it only works on the controller computer.

To set it up by hand, generate a token for the user on the controller:

    npx clusteriocontroller bootstrap generate-user-token <username>

Then create the config and set the URL and token on the computer you run clusterioctl on:

    npx clusterioctl config create
    npx clusterioctl config set ctl.controller_url https://example.com/
    npx clusterioctl config set ctl.controller_token <token>

The `config` command works offline and is described in the [readme for @clusterio/ctl](/packages/ctl/README.md), along with the other command line options.
See [Ctl Configuration](configuration.md#ctl-configuration) for the available settings.

The token logs in as the user it was generated for and gives the same access as that user's roles.
Anyone holding it can manage the cluster as that user, so keep `config-ctl.json` private.
A token stops working when it is revoked with [`user revoke-token`](#revoke-user-token).

If the controller uses a self-signed certificate, Node.js has to be told to trust it before clusterioctl can connect, see [Setting up TLS](setting-up-tls.md#creating-and-using-a-self-signed-certificate).
For example on Linux:

    NODE_EXTRA_CA_CERTS=path/to/cert.pem npx clusterioctl instance list


## Output Format

    ctl> --output json <command>

Print the result of the command as JSON on stdout instead of text meant for reading.
Lists are printed as an array of objects, other results as an object, and commands that have no result print `{"success": true}`.
If the command fails it prints `{"error": "<ClassName>", "message": "<message>"}` and exits with a non-zero exit code.
Log messages are written to stderr in all formats.

`--output wire` prints the same results in the format they are sent between the controller, hosts and clusterioctl, which uses snake_case names like `is_admin`.
The `json` format uses the property names shown in the tables of the human format.

`log follow` and `debug dump-ws` keep running and print one JSON object per line as entries arrive.
`instance start-all` and `instance stop-all` print an array with an entry per instance, which has an `error` property if that instance failed to start or stop.

The default is `--output human`, which prints `Command ran successfully` for commands that have no result.


## Controller

### Stop controller

    ctl> controller stop

Stops the controller.
The run scripts and systemd services created by the installer do not start it again.

### Restart controller

    ctl> controller restart

Restarts the controller.
This only works if the controller was started with `run --can-restart`, which the run scripts and systemd services created by the installer do, otherwise the request is refused.
It is also refused while a plugin install or update is running.

### Controller config

The controller config can be changed while the controller runs, unlike `npx clusteriocontroller config set` which must only be used while it is stopped.
See [Controller Configuration](configuration.md#controller-configuration) for the available fields.

#### List controller config

    ctl> controller config list

Lists the config of the controller.

#### Set controller config value

    ctl> controller config set <field> [value] [--stdin]

Sets a field in the controller config.
If `value` is left out the field is cleared, `--stdin` reads the value from stdin instead.
Some fields, like `controller.allow_remote_updates`, can not be changed remotely and have to be set on the controller computer while it is stopped.

#### Set controller config property

    ctl> controller config set-prop <field> <prop> [value] [--stdin]

Sets one property of an object field in the controller config, see [Set config property of field](#set-config-property-of-field).

#### Edit controller config

    ctl> controller config edit [editor]

Opens the controller config in a text editor and applies the changed values once the editor exits.
If `editor` is not given the `EDITOR` or `VISUAL` environment variable is used.


## Hosts

### List hosts

    ctl> host list

Lists all hosts.

Hosts are added to the cluster by running the installer on the computer the host runs on and approving the code it shows, see [Setting up remote hosts](/README.md#setting-up-remote-hosts).
Listing, approving and rejecting hosts waiting for approval needs the `core.host.approve` permission.

### List pending hosts

    ctl> host pending

Lists hosts waiting for approval with the code they show, the name they asked for, the address they connected from and how long they have been waiting.
A request goes away when its host stops waiting, and after the time set by `controller.host_pairing_timeout`, an hour by default, after which the host asks again with a new code.

### Approve host

    ctl> host approve <code> [--name <host name>]

Approves the host showing the code and prints the id of the new host.
The code is not case sensitive and the dash can be left out.
`--name` gives the host a different name than the one it asked for.
Approving gives the host full access to the cluster, check with `host pending` that the name and address match the computer you are setting up.

### Reject host

    ctl> host reject <code>

Rejects the host showing the code, the host then exits with an error.

### Revoke host

    ctl> host revoke <host>

Specify the host by name or ID.
Removes the host from the cluster, disconnects it and makes its token stop working.
Instances assigned to the host become unassigned, their files stay on the computer.
Requires the `core.host.revoke` permission.
To add the computer back to the cluster, start the host again and approve it.

### Stop host

    ctl> host stop <host>

Stops the host and the instances running on it.
The run scripts and systemd services created by the installer do not start it again, it has to be started on the computer it runs on.

### Restart host

    ctl> host restart <host>

Restarts the host.
Like the controller, this only works if the host was started with `run --can-restart`.

### Host config

The config of a connected host can be changed from clusterioctl.
See [Host Configuration](configuration.md#host-configuration) for the available fields.

#### List host config

    ctl> host config list <host>

Lists the config of the host given by name or ID.

#### Set host config value

    ctl> host config set <host> <field> [value] [--stdin]

Sets a field in the host config.
If `value` is left out the field is cleared, `--stdin` reads the value from stdin instead.
Some fields, like `host.allow_remote_updates`, can not be changed remotely and have to be set on the host computer while it is stopped.

#### Set host config property

    ctl> host config set-prop <host> <field> <prop> [value] [--stdin]

Sets one property of an object field in the host config, see [Set config property of field](#set-config-property-of-field).

#### Edit host config

    ctl> host config edit <host> [editor]

Opens the host config in a text editor and applies the changed values once the editor exits.
If `editor` is not given the `EDITOR` or `VISUAL` environment variable is used.

### Update Clusterio

    ctl> host update <host> [--all] [--restart]

Specify the host by name or ID.
If remote updates are enabled on the host, this will attempt to update `@clusterio/host` on the machine. Add `--all` to also update all npm-installed plugins. Changes will not be applied until the host is restarted. If the `--restart` flag is provided, the host will automatically restart once the update is complete.

Remote updates are enabled by default but can be disabled on a per-machine basis at the owner's discretion. For security reasons, this configuration setting cannot be changed remotely. To modify it, run the following command locally while the host is offline:

    host> config set host.allow_remote_updates true/false

The controller also supports remote updates, following the same logic. The corresponding commands are:

    ctl> controller update [--all] [--restart]
    controller> config set controller.allow_remote_updates true/false

### Mark restart required

    ctl> host mark-restart-required <host>

Marks the host as requiring a restart, the same way a plugin update does. Use it after installing or changing a plugin by other means than `host plugin install`, such as a plugin checked out into `external_plugins`. The mark shows up in the web interface on the next system metrics poll. The controller has the same command:

    ctl> controller mark-restart-required

## Instances

### List Instances

    ctl> instance list [--templates]

List instances.
Templates are only listed if `--templates` is passed.

### Create instance

    ctl> instance create <name> [--id <instance id>] [--from <instance id>] [--template <instance>] [--as-template]

Create a new instance. `name` is the instance name. `--id` is the optional id. `--from` copies the config of an existing instance. `--template` makes the new instance inherit all config values from the given template. `--as-template` creates the instance as a template, see `instance.is_template` in the [configuration docs](configuration.md). Use `--as-template --from <instance>` to make a template out of an existing instance.

### Delete instance

    ctl> instance delete <instance>

Deletes the instance and all its files, including saves, from the host it is assigned to.
The instance must be stopped, and can not be deleted while it is the template of other instances.

### Start instance

    ctl> instance start <instance> [--save <name>] [--keep-open]

Starts the instance, which must be assigned to a host.
Loads the given save, or the most recently modified save if `--save` is not passed.
`--keep-open` keeps clusterioctl running and prints the log of the instance until it is stopped with Ctrl+C.

### Restart instance

    ctl> instance restart <instance> [--save <name>] [--keep-open]

Stops the instance if it is running and starts it again, takes the same options as `start`.

### Load scenario

    ctl> instance load-scenario <instance> <scenario> [--seed <seed>] [--map-exchange-string <string>] [--map-gen-settings <file>] [--map-settings <file>] [--keep-open]

Starts the instance with a new game from the given scenario, for example `base/freeplay`.
This only works with save patching turned off for the instance with `factorio.enable_save_patching`, see [Save Patching](how-it-works.md#save-patching).
`--map-exchange-string` sets the map generation from a map exchange string copied from Factorio.
`--map-gen-settings` and `--map-settings` take paths to the JSON files Factorio uses for these, and `--seed` overrides the seed in them.

### Stop instance

    ctl> instance stop <instance>

Saves the game and stops the instance.

### Start all instances

    ctl> instance start-all [--force]

Starts every stopped instance that is assigned to a host.
Instances with `instance.exclude_from_start_all` set are skipped unless `--force` is passed.

### Stop all instances

    ctl> instance stop-all

Stops every running instance.

### Send RCON command

    ctl> instance send-rcon <instance> <command>

Sends a command to the Factorio server of a running instance and prints the reply, for example `ctl> instance send-rcon "My World" /players`.
Quote the command if it contains spaces.

### Export data

    ctl> instance export-data <instance>

Exports the item icons, names and mod settings from Factorio for the mod pack the instance uses, and uploads them to the controller.
The instance must be stopped.
The web interface needs this data to show icons and names of items, and to show the settings of the mods in a mod pack.
See [Exporting data](managing-a-cluster.md#exporting-data) for when to run it.

### Kill instance

    ctl> instance kill <name>

Terminates the running Factorio server without giving it a chance to save or cleanup after itself.

Note: This may cause loss of data.

### Save game

    ctl> instance save-game <name>

Saves the running game of the instance to the save it was started from and waits for the save to finish.

### Extract players from instance

    ctl> instance extract-players <name>

Creates a user account in the cluster for each player that has been online on the currently running save of the instance and sets the online time of that account on this instance to the online time recorded in the save.

Useful when importing a save to a cluster.
Note that the online time in a save is recorded differntly from how Clusterio records online time.
Most notably Clusterio records wall clock time while the save time is recorded in ticks and this extraction of player time assumes the game runs at 60 ticks a second.


### Config management

#### List Configuration

    ctl> instance config list <instance>

List config values for an instance. `instance` is the instance whose config values to list. Values inherited from a template are marked with `(inherited)`, object fields also list the properties set on the instance.

#### Set config value

    ctl> instance config set <instance> <field> [value] [--stdin]

Set field in instance config. `instance` is instance to set. `field` is field to set. `value` is value to set in field. `--stdin` signals to read value from stdin.

#### Set config property of field

    ctl> instance config set-prop <instance> <field> <prop> [value] [--stdin]

Set one property of an object field, like `factorio.settings`, without replacing the rest of the object.
`value` is parsed as JSON if it can be, otherwise it is used as a string.
If `value` is left out the property is removed.
For example, to set the max player count and remove the game password:

    ctl> instance config set-prop "My World" factorio.settings max_players 16
    ctl> instance config set-prop "My World" factorio.settings game_password

#### Inherit config value

    ctl> instance config inherit <instance> <field> [prop]

Make a field in the instance config take its value from the template again, undoing a previous `set`. `instance` is the instance to update, `field` is the field to inherit, `prop` limits it to one property of an object field.

#### Edit instance config

    ctl> instance config edit <instance> [editor]

Edit instance config in a text editor. Once file is saved and editor has been exited, changed config values will be read back in. `instance` is the instance to edit, `editor` is the editor to use. If `editor` is not given, clusterioctl will read from the `EDITOR` or `VISUAL` enviroment variables.

### Assign instance to host

    ctl> instance assign <instance> [host]

Assigns instance to host. `instance` is instance to assign, `host` is host to assign to. If `host` is not provided, instance will be unassigned.

### Saves

Saves are stored on the host the instance is assigned to.
The commands below need the instance to be assigned, and the host to be connected.

#### List saves

    ctl> instance save list <instance>

Lists the saves of the instance.
`loadByDefault` marks the save that is loaded when the instance is started without `--save`.

#### Create save

    ctl> instance save create <instance> [name] [--seed <seed>] [--map-exchange-string <string>] [--map-gen-settings <file>] [--map-settings <file>]

Creates a new save with a freshly generated map without starting the server.
The name defaults to `world.zip`.
The map options work the same as for [load-scenario](#load-scenario).

#### Upload save

    ctl> instance save upload <instance> <file> [--name <name>]

Uploads a save from this computer to the instance.
`--name` gives it a different name on the host, the name must end with `.zip`.
If a save with the same name exists the upload is stored under a new name.

#### Download save

    ctl> instance save download <instance> <save>

Downloads a save from the instance to the current directory.

#### Rename save

    ctl> instance save rename <instance> <old-name> <new-name>

#### Copy save

    ctl> instance save copy <instance> <source> <destination>

Copies a save within the same instance.

#### Transfer save

    ctl> instance save transfer <source-instance> <source-save> <target-instance> [target-save] [--copy]

Moves a save to another instance, which can be on a different host.
`--copy` leaves the original in place.
If a save with the target name exists the transferred save is stored under a new name, which is printed.

#### Delete save

    ctl> instance save delete <instance> <save>

## Users

Clusterio automatically creates user accounts for all players that join an instance when save patching is enabled.
These accounts are used to store per player data shared between instances, like if the player should be whitelisted, admin or banned.

### List users

    ctl> user list [--attributes] [--stats]

Lists all user accounts in the cluster along with some data for each.
`--attributes` adds the admin, whitelisted and banned status, and `--stats` adds online time and join counts.

### Show user

    ctl> user show <name> [--instance-stats]

Shows the account data of one user.
`--instance-stats` adds the online time and join count for each instance.


### Create User

    ctl> user create <name>

Creates a new empty user account for the given Factorio player.
Note that case matters here.
This is usually not required as user accounts are created automatically for players that join instances with save patching enabled.


### Promote User to Server Admin

    ctl> user set-admin <name> [--revoke] [--create]

Promotes the user given to in-game admin on instances with the `sync_adminlist` option enabled.
If the `--revoke` switch is used the user is removed from the adminlist.

Since admin status is a part of the account data the account must exist for this to succeed, passing `--create` will create the account if it does not exist.

**Note:** Being a server admin does not grant any access to manage the cluster.
See [set-roles](#set-cluster-roles) for adding roles which grant access to managing the clusetr.


### Whitelist User

    ctl> user set-whitelisted <name> [--remove] [--create]

Add the user given to the whitelist on instances with the `sync_whitelist` option enabled.
If the `--remove` switch is used the user is removed from the whitelist.

Since whitelisted status is a part of the account data the account must exist for this to succeed, passing `--create` will create the account if it does not exist.


### Ban User

    ctl> user set-banned <name> [--reason <message>] [--pardon] [--create]

Ban user in-game from instances with the `sync_banlist` option enabled.
Reason is a message that will be shown to the user when attemption to log in.
If the `--pardon` switch is used it removes the ban.

Since ban status is a part of the account data the account must exist for this to succeed, passing `--create` will create the account if it does not exist.

Note: This bans the user from logging in to Factorio servers in the cluster, it does not revoke access to any cluster management they might have, see next section on setting roles for revoking tha.

### Bulk importing admin, whitelist and ban lists

Admin lists, whitelists and banlists can be bulk imported with the following command:

    ctl> user import <file> [--admins|--whitelist|--bans|--users]

The admin list and whitelist files should be a JSON array of names, the same format as Factorio's server-adminlist.json and server-whitelist.json:

    ["joe", "bob", "allan"]

The banlist file uses the format of Factorio's server-banlist.json, where each entry is either a name or an object with a username and reason:

    [
        "joe",
        {"username": "bob", "reason": "stole materials"},
        {"username": "allan", "reason": "rude language"}
    ]

The `--users` option imports a file written by `user export`, which holds the admin, whitelist and ban status of every user.
If no option is given the type is guessed from the file, files with an `export_version` field are treated as user exports, otherwise the file name must contain ban, admin or whitelist.
Users that do not exist are created.
Importing only adds to the existing lists, it never removes anyone from them.

To replace a list instead, use restore:

    ctl> user restore <file> [--admins|--whitelist|--bans|--users] [--no-backup]

This takes the same files as import, but removes everyone not in the file from the list.
The previous list is written to `<type>-backup.json` in the current directory unless `--no-backup` is passed.

The current lists can be exported with the following command:

    ctl> user export <file> [--admins|--whitelist|--bans|--users]

Defaults to exporting users.

### Set Cluster Roles

    ctl> user set-roles <name> [roles...]

Replaces the roles the user has in the cluster with a new list of roles.
Calling with an empty roles argument will remove all roles from the user.

By default there's a roled named Cluster Admin which grants access to everything and a role named Player which grants a limited read access to the cluster, see [the section on roles](#roles) for more information about setting up roles and permissions.


### Revoke user token

    ctl> user revoke-token <name>

Makes every authentication token issued to the user stop working, including the one used by the web interface and clusterioctl.
The user has to log in again, or be given a new token with `npx clusteriocontroller bootstrap generate-user-token <name>`.
Revoking the token of another user needs the `core.user.revoke_other_token` permission.

### Delete user

    ctl> user delete <name>

Deletes everything stored on the controller for this user.

Note: If the player is banned from the cluster this will effectively unban them, as the ban status is stored with the user account.

Note: If the player joins the cluster again a new account will be made for them automatically.


## Roles

Access to manage the cluster is granted through roles.
A role is a named set of permissions, and a user has the permissions of all the roles they have.
By default there are two roles: Cluster Admin, which has the `core.admin` permission that grants everything, and Player, which can view most of the cluster but not change it.
New users get the Player role, this is set by `controller.default_role_id`.
Use [`user set-roles`](#set-cluster-roles) to give roles to a user.

### List roles

    ctl> role list

Lists the roles with their ID, description and permissions.

### Create role

    ctl> role create <name> [--description <text>] [--permissions <permission>]...

Creates a new role and prints its ID.
Pass `--permissions` once for each permission the role should grant, for example:

    ctl> role create "Instance Operator" --permissions core.instance.start --permissions core.instance.stop

### Edit role

    ctl> role edit <role> [--name <name>] [--description <text>] [--set-perms <permission...>] [--add-perms <permission...>] [--remove-perms <permission...>] [--grant-default]

Changes the name, description or permissions of a role.
`--set-perms` replaces the permissions of the role, `--add-perms` and `--remove-perms` change them, and these take several permissions separated by spaces.
`--grant-default` adds the permissions shown as granted by default in [`permission list`](#list-permissions), which are the ones the Player role starts with.

### Delete role

    ctl> role delete <role>

Deletes the role, users that had it lose the permissions it granted.


## Permissions

### List permissions

    ctl> permission list

Lists all permissions with their name, title, description and whether they are granted by default.
Plugins can add their own permissions, these show up here when the plugin is loaded on the controller.


## Mods

Mods are stored on the controller and sent to hosts when an instance needs them.

### List mods

    ctl> mod list [--fields <field...>]

Lists the mods stored on the controller.
`--fields` picks the columns to show, `--fields all` shows every field.

### Search mods

    ctl> mod search <factorio-version> [query] [--page <n>] [--page-size <n>] [--sort <field>] [--sort-order asc|desc] [--fields <field...>]

Searches the mods stored on the controller that work with the given major version of Factorio, for example `2.0`.
This does not search the Factorio Mod Portal, use the Mods page of the web interface for that.

### Show mod

    ctl> mod show <name> <version>

Shows the details of a stored mod.

### Upload mod

    ctl> mod upload <file>

Uploads a mod zip file to the controller.

### Download mod

    ctl> mod download <name> <version>

Downloads a stored mod to the current directory.

### Delete mod

    ctl> mod delete <name> <version>

Deletes a stored mod from the controller.


## Mod Packs

A mod pack is a list of mods with their versions and mod settings, see [Mod packs](managing-a-cluster.md#mod-packs).

### List mod packs

    ctl> mod-pack list

### Show mod pack

    ctl> mod-pack show <mod-pack>

Shows the mods and settings of a mod pack.

### Create mod pack

    ctl> mod-pack create <name> <factorio-version> [--description <text>] [--mods <name:version...>] [--disabled-mods <name...>] [--bool-setting <scope> <name> <value>] ...

Creates a mod pack for the given version of Factorio and prints its ID.
The built in mods of Factorio, like `base` and `space-age`, are added automatically with only `base` enabled.
Mods are given as `name:version`, and optionally `name:version:sha1`.
`--disabled-mods` takes the names of mods from `--mods` that should be in the pack but not enabled.
Mod settings are set with `--bool-setting`, `--int-setting`, `--double-setting`, `--string-setting` and `--color-setting`, which each take a scope, a setting name and a value.
The scope is one of `startup`, `runtime-global` or `runtime-per-user`, and a color is given as JSON like `{"r":1,"g":0,"b":0,"a":1}`.

### Edit mod pack

    ctl> mod-pack edit <mod-pack> [--name <name>] [--description <text>] [--factorio-version <version>] [--add-mods <name:version...>] [--enable-mods <name...>] [--disable-mods <name...>] [--remove-mods <name...>] [--<type>-setting <scope> <name> <value>] [--remove-setting <scope> <name>]

Changes a mod pack, the options work the same as for `create`.
`--add-mods` also replaces the version of a mod already in the pack.
Mods are not checked against the mods stored on the controller, make sure the mods you add have been uploaded.

### Export and import mod packs

    ctl> mod-pack export <mod-pack>
    ctl> mod-pack import <string>

`export` prints the mod pack as a string, and `import` creates a new mod pack from such a string.
This is the same string as the Import string button and the Export to string action in the web interface use.

### Delete mod pack

    ctl> mod-pack delete <mod-pack>


## Notes

Free text notes can be attached to hosts, instances, users, roles, mod packs, mods and saves.
They are stored on the controller and shown to everyone with access to the resource in the web interface, and can for example be used to record who runs a host or what an instance is meant for.

The web interface renders notes as Markdown.
A mention of the form `@<type>/<id>` becomes a link to that resource showing its name, for example `@instance/778528005` or `@user/cooldude2606`.
This works for hosts, instances, users, roles and mod packs, and the id is shown if the name is not available.
The note itself stores the mention as written.

### List notes

    ctl> note list [--type <type>]

Lists all notes, optionally limited to one resource type.

### Set note

    ctl> note set <type> <id> <content>

Sets the note of a resource.
The type is one of host, instance, user, role, mod_pack, mod or save.
The id is the numeric id for hosts, instances, roles and mod packs, the lower case name for users, `<name>_<version>` for mods and `<instance id>/<file name>` for saves.

### Delete note

    ctl> note delete <type> <id>

Removes the note of a resource.
Notes are also removed when the resource they are attached to is deleted.


## Logs

### Query log

    ctl> log query [--all] [--controller] [--host <host>] [--instance <instance>] [--max-level <level>] [--limit <n>] [--start]

Prints entries from the cluster log stored on the controller.
At least one of `--all`, `--controller`, `--host` and `--instance` must be passed to pick which logs to read.
`--max-level` leaves out entries less important than the given level, for example `warn`.
Prints the last 1000 entries by default, `--limit` changes the number and `--start` takes them from the start of the log instead.

### Follow log

    ctl> log follow [--all] [--controller] [--host <host>] [--instance <instance>]

Prints new log entries as they come in until stopped with Ctrl+C.
Takes the same options for picking logs as `query`.


## Plugins (Local)

The plugins loaded by clusterioctl are managed with the `plugin` command, which works without a connection to the controller.
See the [readme for @clusterio/ctl](/packages/ctl/README.md#plugin-command).


## Plugins (Remote)

The installer asks "Allow remote updates and plugin installs from the web interface?" and the answer sets `allow_remote_updates`, `allow_plugin_updates` and `allow_plugin_install` together on that machine, pass `--remote-npm` or `--no-remote-npm` to answer it from the command line.
Remote updates allow ctl and the web UI to update Clusterio and plugins on machines within the cluster.
Remote installs allow them to install any package from npm onto the machine, which is a risk of arbitrary code execution through malicious npm packages, so only allow them if you trust everyone with access to install plugins.
In a config created without the installer remote updates are enabled and remote installs are disabled by default.
See below for changing these settings after installing.

### List

    ctl> controller plugin list
    ctl> host plugin list <host>

This command lists all plugins currently known to the remote. Newly installed plugins will not be displayed until the remote is restarted. Plugins that are distributed as an npm package can be updated remotely.

### Update

    ctl> controller plugin update <name>[@<version>] [--restart]
    ctl> host plugin update <host> <name>[@<version>] [--restart]

If remote plugin updates are enabled on the remote, this will execute `npm update --save <name>`, which stays within the version range saved in the remote's `package.json`.
To update to a specific version, including one outside that range, pass it as `<name>@<version>`, for example `@clusterio/plugin-example@2.1.0`.
The version must be published on npm, and the remote then executes `npm install --save <name>@<version>`.
The plugin must already be installed on the remote, and only remote plugin updates need to be enabled.
Changes will not be applied until the remote is restarted.
If the `--restart` flag is provided, the remote will automatically restart once the update is complete.

### Update All

    ctl> controller update --all [--restart]
    ctl> host update <host> --all [--restart]

Updates the Clusterio package and all plugins installed from npm in a single `npm update --save` command. Updating everything at once avoids ending up with multiple versions of `@clusterio/lib` in the installation. Requires both remote updates and remote plugin updates to be enabled on the remote.

### Install

    ctl> controller plugin install <name>[@<version>] [--restart]
    ctl> host plugin install <host> <name>[@<version>] [--restart]

If remote plugin installs are enabled on the remote, this will execute `npm install --save <name>`.
Pass `<name>@<version>` to install a specific version, for example to match the version used by the rest of the cluster.
The package, and the version if given, must be published on npm.
Changes will not be applied until the remote is restarted.
If the `--restart` flag is provided, the remote will automatically restart once the update is complete.

### Search

    ctl> controller plugin search [query] [--page <n>] [--page-size <n>]

Searches the npm registry for packages tagged with the clusterio-plugin keyword.
The search is done by the controller and does not require remote installs to be enabled.
The web UI has a plugin browser on the plugins page that uses the same search.

### Concurrent Operations

Only one npm operation runs at a time on a machine.
A standalone controller and host share their working directory, so the operation holds the `npm-operation.lock` file there while npm runs.
Other installs and updates on the same machine or installation are rejected with "Another package operation is already in progress on this machine" until it finishes.
A lock file left behind by a process that is no longer running is removed automatically.


### Enable/Disable Updates

    host> config set host.allow_plugin_updates true/false
    controller> config set controller.allow_plugin_updates true/false

Remote updates are enabled by default but can be disabled on a per-machine basis at the owner's discretion. For security reasons, this configuration setting cannot be changed remotely. To modify it, run the above commands locally while the remote is offline.

### Enable/Disable Installs

    host> config set host.allow_plugin_install true/false
    controller> config set controller.allow_plugin_install true/false

Remote installs are disabled by default but can be enabled on a per-machine basis at the owner's discretion. For security reasons, this configuration setting cannot be changed remotely. To modify it, run the above commands locally while the remote is offline.


## Prometheus Metrics

The controller exports metrics for the whole cluster on the `/metrics` endpoint.
Fetching it requires a token for a user with the `core.controller.metrics` permission, sent either as an `Authorization: Bearer <token>` header or as an `X-Access-Token` header.
Requests without a valid token get a 401 response and requests for users lacking the permission get a 403 response.

Create a role with just this permission, a user to hold it, and generate a token for that user.
Give the user a name that is not a valid Factorio player name, such as one starting with `#`, so a player joining the cluster can never claim the account and its token:

    ctl> role create Prometheus --permissions core.controller.metrics
    ctl> user create #prometheus
    ctl> user set-roles #prometheus Prometheus
    $ npx clusteriocontroller bootstrap generate-user-token '#prometheus'

Then pass the token in the scrape job for the controller in `prometheus.yml`:

    scrape_configs:
      - job_name: clusterio
        authorization:
          credentials: <token>
        static_configs:
          - targets: ["localhost:8080"]

Concurrent scrapes share a single round of metrics gathering from the hosts, so multiple scrapers polling the controller do not multiply the load on the hosts.
