Changelog
=========

Version 2.0.0
-------------

- Fixed sslCert and sslPrivKey entries being ignored in the config.
- Changed ssl key creation to be done at startup instead of on npm install.
- Added error handling during master startup.
- Factorio game and rcon port now defaults to a random port above 49151.
- Removed unimplemented mods update command.
- Fixed rcon password being generated with Math.random().
- Added plugins directory to the views path.  This makes it possible for
  plugins to render their own ejs views or pages in their own folders by
  using paths of the format "pluginName/path/to/page-or-view".

### Breaking Changes

- Node.js versions below 10 are no longer supported.
- lib/authenticate no longer requires config to be passed to it.  Breaks
  playerManager.
- The masterIP and masterPort config entries has been merged into masterURL.
  Breaks discordChat, playerManager, serverSelect, trainTeleports and
  clusterioModel.
- Instance names can no longer be invalid Windows file names.
- Removed config management from the command line and the server manager.
- Moved ejs templates into views folder and changed their extension to
  .ejs.  Breaks playerManager.


Version 1.2.2
-------------

- Fixed possible crash with modded technologies named the same as a built-in
  Object prototype property in researchSync.
- Fixed progress of a current infinite tech carrying over to the next one
  when researching it and another node completes it in researchSync.
- Fixed progress of a previous infinite tech from another node being applied
  to the current one in researchSync.


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
