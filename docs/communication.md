# Communication Layer

Clusterio uses links, connectors, and message classes to communicate between controllers, hosts, instances, and control clients.
A link sends and receives messages through a connector, while message classes define the requests and events that can be exchanged.
See the [system overview](how-it-works.md#system-overview) for a diagram of the processes and their connections, and the [protocol reference](devs/protocol.md) for wire formats and session flow.


## Links and routing

[Link](../packages/lib/src/link/link.ts) handles request/response matching, event dispatch, message registration, and routing through an attached router.
Its connector identifies the local and remote endpoints through `connector.src` and `connector.dst`, both `Address` objects.

The controller's `WsServer` stores one link for each host or control connection.
On a host, the `Host` object is a link to the controller, and each `Instance` is linked to a corresponding `InstanceConnection` stored on the host.
The command-line client's `Ctl` object and the web interface's `Control` object each act as a link to the controller.

Requests can pass through several links before reaching their destination.
Each receiving link checks the message name, allowed endpoint types, and source address before routing it.
The controller checks the user's permissions before validating the message data; permission callbacks therefore receive untrusted data.
See [message permissions](writing-plugins.md#static-permission).

At the destination, the registered schema validates the payload and `fromJSON` restores the message before its handler runs.

Routing can perform work before the destination handler runs.
In particular, the [host router](../packages/host/src/Host.ts) can start or wake an instance for messages marked as instance-starting.


## Connectors and sessions

[Connectors](../packages/lib/src/link/connectors.ts) transport messages, assign sequence numbers, and deliver incoming messages to links.
WebSocket connectors connect hosts and control clients to the controller and validate incoming message structures, including their type and addresses.
Hosts and instances share a Node.js process and communicate in memory through paired `VirtualConnector` objects.

The protocol reference describes [connection and recovery behavior](devs/protocol.md#connection-flow), [connector states and events](devs/protocol.md#connector-flow), and [graceful disconnects](devs/protocol.md#graceful-disconnect).
For handling these events in a plugin, including queueing work and preparing for disconnection, see [connection handling](writing-plugins.md#handling-connection-events).


## Message definitions and registration

Core request and event classes live under [packages/lib/src/data/](../packages/lib/src/data/).
Their static `type`, `src`, and `dst` properties specify the message type and allowed endpoint types, while their schema and permission fields define the payload and access rules.
Plugin classes also supply a `plugin` name.

`Link.register` registers request and event classes and compiles their payload validators.
Core classes are registered by the link module; `registerPluginMessages` registers each plugin's `messages` array.
Incoming messages invoke handlers attached with `link.handle(MessageClass, handler)`.
Plugins attach these handlers from their entrypoint functions rather than relying on method-name conventions.

Send a message with `link.sendTo(destination, new MessageClass(...))`.
Requests return a promise for the response; events do not return a handler result.
Use broadcast destinations only for events.
When using a request's source as a later event destination, remove its request ID with `Address.withoutRequestId()`.
See [writing plugins](writing-plugins.md#defining-link-messages) for a complete example.

When changing a wire message structure in [messages_core.ts](../packages/lib/src/data/messages_core.ts), rebuild the packages with `pnpm -r run prepare` to regenerate the standalone validator.
When changing a request or event class, keep serialization, allowed endpoints, permission checks, registration, and handlers consistent.
The [contributor guide](contributing.md#checking-your-code-for-errors) explains how to run focused tests.
