Socket.io protocol
==================

<sub>This document describes the protocol used between the master and
slaves, and unless you're developing Clusterio it's probably not going
to be very useful for you.</sub>

The protocol is built on the [socket.io](https://socket.io/) library
which lets mulitple streams be multiplexed in many different ways over
the same connection and abstracts away reconnection logic.
Unfortunately I've been unable to figure what the message delivery
guarantees of the library is, so whether or not messages can be lost is
still an unknown, I assume that messages are delivered as long as a
connection is maintained or manages to reconnect.

While there are many mechanisms to multiplex streams, the core
communication between the master server and slaves is done entirely by
sending single POJO payloads over the `message` event.  There's a
shortcut for sending these via the `.send` method of the socket.io
sockets.

These messages contain the following three properties:
- seq - integer - The sequence number of the message
- type - string - The type of message
- data - object - Message data


Handshake
---------

Upon connecting to the socket.io endpoint the server will respond with a
`hello` message containing the master server version as the data.  The
client is then expected to send a `register_slave` or `register_control`
message back depending on what kind of client it is.  If the register
operation is successful the master will reply with a `ready` message
with an empty data payload.

**Master `hello` data**

- version - string - The version of the master, e.g. "2.0.0".

**Slave `register_slave` response data**

- agent - string - Human readable identifying the software connecting.
- version - string - The protocol version of the slave, e.g. "2.0.0".
- name - string - Name of the slave.
- id - integer - ID of the slave.

**Control `register_control repsonse data**

- agent - string - Human readable identifying the software connecting.
- version - string - The protocol version of the control, e.g. "2.0.0".

**Example handshake**
```js
// Server hello
({
    type: 'hello',
    data: {
        version: "2.0.0",
    }
})

// Client response
({
    type: 'register_slave',
    data: {
        agent: 'Clusterio Slave',
        version: "2.0.0",
        name: "Foo",
        id: 123,
    }
})

// Server repsonse
({
    type: 'ready',
    data: {}
})
```


Events
------

Events are messages send in one direction over the link, that the
receiver is expected to act upon, but not make any replies (for that
there's [Requests](#requests).  By convention a message types ending in
`*_event` is an event.  The data payload of an event consists solely of
event specific properties.

See [lib/link/messages.js](lib/link/messages.js) for the recognized
events and their contents.


Requests
--------

Requests are messages which expects a response in return.  They function
a lot like HTTP requests except that both parties of a connection can
inniate a request that is expected to be responded to.  By convention
message types ending in `*_request` is a request, and is expected to be
replied to with a corresponding `*_response` message.  If an error
occured while processing the request an error response containing an
error property in the data payload is sent instead.

**`*_response` data**

- seq - integer - The seq number of the request message.
- additional properties may be present depending on the type of request.

**`*_resopnse` error data**
- seq - integer - The seq number of the request message.
- error - string - Human readable text message describing the error.

See [lib/link/messages.js](lib/link/messages.js) for the recognized
requests and their contents.


Closing the connection
----------------------

The party that innitates the shut down of the connection should send a
close message containing the reason for closing before disconnecting.

**`close` data**

- reason - string - Reason for closing the connection
