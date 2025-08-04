# Configuration


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


### controller.http_port

Port to host HTTP server on.
If set to null no HTTP server will be exposed.
At least one of this and controller.https_port needs to be set to a port.

Defaults to 8080.


### controller.https_port

Port to host HTTPS server on.
Uses controller.tls_certificate and controller.tls_private_key as the certificate and private key for the HTTPS server.
If set to null no HTTPS server will be exposed.
At least one of this and controller.http_port needs to be set to a port.

See the [Setting up TLS](/docs/setting-up-tls.md) document for a guide to setting up HTTPS with Clusterio.

Defaults to null.


### controller.bind_address

IP address to bind the HTTP and HTTPS ports on.
Useful to limit which interface to accept connections from.
If set to null the unspecified IPv6 address will be used, which on most systems means it will also listen on the unspecified IPv4 address and accept connections from all
interfaces.

Defaults to null.


### controller.public_url

Public address the controller is accessible on.
Currently only used for `clusteriocontroller bootstrap create-ctl-config` in order to give the right url to connect to.
This should be a full URL ending with a /.

Defaults to null meaning assume localhost.


### controller.tls_certificate

Path to TLS certificate to use for the HTTPS server when controller.https_port is configured.

Defaults to "database/certificates/cert.crt".


### controller.tls_private_key

Path to TLS private key to use for the HTTPS server when controller.https_port is configured.

Defaults to "database/certificates/cert.key".


### controller.auth_secret

Base64 encoded authentication secret used to verify tokens issued to hosts, users, and sessions.
This should contain 256 bytes of random data, and if changed will cause all tokens become invalid.
Keep this secret if leaked an attacker could easily compromise the cluster.

Defaults to null which means generate a secure secret on startup.


### controller.heartbeat_interval

Interval in seconds heartbeats are sent out at for WebSocket connections.
If a WebSocket connection hasn't received a heartbeat in 2 times the heartbeat interval it will be considered stale and closed.
A lower value means less time between connections going stale and them being closed.

Defaults to 15.


### controller.session_timeout

Time in seconds from the connection is closed following a heartbeat timeout until the session is invalidated and data loss occurs.
A higher timeout gives more time for a client to recconect and resume an active session over a connection that was dropped, but also leads to stale connections taking longer to clear out.
In the case of the controller or client crashing the data loss is unavoidable.

Value should not be less than the configured `max_reconnect_delay` of the clients and it should be greater than 2 times `controller.heartbeat_interval`.
Defaults to 60.


### controller.metrics_timeout

Timeout in seconds before a call to gather metrics from a host times out.
This should be less than both the timeout and collection interval configured for the collection job in Prometheus.

Defaults to 8.


### controller.stream_timeout

Timeout in seconds for proxy streams through the controller that has been created but is not yet sending data to be automatically closed.
Streams that have started sending data before this timeout is not affected.

Defaults to 15.


### controller.default_role_id

Role to automatically grant to new users.
If null no role is granted.

Defaults to 1 which correspond to the default Player role.


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

Defaults to a random 31 bit number.


### host.factorio_directory

Directory to look for the Factorio server(s) in.
This can either point to a Factorio server directory, or to a directory containing multiple versions of the Factorio server.

Defaults to "factorio".


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

Defaults to "enter token here".


### host.tls_ca

Path to certificate in PEM format to use for validating a TLS connection to the controller.
If you have a self signed certificate on the controller you will need to copy the certificate to your hosts and set it as the certificate authority with this option.

Defaults to null meaning use Node.js's default set of trusted certificate authorities.


### host.public_address

External address instances hosted on this host can be accessed on.
This is used by plugins like Server Select to give the correct address to switch between instances in-game.

Defaults to "localhost".


### host.max_reconnect_delay

Maximum delay in seconds to wait after connection to the controller is dropped before attempting to reconnect to it.
The actual delay on each reconnect will be a random number between 0 and this configured value to avoid all clients trying to reconnect at the same time.

Defaults to 60.


## Instance Configuration

### instance.name

Name of the instance, shown in instance lists and used to reference to this instance in the clusterioctl command line interface.

Defaults to "New Instance".


### instance.id

Imutable numeric id of the instance which uniquely identifies this instance in the cluster.

Defaluts to a random 31 bit integer.


### instance.assigned_host

Host this instance is assigned to.
To change this you need to use the separate assign instance interface.
After being assigned to a host the directory for the instance is created on the host.

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
Can be a version like "1.0.0" or special string "latest" meaning the latest version of Factorio found on the host.

Defaults to "latest".


### factorio.game_port

UDP port to run the Factorio server on.
If null a random port in the dynamyc range assigned each time the instance starts.

Defaults to null.


### factorio.rcon_port

TCP port to start the RCON interface on the Factorio server on.
If null a random port in the dynamic range is assigned each time the instance starts.

Defaults to null.


### factorio.rcon_password

Password to use for the RCON interafec.
If null a random secure password is generated and used each time the instance starts.

Defaults to null.


### player_online_autosave_slots

Keeps a separate pool for autosaves where at least on player has been online since the previous autosave was done.
This requires regular autosaving to be enabled and will rename autosaves to `_autosave_poN.zip` (where N is a slot number) whenever a player has been online for that save.
The slot numbers start at 1, are incremented by 1 after each autosave that is renamed and reset back to 1 whenever this value is exceeded.
Note that this value should be set to a higher value than the value of `autosave_slots` in `factorio.settings`.
Useful for preventing the loss of all progress when nobody is around on always online servers with auto pause disabled.

If 0 no autosave renaming takes place.

Defaults to 5.


### factorio.enable_save_patching

Whether to use save patching or not.
When enabled lua code is patched into the game save before starting it.
Most plugins require the use of save patching to function.
Turning it off makes it possible to use Clusterio to run and manage regular vanilla games and scenarios not compatible with Clusterio.

Defaults to true.


### factorio.enable_whitelist

Turn on the whitelist on the server.

Defaults to false.


### factorio.settings

Object with the settings to put into `server-settings.json` for the Factorio server.
The settings in `data/server-settings.example.json` of the Factorio installation is used as the base and properties specified here overrides the properties there.

Changes to the following properties will be applied live if the instance is running while it is changed: `afk_autokick_interval`, `allow_commands`, `autosave_interval`, `autosave_only_on_server`, `description`, `ignore_player_limit_for_returning_players`, `max_players`, `max_upload_slots`, `max_upload_in_kilobytes_per_second`, `name`, `only_admins_can_pause_the_game`, `game_password`, `require_user_verification`, `tags`, `visibility`.

Defaults to {"tags":["clusterio"],"auto_pause":false}.


### factorio.verbose_logging

Pass the `--verbose` flag to Factorio when starting the server.
This prints more messages to the log.

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
If enabled Clusterio will generate a new `server-adminlist.json` on instance startup based on the users in the cluster with admin status set to true, and keep the admins in sync with the users that have admin status while the instance is running.

Defaults to true.


### factorio.sync_whitelist

Synchronize in-game whitelist with the whitelisted status of the users in the cluster.
If enabled Clusterio will generate a new `server-whitelist.json` on instance startup based on the users in the cluster with whitelisted status set to true, and keep the whitelisted users in sync with the users that have whitelisted status while the instance in running.

Defaults to true.


### factorio.sync_banlist

Synchronize in-game banlist with the banned status of users in the cluster.
If enabled Clusterio will generate a new `server-banlist.json` on instance startup based on users in the cluster with banned status set to true, and keep the banned users in sync with the users that have the banned status while the instance is running.

Defaults to true.


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

Defaults to 5.


### <plugin_name>.load_plugin

Whether to load the given plugin on the instance.
Note that plugins need to be loaded on the controller in order for them to be loaded on instances.

Defaults to true.


## Control Configuration

### control.controller_url

URL to connect to the controller to.

Defaults to null meaning complain about it not being set and exit.


### control.controller_token

Access token used for authenticating with the controller.
You can generate an access token with `clusteriocontroller bootstrap generate-user-token <username>`, or use the `clusteriocontroller bootstrap create-ctl-config <username>` to create a new ctl config with the correct url and token in it.

Defaults to null meaning complain about it not being set and exit.


### control.tls_ca

Path to certificate in PEM format to use for validating a TLS connection to the controller.
If you have a self signed certificate on the controller you will need to copy the certificate to the computer you run clusterctl from and set it as the certificate authority with this option.

Defaults to null meaning use Node.js's default set of trusted certificate authorities.


### control.max_reconnect_delay

Max duration in seconds to wait before attempting to reconnect with the controller after the connection is dropped.
The actual delay on each reconnect will be a random number between 0 and this configured value to avoid all clients trying to reconnect at the same time.

Defaults to 60.
