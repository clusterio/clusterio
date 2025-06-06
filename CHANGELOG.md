# Changelog

<!-- Template for entries. Add sections that apply as changes are made.
## Version 2.0.0-alpha.xx

### Major Features

- Major additions and/or major improvements to managing clusters.

### Features

- New features added.

### Changes

- Small changes to existing behaviour.

### Fixes

- Bugfixes

### Breaking Changes

- Changes which break backwards compatibility with older hosts or plugins code.

### Meta

- Changes to the project activities / structure worth highlighting but have no impact on the published package.

Many thanks to the following for contributing to this release:  
[@username](https://github.com/username)
-->

## Version 2.0.0-alpha.21

### Major Features

- Added import, export, and restore of user lists (bans / admins / whitelist / combined). [#717](https://github.com/clusterio/clusterio/issues/717)
- Added remote update for core packages and third party plugins. [#761](https://github.com/clusterio/clusterio/issues/761)
- Added config cloning on instance creation. [#720](https://github.com/clusterio/clusterio/issues/720)

### Features

- Added social links and instructions to error page. [#742](https://github.com/clusterio/clusterio/issues/742)
- Added button to download control config. [#740](https://github.com/clusterio/clusterio/issues/740)
- Added server action filter (aka "chat filter") to instance log in web ui. [#744](https://github.com/clusterio/clusterio/issues/744)
- Added `factorio.console_logging` to enable dedicated console log file for servers. [#748](https://github.com/clusterio/clusterio/issues/748)
- Added a recovery mode to host and controller accessible as an option on the run command. [#752](https://github.com/clusterio/clusterio/issues/752)
- Added username search to the users list. [#751](https://github.com/clusterio/clusterio/issues/751)
- Added log level filtering to the web ui. [#745](https://github.com/clusterio/clusterio/issues/745)
- Added pending update detection for host and controller. [#758](https://github.com/clusterio/clusterio/issues/758)
- Added restart required indicator for host and controller. [#758](https://github.com/clusterio/clusterio/issues/758)
- Added version mismatch indicator in host list. [#758](https://github.com/clusterio/clusterio/issues/758)
- Added host plugin list command to crl where previously only controller plugin list existed. [#760](https://github.com/clusterio/clusterio/issues/760)
- Added optional feature which allows new plugins to be installed remotely.
- Added bidirectional whitelist syncing. [#716](https://github.com/clusterio/clusterio/issues/716)
- Added support for v2 map exchange strings. [#700](https://github.com/clusterio/clusterio/issues/700)

### Fixes

- Fixed handling of zip files with multiple top-level folders. [#739](https://github.com/clusterio/clusterio/issues/739)
- Fixed looping between instances of ban and admin sync events. [#736](https://github.com/clusterio/clusterio/issues/736)
- Fixed quality being stripped from power armour equipment when moving between servers [#753](https://github.com/clusterio/clusterio/pull/753)
- Resolved webpack type export warnings [#750](https://github.com/clusterio/clusterio/pull/750)
- Reduce page load time on users list by enabling pagination. [#718](https://github.com/clusterio/clusterio/issues/718)
- Corrected stack trace and enabled source mapping during bootstrap. [#764](https://github.com/clusterio/clusterio/pull/764)
- Fixed map gen settings using the incorrect name for cliff settings following exchange string decode.

### Meta

- Silent testing is now truly silent. [#764](https://github.com/clusterio/clusterio/pull/764)
- Node 18 has reached end of life and is no longer maintained, we no longer guarantee support for it.
- CI testing now runs on node 20 & 22 as well as factorio 1.1.110 & 2.0.47.

Many thanks to the following for contributing to this release:  
[@Cooldude2606](https://github.com/Cooldude2606)
[@Danielv123](https://github.com/Danielv123)
[@Hornwitser](https://github.com/Hornwitser)

## Version 2.0.0-alpha.20

### Features

- Update subspace storage to 2.0 and space age. [#733](https://github.com/clusterio/clusterio/pull/733)
- A fresh install of Clusterio will include default mod packs. [#719](https://github.com/clusterio/clusterio/issues/719)

### Fixes

- Fix crash when leaving a server without a logistic requester point [#731](https://github.com/clusterio/clusterio/pull/731)
- Use floor instead of round to prevent "1 minute and 60 seconds" being shown [#723](https://github.com/clusterio/clusterio/issues/723)
- Fixed production statistics overwriting consumption statistics and vise versa [#734](https://github.com/clusterio/clusterio/pulls/734)
- Hot patch to add the updated 2.0.29 control.lua freeplay hash to know scenarios. [commit](https://github.com/clusterio/clusterio/commit/26269df7d4d8f39042c59653008bc8f034a4f3b4)

### Meta

- We have now introduced a new [decisions log](https://github.com/clusterio/clusterio/blob/master/docs/decisions.md) to aid tracking all the technical and design decisions we make and their reasons. [#714](https://github.com/clusterio/clusterio/pull/714)

Many thanks to the following for contributing to this release:  
[@Cooldude2606](https://github.com/Cooldude2606)
[@Danielv123](https://github.com/Danielv123)
[@psihius](https://github.com/psihius)

## Version 2.0.0-alpha.19

### Major Features

- Added support for 2.0 builtin mods during mod pack creation. [#684](https://github.com/clusterio/clusterio/pull/684)
- Added basic 2.0 support to clusterio lua api and 1st party plugins. [#685](https://github.com/clusterio/clusterio/pull/685)

### Features

- Added Datastore and Datastore Provider classes to the library to support savable Maps. [#629](https://github.com/clusterio/clusterio/pull/629)
- Added clean script to speed up publishing and debugging of build steps. [#640](https://github.com/clusterio/clusterio/pull/640)
- Added sub-tile option on plugin page headers. [#642](https://github.com/clusterio/clusterio/pull/642)
- Greatly improved plugin and module template generation. [#641](https://github.com/clusterio/clusterio/pull/641)
- Duplicate host connections from the same address will kill the older host process. [#647](https://github.com/clusterio/clusterio/pull/647)
- Controller will refuse duplicate host connections from different addresses. [#647](https://github.com/clusterio/clusterio/pull/647)
- Monorepos are now supported for external plugins. [#654](https://github.com/clusterio/clusterio/pull/654)
- Changed default role selection to be a dropdown menu rather than id. [#664](https://github.com/clusterio/clusterio/pull/664)
- Added credential option to config entries to allow writing sensitive data that can't be read back remotely.
- Allow hidden and readonly graphical representations of config values. [#665](https://github.com/clusterio/clusterio/pull/665)
- Added locale exporting for all builtin mods, not just for the base mod. [#684](https://github.com/clusterio/clusterio/pull/684)
- Added option for silent testing which only shows the results, can be ran using `pnpm silent-test` [#680](https://github.com/clusterio/clusterio/pull/680)
- Added prompt for http port on installation of Clusterio. [#564](https://github.com/clusterio/clusterio/issues/564)
- Added drag and drop overlay to upload button on mods page and save table on instance page. [#591](https://github.com/clusterio/clusterio/issues/591)
- Automatically add plugins from ./plugins, ./external_plugins and installed npm modules. [#692](https://github.com/clusterio/clusterio/pull/692)
- `compat.table_to_json` and `compat.json_to_table` supported in all stages in pre 2.0 [#687](https://github.com/clusterio/clusterio/issues/687)
- Add "connect to server" button to web interface, launches with steam api. [#608](https://github.com/clusterio/clusterio/issues/608)
- Add space platform name mapping to space platform statistics. [#706](https://github.com/clusterio/clusterio/pull/706)
- Track space platform speed metric clusterio_statistics_exporter_platform_speed. [#706](https://github.com/clusterio/clusterio/pull/706)
- Track space platform weight metric clusterio_statistics_exporter_platform_weight. [#706](https://github.com/clusterio/clusterio/pull/706)
- Added bidirectional sync to admin and ban list. [#709](https://github.com/clusterio/clusterio/pull/709)

### Fixes

- Fixed IPC errors reporting undefined when no stack trace was present. [#624](https://github.com/clusterio/clusterio/pull/624)
- Fixed loopback routing for instances reporting the wrong error message. [#625](https://github.com/clusterio/clusterio/pull/625)
- Fixed docs linking to non-existing js files after ts migration. [#633](https://github.com/clusterio/clusterio/pull/633)
- Fixed CI workflows using deprecated version of nodejs. [#637](https://github.com/clusterio/clusterio/pull/637)
- Fixed linux only tests to run on windows. [#661](https://github.com/clusterio/clusterio/pull/661)
- Fixed log events being sent from a host over an invalid websocket. [#639](https://github.com/clusterio/clusterio/pull/639)
- Fixed spaces passed in arguments to the installer causing it to break. [#620](https://github.com/clusterio/clusterio/issues/620)
- Fixed numeric admin name breaking login. [#536](https://github.com/clusterio/clusterio/issues/536)
- Fixed issues with subscriptions which prevented them from working on instances or generic events. [#655](https://github.com/clusterio/clusterio/pull/655).
- Fixed unreliable datastore tests. [#662](https://github.com/clusterio/clusterio/pull/662).
- Fixed 2.0 version extraction from linux headless. downloaded during installation of clusterio. [#671](https://github.com/clusterio/clusterio/pull/671)
- Fixed invalid transient state during server start. [#676](https://github.com/clusterio/clusterio/issues/676)
- Fixed host user sync to instances after reconnecting to the. controller. [#678](https://github.com/clusterio/clusterio/pull/678)
- Fixed WebUI adding and displaying the wrong base mod version. [#684](https://github.com/clusterio/clusterio/pull/684)
- Fixed WebUI inconsistent pattern matching for factorio version. [#684](https://github.com/clusterio/clusterio/pull/684)
- Fixed `safeOutputFile` not being atomic because of a missing path separator. [#659](https://github.com/clusterio/clusterio/pull/659)
- Fixed built-in mods showing as missing in the WebUI. [#581](https://github.com/clusterio/clusterio/issues/581)
- Fixed dirty flag not being set when only the config of an instance is updated. [#675](https://github.com/clusterio/clusterio/pull/675)
- Fixed incorrect command being used to remove players from the whitelist. [#679](https://github.com/clusterio/clusterio/pull/679)
- Fixed CI following undocumented breaking change from downstream dependency. [#683](https://github.com/clusterio/clusterio/pull/683)
- Fixed instance crash when missing saves folder. [#698](https://github.com/clusterio/clusterio/issues/698)
- Fixed statistics exporter not working on newer versions of windows 11 due to wmic deprecation. [#707](https://github.com/clusterio/clusterio/issues/707)

### Changes

- Added prompt for the HTTP port to host the controller to the installer. [#619](https://github.com/clusterio/clusterio/pull/619)
- Added tests for sendEvent and sendRequest throwing the correct error messages. [#638](https://github.com/clusterio/clusterio/pull/638)
- Updated all web ui pages to use correct page header component. [#643](https://github.com/clusterio/clusterio/pull/643)
- Bumped Typescript version to 5.5 and implemented `${configDir}` in base configs for "outDir". [#648](https://github.com/clusterio/clusterio/pull/648).
- Added factorio.executable_path option which allows overriding the default path to the Factorio executable run.
- Added instance version display. [#573](https://github.com/clusterio/clusterio/pull/573)
- Added `factorio.shutdown_timeout` config to set the time the host will wait for a Factorio server to shut down befor killing it.
- Changed shutdown logic to prefer sending a /quit command via RCON instead of using diverging logic on Windows and Linux.
- Added `controller.factorio_username` and `controller.factorio_token` config to set Factorio credentials used for the whole cluster.
- Added `controller.share_factorio_credential_with_hosts` config to optionally require hosts to provide their own credentials.
- Added `host.factorio_username` and `host.factorio_token` config to set Factorio credentials used on a given host.
- Changed `instance.rcon_password` config to be a credential field that can not be read by the control interface.
- Changed `host.id` `instance.id` and `instance.assign_host` config to be hidden fields that can not be seen on the web ui.
- Updated display name and description of `controller.external_address` to avoid confusion. [#674](https://github.com/clusterio/clusterio/pull/674)
- Renamed config value `controller.external_address` to `controller.public_url`, migrations are applied automatically.
- String config values with whitelisted values (enum) now display as a selection dropdown. [#701](https://github.com/clusterio/clusterio/pull/701)
- Existing selection dropdowns now support search filtering. [#701](https://github.com/clusterio/clusterio/pull/701)
- Added surface label to clusterio_statistics_exporter_instance_force_flow_statistics. [#691](https://github.com/clusterio/clusterio/issues/691)
- Compat lib now supports versions from 0.17 to 2.0 [#711](https://github.com/clusterio/clusterio/pull/711)
- Add bidirectional sync to admin and ban list. [#709](https://github.com/clusterio/clusterio/pull/709)

### Breaking Changes

- Previously silent errors for controller.sendEvent now throw exceptions [#625](https://github.com/clusterio/clusterio/pull/625).
- @clusterio/controller export InstanceInfo has added factorioVersion parameter.
- Argument order for `Config.canAccess` changed to require an access mode passed as the second argument.
- Instances can now have `factorio.enable_script_commands` disabled which will throw an error when any script command is used over rcon. [#681](https://github.com/clusterio/clusterio/pull/681).
- User IDs are now case insensitive, duplicate users will be automatically merged with a backup created. [#682](https://github.com/clusterio/clusterio/pull/682)
- Plugins now require the keyword "clusterio-plugin" in package.json to be automatically loaded [#692](https://github.com/clusterio/clusterio/pull/692)

Many thanks to the following for contributing to this release:  
[@CCpersonguy](https://github.com/CCpersonguy)
[@Cooldude2606](https://github.com/Cooldude2606)
[@Danielv123](https://github.com/Danielv123)
[@Hornwitser](https://github.com/Hornwitser)
[@Laar](https://github.com/Laar)
[@psihius](https://github.com/psihius)


## Version 2.0.0-alpha.18

### Features

- Added logging of HTTP requests and errors on the controller [#556](https://github.com/clusterio/clusterio/pull/556).
- Added caching of data parsed from mods to speed up startup time [#606](https://github.com/clusterio/clusterio/pull/606).
- Added command to installer to generate the code for making a new plugin [#570](https://github.com/clusterio/clusterio/pull/570).

### Changes

- Fixed Inventory Sync reporting a negative database size [#598](https://github.com/clusterio/clusterio/pull/598).
- Fixed plugin events being invoked while a host connection was in an invalid state.
- Suppresed bogus warning about event listener leak in the browser's console [#600](https://github.com/clusterio/clusterio/pull/600).
- Fixed installer breaking on Windows after Node.js released a security fix [#614](https://github.com/clusterio/clusterio/pull/614).
- During a data export the mod settings in mod packs will now be corrected to the type of the settings prototype if the type is incorrect.
- Fixed missing color setting causing the Mod Pack view in the Web UI to show an error [#609](https://github.com/clusterio/clusterio/issues/609).

Many thanks to the following for contributing to this release:  
[@Cooldude2606](https://github.com/Cooldude2606)
[@Danielv123](https://github.com/Danielv123)
[@Hornwitser](https://github.com/Hornwitser)


## Version 2.0.0-alpha.17

### Features

- Made the host an instance is assigned to link to the host page for that host in the Web UI [#587](https://github.com/clusterio/clusterio/pull/587).
- Added pagination to the saves list.

### Changes

- Fixed an unhandled error in Subspace Storage crashing the host.
- Fixed an unhandled rejection in disconnect logic crashing the host.
- Fixed instance screen in Web UI not updating when an instance was reassigned.
- Fixed an error thrown in the rendering of one page in the Web UI causing all pages to become inaccessible.
- Fixed Web UI not showing instance saves when the permission to list and subscribe the saves is granted but the user is not a cluster admin.
- Similarly fixed Web UI not showing the mod pack create, delete, list and host revoke token actions if the user is not a cluster admin.
- Fixed Research Sync applying progress of a previous techology level to the level on the controller when it's the active research during instance startup.
- Fixed data export with a mod using shorthand notation for the default value of a color-setting causing the ModPack data to be set to invalid data.
- Fixed per user per instance player stats not being deleted when the instance it's for is deleted.
- Fixed mods setting the item prototype icons property to an object mapping instead of an array breaking the data export.
- Fixed a bad mod in the host's mods folder causing instance start to fail instead of the host re-downloading the mod.

### Breaking Changes

- Renamed the permission `core.instance.save.list.subscribe` to `core.instance.save.subscribe`.

Many thanks to the following for contributing to this release:  
[@Cooldude2606](https://github.com/Cooldude2606)
[@Danielv123](https://github.com/Danielv123)
[@Hornwitser](https://github.com/Hornwitser)


## Version 2.0.0-alpha.16

### Changes

- Fixed message sequences not being renumbered when forwarded between links causing reconnects to send duplicated messages.


## Version 2.0.0-alpha.15

### Features

- Added support for `color-settings` Mod settings [#568](https://github.com/clusterio/clusterio/issues/568).
- Added `clusterio_controller_pending_requests` and `clusterio_host_pending_requests` metrics.

### Changes

- Fixed generated systemd file for clusteriohost not enabling source maps.
- Fixed ctl not exporting types used for adding commands to ctl plugins.
- Fixed controller only plugins throwing an error about missing a config field on startup out when added to hosts.
- Fixed installer incorrectly claiming the options --factorio-dir and --no-download-headless conflicts with each other.
- Fixed a memory leak on every request sent over the WebSocket.
- Fixed assertion error on closing or invalidating a link with messages forwarded from a virtual link.
- Fixed host hanging if stopped while an instance is in the process of creating a save during startup.
- Fixed `instance.auto_start` option.
- Fixed host log spammed with errors when plugins broadcast messages to instances with the plugin disabled.
- Fixed properties of object config fields not being possible to remove.


## Version 2.0.0-alpha.14

This release does not retain backwards compatibility with 2.0.0-alpha.13 meaning all parts of the cluster needs to updated at the same time.
See the [migration guide](/docs/migrating-from-2.0.0-alpha.13.md) for how to update.

### Major Features

- Added mod management. Mods can be uploaded to the controller and included in mod packs that can be assigned to instances and run.
- Added host port ranges which the instance ports will be automatically assigned a port from if factorio.game_port is not set.
- Added system info such as CPU model, hostname and kernel along with basic metrics for CPU usage, memory usage and disk usage for the controller and hosts.
- Added ability to remotely view and modify the configuration of hosts.

### Features

- Added logging of Clusterio version on startup
- Added `clusterio_controller_log_bytes` metric counting the size of the log files on the controller.
- Added warning logged when plugins on a connecting host does not match the ones installed on the controller.
- Added ability to revoke user tokens.
- Added restart required indicator to config fields in the Web UI.
- Added ability to revoke host tokens.
- Added support for plugins to run in the context of a host.
- Added more feedback when the web UI and or its plugins fails to load.
- Added autosaving of data held in memory on the controller such as configs, instances, users, mods to prevent large data loss on crashing.
- Added `system_info` metric with kernel, instruction set, CPU Model, hostname and Node.js version of the controller.
- Added `clusterio_host_system_info` metric with kernel, instruction set, CPU Model, hostname and Node.js version of hosts.
- Added `system_cpu_seconds_total`, `system_cpu_idle_seconds_total`, `system_memory_capacity_bytes`, `system_memory_available_bytes`, `system_disk_capacity_bytes`, `system_disk_available_bytes` metrics for CPU, memory and disk usage on the controller.
- Added `clusterio_host_system_cpu_seconds_total`, `clusterio_host_system_cpu_idle_seconds_total`, `clusterio_host_system_memory_capacity_bytes`, `clusterio_host_system_memory_available_bytes`, `clusterio_host_system_disk_capacity_bytes`, `clusterio_host_system_disk_available_bytes` metrics for CPU, memory and disk usage on hosts.
- Added support for reading the client's IP address from the `X-Forwarded-For` header when the source address is in the `controller.trusted_proxies` config option.
- Added field showing the IP address a host is connecting from.
- Added per player statistic tracking when they were first seen joining a particular server.
- Added ability to remotely restart and/or stop the controller and hosts.

### Changes

- Fixed filenames with extensions that are invalid on Windows such as "con.zip" not being treated as invalid.
- Fixed generate host token modal not using a random id when the optional id field is unset.
- Exported Factorio data is now tied to mod packs instead of being per cluster.
- Fixed export failing if a mod uses a different root folder mod_version in its zip file.
- Fixed sorting of user last seen column in the Web UI.
- The list users permission is now granted by default to players.
- Fixed incorrect handling of hosts and instance with an id of 0 causing them to not update properly.
- Fixed unable to unassign instances in the Web UI.
- Fixed host crashing if the Factorio server is not marked executable.
- Fixed errors logged from instance not being attributed to the instance in certain situations.
- Hosts no longer print messages from instances into their console.
- Clusterio now treat unhandled Node.js errors and promise rejections as fatal and exit immediately.
- Fixed a potential for data loss after a hard system crash due to fsync not being called on files written.
- Fixed Factorio server crashing in the research_sync plugin when a mod enables a previously disabled technology and a player attempts to research it.
- Fixed Factorio server crashing when the game starts with tick_paused = true
- Removed migration of alpha 10's single file log format.
- Log errors linking mods on Windows instead of preventing startup.
- Added locale support for modules patched into to the game save.
- Added support for defining a module_exports.lua file for modules patched into the game save.
- Fixed controller logs being split on server's local time day boundary instead of UTC day boundary.
- Fixed Unicode BOM in mod locale files breaking instance data export.
- Added a warning to the server-setting.json that is automatically written to instance folders stating changes will be overwritten.
- Changed save patching to use a `.tmp.zip` extension for the temporary file created instead of `zip.tmp`.
- Fixed Inventory Sync wiping the player's inventory when logging out while in the Space Exploration remote view mode.
- Fixed the public /api/plugins endponit leaking filesystem paths on the controller.
- Refactored list subscriptions in the Web UI to cache and only fetch updated entries when navigating to previously seen list.
- Added caching of save lists on the controller, enabling the saves of instances on offline hosts to still be seen.
- Hosts in the assign instance dropdown is now sorted by name.
- Added `non_blocking_saving` as one of the default settings added to `factorio.settings` on new instances.

### Breaking Changes

- Renamed usage of the terms master and slave to controller and host in all places they occur.
- Mods located in `sharedMods` are no longer copied to instances' mods folder.
- The instances' mods folder is now managed through mod packs, mods not part of the mod pack will be automatically deleted.
- Removed ability to import sub packages like `@clusterio/lib/link` from.
- Replaced `clusterio_controller_http_hits_total` metric with `clusterio_controller_http_endpoint_duration_seconds`.
- Replaced `clusterio_controller_last_query_log_duration_seconds` metric with `clusterio_controller_query_log_duration_seconds` summary.
- Reworked the network protocol to be simpler to work and reason with.
- Bumped minimum supported Node.js version to v18.
- Ported the codebase to TypeScript
- Changed the config format stored on disk to be much simpler.

### Contributors

Many thanks to the following for contributing code in this release:  
[@Hornwitser](https://github.com/Hornwitser) [@Luciole0x](https://github.com/Luciole0x) [@Cooldude2606](https://github.com/Cooldude2606) [@Danielv123](https://github.com/Danielv123) [@Reavershark](https://github.com/Reavershark) [@Laar](https://github.com/Laar) [@rstrom1763](https://github.com/rstrom1763)

## Version 2.0.0

### Major Features

- Replaced Hotpatch with save patching.
  Removed the Hotpatch scenario and the depency on it for getting code into the game.
  Added a save patcher than runs before starting up Factorio that patches in lua modules based on the event_loader lib into the savegame.
  Regular freeplay games can now be used with Clusterio and will be compatible without having to convert them to Hotpatch.
- Daemonized hosts.
  Hosts now have the ability to run multiple Factorio instances, starting and stopping them individually.
  To manage this the local command line interface has been replaced with a remote interface on the controller that can be accessed through the clusterioctl cli tool.
- Rewritten the communication between hosts and the controller from scratch.
  The new system is based on a WebSocket connection between the hosts and the controller and provides efficient validated bi-directonal communication.
- Rewritten the plugin system from scratch.
  Plugins now inherit from a base class and use the same WebSocket connection Clusterio uses to communicate.
- New configuration system with support for initializing configs when needed, modifying config entries using built-in commands, and updating instance configuration remotely.
- Packaged and uploaded to npm again, greatly simplifying distribution and installation of both Clusterio and plugins.
- Added centralized logging for the cluster.
  All logs from both Clusterio and Factorio is stored in a shared log which can be inspected and queried.
- Added remote save management with the ability to list, create, rename, copy, upload, download, transfer, delete and load saves for instances.

### Features

- Added export of pollution statitics.
- Reconnection logic that esures no data is dropped talking to the controller provided the session can be resumed.
- Added support for having multiple Factorio installs and selecting which version to use on a per instance basis.
- Added config to specify which path the controller interface is accessed under, allowing it to be proxied behind web-server.
- Added WebSocket usage statistics.
- Added commands sent statistic.
- Added Factorio server CPU and memory usage statistic.
- Added Factorio autosave size statistic.
- Added support for extracting locale and item icons from Factorio and mods.
- Added integrated user management for controlling access and storing per player data.
- Added synchronization of in-game adminlist, banlist and whitelist to Clusterio core.
  Previously this was handled by the playerManager plugin.
- Added stripping of long paths in the Factorio server log.
- Added option to configure maximum number of commands to send in parallel.
- Added option to auto start instances on host startup.
- Added metric mapping of host and instance ids to their names, allowing them to be displayed by name in queries that join with the mapping.
- Added option to configure timeout for exported Prometheus metrics.
- Added option to set address to bind HTTP(S) port to.
- Added an overview of the installed plugins to the web interface.
- Added clusterioctl command to list plugins on the controller.
- Added Player Auth plugin for logging in to the web interface by proving the ability to log in to a server as a given user.
- Added Node.js based installer to simplify setting up a cluster.

### Changes

- Added error handling during controller startup.
- Factorio game and rcon port now defaults to a random port above 49151.
- Removed unimplemented mods update command.
- Fixed rcon password being generated with Math.random().
- Added plugins directory to the views path.
  This makes it possible for plugins to render their own ejs views or pages in their own folders by using paths of the format "pluginName/path/to/page-or-view".
- Replaced the per instance copy of the shared Factorio mods with symlinks.
  On Windows hard links are used instead due to the privileges requirements of symlinks.
- Changed the per instance scenario folder to be linked instead of copied on instance creation.
- Instance id is no longer derived from the rcon password, instead it's generated upon instance creation and stored in the instance config.
- The game port, RCON port and RCON password instance config entries are are now null by default, indicating that a random one will be generated every time the instance is started.
- Removed the broken client download command as this would download pre-releases.
- Moved the item database and HTTP definitions for /api/place, /api/remove, /api/inventory, /api/inventoryAsObject and the web interface view for the storage page into the clusterioMod plugin.
  If you disable this plugin then these things will not be available.
- Removed undocumented --port and --rcon-port arguments to client.
- Removed undocumented FACTORIOPORT and RCONPORT enviroment variable handling in client.
- Removed redundant call to /api/slaves in globalChat plugin.
- Removed broken serverManager plugin.
- Removed factorio_version from config.
  The version installed is auto detected and used instead.
- Removed the playerManager specific command CLI tools/delete_player.js.
- Creating an instance, assigning it to a host, creating a save for an instance and starting an instance is now four separate commands.
- Removed oddball limits to hosts.json size.
- Moved host specific and instance specific configuration into their own configuration files.
- Removed unused binary option from plugin config.
- Removed info and shout command from globalChat plugin - Removed mirrorAllChat and enableCrossServerShout configuration options for globalChat plugin.
- Removed UPSdisplay plugin.
  UPS statistics is exported by the statistics exporter plugin.
- Controller now defaults to hosting on https on port 8443.
- Renamed client to slave.
- Removed rotation of factorio-current.log files.

### Breaking Changes

- Removed lib/authenticate.
  Breaks playerManager.
- The masterIP and masterPort config entries has been merged into masterURL.
  Breaks discordChat, playerManager, serverSelect, trainTeleports and clusterioModel.
- Removed config management from the command line and the server manager.
- Moved ejs templates into views folder and changed their extension to .ejs.
  Breaks playerManager.
- Mods are no longer copied from the per instance instanceMods directory.
  If you need per instance mods you can now place them directly in the mods directory inside the instance folder.
- Hotpatch scenarios and code loading is no longer compatible with Clusterio.
  Breaks playerManager, serverSelect, and tranTeleports.
- Removed getLua and getCommand from lib/clusterTools.
  If you need to run more than the most trivial of code in commands use the save patcher and add in a remote interface.
- Removed mod uploading and distributing from the HTTP interface.
  Breaks the old unmaintained and no longer needed factorioClusterioClient.
- Removed the remoteCommands plugin and the old runCommand interface.
  Breaks playerManager and external tools sending commands.
- Removed broken serverManager plugin.
- Removed fields info, time, rconPort, rconPassword, serverPort, unique, mods, instanceName, playerCount, mac, and meta from the hosts in the host database.
- Removed getInstanceName and lib/clusterTools.
  Breaks playerManager, and discordChat.
- Removed the /api/rconPasswords, and /api/slaves endpoints.
  Breaks web interface, trainTeleports, and discordChat.
- Removed the /api/getSlaveMeta and /api/editSlaveMeta endpoints.
  Breaks researchSync, and UPSdisplay.
- Removed the hello event from the socket connection handshake.
  Breaks playerManager, trainTeleports, serverSelect, and discordChat
- Changed the format of database/hosts.json.
- Removed the output file subscription system.
  Breaks inventoryImports, playerManager, trainTeleports, serverSelect and researchSync.
- Removed the factorioOutput hook from instance plugins.
  The onOutput hook provides parsed output instead.
- Removed the onLoadFinish hook from master plugins.
- Moved plugins from the sharedPlugins directory to plugins directory.
- Implemented a new plugin system that replaces the old.
  Breaks all plugins.
- Removed express metric http_request_duration_milliseconds metric.
- Removed socket.io metrics socket_io_connected, socket_io_connect_total, socket_io_disconnect_total, socket_io_events_received_total, socket_io_events_sent_total, socket_io_recieve_bytes, and socket_io_transmit_bytes,
- Removed clusterio_connected_instaces_gauge and added clusterio_master_connected_clients_count in its place.
- Renamed clusterio_player_count_gauge to clusterio_statistics_exporter_instance_player_count
- Removed clusterio_UPS_gauge and added clusterio_statistics_exporter_instance_game_ticks_total in its place.
- Renamed clusterio_endpoint_hit_gauge to clusterio_http_enpoint_hits_total
- Renamed clusterio_statistics_gauge to clusterio_statistics_exporter_instance_force_flows
- Renamed clusterio_nn_dole_gauge to clusterio_subspace_storage_nn_dole_gauge.
- Renamed clusterio_dole_factor_gauge to clusterio_subspace_storage_dole_factor_gauge.
- Renamed clusterio_import_gauge to clusterio_subspace_storage_import_total.
- Renamed clusterio_export_gauge to clusterio_subspace_storage_export_total.
- Renamed clusterio_master_inventory_gauge to clusterio_subspace_storage_master_inventory.
- Removed clusterioMod plugin specific config options logItemTransfers, disableFairItemDistribution useNeuralNetDoleDivider, autosaveInterval, and disableImportsOfEverythingExceptElectricity from the master config.
- Removed msBetweenCommands config option.
  The RCON is instead limited to 5 concurrent commands.
- Removed allowRemoteCommandExecution config option.
  Remote commands are always allowed with the move to controller managing hosts/instances.
- Removed `--databaseDirectory`, `--controllerPort`, and `--sslPort` command line arguments from the controller.
- Implemented a new config system that replaces the old.
  Breaks all plugins.
- Removed usage of socket.io entirely in favor of a plain WebSocket connection.
- Renamed clusterioMod plugin to subspace_storage.
- Controller no longer creates secret-api-token.txt.
- Removed automatic creation of self-signed TLS certificate.
- Node.js versions below 12 are no longer supported.

## Version 1.2.4

- Removed broken remote combinator signaling.
- Fixed research sync endlessly updating already researched technologies
- Removed obsolete item/fluid statistics from clusterioMod
- Removed per mod upload logging when config.uploadModsToMaster disabled
- Fixed bcrypt failing to install on windows due to the new version not having Windows binaries.


## Version 1.2.3

- Disabled uploading mods to the master server by default as this is mostly just a waste of bandwidth with the mod portal being integrated into the game now.
- Fixed researchSync breaking with heavily modded games due to the tech tree exceeding the default 100kb limit on JSON payloads.
- Fixed the command inventoryImport sends referencing player instead of character, and trying to count the non-existant quick bar slots.
- Fixed inventoryImport never receiving the script output after the default mode for reading script output changed to tail mode.
- Fixed desync caused by the mods and loaded mods arrays in Hotpatch getting out of sync when plugins update their scenario mod code.
  To fix existing games you will need copy lib/scenarios/Hotpatch/hotpatch/mod-tools.lua over the existing mod-tools.lua in the save's hotpatch folder.
- Updated the Windows install instructions.


## Version 1.2.2

- Fixed possible crash with modded technologies named the same as a built-in Object prototype property in researchSync.
- Fixed progress of a current infinite tech carrying over to the next one when researching it and another node completes it in researchSync.
- Fixed progress of a previous infinite tech from another node being applied to the current one in researchSync.
- Fixed crash in researchSync when modded technologies are present only on some nodes.
- Fixed install failing due to bcrypt version less than 3 not being supported on node v10.
- Reordered install instructions to avoid problem with npm creating files owned by root in the home directory.
- Swapped curl out with wget in the install instructions as the latter comes pre-installed on Ubuntu.

### Breaking Changes

- Node.js versions below 10 are no longer supported.


## Version 1.2.1

- Updated node-factorio-api to v0.3.8 to fix mod downloads randomly breaking ([#229][#229]).
- Fixed SIGINT being sent twice to Factorio server when interrupted by CTRL+C on Linux ([#217][#217]).
- Fixed package.json incorrectly reporting the license as ISC.

[#217]: https://github.com/clusterio/clusterio/issues/217
[#229]: https://github.com/clusterio/clusterio/issues/229

### Breaking Changes

- Added authentication to the socket.io server running on the master.
