# Player Proxy

The controller can accept connections from Factorio clients on a single UDP port and forward each player to an instance in the cluster.
Players then only need to know one address, and instances that are stopped are started when someone connects to them.


## Contents

- [Enabling the proxy](#enabling-the-proxy)
- [How players are routed](#how-players-are-routed)
- [Dedicated instance ports](#dedicated-instance-ports)
- [Lobbies and the server browser](#lobbies-and-the-server-browser)
- [Limitations](#limitations)


## Enabling the proxy

The proxy listens on UDP port 34197, the default port of Factorio servers, unless [controller.player_proxy_port](configuration.md#controllerplayer_proxy_port) is changed.
Set it to null to turn the proxy off:

    npx clusteriocontroller config set controller.player_proxy_port null

Make sure the port is reachable from the Internet.
The controller connects to the game port of the instances from the address the host connected to the controller from, so the game ports of the instances must be reachable from the controller.
Instances behind the proxy should have `visibility.public` turned off in their `factorio.settings`, otherwise they are listed in the server browser with their own address in addition to the proxy.
If the port is taken, for example by an instance of a host on the same machine, the controller logs an error and runs without the proxy.


## How players are routed

A Factorio client starts a connection by sending its version, and only sends the name of the player after the server has answered.
The proxy answers the first message itself with the version of the client, waits for the name, and then picks an instance in this order:

1. The first instance returned by a plugin from the `playerProxyRoute` controller hook, see [Writing plugins](writing-plugins.md#defining-the-plugin-entrypoint).
2. The instance the port the player connected to is dedicated to, see below.
3. The instance the player was last on.
4. [controller.player_proxy_default_instance_id](configuration.md#controllerplayer_proxy_default_instance_id).
5. Any running instance.

If the chosen instance is stopped it is started, and the player is connected once it's running.
Factorio clients give up after roughly 10 seconds, so the first attempt to join an instance that takes longer to start fails, but trying again once it's up works.
The lobby plugin avoids this by letting players wait in a lobby instead.

The version of the client is not checked against the instance.
Factorio clients only check the version in the answer to their first message, which the proxy sends, so a player sent to an instance running a different version does not get Factorio's version mismatch message and fails later in the handshake instead.
The proxy logs a warning when this happens.


## Dedicated instance ports

[instance.player_proxy_port](configuration.md#instanceplayer_proxy_port) makes the proxy listen on another port that always sends players to that instance.
This lets each instance have its own address while still being started on demand.


## Lobbies and the server browser

The [lobby plugin](../plugins/lobby/README.md) builds on the proxy:

- Players connecting to the proxy go to a lobby instance running their Factorio version, where an in-game list lets them pick the instance to join.
  Picking a stopped instance starts it, and the player is moved there once it's running.
- The cluster is listed as one game in the Factorio server browser, with the players online in the whole cluster.
- Instances can be listed as their own games in the server browser on a dedicated port, also while they are stopped.
  Players joining a stopped instance from the server browser wait in a lobby while it starts.


## Limitations

- Every player reaches the instances from the address of the controller, so bans by IP address and limits on connection attempts per address in Factorio apply to all players behind the proxy together.
- Factorio's network protocol is not stable between versions, the proxy is written for Factorio 2.0 and 2.1.
- All game traffic passes through the controller, which adds latency if the controller and the instances are far apart.
