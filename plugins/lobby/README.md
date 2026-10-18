# Clusterio Lobby Plugin

Lobby servers where players pick the instance to join, and listing of the cluster in the Factorio server browser.
Works together with the [player proxy](../../docs/player-proxy.md) on the controller.

- Players connecting to the player proxy are sent to a lobby instance running their Factorio version.
  The lobby shows a list of the instances in the cluster, picking one moves the player there with `LuaPlayer.connect_to_server`.
- Picking a stopped instance starts it, the player waits in the lobby and is moved once it's running.
- Other instances with the plugin loaded get a Servers button that opens the same list.
- If the [Player Auth](../player_auth/README.md) plugin is loaded the list has a button for logging into the web interface, which does the same as the `/web-login` command.
- The cluster can be listed in the Factorio server browser as one game per Factorio version a lobby runs, showing the players online in the whole cluster.
- Instances can also be listed in the server browser as their own game on a dedicated proxy port, including while they are stopped.

The [Server Select](https://github.com/Hornwitser/server_select/tree/clusterio-2.0) community plugin provides a similar in-game server list without the lobby, proxy and server browser parts.


## Installation

Run the following commands in the folder Clusterio is installed to:

    npm install @clusterio/plugin-lobby
    npx clusteriocontroller plugin add @clusterio/plugin-lobby

Substitute clusteriocontroller with clusteriohost or clusterioctl if this a dedicate host or ctl installation respectively.


## Setting up a lobby

1. Make sure the player proxy is enabled, it listens on `controller.player_proxy_port` which defaults to 34197.
2. Set `controller.player_proxy_public_address` to the address and port players reach the proxy on, for example `play.example.com:34197`.
   This is the address players are sent to when they pick an instance, and what's published in the server browser.
   If it's not set the host name of `controller.public_url` and `controller.player_proxy_port` is used.
3. Create an instance to act as the lobby, set `lobby.is_lobby` to true on it and start it.
   Lobbies always start the save `lobby.zip`, which is created the first time as an empty one tile map without the freeplay scenario, and players are made spectators in it.
   To use a different map, replace `lobby.zip` with a save of your own.
   Starting a specific save from the web interface or clusterioctl still works.
   Create one lobby for each Factorio version you want to accept players on, by setting `factorio.version` on it.
4. Optionally set `lobby.listed` to false on instances that should not be shown in the list.

Players who connect to the proxy now end up in the lobby for their version.
If there's no lobby running their version they are routed as if the plugin wasn't loaded.


## Server browser listing

Set `lobby.server_browser_listing` to true to list the cluster in the Factorio server browser.
This needs `controller.factorio_username` and `controller.factorio_token` to be set, and a lobby instance to be running so its exact version and build can be listed.
Factorio only shows games running the exact same version and build as the client.

To list an instance as its own game, set `instance.player_proxy_port` to a port the proxy should listen on for it and `lobby.server_browser_listing` on the instance to true.
The instance stays listed when it's stopped, as long as it has been started once while the controller was running so its version is known.
Players joining it while it's stopped wait in a lobby running their version until the instance has started.


## Controller Configuration

### lobby.server_browser_listing

List the cluster in the Factorio server browser as one game for each Factorio version a lobby is running.

Defaults to false.

### lobby.server_browser_name

Name of the cluster in the server browser, uses `controller.name` if null.

Defaults to null.

### lobby.server_browser_description

Description of the cluster in the server browser.

Defaults to an empty string.

### lobby.server_browser_tags

Comma separated tags shown for the games listed in the server browser.

Defaults to "clusterio".

### lobby.server_browser_max_players

Max players shown for the games listed in the server browser, 0 for no limit.
This is only shown, it does not limit how many players can join.

Defaults to 0.


## Instance Configuration

### lobby.is_lobby

Players connecting to the player proxy are sent to a running lobby with their Factorio version, where they pick which instance to join.

Defaults to false.

### lobby.listed

Show this instance in the server list of lobbies.

Defaults to true.

### lobby.server_browser_listing

List this instance as its own game in the Factorio server browser, also while it's stopped.
Requires `instance.player_proxy_port` to be set.

Defaults to false.
