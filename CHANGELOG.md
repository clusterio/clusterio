Changelog
=========

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
