Communication Layer
===================

<sub>This document describes the communication layer in Clusterio and
unless you're developing Clusterio it's probably not going to be very
useful for you.</sub>

Communication is facilitated by the lib/link library and is based on
three core abstractions: links, connectors and messages.  Links
represents one side of a two way communication pipe, connectors deal
with connecting and establishing communication, and messages are the
content sent over the link.


Link
----

The Link class represents one side of a two way communication channel
where the actual communication is done by a connector associated with
the link.  The link also knows what the endpoint types it's connected to
are via the source and target attributes.

The endpoint types currently implemented are master, slave, instance,
and control.  Although slave and instances run in the same Node.js
program they use virtual links to communicate between them in order to
simplify the communication architecture.

Upon creation the link will register with the connector in order to
receive and process messages from it.  The messages received are
validated using the validator registered for the type of the message.  A
message for which there is no validator for is considered an error.


Connector
---------

The connector used with a link is responsible for establishing and/or
maintain the connection that messages are sent over.  Reconnect logic is
expected to be implemented in the connector, though this has not yet
been done.

There's also the virtual connector which lets two links in the same
program be connected to each other without having to establish a
network connection.


Message
-------

There's two types of messages currently implemented apart from the
Link builtin close message and that's Request and Event.  The builtin
messages are defined in
[packages/lib/link/messages.js](/packages/lib/link/messages.js) and are
attached to links via the attachAllMessages function, which is usally
called in the Link subclass constructor.

The messages define which links they are valid on and only attaches
handlers for those links.  There's also a forwarding mechanism for when
a request or event is to be forwarded another hop.
