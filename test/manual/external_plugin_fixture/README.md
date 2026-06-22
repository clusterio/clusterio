# External-plugin `--dev-plugin` reproduction

This is the build-capable fixture the PR's *Limitations* section noted was missing
(`test/mock_external_plugin` only exercises pnpm's dependency *resolution*, not an
actual Webpack build). It lets a reviewer reproduce, in one command, the claim that
**an external plugin cloned into the repo does NOT need `injected: true`** — being an
ordinary in-repo pnpm workspace member is enough to resolve and build it against the
single shared `react` / `react-dom` / `webpack` / `@clusterio/*`.

It lives under `test/manual/` so it is excluded from the automated mocha suite and from
linting; you run it by hand. Because controller plugin *discovery* only scans `plugins/`
and `external_plugins/` (`lib/load_plugin_list.ts` `findLocalPlugins`), this fixture is
**not** loaded by a live controller — `verify.js` validates the build/resolution path
directly instead (see *Booting it live* below).

## What it proves

The fixture deliberately requests conflicting `react@^17`, `react-dom@^17` and
`webpack@^4`, which the overrides must collapse to the single workspace copies.
`verify.js` asserts:

1. `react` resolves to a **single** copy shared with `@clusterio/web_ui`,
2. `react-dom` resolves to a **single** copy shared with `@clusterio/web_ui`,
3. the controller's `webpack` and the plugin's `webpack` are the **same** copy
   (the build-tool singleton `injected: true` is meant to provide), and
4. the `--dev-plugin` web build **compiles with no errors**.

It also prints the resolved versions so you can see `react@^17` / `react-dom@^17` /
`webpack@^4` collapse to the workspace `react@18` / `react-dom@18` / `webpack@5`.

## Reproduce

From the repository root, with the project already installed and built
(`pnpm install`):

1. **Wire the fixture into the workspace** (it is intentionally *not* committed to
   `pnpm-workspace.yaml`, to keep the lockfile clean — see the PR rationale):

   ```
   # the easy way (adds the line + installs; no injection, because it is in-repo):
   pnpm dev-plugin test/manual/external_plugin_fixture

   # or do it by hand: add this under `packages:` in pnpm-workspace.yaml
   #   - test/manual/external_plugin_fixture
   # then run: pnpm install
   ```

2. **Run the driver:**

   ```
   node test/manual/external_plugin_fixture/verify.js
   ```

   Expected tail:

   ```
   ALL CHECKS PASSED
   ```

3. **Confirm it is falsifiable** — remove the `"react"`, `"react-dom"` and
   `"webpack"` lines from `pnpm.overrides` in the root `package.json`, run
   `pnpm install`, and re-run the driver. A second `react@17` / `webpack@4` copy
   appears; the checks report `SOME CHECKS FAILED` (the build step fails because
   webpack 4 has no `webpack.container.ModuleFederationPlugin`).

4. **Clean up** (these edits are local-only and must not be committed):

   ```
   git checkout pnpm-workspace.yaml pnpm-lock.yaml package.json
   pnpm install
   ```

## Booting it live (optional)

`verify.js` proves the build/resolution. To actually load a plugin through a running
controller's `--dev-plugin`, it must live under `external_plugins/` (or `plugins/`),
which is where discovery looks — `test/manual/` is not scanned. Copy the fixture into
`external_plugins/`, wire it the same way, and start the controller with
`--dev-plugin mock_external_web`. This has been done: a live controller compiled and
served the plugin with no duplicate-dependency errors. The full external-plugin
workflow is in `docs/writing-plugins.md`.

## Symlinking from outside the repo is not supported

If instead of copying the plugin into the repo you symlink one that lives **outside**
the repository into `external_plugins/`, `--dev-plugin` builds it at that path, which
resolves to the symlink's real location and the plugin's own `node_modules` (duplicate
`react`/`webpack`). `injected: true` does **not** fix this — it only rewrites
`node_modules/<name>`, a path that build never uses. This was confirmed with a live
controller run and a before/after-injection resolution probe. Copy the plugin's source
into `external_plugins/` instead.
