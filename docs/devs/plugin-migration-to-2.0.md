# Migrating Plugins to 2.0

This guide covers the changes needed to bring a plugin written for 2.0.0-alpha.27 up to 2.0.0.
If your plugin targets an older alpha, go through the Breaking Changes sections in the [changelog](/CHANGELOG.md) for the versions in between first.
Plugins still on alpha 13 should start with the [alpha 14 guide](plugin-migration-to-alpha-14.md).


## Versioning from 2.0

From 2.0.0 onwards a major version (3.0.0) contains breaking changes for users running a cluster, while a minor version (2.1.0) may contain breaking changes for the plugin API.
This means a plugin written for 2.0 is not guaranteed to work with 2.1 without changes.
Check the Breaking Changes section of the changelog when a new minor version is released and publish an update to your plugin if needed.
See [Breaking Changes](/docs/decisions.md#breaking-changes) in the decision log.


## Convert to ES modules

Clusterio's packages are now ES modules and plugins should be too.
Add `"type": "module"` to the plugin's `package.json` and replace `require()` and `module.exports` with `import` and `export`.

Relative imports must include the full filename with the `.js` extension.
This also applies in TypeScript, where you import `./messages.js` even though the source file is `messages.ts`.
Importing a directory no longer resolves to its `index.js`.

**Alpha 27**
```js
"use strict";
const lib = require("@clusterio/lib");
const messages = require("./messages");

const plugin = {
    name: "foo_frobber",
    controllerEntrypoint: "controller",
    messages: [messages.Frobnicate],
};

module.exports = {
    plugin,
};
```

**2.0**
```js
import * as lib from "@clusterio/lib";
import * as messages from "./messages.js";

export const plugin = {
    name: "foo_frobber",
    controllerEntrypoint: "controller.js",
    messages: [messages.Frobnicate],
};
```

The entrypoint paths in the plugin declaration must include the `.js` extension as well, for TypeScript plugins this means `"./dist/node/controller.js"` instead of `"./dist/node/controller"`.

`__dirname` and `__filename` do not exist in ES modules, use `import.meta.dirname` and `import.meta.filename` instead.
JSON files are imported with `import packageJson from "./package.json" with { type: "json" };`.

A `webpack.config.js` written with `require()` stops working once the package is an ES module.
Rename it to `webpack.config.cjs`, webpack-cli finds it under that name without further changes.
If your `prepare` script passes `--config webpack.config.js` update it to the new name.

TypeScript plugins using `"module": "node16"` in their tsconfig, as the plugin templates do, emit ES modules once `"type": "module"` is set and need no further config changes.

Node.js can still import a CommonJS plugin, but it only finds the `plugin` export if it can detect it from the source, which works for `module.exports = { plugin };` and fails for other forms such as an object literal written in place.
Converting the plugin avoids the problem.


## Replace plugin classes with entrypoint functions

Entrypoints now export a default async function instead of a class deriving from `BaseControllerPlugin`, `BaseHostPlugin`, `BaseInstancePlugin`, `BaseCtlPlugin` or `BaseWebPlugin`.
The function is called once when the plugin loads and attaches handlers to the hooks it needs.
Class exports still load, but they are deprecated and a warning is logged for each one.
See [Defining the plugin entrypoint](/docs/writing-plugins.md#defining-the-plugin-entrypoint) for the details.

**Alpha 27**
```js
const { BaseControllerPlugin } = require("@clusterio/controller");

class ControllerPlugin extends BaseControllerPlugin {
    async init() {
        this.controller.handle(Frobnicate, this.handleFrobnicate.bind(this));
    }

    async onSaveData() {
        await this.saveFrobnicationData();
    }

    async onInstanceStatusChanged(instance, prev) {
        this.logger.info(`Instance ${instance.id} went from ${prev} to ${instance.status}`);
    }

    async handleFrobnicate(request) { /* ... */ }
}

module.exports = {
    ControllerPlugin,
};
```

**2.0 (JS)**
```js
export default async function(context) {
    const { controller, logger, plugin } = context;

    controller.handle(Frobnicate, async (request) => { /* ... */ });

    controller.hooks.save.attach(plugin.name, async () => {
        await saveFrobnicationData();
    });

    controller.hooks.instanceStatusChanged.attach(plugin.name, async (instance, prev) => {
        logger.info(`Instance ${instance.id} went from ${prev} to ${instance.status}`);
    });
}
```

**2.0 (TS)**
```ts
import type { ControllerPluginContext } from "@clusterio/controller";

export default async function(context: ControllerPluginContext) {
    // Same as above
}
```

The code from `init()` goes into the body of the function, and state that lived on `this` becomes local variables.
The context types are `ControllerPluginContext`, `HostPluginContext`, `InstancePluginContext`, `CtlPluginContext` and `WebPluginContext` from the respective packages.


### Method to hook names

Each `on*` method has a hook of the same name without the `on` prefix and with the first letter lowercased, so `onInstanceStatusChanged` becomes `controller.hooks.instanceStatusChanged`.
The exceptions are:

- `onSaveData` on the controller is `controller.hooks.save`.
- `addCommands` on ctl plugins is `context.hooks.addCommands`.
- The `pages`, `loginForms` and `inputComponents` properties of web plugins are the `pages`, `loginForms` and `inputComponents` hooks on `control.hooks`, with handlers that return the value.
- The `componentExtra` property of web plugins is the `control.hooks.extensionComponents` hook.

Controller hooks are on `controller.hooks`, host hooks on `host.hooks`, instance hooks on `instance.hooks`, and web hooks on `control.hooks`.
The ctl hooks are passed directly as `context.hooks`.

**Alpha 27**
```jsx
class WebPlugin extends BaseWebPlugin {
    async init() {
        this.pages = [
            { path: "/foo_frobber", sidebarName: "Foo Frobber", content: <FrobberPage/> },
        ];
    }
}
```

**2.0**
```jsx
export default async function(context) {
    const { control, plugin } = context;

    control.hooks.pages.attach(plugin.name, () => [
        { path: "/foo_frobber", sidebarName: "Foo Frobber", content: <FrobberPage/> },
    ]);
}
```


### Replacing other class members

The class properties are on the context object passed to the entrypoint:

- `this.info` is `context.plugin`.
- `this.logger` is `context.logger`.
- `this.controller`, `this.host`, `this.instance` and `this.control` are `context.controller`, `context.host`, `context.instance` and `context.control`.
- `this.metrics` on controller plugins is `context.metrics`.
- `this.package` on web plugins is `context.package`.

The helper methods of the base classes have the following replacements:

- `this.sendRcon(message, expectEmpty)` is `instance.sendRcon(message, expectEmpty, plugin.name)`.
  The plugin name is used to label the RCON metrics.
- `this.broadcastEventToHosts(event)` is `controller.sendTo("allHosts", event)`.
- `this.sendOrderedRcon(message)` has no replacement.
  If your plugin needs commands to execute in order, queue them in the plugin and send the next one after the previous one resolves.


### Changes to hook behaviour

Handlers attached by different plugins to the same hook now run concurrently, where the `on*` methods were called one plugin at a time.
Don't rely on another plugin's handler having finished before yours runs.

A handler that throws or takes more than 15 seconds is logged and does not prevent the other handlers from running.
Each hook accepts one handler per name, attach it under `plugin.name`.


## Accessing other plugins

The `plugins` map on `Controller`, `Host` and `Instance` has been removed.
It's replaced with `loadedPlugins`, a set of the plugin info objects for the plugins that loaded.
To check if a plugin is loaded on the controller:

```js
const loaded = [...controller.loadedPlugins].some(info => info.name === "other_plugin");
```

In the web interface `control.loadedPlugins` is a map from plugin name to plugin info.
`control.plugins` is deprecated and only holds plugins still using the class export.

With no plugin class instances, `controller.plugins.get("other_plugin")` has no direct replacement.
If one plugin needs to call into another, have the other plugin export functions from its module and import them.
State that's tied to a particular controller, host or instance can be kept in a `WeakMap` keyed by that object:

```js
// In other_plugin/controller.js
const frobbers = new WeakMap();

export function getFrobber(controller) {
    return frobbers.get(controller);
}

export default async function(context) {
    frobbers.set(context.controller, new Frobber(context));
}
```

For state shared between components of a web plugin, assign it to a module level variable in the entrypoint.
The web plugin template created by `@clusterio/create` shows this for a subscriber.


## Declare permissions on the plugin

Permissions can now be declared under `permissions` in the plugin declaration instead of with `lib.definePermission()`.
`lib.definePermission()` still works, but don't use both for the same permission name.

For TypeScript plugins `user.checkPermission()`, `account.hasPermission()` and the `permission` of web pages now only accept known permission names.
Add your permission names to the `Permissions` interface or these calls will fail to compile, even if you keep using `lib.definePermission()`:

```ts
declare module "@clusterio/lib" {
    export interface Permissions {
        "foo_frobber.frobnicate": never;
    }
}
```

The plugin template's `tsconfig.browser.json` now includes `index.ts` so the web build also sees the declaration, add it to the `include` list if your plugin has its own tsconfig for the browser.
See [Plugin Permissions](/docs/writing-plugins.md#plugin-permissions).


## Renamed ctl classes and config

The remaining uses of "control" for clusterioctl were renamed to "ctl":

- `controlConfigFields` in the plugin declaration is `ctlConfigFields`.
  Fields under the old name are silently ignored.
- The `ControlConfigFields` interface is `CtlConfigFields`.
- `lib.ControlConfig` is `lib.CtlConfig`.
- The `Control` class exported by `@clusterio/ctl` is `Ctl`.

The term "control" is still used in message `src` and `dst` and in config field locations, where it covers both ctl and the web interface.


## Static assets in the web interface

`staticRoot` now includes the `static/` prefix.
Plugins that fetch assets with `${staticRoot}static/...` should drop the `static/` part.


## Package dependencies

npm installs peer dependencies by default, so listing `@clusterio/web_ui` under `peerDependencies` installs it everywhere the plugin is installed even though it's only needed to build the web bundle.
Move `@clusterio/web_ui` to `devDependencies` and mark `@clusterio/controller`, `@clusterio/host` and `@clusterio/ctl` as optional in `peerDependenciesMeta`:

```json
"peerDependencies": {
    "@clusterio/controller": "^2.0.0",
    "@clusterio/host": "^2.0.0",
    "@clusterio/lib": "^2.0.0"
},
"peerDependenciesMeta": {
    "@clusterio/controller": {
        "optional": true
    },
    "@clusterio/host": {
        "optional": true
    }
}
```
