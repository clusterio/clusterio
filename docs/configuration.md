# Configuration

Config values are changed with the `config set` commands of clusterioctl, clusteriocontroller and clusteriohost, or from the settings pages in the web interface.
See [Managing a Cluster](/docs/managing-a-cluster.md) for the commands.

All values are checked against the type of the field when set.
Some fields have additional rules on top of that, such as a number having to be greater than 0, and these are listed under the field.
Setting a value that fails a check is rejected with an error and the old value is kept.

A few fields are internal to Clusterio.
These are managed by Clusterio itself, hidden in the web interface and should not be modified by hand.


## Controller Configuration

### controller.name

Name of the cluster.
Used to distinguish it from other clusters and is prepended to the name of servers in the server list.

Defaluts to "Your Cluster".


### controller.database_directory

Directory used to store cluster data to.
Needs to be writeable by the controller.
This is also used by plugins to store its data.

Defaults to "database".


### controller.mods_directory

Directory where mods shared with the cluster are stored.
Mods uploaded through the web interface or downloaded from the mod portal end up here, and hosts fetch the mods they need for their instances from here.
Needs to be writeable by the controller.

Defaults to "mods".


### controller.autosave_interval

Interval in seconds the controller saves the data it holds in memory, such as users, instances, mod packs and plugin data, to controller.database_directory.
The data is also saved on shutdown.
Must be greater than 0.

Defaults to 60.


### controller.http_port

Port to host HTTP server on.
If set to null no HTTP server will be exposed.
At least one of this and controller.https_port needs to be set to a port.
Must be a whole number greater than 0.

Defaults to 8080.


### controller.https_port

Port to host HTTPS server on.
Uses controller.tls_certificate and controller.tls_private_key as the certificate and private key for the HTTPS server.
If set to null no HTTPS server will be exposed.
At least one of this and controller.http_port needs to be set to a port.
Must be a whole number greater than 0.

See the [Setting up TLS](/docs/setting-up-tls.md) document for a guide to setting up HTTPS with Clusterio.

Defaults to null.


### controller.bind_address

IP address to bind the HTTP and HTTPS ports on.
Useful to limit which interface to accept connections from.
If set to null the unspecified IPv6 address will be used, which on most systems means it will also listen on the unspecified IPv4 address and accept connections from all
interfaces.

Defaults to null.


### controller.trusted_proxies

Comma separated list of IP addresses and/or CIDR blocks of reverse proxies in front of the controller to trust the `X-Forwarded-For` header from.
When a connection comes from one of these addresses the last address in the `X-Forwarded-For` header is used as the remote address of the connection instead of the address of the proxy.
Entries that are not valid IP addresses are logged as errors and ignored.

Defaults to null meaning the header is never trusted.


### controller.public_url

Public address the controller is accessible on.
Used as the URL in configs generated with `clusteriocontroller bootstrap create-ctl-config` and `clusterioctl host create-config`, and by plugins like Player Auth that need to show the address of the web interface in-game.
This should be a full URL ending with a /.

Defaults to null meaning assume localhost.


### controller.static_url

Used to override where static assets such as the web bundle is loaded from.
This can be used if you want to put the static assets on a separate cdn url like `https://cdn.example.com/static/` while keeping the API hosted directly by clusterio.
Due to a limitation on how the webpack assets are built the pathname component of the url have to be `/static/`, values with any other path are rejected.

See also the `clusteriocontroller copy-static` command for how to obtain the static asset files that need to be hosted.

Defaults to null meaning use the internally hosted assets.


### controller.grafana_url

URL of a Grafana dashboard to link to from the overview page of the web interface, including the protocol.
If null no link is shown.

Defaults to null.


### controller.tls_certificate

Path to TLS certificate to use for the HTTPS server when controller.https_port is configured.
Both this and controller.tls_private_key have to be set for the controller to start with controller.https_port configured.

Defaults to null.


### controller.tls_private_key

Path to TLS private key to use for the HTTPS server when controller.https_port is configured.

Defaults to null.


### controller.auth_secret

Base64 encoded authentication secret used to verify tokens issued to hosts, users, and sessions.
This should contain 256 bytes of random data, and if changed will cause all tokens become invalid.
Keep this secret if leaked an attacker could easily compromise the cluster.
The value can only be read and changed from the controller itself, it is not available through clusterioctl or the web interface.

Defaults to null which means generate a secure secret on startup.


### controller.heartbeat_interval

Interval in seconds heartbeats are sent out at for WebSocket connections.
If a WebSocket connection hasn't received a heartbeat in 2 times the heartbeat interval it will be considered stale and closed.
A lower value means less time between connections going stale and them being closed.
Must be greater than 0.

Defaults to 15.


### controller.session_timeout

Time in seconds from the connection is closed following a heartbeat timeout until the session is invalidated and data loss occurs.
A higher timeout gives more time for a client to recconect and resume an active session over a connection that was dropped, but also leads to stale connections taking longer to clear out.
In the case of the controller or client crashing the data loss is unavoidable.

Value should not be less than the configured `max_reconnect_delay` of the clients and it should be greater than 2 times `controller.heartbeat_interval`.
Must be greater than 0.

Defaults to 60.


### controller.metrics_timeout

Timeout in seconds before a call to gather metrics from a host times out.
This should be less than both the timeout and collection interval configured for the collection job in Prometheus.
Must be greater than 0.

Defaults to 8.


### controller.system_metrics_interval

Interval in seconds the controller gathers CPU, memory and disk usage from itself and every connected host for display in the web interface.
Whether the controller needs a restart to apply an update is also checked on this interval.
If 0 system metrics are not gathered.
Must be 0 or greater.

Defaults to 10.


### controller.proxy_stream_timeout

Timeout in seconds for proxy streams through the controller that has been created but is not yet sending data to be automatically closed.
Streams that have started sending data before this timeout is not affected.
Must be greater than 0.

Defaults to 15.


### controller.factorio_username

Username of the Factorio.com account to authenticate with the Factorio API with.
Together with controller.factorio_token this is used by the controller to download mods from the mod portal, and if controller.share_factorio_credentials_with_hosts is enabled, as the credentials in the server settings of instances.

Defaults to null.


### controller.factorio_token

Token of the Factorio.com account to authenticate with the Factorio API with, see controller.factorio_username.
This is the token shown on your profile page on factorio.com, not your password.
The value is treated as a credential, it can be set from anywhere but only read back from the controller itself.

Defaults to null.


### controller.share_factorio_credentials_with_hosts

If enabled hosts get controller.factorio_username and controller.factorio_token from the controller when they start an instance and put them in the server settings of that instance.
Credentials set on the host with host.factorio_username and host.factorio_token, or on the instance through `username` and `token` in factorio.settings, take precedence over the ones from the controller.
Disable this if you don't want the controller's credentials to be sent to the hosts.

Defaults to true.


### controller.default_mod_pack_id

ID of the mod pack to use for instances that don't have factorio.mod_pack_id set.
Instances without a mod pack of their own fail to start if this is null.

Defaults to null.


### controller.default_role_id

Role to automatically grant to new users.
If null no role is granted.

Defaults to 1 which correspond to the default Player role.


### controller.mod_portal_cache_duration_minutes

Time in minutes the controller caches the list of mods fetched from the Factorio mod portal when browsing it from the web interface.
Set to 0 to disable the cache and fetch the list on every request.
Must be 0 or greater.

Defaults to 30.


### controller.mod_portal_page_size

Number of results to request per page when fetching the list of mods from the Factorio mod portal.
Must be greater than 0.

Defaults to 1000.


### controller.allow_remote_updates

Whether the `controller update` command in clusterioctl and the update button in the web interface are allowed to update the `@clusterio/controller` package with npm.
For security reasons this can only be changed locally with `clusteriocontroller config set` while the controller is stopped, and it is hidden in the web interface.
See [Managing a Cluster](/docs/managing-a-cluster.md) for details on remote updates.

Defaults to true.


### controller.allow_plugin_updates

Whether remote requests to update plugins installed on the controller with npm are allowed.
Like controller.allow_remote_updates this can only be changed locally.

Defaults to true.


### controller.allow_plugin_install

Whether remote requests to install new plugins on the controller with npm are allowed.
Like controller.allow_remote_updates this can only be changed locally.

Defaults to false.


### controller.version

Version of the controller package that last loaded this config.
Set automatically on startup and used to detect when the controller has been updated or downgraded.
Internal, hidden in the web interface and should not be changed.


### <plugin_name>.load_plugin

Whether to load the plugin on the controller.
Plugins not loaded on the controller will not be loaded on instances.

Defaults to true.


## Host Configuration

### host.name

Name of the host.
Shows up in host lists and is used to reference this host in the clusterioctl command line interface.

Defaults to "New Host".


### host.id

Immutable numeric id of the host which uniquely identifies this host in the cluster.
Hidden in the web interface.

Defaults to a random 31 bit number.


### host.factorio_directory

Directory to look for the Factorio server(s) in.
This can either point to a Factorio server directory, or to a directory containing multiple versions of the Factorio server.

Defaults to "factorio".


### host.mods_directory

Directory the host stores mods downloaded from the controller in.
When an instance starts the mods in its mod pack are downloaded here if missing and then linked into the mods directory of the instance.

Defaults to "mods".


### host.instances_directory

Directory to store instances in.
One sub-directory will be created in it for each instance assigned to this host and these sub-directories will contain logs, saves, and various auto generated configuration files for the instances.

Defaults to "instances".


### host.controller_url

URL to connect to the controller to.

Defaults to "http://localhost:8080/".


### host.controller_token

Access token used for authenticating with the controller.
You can generate an access token with `clusterioctl host generate-token --id <host-id>`, or use the `clusterioctl host create-config` to create a new host config with the correct url and token in it.
The value can only be read and changed from the host itself.

Defaults to "enter token here".


### host.public_address

External address instances hosted on this host can be accessed on.
This is used by plugins like Server Select to give the correct address to switch between instances in-game.

Defaults to "localhost".


### host.factorio_port_range

UDP ports the host hands out to instances that don't have factorio.game_port set.
Written as a comma separated list of ports and/or ranges of ports separated with a dash, for example "34100-34199" or "34100, 34200-34210".
A port is picked when the instance is started and remembered in factorio.host_assigned_game_port, so an instance keeps the same port as long as it is still free.
Starting an instance fails if all ports in the range are taken.

Defaults to "34100-34199".


### host.factorio_username

Username of the Factorio.com account to put in the server settings of instances on this host.
If set this takes precedence over the credentials shared by the controller, but not over `username` set in factorio.settings of an instance.

Defaults to null.


### host.factorio_token

Token of the Factorio.com account to go with host.factorio_username.
The value is treated as a credential, it can be set from anywhere but only read back from the host itself.

Defaults to null.


### host.max_reconnect_delay

Maximum delay in seconds to wait after connection to the controller is dropped before attempting to reconnect to it.
The actual delay on each reconnect will be a random number between 0 and this configured value to avoid all clients trying to reconnect at the same time.
Must be greater than 0.

Defaults to 60.


### host.allow_remote_updates

Whether the `host update` command in clusterioctl and the update button in the web interface are allowed to update the `@clusterio/host` package with npm.
For security reasons this can only be changed locally with `clusteriohost config set` while the host is stopped, and it is hidden in the web interface.
See [Managing a Cluster](/docs/managing-a-cluster.md) for details on remote updates.

Defaults to true.


### host.allow_plugin_updates

Whether remote requests to update plugins installed on the host with npm are allowed.
Like host.allow_remote_updates this can only be changed locally.

Defaults to true.


### host.allow_plugin_install

Whether remote requests to install new plugins on the host with npm are allowed.
Like host.allow_remote_updates this can only be changed locally.

Defaults to false.


### host.version

Version of the host package that last loaded this config.
Set automatically on startup and used to detect when the host has been updated or downgraded.
Internal, hidden in the web interface and should not be changed.


### <plugin_name>.load_plugin

Whether to load the plugin on the host.
Only plugins with a host or instance part have this field in the host config.
Plugins not loaded on the host will not be loaded on the instances it hosts.

Defaults to true.


## Instance Configuration

### instance.name

Name of the instance, shown in instance lists and used to reference to this instance in the clusterioctl command line interface.

Defaults to "New Instance".


### instance.id

Imutable numeric id of the instance which uniquely identifies this instance in the cluster.
Hidden in the web interface.

Defaluts to a random 31 bit integer.


### instance.assigned_host

Host this instance is assigned to.
To change this you need to use the separate assign instance interface.
After being assigned to a host the directory for the instance is created on the host.
Internal and hidden in the web interface.

Defaults to null meaning not assigned.


### instance.auto_start

If enabled start this instance when the host it is assigned to is started up.
Does not affect start or stop of the instance while the host is running.

Defaults to false.


### instance.exclude_from_start_all

If enabled this instance will be excluded from the "Start all" button operation in the web interface.
This allows you to prevent certain instances from being started when using the bulk start operation.

Defaults to false.


### factorio.version

Version of Factorio to use for this instance.
Can be a specific version like "2.0" or "2.0.15", a release channel like "stable" or "experimental", or the special string "latest" meaning the latest version of Factorio found on the host.
A release channel is resolved to a version through the latest releases data the controller keeps, and the instance fails to start if that is unavailable.
Values that don't match one of these forms are rejected.

Defaults to "latest".


### factorio.executable_path

Path relative to the Factorio installation directory of the executable to run.
If null the path is auto detected, which is `bin/x64/factorio` on Linux and Windows and `MacOS/factorio` on macOS.
Only needed in special setups.

Defaults to null.


### factorio.shutdown_timeout

Time in seconds to wait for the Factorio server to exit after asking it to stop before the process is killed.
Set to 0 to wait forever.
Changing this while the instance is stopping restarts the timer with the new value.
Must be 0 or greater.

Defaults to 300.


### factorio.game_port

UDP port to run the Factorio server on.
If null a port from host.factorio_port_range on the host is assigned to the instance.
Negative values are rejected.

Defaults to null.


### factorio.host_assigned_game_port

Port from host.factorio_port_range the host has assigned to this instance while factorio.game_port is null.
Internal, set by the host and only accessible from the host.


### factorio.rcon_port

TCP port to start the RCON interface on the Factorio server on.
If null a random port in the dynamic range is assigned each time the instance starts.
Negative values are rejected.

Defaults to null.


### factorio.rcon_password

Password to use for the RCON interafec.
If null a random secure password is generated and used each time the instance starts.
The value is treated as a credential and can only be read back by the controller and the host.

Defaults to null.


### factorio.player_online_autosave_slots

Keeps a separate pool for autosaves where at least on player has been online since the previous autosave was done.
This requires regular autosaving to be enabled and will rename autosaves to `_autosave_poN.zip` (where N is a slot number) whenever a player has been online for that save.
The slot numbers start at 1, are incremented by 1 after each autosave that is renamed and reset back to 1 whenever this value is exceeded.
Setting this to a value lower than `autosave_slots` in factorio.settings is rejected, unless it is 0.
The same check is done when factorio.settings is changed.
Useful for preventing the loss of all progress when nobody is around on always online servers with auto pause disabled.

If 0 no autosave renaming takes place.

Defaults to 5.


### factorio.mod_pack_id

ID of the mod pack to use on this instance.
The mods in the pack are linked into the mods directory of the instance every time it starts, and any other files in that directory are removed.
If null the mod pack set in controller.default_mod_pack_id is used.

Defaults to null.


### factorio.enable_save_patching

Whether to use save patching or not.
When enabled lua code is patched into the game save before starting it.
Most plugins require the use of save patching to function.
Turning it off makes it possible to use Clusterio to run and manage regular vanilla games and scenarios not compatible with Clusterio.
Plugins that need save patching can't be loaded on the instance while this is disabled.
Disabling it while such a plugin is loaded is rejected, and so is loading such a plugin while it is disabled.

Defaults to true.


### factorio.enable_script_commands

Allow Clusterio and plugins to send commands that disable achievements to the server over RCON, that is `/c`, `/sc`, `/mc`, `/cheat`, `/editor` and their long forms.
Clusterio integrations and most plugins need this, and when enabled achievements are disabled on the server at startup.
When disabled attempts to send such a command fail with an error.
This does not stop players from using these commands themselves.
Like factorio.enable_save_patching, plugins that need script commands can't be loaded on the instance while this is disabled.

Defaults to true.


### factorio.enable_whitelist

Turn on the whitelist on the server.

Defaults to false.


### factorio.enable_authserver_bans

Pass the `--use-authserver-bans` flag to Factorio, which makes the server check connecting players against the multiplayer bans on Factorio.com and report bans and unbans done on the server back to it.

Defaults to false.


### factorio.settings

Object with the settings to put into `server-settings.json` for the Factorio server.
The settings in `data/server-settings.example.json` of the Factorio installation is used as the base and properties specified here overrides the properties there.

Changes to the following properties will be applied live if the instance is running while it is changed: `afk_autokick_interval`, `allow_commands`, `autosave_interval`, `autosave_only_on_server`, `description`, `ignore_player_limit_for_returning_players`, `max_players`, `max_upload_slots`, `max_upload_in_kilobytes_per_second`, `name`, `only_admins_can_pause_the_game`, `game_password`, `require_user_verification`, `tags`, `visibility`.

Defaults to a set of common settings filled in when the instance is created, such as `"tags": ["clusterio"]`, `"auto_pause": false` and a `name` and `description` based on the cluster and instance names.


### factorio.verbose_logging

Pass the `--verbose` flag to Factorio when starting the server.
This prints more messages to the log.

Defaults to false.


### factorio.console_logging

Pass the `--console-log` flag to Factorio to make it write the console output, such as chat, commands and player joins, to `console.log` in the instance directory.
Useful for 3rd party tools that read the console log of the server.

Defaults to false.


### factorio.strip_paths

Strip down absolute paths in the server log going to files inside the instance directory such that they are relative to the instance directory.
This improves the signal to noise ratio of the log.

Sample output when disabled:

    0.487 Loading map /srv/clusterio/instances/test/saves/world.zip: 2615888 bytes.
    0.614 Checksum for script /srv/clusterio/instances/test/temp/currently-playing/control.lua: 2390553941
    1.277 Script @/srv/clusterio/instances/test/temp/currently-playing/modules/example/test.lua:7: Example log line.

Sample output when enabled:

    0.487 Loading map saves/world.zip: 2615888 bytes.
    0.614 Checksum for script temp/currently-playing/control.lua: 2390553941
    1.277 Script @modules/example/test.lua:7: Example log line.

Defaults to true.

### factorio.sync_adminlist

Synchronize in-game admin list with admin status of the users in cluster.
One of "disabled", "enabled" or "bidirectional".
If enabled Clusterio will generate a new `server-adminlist.json` on instance startup based on the users in the cluster with admin status set to true, and keep the admins in sync with the users that have admin status while the instance is running.
With "bidirectional" players promoted or demoted in-game with `/promote` and `/demote` are also updated in the cluster, and from there on the other instances.
Configs from before this became a choice are migrated from true and false to "enabled" and "disabled".

Defaults to "bidirectional".


### factorio.sync_whitelist

Synchronize in-game whitelist with the whitelisted status of the users in the cluster.
One of "disabled", "enabled" or "bidirectional".
If enabled Clusterio will generate a new `server-whitelist.json` on instance startup based on the users in the cluster with whitelisted status set to true, and keep the whitelisted users in sync with the users that have whitelisted status while the instance in running.
With "bidirectional" changes made in-game with `/whitelist` are picked up by watching `server-whitelist.json` for changes and updated in the cluster as well.
This requires factorio.enable_whitelist to be on, as Factorio doesn't write the file otherwise.
Configs from before this became a choice are migrated from true and false to "enabled" and "disabled".

Defaults to "bidirectional".


### factorio.sync_banlist

Synchronize in-game banlist with the banned status of users in the cluster.
One of "disabled", "enabled" or "bidirectional".
If enabled Clusterio will generate a new `server-banlist.json` on instance startup based on users in the cluster with banned status set to true, and keep the banned users in sync with the users that have the banned status while the instance is running.
With "bidirectional" players banned or unbanned in-game with `/ban` and `/unban` are also updated in the cluster, and from there on the other instances.
Configs from before this became a choice are migrated from true and false to "enabled" and "disabled".

Defaults to "bidirectional".


### factorio.max_concurrent_commands

Maximum number of commands being transmitted into the game in parallel.
Since the rate at which long commands are streamed into the game is by default limeted to 100 bytes/tick and scales down to 25 bytes/tick when there's 20 players connected, long commands can hold up the command interface and cause large latencies in getting data pushed into the game.
(The rates are controlled by the `segment_size` options in the server settings.)
To counteract this Clusterio sends up to this configured value number of commands in parallel over the RCON interface.
This causes the game updates sent to clients to have this many command streams in parallel contained in them, drastically increasing the maxiumum size they can become.
Since commands are only processed so ofter the maximum rate of commands that can be sustained is roughly 30 times this configured value per second, though note that large commands will lower this value.

The game updates sent by the server is split into roughly 500 byte packets, and if any one of those parts are lost the entire update is resent.
This means a high number of concurrent commands can amplify resends due to packet loss and degrade the player experience up to the point of becomming completely unplayable.

Prior to 0.18.7 the maximum practical size of game update sent where arround 8 kB due to the UDP receive buffer on windows defaulting to this value, larger updates would not get through the receive buffer and cause the connection to drop.
To stay below the 8 kB limit the maximum safe value for this option would be around 7000 / (3 * game_speed * maximum_segment_size), which is around 20 in normal circumstances.
Must be greater than 0.

Defaults to 5.


### <plugin_name>.load_plugin

Whether to load the given plugin on the instance.
Note that plugins need to be loaded on the controller and the host in order for them to be loaded on instances.
Loading a plugin that requires save patching or script commands is rejected while factorio.enable_save_patching or factorio.enable_script_commands respectively is disabled on the instance.

Defaults to true.


## Control Configuration

### control.controller_url

URL to connect to the controller to.

Defaults to null meaning complain about it not being set and exit.


### control.controller_token

Access token used for authenticating with the controller.
You can generate an access token with `clusteriocontroller bootstrap generate-user-token <username>`, or use the `clusteriocontroller bootstrap create-ctl-config <username>` to create a new ctl config with the correct url and token in it.

Defaults to null meaning complain about it not being set and exit.


### control.max_reconnect_delay

Max duration in seconds to wait before attempting to reconnect with the controller after the connection is dropped.
The actual delay on each reconnect will be a random number between 0 and this configured value to avoid all clients trying to reconnect at the same time.
Must be 0 or greater.

Defaults to 60.
