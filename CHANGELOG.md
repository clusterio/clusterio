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

### Breaking Changes

- Node.js versions below 10 are no longer supported.
- lib/authenticate no longer requires config to be passed to it.  Breaks
  playerManager.
- The masterIP and masterPort config entries has been merged into masterURL.
  Breaks discordChat, playerManager, serverSelect, trainTeleports and
  clusterioModel.
- Instance names can no longer be invalid Windows file names.


Version 1.2.1
-------------

### Breaking Changes

- Added authentication to the socket.io server running on the master.
