# Migrating Plugins to 2.1

This guide covers the changes needed to bring a plugin written for 2.0 up to 2.1.
Plugins still on an alpha release should start with the [2.0 guide](plugin-migration-to-2.0.md).


## Build the web module with Vite

The web interface is now built with Vite instead of webpack, and plugin web modules are loaded as ES modules instead of through Module Federation.
A plugin built with webpack fails to load with the error "Incompatible dist/web/manifest.json, the plugin must be rebuilt with Vite".

Delete `webpack.config.cjs` and add a `vite.config.js` next to `package.json`:

```js
import { defineConfig } from "vite";
import { clusterioPlugin } from "@clusterio/web_ui/vite.mjs";

export default defineConfig({
	plugins: [clusterioPlugin()],
});
```

In `package.json` replace `webpack-cli --mode production` in the `prepare` script with `vite build`, and replace the `webpack`, `webpack-cli` and `webpack-merge` dev dependencies with `vite`.
Add `vite.config.js` to `.npmignore` if you had `webpack.config.js` there.

`clusterioPlugin` exposes `index.ts` (or `index.js`) as `"./"`, `package.json` as `"./package.json"` and `web/index.tsx` (or `.ts`, `.jsx`, `.js`) as `"./web"`.
These are the same keys the plugin template used with webpack, so `webEntrypoint: "./web"` stays as it is.
If your webpack config exposed other paths, move the code so it is reachable from `web/index.tsx`.

The web interface provides `@clusterio/lib`, `@clusterio/web_ui`, `@sinclair/typebox`, `antd`, `react`, `react-dom`, `react-router` and `react-router-dom` to plugins.
These are left as imports in the plugin bundle and resolved by the browser, there is no need to list them as shared.
Everything else is bundled into the plugin, including `@ant-design/icons`.
Import `react-dom/client` and `react/jsx-runtime` by those names, other subpaths of the shared packages are bundled as a separate copy.

Vite does not provide Node.js modules to plugin code.
If your web code imports `events`, `path` or similar, add the browser package for it (`events`, `path-browserify`) to your dependencies.

The `container` property of `WebPluginContext` is now the plugin's ES module namespace, `await container.get("./web")` returns the module instead of a factory function.
