Changelog
=========

Version 2.0.0
-------------

### Major Features

- Replaced Hotpatch with save patching.  Removed the Hotpatch scenario and
  the depency on it for getting code into the game.  Added a save patcher than
  runs before starting up Factorio that patches in lua modules based on the
  event_loader lib into the savegame.  Regular freeplay games can now be
  used with Clusterio and will be compatible without having to convert them
  to Hotpatch.
- Daemonized slaves.  Slaves now have the ability to run multiple Factorio
  instances, starting and stopping them individually.  To manage this the
  local command line interface has been replaced with a remote interface on
  the master server that can be accessed through the clusterctl cli tool.
- Rewritten the communication between slaves and the master from scratch.  The
  new system is based on a WebSocket connection between the slaves and the
  master server and provides efficient validated bi-directonal communication.
- Rewritten the plugin system from scratch.  Plugins now inherit from
  a base class and use the same WebSocket connection Clusterio uses to
  communicate.
- New configuration system with support for initializing configs when needed,
  modifying config entries using built-in commands, and updating instance
  configuration remotely.

### Features

- Added export of pollution statitics.

### Changes

- Fixed sslCert and sslPrivKey entries being ignored in the config.
- Changed ssl key creation to be done at startup instead of on npm install.
- Added error handling during master startup.
- Factorio game and rcon port now defaults to a random port above 49151.
- Removed unimplemented mods update command.
- Fixed rcon password being generated with Math.random().
- Added plugins directory to the views path.  This makes it possible for
  plugins to render their own ejs views or pages in their own folders by
  using paths of the format "pluginName/path/to/page-or-view".
- Replaced the per instance copy of the shared Factorio mods with
  symlinks.  On Windows hard links are used instead due to the
  privileges requirements of symlinks.
- Changed the per instance scenario folder to be linked instead of
  copied on instance creation.
- Instance id is no longer derived from the rcon password, instead it's
  generated upon instance creation and stored in the instance config.
- The game port, RCON port and RCON password instance config entries are are
  now null by default, indicating that a random one will be generated every
  time the instance is started.
- Removed the broken client download command as this would download
  pre-releases.
- Moved the item database and HTTP definitions for /api/place, /api/remove,
  /api/inventory, /api/inventoryAsObject and the web interface view for the
  storage page into the clusterioMod plugin.  If you disable this plugin
  then these things will not be available.
- Removed undocumented --port and --rcon-port arguments to client.
- Removed undocumented FACTORIOPORT and RCONPORT enviroment variable
  handling in client.
- Removed redundant call to /api/slaves in globalChat plugin.
- Removed broken serverManager plugin.
- Removed factorio_version from config.  The version installed is auto
  detected and used instead.
- Removed the playerManager specific command CLI tools/delete_player.js.
- Creating an instance, assigning it to a slave, creating a save for an
  instance and starting an instance is now four separate commands.
- Removed oddball limits to slaves.json size.
- Moved slave specific and instance specific configuration into their own
  configuration files.
- Removed unused binary option from plugin config.
- Removed info and shout command from globalChat plugin
- Removed mirrorAllChat and enableCrossServerShout configuration options for
  globalChat plugin.
- Removed UPSdisplay plugin.  UPS statistics is exported by the statistics
  exporter plugin.
- Master server now defaults to hosting on https on port 8443.

### Breaking Changes

- lib/authenticate no longer requires config to be passed to it.  Breaks
  playerManager.
- The masterIP and masterPort config entries has been merged into masterURL.
  Breaks discordChat, playerManager, serverSelect, trainTeleports and
  clusterioModel.
- Instance names can no longer be invalid Windows file names.
- Removed config management from the command line and the server manager.
- Moved ejs templates into views folder and changed their extension to
  .ejs.  Breaks playerManager.
- Mods are no longer copied from the per instance instanceMods directory.
  If you need per instance mods you can now place them directly in the mods
  directory inside the instance folder.
- Hotpatch scenarios and code loading is no longer compatible with Clusterio.
  Breaks playerManager, serverSelect, and tranTeleports.
- Removed getLua and getCommand from lib/clusterTools.  If you need to run
  more than the most trivial of code in commands use the save patcher and
  add in a remote interface.
- Removed mod uploading and distributing from the HTTP interface.  Breaks
  the old unmaintained and no longer needed factorioClusterioClient.
- Removed the remoteCommands plugin and the old runCommand interface.  Breaks
  playerManager and external tools sending commands.
- Removed broken serverManager plugin.
- Removed fields info, time, rconPort, rconPassword, serverPort, unique,
  mods, instanceName, playerCount, mac, and meta from the slaves in the
  slave database.
- Removed getInstanceName and lib/clusterTools.  Breaks playerManager,
  and discordChat.
- Removed the /api/rconPasswords, and /api/slaves endpoints.  Breaks web
  interface, trainTeleports, and discordChat.
- Removed the /api/getSlaveMeta and /api/editSlaveMeta endpoints.  Breaks
  researchSync, and UPSdisplay.
- Removed the hello event from the socket connection handshake.  Breaks
  playerManager, trainTeleports, serverSelect, and discordChat
- Changed the format of database/slaves.json.
- Removed the output file subscription system.  Breaks inventoryImports,
  playerManager, trainTeleports, serverSelect and researchSync.
- Removed the factorioOutput hook from instance plugins.  The onOutput
  hook provides parsed output instead.
- Removed the onLoadFinish hook from master plugins.
- Moved plugins from the sharedPlugins directory to plugins directory.
- Implemented a new plugin system that replaces the old.  Breaks all plugins.
- Removed express metric http_request_duration_milliseconds metric.
- Removed socket.io metrics socket_io_connected, socket_io_connect_total,
  socket_io_disconnect_total, socket_io_events_received_total,
  socket_io_events_sent_total, socket_io_recieve_bytes, and
  socket_io_transmit_bytes,
- Removed clusterio_connected_instaces_gauge and added
  clusterio_master_connected_clients_count in its place.
- Renamed clusterio_player_count_gauge to clusterio_instance_player_count
- Removed clusterio_UPS_gauge and added clusterio_instance_game_ticks_total in
  its place.
- Renamed clusterio_endpoint_hit_gauge to clusterio_http_enpoint_hits_total
- Renamed clusterio_statistics_gauge to clusterio_instance_force_flows
- Removed clusterioMod plugin specific config options logItemTransfers,
  disableFairItemDistribution useNeuralNetDoleDivider, autosaveInterval, and
  disableImportsOfEverythingExceptElectricity from the master config.
- Removed msBetweenCommands config option.  The RCON is instead limited to 5
  concurrent commands.
- Removed allowRemoteCommandExecution config option.  Remote commands are
  always allowed with the move to master managing slaves/instances.
- Removed `--databaseDirectory`, `--masterPort`, and `--sslPort` command line
  arguments from the master server.
- Implemented a new config system that replaces the old.  Breaks all plugins.
- Removed usage of socket.io entirely in favor of a plain WebSocket connection.


Version 1.2.4
-------------

- Removed broken remote combinator signaling.
- Fixed research sync endlessly updating already researched technologies
- Removed obsolete item/fluid statistics from clusterioMod
- Removed per mod upload logging when config.uploadModsToMaster disabled
- Fixed bcrypt failing to install on windows due to the new version not
  having Windows binaries.


Version 1.2.3
-------------

- Disabled uploading mods to the master server by default as this is mostly
  just a waste of bandwidth with the mod portal being integrated into the
  game now.
- Fixed researchSync breaking with heavily modded games due to the tech tree
  exceeding the default 100kb limit on JSON payloads.
- Fixed the command inventoryImport sends referencing player instead of
  character, and trying to count the non-existant quick bar slots.
- Fixed inventoryImport never receiving the script output after the default
  mode for reading script output changed to tail mode.
- Fixed desync caused by the mods and loaded mods arrays in Hotpatch getting
  out of sync when plugins update their scenario mod code.  To fix existing
  games you will need copy lib/scenarios/Hotpatch/hotpatch/mod-tools.lua
  over the existing mod-tools.lua in the save's hotpatch folder.
- Updated the Windows install instructions.


Version 1.2.2
-------------

- Fixed possible crash with modded technologies named the same as a built-in
  Object prototype property in researchSync.
- Fixed progress of a current infinite tech carrying over to the next one
  when researching it and another node completes it in researchSync.
- Fixed progress of a previous infinite tech from another node being applied
  to the current one in researchSync.
- Fixed crash in researchSync when modded technologies are present only on some
  nodes.
- Fixed install failing due to bcrypt version less than 3 not being supported
  on node v10.
- Reordered install instructions to avoid problem with npm creating files owned
  by root in the home directory.
- Swapped curl out with wget in the install instructions as the latter comes
  pre-installed on Ubuntu.

### Breaking Changes

- Node.js versions below 10 are no longer supported.


Version 1.2.1
-------------

- Updated node-factorio-api to v0.3.8 to fix mod downloads randomly breaking
  ([#229][#229].)
- Fixed SIGINT being sent twice to Factorio server when interrupted by CTRL+C
  on Linux ([#217][#217].)
- Fixed package.json incorrectly reporting the license as ISC.

[#217]: https://github.com/clusterio/factorioClusterio/issues/217
[#229]: https://github.com/clusterio/factorioClusterio/issues/229

### Breaking Changes

- Added authentication to the socket.io server running on the master.
