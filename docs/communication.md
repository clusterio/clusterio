# Communication Layer

Clusterio uses links, connectors, and message classes to communicate between controllers, hosts, instances, and control clients.
See the [protocol reference](devs/protocol.md) for wire formats and session flow.


## Links and routing

[Link](../packages/lib/src/link/link.ts) handles request/response matching, event dispatch, message registration, and routing through an attached router.
Its connector identifies the local and remote endpoints through `connector.src` and `connector.dst`, both `Address` objects.
Controller connections have one link per host or control client.
Hosts and instances share a Node.js process and communicate through paired virtual connectors.

For a routed request, trace the sender, message class, each router, controller permission check, and destination handler.
The receiving link checks the message name, allowed endpoint types, and ingress constraints before routing it.
Control-origin permission checks run on the controller before destination payload validation; callbacks therefore see raw, untrusted data.
See [message permissions](writing-plugins.md#static-permission).

At the destination, the registered schema validates the payload and `fromJSON` restores the message before its handler runs.
Responses are matched to pending requests using the request ID in the destination address, not the transport sequence number.
Events do not return a handler result to the sender.

Routing can perform work before the destination handler runs.
In particular, the [host router](../packages/host/src/Host.ts) can start or wake an instance for messages marked as instance-starting.
A handler-only trace can miss this behavior.


## Connectors and sessions

[Connectors](../packages/lib/src/link/connectors.ts) transport wire envelopes, assign sequence numbers, and deliver incoming messages to links.
WebSocket connectors implement handshakes, heartbeats, acknowledgements, send buffers, and session recovery.
The client connector retries connections with backoff; the [server connector](../packages/controller/src/WsServerConnector.ts) retains resumable sessions until they expire.
`VirtualConnector` connects links in memory without WebSocket session machinery.

| Event | Meaning |
| --- | --- |
| `connect` | A new session is established. |
| `drop` | The transport was lost while the session can still be resumed. |
| `resume` | The retained session is reconnected; unacknowledged buffered messages are replayed. |
| `invalidate` | The previous session cannot be reused. |
| `close` | The connector is closed. |

Invalidation or closure rejects pending requests with `SessionLost`.
Successful resumption is not an application-level exactly-once guarantee.
Plugins must handle lost sessions, stale state, and application retries where required.
See [connection handling](writing-plugins.md#handling-connection-events) for plugin hooks and queueing.

A graceful disconnect asks the peer to prepare before closing; plugins should stop generating new traffic and finish pending work through the preparation hooks.
This reduces data loss but cannot guarantee delivery after a process crash or forced close.
Close codes matter: the client treats policy violation (1008) as terminal, while try-again-later (1013), used for send-buffer overflow, permits reconnecting.
The [send-buffer setting](configuration.md#controllermax_send_buffer_size) documents its current accounting limitation.


## Message definitions and registration

Wire envelopes and their schemas live in [messages_core.ts](../packages/lib/src/data/messages_core.ts).
Operation-specific core request and event classes live under [packages/lib/src/data/](../packages/lib/src/data/).
Their `type`, `src`, `dst`, schema, and permission fields define the contract; plugin classes also supply a `plugin` name.

`Link.register` registers request and event classes and compiles their payload validators.
Core classes are registered by the link module; `registerPluginMessages` registers each plugin's `messages` array.
Handlers are attached explicitly with `handle(MessageClass, handler)`.
Send through `sendTo(destination, new MessageClass(...))`; use broadcast destinations only for events.
See [writing plugins](writing-plugins.md#defining-link-messages) for a complete example.

When changing a wire envelope, regenerate the standalone validator after compiling the schema.
When changing an operation, keep serialization, allowed endpoints, permission checks, registration, and handlers consistent.
The [validation guide](contributing.md#checking-your-code-for-errors) covers focused tests and cross-version checks.
