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
- Added instanceName entry to the config passed to instance plugins.
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
