# Migrating Plugins to Alpha 14

Between version 2.0.0-alpha.13 and 2.0.0-alpha.14 the codebase underwent major refactoring and was ported to TypeScript.
In order to support alpha 14 there are several major changes that need to be done to existing plugins, these are in no particular order


## Rename master and slave

All references to slave and master in the code was renamed to controller and host respectively which means that code referencing these in plugins must be renamed.
In short this means performing a global search and replace on the codebase replacing:

- `master` with `controller`
- `Master` with `Controller`
- `slave` with `host`
- `Slave` with `Host`

in all places it occurs, even as part of longer names such as changing `BaseMasterPlugin` to `BaseControllerPlugin`.


## Change lib imports to import directly from the top level package

Previously code could import sub packages of lib such as lib/lua_tools.
These imports need to be changed to all import from lib directly.

**Alpha 13**
```js
const libLuaTools = require("@clusterio/lib/lua_tools");
const libErrors = require("@clusterio/lib/errors");

// Using imports
new libErrors.RequestError(...)
libLuaTools.escapeString(...)
```

**Alpha 14 (JS)**
```js
const lib = require("@clusterio/lib");

// Using library components
new lib.RequestError(...)
lib.escapeString(...)
```

**Alpha 14 (TS)**
```ts
import * as lib from "@clusterio/lib";

// Using library components
new lib.RequestError(...)
lib.escapeString(...)
```


## Change import of base plugins

Previously `BaseMasterPlugin` and `BaseInstancePlugin` were imported from `@clusterio/lib`, these have been moved to `@clusterio/controller` and `@clusterio/host` respectively.

**Alpha 13**
```js
const { BaseMasterPlugin } = require("@clusterio/lib");
const { BaseInstancePlugin } = require("@clusterio/lib");
```

**Alpha 14 (JS)**
```js
const { BaseControllerPlugin } = require("@clusterio/controller");
const { BaseInstancePlugin } = require("@clusterio/host");
```

**Alpha 14 (TS)**
```ts
import { BaseControllerPlugin } from "@clusterio/controller";
import { BaseInstancePlugin } from "@clusterio/host";
```


## Change main entrypoint of plugin

Previously the info of a plugin would be loaded by requiring `./plugin_dir/info`, this has been changed to require `./plugin_dir` which in turn means that `info.js` is no longer the default entrypoint.
To solve this you can either add `"main": "info.js",` to package.json or rename `info.js` to `index.js` (the rest of this guide assumes the entrypoint was renamed to `index.js`).
The motivation behind this change was to allow TypeScript to output its build to a sub-folder of the plugin, if you're using TypeScript you'll likely have the entrypoint be located in `dist/index.js` instead.

The expected place where the declaration of a plugin is exported has also changed from `module.exports` to `module.exports.plugin`:

**Alpha 13**
```js
// info.js
module.exports = {
    name: "plugin_name",
    ...
}
```

**Alpha 14 (JS)**
```js
// index.js
const plugin = {
    name: "plugin_name",
    ...
}

module.exports = {
    plugin,
};
```

**Alpha 14 (TS)**
```ts
// index.ts
import type * as lib from "@clusterio/lib";

export const plugin: lib.PluginDeclaration = {
    name: "plugin_name",
    ...
};
```


### Modify exposed path in webpack.config.js

The `./info` import path exposed in the ModuleFederationPlugin in the `webpack.config.js` needs to be changed to `./`.
E.g.:

**Alpha 13**
```js
// In webpack.config.js
new webpack.container.ModuleFederationPlugin({
    ...
    exposes: {
        "./info": "./info.js",
        ...
    },
}),
```

**Alpha 14**
```js
// In webpack.config.js
new webpack.container.ModuleFederationPlugin({
    ...
    exposes: {
        "./": "./index.js",
        ...
    },
}),
```

## Remove usage of ConfigGroup

The Config system was refactored and the `ConfigGroup` concept was completely removed.
Config fields are now defined directly on the exported plugin info.

**Alpha 13**
```js
const lib = require("@clusterio/lib");

class MasterConfigGroup extends lib.PluginConfigGroup { }
MasterConfigGroup.groupName = "plugin_name";
MasterConfigGroup.defaultAccess = ["master", "control"];
MasterConfigGroup.define({
    name: "option",
    title: "Option",
    description: "A config option.",
    type: "string",
    optional: true,
});

module.exports = {
    name: "plugin_name",
    MasterConfigGroup,
    ...
}
```

**Alpha 14 (JS)**
```js
const plugin = {
    name: "plugin_name",
    controllerConfigFields: {
        "plugin_name.option": {
            title: "Option",
            description: "A config option.",
            type: "string",
            initial_value: "foo",
            optional: true,
        },
    },
    ...
}

module.exports = {
    plugin,
};
```

**Alpha 14 (TS)**
```ts
import type * as lib from "@clusterio/lib";

// Declare the type of the field to make the type of controller.config.get(field) correctly deduced.
declare module "@clusterio/lib" {
    export interface ControllerConfigFields {
        "plugin_name.option": null | string;
    }
}

export const plugin: lib.PluginDeclaration = {
    name: "plugin_name",
    controllerConfigFields: {
        "plugin_name.option": {
            title: "Option",
            description: "A config option.",
            type: "string",
            initialValue: "foo",
            optional: true,
        },
    },
    ...
};
```


### Use onControllerConfigFieldChanged instead of listering to the fieldChanged event

**Alpha 13**
```js
this.controller.config.on("fieldChanged", (group, field, prev) => {
    if (group.name === "plugin_name" && field === "option") {
        const curr = group.get(field);
        // Do stuff with curr and or prev
    }
}
```

**Alpha 14 (JS)**
```js
async onControllerConfigFieldChanged(field, curr, prev) {
    if (field === "plugin_name.option") {
        // Do stuff with curr and or prev
    }
}
```

**Alpha 14 (TS)**
```ts
async onControllerConfigFieldChanged(field: string, curr: unknown, prev: unknown) {
    if (field === "plugin_name.option") {
        // Do stuff with curr and or prev
    }
}
```

## Redefine link messages as classes

The link layer has been majorly refactored and Request and Events are now defined as [JSON Serialisable Classes](./json-serialisable-classes.md).

**Alpha 13**
```js
module.exports = {
    name: "plugin_name",
    messages: {
        forwarded: new lib.Event({
            type: "plugin_name:forwarded",
            links: ["instance-slave", "slave-master"],
            forwardTo: "master",
            eventProperties: {
                "string_value": { type: "string" },
                "number_value": { type: "number" },
            },
        }),
        simple: new lib.Request({
            type: "plugin_name:simple",
            links: ["master-slave", "slave-instance"],
            forwardTo: "instance",
            requestProperties: {
                "instance_id": { type: "number" },
                "string_value": { type: "string" },
            },
            responseProperties: {
                "number_value": { type: "number" },
            },
        }),
    },
};
```

**Alpha 14 (JS)**
```js
const lib = require("@clusterio/lib");

class ForwardedEvent {
    static type = "event";
    static src = "instance";
    static dst = "controller";
    static plugin = "plugin_name";

    constructor(stringValue, numberValue) {
        this.stringValue = stringValue;
        this.numberValue = numberValue;
    }

    static jsonSchema = {
        type: "object",
        required: ["stringValue", "numberValue"],
        properties: {
            "stringValue": { type: "string" },
            "numberValue": { type: "number" },
        },
    };

    static fromJSON(json) {
        return new this(json.stringValue, json.numberValue);
    }
}

class SimpleRequest {
    static type = "request";
    static src = "controller";
    static dst = "instance";
    static plugin = "plugin_name";

    constructor(stringValue) {
        this.stringValue = stringValue;
    }

    static jsonSchema = {
        type: "object",
        required: ["stringValue"],
        properties: {
            "stringValue": { type: "string" },
        },
    };

    static Response = lib.JsonNumber
}

const plugin = {
    name: "plugin_name",
    messages: [
        ForwardedEvent,
        SimpleRequest,
    ],
    ...
};

module.exports = {
    plugin,
    ForwardedEvent,
    SimpleRequest,
}
```

**Alpha 14 (TS)**
```ts
import * as lib from "@clusterio/lib";
import { Static, Type } from "@sinclair/typebox";

export class ForwardedEvent {
    declare ["constructor"]: typeof ForwardedEvent;
    static type = "event" as const;
    static src = "instance" as const;
    static dst = "controller" as const;
    static plugin = "plugin_name" as const;

    constructor(
        public stringValue: string,
        public numberValue: number,
    ) { }

    static jsonSchema = Type.Object({
        "stringValue": Type.String(),
        "numberValue": Type.Number(),
    });

    static fromJSON(json: Static<typeof this.jsonSchema>) {
        return new this(json.stringValue, json.numberValue);
    }
}

export class SimpleRequest {
    declare ["constructor"]: typeof SimpleRequest;
    static type = "request" as const;
    static src = "controller" as const;
    static dst = "instance" as const;
    static plugin = "plugin_name" as const;

    constructor(
        public stringValue: string,
    ) { }

    static jsonSchema = Type.Object({
        "stringValue": Type.String(),
    });

    static fromJSON(json: Static<typeof this.jsonSchema>) {
        return new this(json.stringValue);
    }

    static Response = lib.JsonNumber
}

export const plugin: lib.PluginDeclaration = {
    name: "plugin_name",
    messages: [
        ForwardedEvent,
        SimpleRequest,
    ],
    ...
}
```

### Refactor message sending

Message handlers are now explicitly registered instead of relying on magic name lookups that don't make sense unless you know them.

**Alpha 13**
```js
const lib = require("@clusterio/lib");

class ControllerPlugin extends lib.BaseControllerPlugin {
    // event name is magically created by concatenating EventHandler or
    // RequestHandler to the name in the messages export in in info.js.
    async forwardedEventHandler(message) {
        // message.data contains the raw JSON data sent.
        if (message.data.string_value) {
            // ...
        }
    }
}
```

**Alpha 14 (JS)**
```js
const { BaseControllerPlugin } = require("@clusterio/lib");
const { ForwardedEvent } = require("./index.js");

class ControllerPlugin extends BaseControllerPlugin {
    async init() {
        // Explicit binding between message class and the handler for it
        this.controller.handle(ForwardedEvent, this.handleForwardedEvent.bind(this));
        // Note: On an instance plugin you would use this.instance.handle
    }

    async handleForwardedEvent(event, src, dst) {
        // Event is an instance of the ForwardedEvent class
        if (event.stringValue) {
            // ...
        }

        // src and dst are instances of lib.Address and describe where
        // the message came from and who it was addressed to.
    }

    ...
}

module.exports = {
    ControllerPlugin,
}
```

**Alpha 14 (TS)**
```ts
import * as lib from "@clusterio/lib";
import { BaseControllerPlugin } from "@clusterio/controller";
import { ForwardedEvent } from "./index.js";

export class ControllerPlugin extends BaseControllerPlugin {
    async init() {
        // When using TypeScript this call is type checked to make sure the handler accepts the right class.
        this.controller.handle(ForwardedEvent, this.handleForwardedEvent.bind(this));
        // Note: On an instance plugin you would use this.instance.handle
    }

    async handleForwardedEvent(event: ForwardedEvent, src: lib.Address, dst: lib.Address) {
        // Event is an instance of the ForwardedEvent class
        if (event.stringValue) {
            // ...
        }

        // src and dst describe where the message came from and who it was addressed to.
    }

    ...
}
```


### Refactor message sending

Message are now addressed end to end instead of using the confusing forwardTo and broadcastTo properties of the message definition.
When broadcasting events the special `"allInstances"`, `"allHosts"`, and `"allControls"` shorthand addresses can be used.
There's two methods for sending messages `.send` and `.sendTo` where `.send` is a shorthand for `.sendTo` with an address filled in as the other side of the link, this is mostly only useful in control plugins where the other side of the link is the controller.

**Alpha 13**
```js
// from instance plugin
this.info.messages.forwarded.send(this.instance, {
    string_value: "foo",
    number_value: 123,
});

// from master plugin
const instance_id = ...
const response = await this.forwardRequestToInstance(this.info.messages.simple, {
    instance_id,
    string_value: "foo",
});
const value = response.number_value;
```

**Alpha 14**
```js
const { ForwardedEvent } = require("./info.js");

// from instance plugin
this.instance.sendTo("controller", new ForwardedEvent("foo", 123));

// from controller plugin
const instanceId = ...
const value = await this.controller.sendTo({ instanceId }, new SimpleRequest("foo"));
// if using TypeScript then the type of value will be inferred as number here
```
