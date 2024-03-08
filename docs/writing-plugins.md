# Writing Plugins

Plugins for Clusterio are classes written in JavaScript that run under Node.js.
The plugin classes have pre-defined hooks that are called during various stages and operations of Clusterio.


## Contents

- [Plugin Structure](#plugin-structure)
- [Defining the plugin class](#defining-the-plugin-class)
- [Logging Messages](#logging-messages)
- [Plugin Configuration](#plugin-configuration)
- [Communicating with Factorio](#communicating-with-factorio)
- [Defining Link Messages](#defining-link-messages)
- [Sending Link Messages](#sending-link-messages)
    - [Handling connection events](#handling-connection-events)
- [Collecting Statistics](#collecting-statistics)
- [Adding Custom Commands to clusterioctl](#adding-custom-commands-to-clusterioctl)


## Plugin Structure

The basic file structure of a plugin is the following.

    plugin_name/
      +- index.js
      +- package.json
      +- controller.js
      +- instance.js
      +- control.js
      +- test/
      |  +- plugin.js
      +- module/
         +- module.json
         +- plugin.lua

Clusterio plugins are Node.js packages that can be published on npm for ease of installation and distribution.
The usual guides for creating such packages apply.
At minimum the `package.json` file must contain a version entry.

A possible workflow for developing plugins is to place the plugin in a sub-directory of where clusterio has been installed, and rely on Node.js searching up the folder heirarchy for it to find `@clusterio/lib`.
After creating a directory for your plugin, the boilerplate can be generated automaticlly from a set of tempaltes using `npm exec @clusterio/create -y -- --plugin-template` after which you will be asked which areas your plugin will interact with and your plugin's name.
To add it to `plugin-list.json` so that it gets loaded use the `plugin add <path>` sub-command to either clusteriocontroller, clusteriohost or clusterioctl.
Note that it's important that the path starts with ./ or ../ (use .\ or ..\ on Windows).

For a plugin to be recognised by Clusterio it needs to export an entry named `plugin` from its main entrypoint.
By default the main entrypoint is the `index.js` file, but this may be changed by setting the `"main"` entry to a different file in `package.json`.
Here's an example of `index.js`:

```js
module.exports.plugin = {
    name: "foo_frobber",
    title: "Foo Frobber",
    description: "Does advanced frobnication",
    instanceEntrypoint: "instance",
    controllerEntrypoint: "controller",
    messages: {
        /* See below */
    },
};
```

The following properties are recognized:

**name**:
    Internal name of the plugin.
    Must be the same as the plugin's directory name

**title**:
    Name of the plugin as shown to users.
    Currently not used.

**description**:
    Brief description of what the plugin does.
    Currently not used.

**instanceEntrypoint**:
    Path to a Node.js module relative to the plugin directory which contains the InstancePlugin class definition for this plugin.
    This is an optional paramater.
    A plugin may have code only for instances but it must still be loaded on the controller in order for it to be possible to load it on an instance.

**instanceConfigFields**:
    Object mapping instance configuration fields to `FieldDefinitions`for this plugin.
    See [Plugin Configuration](#plugin-configuration)

**controllerEntrypoint**:
    Path to a Node.js module relative to the plugin directory which contains the ControllerPlugin class definiton for this plugin.
    This is an optional parameter.
    A plugin can be made that only runs on the controller.

**ControllerConfigGroup**:
    Object mapping controller configuration fields to `FieldDefinitions`for this plugin.
    See [Plugin Configuration](#plugin-configuration)

**ctlEntrypoint**:
    Path to a Node.js module relative to the plugin directory which contains the CtlPlugin class definition for this plugin.
    This is an optional paramater.
    A plugin can be made that only runs on the clusterioctl side.

**messages**:
    Object with link messages definitions for this plugin.
    See guide for [defining link messages](#defining-link-messages) below.

The optional module folder contains a Clusterio module that will be patched into the save when the plugin is loaded.
See the section on [Clusterio Modules](developing-for-clusterio.md) in the Developing for Clusterio document.
The only restriction imposed on modules embedded into plugins is that they must be named the same as the plugin.

While there is no standard for how to organize a plugin it's recommended to put the ControllerPlugin class definition into controller.js and the InstancePlugin class definition into instance.js.
You can put them into whatever file you want (even the same one for both).

For both instanceEntrypoint and controllerEntrypoint the path should not end with .js and it should use forward slashes for directory separators if any.


## Defining the plugin class

The plugin class should derive from its respective base class defined in `lib/plugin`.
For example, to define a ControllerPlugin class the following code can be used:

```js
const { BaseControllerPlugin } = require("@clusterio/controller");

class ControllerPlugin extends BaseControllerPlugin {
    async init() {
        this.foo = 42;
        await this.startFrobnication();
    }

    // ...
}

module.exports = {
    ControllerPlugin,
}
```

For the instance plugin it's exactly the same except "Controller" is replaced with "Instance", for host plugins "Host" is used and for the clusterioctl plugin "Ctl" is used.
The available hooks that you can override are documented in the base classes.

It's best to avoid defining a constructor, but if you insist on defining one, forward all arguments to the base class.
E.g.:

```js
constructor(...args) {
    super(...args);

    // Code here
}
```

The arguments passed may change, and attempting to modify them will result in unpredicatable behaviour.
The async init method is always called immediatly after the constructor, so there's little reason to do this.


## Logging Messages

The base plugin classes provide a winston logger for logging messages to the shared cluster log.
For instances a copy of the log is also stored on the host the instance is on.
To use it, pass a string to one of the log levels functions, for example:

```js
async init() {
    this.logger.info("Initializing frobbing");
}
```

Metadata covering which plugin and instance (for instance plugin classes) the log event happened on will automatically be attached to the log message.

The available levels are fatal, error, warn, audit, info, and verbose.
These levels have roughly the following meanings:

- fatal: Unrecoverable error that prevents continuing execution of the Node.js process.
  Note that Plugins shouldn't have fatal errors.
- error: An unexpected error condition occured, usually an exception thrown when it wasn't expected.
  Should be investigated and fixed.
- warn: An potential error was detected, but operation continued gracefully.
  These may indicate that something is running sub-optimally, or is not working as intedend.
- audit: Record of actions performed by users of the cluster.
  This is usually emitted in response to management requests by a control link.
- info: A general log message.
  May indicae a status or operation completed.
  This should not be emitted by periodic tasks that run often.
- verbose: A verbose log message which might be useful when investigating issues, does not show by default.
  Note that logging messages is not a cheap operation even when the messages do not show up and spammy logging should be avoided for the verbose level.
  If the logs are still valuable in certain cases consider putting them behind a config option.

For guarding unexpected errors the best option is to log a short description along with the`stack` property of the Error:

```js
try {
    // Operation that should not throw but may end up throwing
} catch (err) {
    this.logger.error(`Operation failed:\n${err.stack}`);
)
```

For plugin hooks expections thrown are automatically catched and logged, but for event handlers registered on EventEmitters it's critical that exceptions are catched and handled appropriately.


## Plugin Configuration

Clusterio provides a configuration system that handles storing, distributing, editing and validating config fields for you.
You can take advantage of it by declaring config fields under either `controllerConfigFields` or `instanceConfigFields` in the `plugin` export.
For example in index.js:

```ts
import type * as lib from "@clusterio/lib";

declare module "@clusterio/lib" {
    // Extend the interface defining available fields so that instance.config.get(...)
    // will have our own options.
    export interface ControllerConfigFields {
        "foo_frobber.level": number, // If optional is true then this should have | null in addition.
    }
}

export default {
    ...
    controllerConfigFields: {
        "foo_frobber.level": {
            description: "Level of frobnication done",
            type: "number",
            initialValue: 2,
        },
    }
} satisfies lib.PluginDeclaration;
```

Code inside the `ControllerPlugin` class will then be able to access the level config field through the `Config` object at `this.controller.config`, for example in the ControllerPluginClass:

```ts
async init() {
    let level = this.controller.config.get("foo_frobber.level");
    this.logger.info(`I got a frobnication level of ${level}`);
}
```

The same applies for instance configs, replace "controller" with "instance" where appropriate.
See [Configuration System](config-system.md) for more details on how this system works.


### Handling Invalid Configuration

If the plugin requires a certain feature to be enabled to function it should throw an error during init if this is not the case.
The most common such feature is the save patching, which can be disabled to run vanilla or scenarios not compatible with Clusterio.
For example:

```js
async init() {
    if (!this.instance.config.get("factorio.enable_save_patching")) {
        throw new Error("foo_frobber plugin requires save patching.");
    }
}
```


## Communicating with Factorio

For pushing data into Factorio there's RCON, which lets you send arbitrary Lua commands to invoke whatever code you want in the game.
This is done by calling the `sendRcon` method on the plugin object.
For example:

```js
async onStart() {
    let response = await this.sendRcon(
        "/sc rcon.print('data')"
    );

    // Do stuff with response.
}
```

Because data into Factorio is streamed at a rate of 3-6 kB/s by default, it is recommended to avoid sending large commands as much as possible, and to strip down the data on the ones you send to only what's strictly necessary.
You can have lua code injected into the game via the module system and call that from RCON to avoid having to send code through the commands.

For getting data out from Factorio there's both RCON and the `send_json` API of the Clusterio module.
Returning data via RCON is prefered if the action is initiated from the Node.js side.
The `send_json` API allows sending JSON payloads on channels that plugins can listen to.
From a plugin you listen for an event named `ipc-channel_name` in order to get data sent by `send_json`.
For example in the plugin code:

```js
async init() {
    this.instance.server.on("ipc-my_plugin_foo", content =>
        this.handleFoo(content).catch(err => this.logger.error(
            `Error handling foo:\n${err.stack}`
        ))
    );
}

async handleFoo(content) {
    // Do stuff with content
}
```

And then in the module for the plugin:

```lua
local clusterio_api = require("modules/clusterio/api")

-- inside some event handler
clusterio_api.send_json("my_plugin_foo", { data = 123 })
```

For convience a helper function is exposed on server specifically for handling IPC events.

```js
async init() {
    this.instance.server.handle("my_plugin_foo", this.handleFoo.bind(this));
}

async handleFoo(content) {
    // Do stuff with content
}
```

**Note:** This only handles IPC events, all other events must use `on`. You should not include the `ipc-` prefix when using this method. Error logging is handled for you, if you want custom error handling use `on`.

It's recommended to either use the plugin name as the channel name or to prefix the channel name with the name of the plugin if you need multiple channels.
It's also important to catch any errors that might occur as they will otherwise be propogated to the instance code and kill the server.

Data out from Factorio does not have the same limits as data into Factorio, RCON responses can be in 100kB range without causing issues, and payloads to the `send_json` API can be in the 4MB range provided the server has a fast enough storage system.

**Note:** both `send_json` and RCON can operate out of order.
For `send_json` it's possible that payloads greater than 4kB are received after payloads that were sent at a later point in time.
For RCON, commands longer than 50 characters may end up being executed after shorter commands sent after it.


## Defining Link Messages

You will most likely have to communicate with the controller or other instances in your plugin for it to do anything useful.
For this there's a WebSocket communication channel established between the hosts and the controller that plugins can define their own messages to send over it.
This channel is bi-directional and all messages sent over it are validated with a JSON schema (see [this guide][guide] for an introduction to writing JSON schema).

[guide]: https://json-schema.org/learn/getting-started-step-by-step.html

There are currently two kinds of messages that can be defined: events and requests.
Events are simple one-way notifications that invoke a handler on the target it's sent to.
Requests are pairs of request and response messages where the request is sent to the target and the response is the reply back from the target.
The requests are similar to HTTP requests, except both parties of a link may initiate one.

Messages are defined as items of the `plugin.messages` array exported by `index.js`.
For example, the following could be defined in `plugin`:

```js
messages: [
    class Frobnicate {
        static plugin = "foo_frobber"; // Plugin name
        static type = "request";
        static src = "controller";
        static dst = "instance";
        static jsonSchema = {
            type: "object",
            properties: {
                "verbosity": { type: "integer" },
                "special": { type: "boolean" },
            },
            required: ["verbosity"],
            additionalProperties: false,
        };
        constructor(json) {
            this.verbosity = json.verbosity;
            this.special = json.special;
        }
        static fromJSON(json) {
            return new Frobnicate(json);
        }
        toJSON() {
            return {
                verbosity: this.verbosity,
                special: this.special,
            };
        }
        static Response = {
            jsonSchema: {
                type: "object",
                properties: {
                    "report": {
                        type: "array",
                        items: { type: "string" },
                    },
                },
            },
            fromJSON(json) {
                return json
            }
        }
    }
]
```

This specifies a request that can be sent from the controller to an instance, being routed through the correct host behind the scenes.
The request data must contain the property `verbosity` with an integer number as the value, and it may also contain a boolean `special` property.
It also defines that the response sent may contain a `report` property mapping to an array of strings.

The following properties are recognized as part of a message class:

#### static plugin

Must contain the name of the plugin this message is defined by.
This property is not used in core messages.

#### static type

A string describing the message type sent over the wire.
This can be either `"request"` or `"event"`.
The primary difference is whether they allow for a response.

#### static src

A string or an array of strings describing where this message is allowed to originate from.
The available endpoints are `"controller"`, `"host"`, `"instance"`, or `"control"`.
Messages sent from a different source will be rejected.

#### static dst

A string or array of strings describing where this message may be addressed to.
The available endpoints are `"controller"`, `"host"`, `"instance"`, or `"control"`.
If the target is multiple hops away it the message will be forwarded towards its destination by the intermediaries.
For example a message sent from a control connection an instance will be forwarded by the controller to the relevant host and from the host to the correct instance.
Messages sent to a different destination will be rejected.

#### static jsonSchema

A JSON schema that specifies what's valid to send in the message.

#### toJSON

Optional method to serialize an instance of the class to a JSON object, see the [documentation for `JSON.stringify()`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/JSON/stringify#description) for the semantics of this method.
This should return an object that's valid according to `jsonSchema` and accepted by `fromJSON`, and may be omitted if the default serialisation by `JSON.stringify()` already does this.

#### static fromJSON

Required function to restore the class from a JSON object.
This function is called when the message reaches its destination and is expected to return an identical instance of the class.
I.e. the result of `fromJSON(JSON.parse(JSON.stringify(instance)))` should be a complete copy of the message.

#### static Response

Optional [JSON sterilisable class](/docs/devs/json-serialisable-classes.md) that specifies the response to the request.
Required properties are `jsonSchema` and `fromJSON`.

## Sending Link Messages

Link messages are sent by calling the `.sendTo()` method on a connection object with the destination and the data you want to send, where the data is an instance of one of the defined message classes in plugin.messages.
For example:

```js
// In an InstancePlugin class
async frobnicate() {
    const response = await this.instance.sendTo("controller", new messages.Frobnicate({ 
        verbosity: 2,
        special: false,
    }));
    console.log(response); // { report: [...] }
}
```

For classes with `static type = "request"` the send method is async and returns a promise that resolves to the response data received from the target it was sent to, or rejects with an error if the request failed.
The destination specification can either be the ID of a particular control, host or instance, or one of the keywords used to send to multiple targets at once.

Example destinations:

```js
sendTo("controller", message);
sendTo("allHosts", message);
sendTo("allControls", message);
sendTo("allInstances", message);
sendTo({ hostId: 123 }, message);
sendTo({ instanceId: 123 }, message);
sendTo({ controlId: 123 }, message);
```

### Handling connection events

There are a few connection related events that plugins neeed to repsond to in order to avoid data loss and connection problems.
The most important is the prepare disconnect for the link between controller and host.
This is signaled to `ControllerPlugin` classes via the `onPrepareHostDisconnect` hook and to `InstancePlugin` classes via the `onPrepareControllerDisconnect` hook.

After the prepare disconnect the connection will be closed, which will result in pending requests and events being dropped.
Plugins must respond to the prepare disconnect by stopping any processess it does that send events or requests over the link in question.
This can be accomplished either through listening for the prepare disconnect hook, or by checking the `connected` property of the `HostConnection` class and `Host` class on the controller and host respectively.
For example the sending of an event from an `InstancePlugin` class can be stopped while the connection is not connected, not in the dropped state, and not in the process of discunnecting by using the following code:

```js
if (this.host.connected) {
    this.instance.sendTo("controller", new messages.Frobnicate({ foo: "bar" }));
}
```

If the event or request needs to be sent to the controller it can be put into a queue stored on the plugin instance and sent out when the connection is established again.
The re-establishement of the connection is  notified to plugins via the `connect` event to the `onControllerConnectionEvent` and `onHostConnectionEvent` hooks.

The second connection event which is of lesser importance to respond to is the `drop` connection event served through `onControllerConnectionEvent` for `InstancePlugin` classes and through `onHostConnectionEvent` for `ControllerPlugin` classes.
This is raised when the connection between the controller and host in question is lost, most likely due to networking issues.
When in the dropped state the host will keep trying to reconnect to the controller in order to re-establish it, and if successful no events or requests will be lost.
However while in the dropped state any requests and events sent gets queued up in memory until the connection is either re-established or the session times out.
This means that if your plugin sends a lot of events or requests, they can end up being queued up in a buffer and sent out all at once the connection is re-estabished.
To avoid this you should be throtteling and/or stopping your requests/events after `drop` has been raised, and continue back as normal when `resume` is raised.


## Collecting Statistics

Clusterio comes with its own Prometheus client implementation, one part due to Not Invented Here and another part due to collectors in prom-client being difficult to get to work nicely with collecting data from plugins optionally loaded at runtime on different computers.

In its simplest form collecting data from plugins consists of defining the metric and updating it somewhere in the plugin code.
For example:

```js
const { Counter } = require("@clusterio/lib");

const fooMetric = new Counter(
    "clusterio_foo_frobber_foo_metric", "Measures the level of foo",
);

// Somewhere in the controller plugin code
fooMetric.inc();
```

This works for controller plugins, and the metric will be automatically available through the /metric HTTP endpoint.
It's recommended that plugin metrics follow `clusterio_<plugin_name>_<metric_name>` as the naming scheme.

For metrics that are per-instance, you must define an `instance_id` label and set it accordingly, for example:

```js
const { Counter } = require("@clusterio/lib");

const barMetric = new Gauge(
    "clusterio_foo_frobber_bar_metric", "Bar instance level",
    { labels: ["instance_id"] }
);

// Somewhere in the instance plugin code
barMetric.labels(String(this.instance.id)).set(someValue);
```

Metrics are automatically registered to the default registry, and this default registry is automatically polled by the controller on hosts.
This means that it's important that you place the definition of the metric at module level so that it's not created more than once over the lifetime of a host.
Since the metrics remember their values and would continue to be exported after an instance is shutdown, there's code at instance shutdown that removes all the values where the `instance_id` label matches the id of the instance shut down.

For statistics you need to update on collection there's an `onMetrics` hook on both controller and instance plugins that is run before the metrics in the default registry are collected.


## Adding Custom Commands to clusterioctl

The control entrypoint for plugins allows you to extend clustectl with your own commands.
The creation of custom commands typically starts with defining a command tree for the plugin:

```js
const { Command, CommandTree } = require("@clusterio/lib");
const fooFrobberCommands = new CommandTree({
    name: "foo-frobber", description: "Foo Frobber Plugin commands"
});
```

Then commands are added to the the plugin's command tree:

```js
const info = require("./info");

fooFrobberCommands.add(new Command({
    definition: ["frobnicate <type>", "Do frobnications", (yargs) => {
        yargs.positional("level", {
            describe: "type of frobnication", type: "string"
        });
    }],
    handler: async function(args, control) {
        await info.messages.frobnicate.send(control, {
            instance_name: "Console",
            content: args.message,
        });
    },
}));
```

For a command the `definition` is the arguments to pass to [yargs.command](http://yargs.js.org/docs/#api-reference-commandcmd-desc-builder-handler) (see also [yargs.positional](http://yargs.js.org/docs/#api-reference-positionalkey-opt) and [yargs.options](http://yargs.js.org/docs/#api-reference-optionskey-opt) for setting up positional and optional arguments to commands).
The `handler` is an async function that's invoked when the command is executed and it's passed the parsed command line arguments and a reference to the `Control` class of clusterioctl.
It's possible to optain a reference to the plugin class with `control.plugins.get(info.name)`.

Note that messages sent from clusterioctl needs to have `"control-controller"` as a part of the links array for it to be accepted by the controller, see [Defining Link Messages](#defining-link-messages) for how to define the messages that can be sent to the controller.

To have the command tree become part of clusterioctl it needs to be added to the rootCommand tree in `addCommands` callback of the Ctl plugin:

```js
const { BaseCtlPlugin } = require("@clusterio/ctl");

class CtlPlugin extends BaseCtlPlugin {
    async addCommands(rootCommand) {
        rootCommand.add(fooFrobberCommands);
    }
}

module.exports = {
    CtlPlugin,
}
```
