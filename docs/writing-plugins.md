Writing Plugins
===============

Plugins for Clusterio are classes written in JavaScript that run under
Node.js.  The plugin classes have pre-defined hooks that are called
during various stages and operations of Clusterio.


Contents
--------

- [Plugin Structure](#plugin-structure)
- [Defining the plugin class](#defining-the-plugin-class)
- [Plugin Configuration](#plugin-configuration)
- [Communicating with Factorio](#communicating-with-factorio)
- [Defining Link Messages](#defining-link-messages)
    - [Defining Events](#defining-events)
    - [Defining Requests](#defining-requests)
- [Sending Link Messages](#sending-link-messages)
- [Collecting Statistics](#collecting-statistics)


Plugin Structure
----------------

The basic file structure of a plugin is the following.

    plugin_name/
      +- info.js
      +- package.json
      +- master.js
      +- instance.js
      +- test/
      |  +- plugin.js
      +- module/
         +- module.json
         +- plugin.lua

The most important file is the `info.js` file.  Without it the plugin
will not recognized by Clusterio.  Here's an example of it:

    const link = require('lib/link'); // For messages

    module.exports = {
        name: "foo_frobber",
        title: "Foo Frobber",
        description: "Does advanced frobnication",
        version: "0.8.1",
        instanceEntrypoint: "instance",
        masterEntrypoint: "master",
        messages: {
            /* See below */
        },
    };

The following properties are recognized:

**name**:
    Internal name of the plugin.  Must be the same as the plugin's
    directory name

**title**:
    Name of the plugin as shown to users.  Currently not used.

**description**:
    Brief description of what the plugin does.  Currently not used.

**version**:
    Semver compatible version string of the plugin.  Currently only
    servers as the default for the Clusterio module embedded in the
    plugin, if any.

**instanceEntrypoint**:
    Path to a Node.js module relative to the plugin directory which
    contains the InstancePlugin class definition for this plugin.  This
    is an optional paramater.  A plugin can be for instances only, but
    for it to be able to send any messages to other instances it will
    still have to be loaded on the master server.

**InstanceConfigGroup**:
    Subclass of `PluginConfigGroup` for defining the per instance
    configuration fields for this plugin.  See [Plugin
    Configuration](#plugin-configuration)

**masterEntrypoint**:
    Path to a Node.js module relative to the plugin directory which
    contains the MasterPlugin class definiton for this plugin.  This is
    an optional parameter.  A plugin can be made that only runs on the
    master server.

**MasterConfigGroup**:
    Subclass of `PluginConfigGroup` for defining the master server
    configuration fields for this plugin.  See [Plugin
    Configuration](#plugin-configuration)

**messages**:
    Object with link messages definitions for this plugin.  See guide
    for [defining link messages](#defining-link-messages) below.

The optional module folder contains a Clusterio module that will be
patched into the save when the plugin is enabled.  See the section on
[Clusterio Modules](developing-for-clusterio.md) in the Developing for
Clusterio document.  The only restriction imposed on modules embedded
into plugins is that they must be named the same as the plugin.

While there is no standard for how to organize a plugin it's recommended
to put the MasterPlugin class definition into master.js and the
InstancePlugin class definition into instance.js.  You can put them into
whatever file you want (even the same one for both).

For both instanceEntrypoint and masterEntrypoint the path should not end
with .js and it should use forward slashes for directory separators if
any.


Defining the plugin class
-------------------------

The plugin class should derive from its respective base class defined in
`lib/plugin`.  For example, to define a MasterPlugin class the following
code can be used:

    const plugin = require('lib/plugin');

    class MasterPlugin extends plugin.BaseMasterPlugin {
        async init() {
            this.foo = 42;
            await this.startFrobnication();
        }

        // ...
    }

    module.exports = {
        MasterPlugin,
    }

For the instance plugin it's exactly the same except "Master" is
replaced with "Instance".  The available hooks that you can override are
documented in the base class [in lib/plugin.js](../lib/plugin.js).

It's best to avoid defining a constructor, but if you insist on defining
one, forward all arguments to the base class.  E.g.:

        constructor(...args) {
            super(...args);

            // Code here
        }

The arguments passed may change, and attempting to modify them will
result in unpredicatable behaviour.  The async init method is always called
immediatly after the constructor, so there's little reason to do this.


Defining Configuration
----------------------

Clusterio provides a configuration system that handles storing,
distributing, editing and validating config fields for you.  You can
take advantage of it by subclassing `PluginConfigGroup`, setting the
`groupName` to your plugin name, defining fields on it, finalizing it,
and passing it as either `MasterConfigGroup` or `InstanceConfigGroup` in
the `info.js` export.  For example in info.js:

    const config = require("lib/config");

    class MasterConfigGroup extends config.PluginConfigGroup { }
    MasterConfigGroup.groupName = "foo_frobber";
    MasterConfigGroup.define({
        name: "level",
        description: "Level of frobnication done",
        type: "number",
        initial_value: 2,
    });
    MasterConfigGroup.finalize();

    module.exports = {
        ...
        MasterConfigGroup: MasterConfigGroup,
    };

Code inside the `MasterPlugin` class will then be able to access the
level config field through the `Config` object at `this.master.config`,
for example in the MasterPluginClass:

    async init() {
        let level = this.master.config.get("foo_frobber.level");
        console.log("I got a frobnication level of", level);
    }

The same applies for instance configs, replace "master" with "instance"
where appropriate.  See [Configuration System](configuration-system.md)
for more details on how this system works.


Communicating with Factorio
---------------------------

For pushing data into Factorio there's RCON, which lets you send
arbitrary Lua commands to invoke whatever code you want in the game.
This is done by calling the `sendRcon` method on the instance's server object.
For example:

    async onStart() {
        let response = await this.instance.server.sendRcon(
            "/sc rcon.print('data')"
        );

        // Do stuff with response.
    }


Because data into Factorio is streamed at a rate of 3-6 kB/s by default,
it is recommended to avoid sending large commands as much as possible,
and to strip down the data on the ones you send to only what's strictly
necessary.  You can have lua code injected into the game via the module
system and call that from RCON to avoid having to send code through the
commands.

For getting data out from Factorio there's both RCON and the `send_json`
API of the Clusterio module.  Returning data via RCON is prefered if the
action is initiated from the Node.js side.  The `send_json` API allows
sending JSON payloads on channels that plugins can listen to.  From a
plugin you listen for an event named `ipc-channel_name` in order to get
data sent by `send_json`.  For example in the plugin code:

    async init() {
        this.instance.server.on('ipc-my_plugin_foo', content =>
            this.handleFoo(content).catch(err => console.log(
                "Error handling foo:", foo
            ))
        );
    }

    async handleFoo(content) {
        // Do stuff with content
    }

And then in the module for the plugin:

    local clusterio_api = require('modules/clusterio/api')

    -- inside some event handler
    clusterio_api.send_json('my_plugin_foo', { data = 123 })

It's recommended to either use the plugin name as the channel name or to
prefix the channel name with the name of the plugin if you need multiple
channels.  It's also important to catch any errors that might occur as
they will otherwise be propogated to the instance code and kill the
server.

Data out from Factorio does not have the same limits as data into
Factorio, RCON responses can be in 100kB range without causing issues,
and payloads to the `send_json` API can be in the 4MB range provided the
server has a fast enough storage system.

**Note:** both `send_json` and RCON can operate out of order.  For
`send_json` it's possible that payloads greater than 4kB are received
after payloads that were sent at a later point in time.  For RCON,
commands longer than 50 characters may end up being executed after
shorter commands sent after it.


Defining Link Messages
----------------------

You will most likely have to communicate with the master or other
instances in your plugin for it to do anything useful.  For this there's
a WebSocket communication channel established between the slaves and the
master server that plugins can define their own messages to send over
it.  This channel is bi-directional and all messages sent over it are
validated with a JSON schema (see [this guide][guide] for an
introduction to writing JSON schema).

[guide]: https://json-schema.org/learn/getting-started-step-by-step.html

There are currently two kinds of messages that can be defined: events
and requests.  Events are simple one-way notifications that invoke a
handler on the target it's sent to.  Requests are pairs of request and
response messages where the request is sent to the target and the
response is the reply back from the target.  The requests are similar to
HTTP requests, in that both parties of a link may initiate one.


### Defining Events

Events are defined as properties of the messages object exported by
`info.js` that map to instances of the `Event` class from `lib/link`.
The name of the property correspond to the handler invoked on the plugin
class.  The Event constructor takes an object of properties that define
the event, for example the following could be defined in `info.js`:

    messages: {
        startFrobnication: new link.Event({
            type: 'foo_frobber:start_frobnication',
            links: ['master-slave', 'slave-instance'],
            forwardTo: 'instance',
            eventProperties: {
                "frobnication_type": { type: "string" },
            },
        }),
    },

This specifies an event that can be sent from the master to a slave,
and from a slave to an instance.  It also specifies that the event must contain the
property `frobnication_type`, with a string value in the data payload.
It will also be forwarded by slaves to a specific instance.

The following properties are recognized by the Event constructor:

**type**:
    The message type sent over the wire.  This can be any string, but
    it must be unique across all plugins, and it's recommended that it is
    of format `plugin_name:message_name`.  The suffix `_event` will be
    appended to the type.

**links**:
    An array of strings describing which links this event can be sent
    over.  Direction matters, `'master-slave'` means the event can be
    sent from the master to the slave, but can't be sent back the other way,
    unless `'slave-master'` is also present in the links array.

**forwardTo**:
    Target to forward an event to.  Can either be `'master'`, to indicate a
    slave should forward it to the master server, or `'instance'`, to
    indicate it should be forwarded to the instances specified by the
    `instance_id` event property.  This works by using a default handler
    for the event at the links that forward it.

**broadcastTo**:
    Target to broadcast this message towards.  A value of "instance" means
    the event will be broadcast to all instances downstream of the target
    it's sent to, but not back from where it came from. Currently, only
    "instance" is supported. This means that sending an event to a slave
    that slave except for the instance it came from.
    from an instance will cause it to be broadcast to all instances of

**eventProperties**:
    Object with properties mapping to a JSON schema of that property
    that specifies what's valid to send in the event.  This is
    equivalent to using the `properties` keyword in JSON schema, except
    that the properties specified are implicitly required and additional
    properties are not allowed.  See [this guide][guide] for an
    introduction to writing JSON schemas.

The forwardTo and broadcastTo can be combined such that specifying
`'master'` as the forwardTo value and `'instance'` as the broadcastTo
value will cause the event to be broadcast to all instances in the
cluster.  For this to work, you will need to specify `instance-slave`,
`slave-master`, `master-slave`, and `slave-instance` as the links.

Keep in mind when forwarding events that if the target an event is being
forwarded to is not online, the event will be dropped.  Use a request if
you need a confirmation that the message was received.

### Definining Requests

Requests are defined as properties of the messages object exported by
`info.js` that map to instances of the `Request` class from `lib/link`.
The name of the property corresponds to the handler invoked on the plugin
class.  The Request constructor takes an object of properties that define
the event. For example, the following could be defined in `info.js`:

    messages: {
        reportFrobnication: new link.Request({
            type: 'foo_frobber:report_frobnication',
            links: ['master-slave', 'slave-instance'],
            forwardTo: 'instance',
            requestProperties: {
                "verbosity": { type: "integer" },
            },
            responseProperties: {
                "report": {
                    type: "array",
                    items: { type: "string" },
                },
            },
        }),
    },

This specifies a request that can be sent from the master to a slave,
and from a slave to an instance.  The request data must contain the
property `verbosity` with an integer number as the value, as well as the
`instance_id` property (implied by `forwardTo: 'instance'`), and the
response sent must contain a `report` property mapping to an array of
strings.  When received by a slave, it will also be forwarded to the
instance specified by `instance_id`.

The following properties are recognized by the Request constructor:

**type**:
    The message type sent over the wire.  This can be any string, but
    it must be unique across all plugins, and it's recommended that it is
    of format `plugin_name:message_name`.  The suffix `_request` will be
    appended to the type for the request message sent, and the suffix
    `_response` will be appended to the type for the response.

**links**:
    An array of strings describing which links this request can be sent
    over.  Direction matters; `'master-slave'` means the request can be
    sent from the master to the slave and the slave can reply to the master,
    but the slave can't send a request to the master unless
    `'slave-master'` is also present in the links array.

**forwardTo**:
    Target to forward the request to.  Can either be `'master'` to indicate
    a slave should forward it to the master server when receiving it
    from an instance, or `'instance'` to indicate it should be forwarded
    to the instances specified by the `instance_id` request property.
    This works by using a default handler for the request by the links
    that forward it.

**requestProperties**:
    Object with properties mapping to a JSON schema of that property
    that specifies what's valid to send in the request.  This is
    equivalent to using the `properties` keyword in JSON schema, except
    that the properties specified are implicitly required and additional
    properties are not allowed.  See [this guide][guide] for an
    introduction to writing JSON schemas

**responseProperties**:
    Same as the requestProperties only for the response sent back by the
    target.


Sending Link Messages
---------------------

Link messages are sent by calling the `.send()` method on the
Event/Request instance with the link you want to send it over and the
data to send. For `InstancePlugin` code the link to the slave is the
`instance` itself, which is accessible through the `.instance` property
of the `InstancePlugin`. The `.info` property of the plugin class exposes
the data exported from the plugin's `info.js` module.  In other words:

    // In an InstancePlugin class
    async frobnicate() {
        this.info.messages.exampleEvent.send(this.instance, { foo: "bar" });
    }

For the Request class the send method is async and returns the response
data received from the target it was sent to, or throws an error if the
request failed.


Collecting Statistics
---------------------

Clusterio comes with its own Prometheus client implementation, one part
due to Not Invented Here and another part due to collectors in
prom-client being difficult to get to work nicely with collecting data
from plugins optionally loaded at runtime on different computers.

In its simplest form collecting data from plugins consists of defining
the metric and updating it somewhere in the plugin code.  For example:

    const { Counter } = require('lib/prometheus');

    const fooMetric = new Counter(
        'clusterio_foo_frobber_foo_metric', "Measures the level of foo",
    );

    // Somewhere in the master plugin code
    fooMetric.inc();

This works for master plugins, and the metric will be automatically
available through the /metric HTTP endpoint.  It's recommended that
plugin metrics follow `clusterio_<plugin_name>_<metric_name>` as the
naming scheme.

For metrics that are per-instance, you must define an `instance_id` label and
set it accordingly, for example:

    const { Counter } = require('lib/prometheus');

    const barMetric = new Gauge(
        'clusterio_foo_frobber_bar_metric', "Bar instance level",
        { labels: ['instance_id'] }
    );

    // Somewhere in the instance plugin code
    barMetric.labels(String(this.instance.config.get("instance.id"))).set(someValue);

Metrics are automatically registered to the default registry, and this
default registry is automatically polled by the master server on slaves.
This means that it's important that you place the definition of the
metric at module level so that it's not created more than once over the
lifetime of a slave.  Since the metrics remember their values and would
continue to be exported after an instance is shutdown, there's code at
instance shutdown that removes all the values where the `instance_id`
label matches the id of the instance shut down.

For statistics you need to update on collection there's an `onMetrics`
hook on both master and instance plugins that is run before the
metrics in the default registry are collected.
