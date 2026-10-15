# Working on Clusterio

Clusterio manages distributed Factorio servers through a controller, hosts, and plugins.
Use this file as a development and debugging entry point for the whole repository.
Follow the current source, package scripts, and CI configuration when details differ from older documentation.


## Finding the relevant code

Start with the project map below and read the relevant implementation and tests before editing.
Use focused source searches for the behavior or symbols involved, and verify findings against the current checkout.


## Project map

| Location | Responsibility |
| --- | --- |
| `packages/controller/` | Central cluster state, users/roles, host and control connections, HTTP API, and serving the web UI. Start with `src/Controller.ts` and `src/ControlConnection.ts`. |
| `packages/host/` | Host connection, instance lifecycle, Factorio processes, save patching, and data export. Start with `src/Host.ts`, `src/Instance.ts`, `src/server.ts`, and `src/patch.ts`. |
| `packages/ctl/` | Command-line administration client and plugin commands. |
| `packages/lib/` | Shared messages, routing/connectors, configuration, permissions, plugin loading, logging, and utilities. Used by both Node and browser code. |
| `packages/web_ui/` | React/Ant Design interface and browser control connection; bundled through the controller's webpack build. |
| `packages/create/` | Installer and JavaScript/TypeScript plugin templates. |
| `plugins/` | Bundled plugins, including their Node, web, Lua, and test code. |
| `external_plugins/` | Workspace location for separately developed plugins; may contain independent repositories. |
| `packages/host/modules/` | Lua modules injected into saves. |
| `packages/host/lua/` | Factorio mod sources, including `clusterio_lib`. |
| `test/` | Root Mocha suite, fixtures, shared helpers, integration harness, and manual tests. Plugin tests also live under `plugins/*/test/`. |

Read [contributing](docs/contributing.md) for style and workflow and [decisions](docs/decisions.md) for compatibility policies.
Use [how it works](docs/how-it-works.md), [communication](docs/communication.md), and [config system](docs/config-system.md) for architecture.
Use [writing plugins](docs/writing-plugins.md) and [developing for Clusterio](docs/developing-for-clusterio.md) for plugin and Factorio integration contracts.


## Setup and build

Run commands from the repository root unless stated otherwise.
Use Node.js 22 or newer and the pnpm version pinned in root `package.json` (`packageManager`).
The workspace layout and shared dependency catalog are in `pnpm-workspace.yaml`.
Keep shared versions in that catalog and follow existing `catalog:` and `workspace:` dependency conventions.
`pnpm-lock.yaml` is intentionally ignored; do not force-add it or assume a frozen-lockfile install is supported.

| Command | Purpose |
| --- | --- |
| `pnpm install --no-frozen-lockfile` | Install/link workspace dependencies and run package preparation scripts. |
| `pnpm build` | Compile TypeScript project references. |
| `pnpm watch` | Recompile TypeScript as files change. Restart affected Node processes afterward. |
| `pnpm run -r --if-present prepare` | Run package preparation, including validator generation and production web bundles where defined. |
| `pnpm --filter @clusterio/lib run prepare` | Compile lib and regenerate its core wire-message validator. Use after changing the schema in `packages/lib/src/data/messages_core.ts`. |
| `pnpm --filter @clusterio/controller run prepare` | Compile the controller and build its production web bundle. |
| `pnpm build-mod` | Build Factorio mod archives into root `dist/`. |
| `pnpm docs` | Generate API documentation with TypeDoc. |

`pnpm build` alone does not regenerate the standalone validator or webpack bundles.
Edit source files, not `dist/`, generated API docs, or `message_validate.js`; regenerate outputs through their scripts.
For recursive operations targeting release packages, use explicit `--filter='./packages/*' --filter='./plugins/*' --fail-if-no-match` selectors.
Do not assume brace expansion inside a quoted pnpm filter selects both directories.


## Local development and debugging

For a fresh development cluster, run `node packages/create --dev` after installing dependencies.
This creates local configuration and runtime data; inspect existing configuration before reinitializing an established checkout.
The repository entry points are:

```sh
node --enable-source-maps packages/controller run
node --enable-source-maps packages/host run
node --enable-source-maps packages/ctl --help
```

Run controller and host in separate terminals.
If ctl is not configured, use `node packages/controller bootstrap create-ctl-config <admin-user>` for an existing admin user.
Enable source maps when debugging so stack traces point to TypeScript source.
Confirm the process is running rebuilt code before investigating a seemingly ineffective change.

For browser development, run `node --enable-source-maps packages/controller run --dev`.
Add `--dev-plugin <name>` to rebuild a plugin's web module; external plugins should be in the workspace under `external_plugins/`.
These development modes remove production web output, so run the recursive `prepare` command before returning to normal serving.
Verify UI behavior in the browser; a successful TypeScript build does not verify rendering, permissions, or subscriptions.

For runtime failures, establish the controller/host/instance involved, Factorio version, enabled plugins, and exact reproduction first.
Trace requests through the sender, shared message definition, router, permission check, and destination handler.
Instance-starting requests can wake an instance in the host router before reaching its handler.
For game-side failures, follow `Instance.ts` into `server.ts`, save patching, and the relevant Lua module or mod.
Distinguish RCON commands into Factorio from IPC events coming back out; do not assume asynchronous responses arrive in order.
Use the existing contextual logger so host, instance, and plugin metadata remain available.

Inspect `logs/` for a development cluster and `temp/test/logs/` for integration runs; CI uploads the latter as artifacts.
For connection/recovery bugs, reproduce disconnect, reconnect, timeout, and shutdown behavior as applicable.
A cached controller status does not by itself prove the current state of a host or Factorio process.
Recovery mode intentionally disables normal plugin loading, so account for it when diagnosing missing plugin behavior.


## Tests and validation

Tests use Mocha and Node assertions, mostly as JavaScript ESM importing compiled packages.
Run tests from the root: individual package `test` scripts are often placeholders that deliberately fail.

| Command | Coverage |
| --- | --- |
| `pnpm test` | Builds TypeScript, then runs root and bundled-plugin tests, excluding `test/manual/`. |
| `pnpm fast-test` | Skips tests marked slow; still runs the remaining integration setup/tests. |
| `pnpm no-external-test` | Skips tests marked as requiring external APIs; still runs local integration tests. |
| `FAST_TEST=y NO_EXTERNAL_TEST=y pnpm test` | Combines both exclusions. |
| `pnpm lint` | ESLint over packages, plugins, and tests. |
| `pnpm cover` | Full test run with c8 coverage. |

For a focused test, build first, then select the file explicitly rather than appending it to the full-suite script:

```sh
pnpm build
NODE_EXTRA_CA_CERTS="$PWD/test/file/tls/cert.pem" pnpm exec mocha \
  --enable-source-maps --check-leaks test/lib/helpers.js
```

Replace the example file with the relevant test or use `--grep` to narrow it further.
Preserve the test TLS CA configuration for HTTPS integration tests.
Some tests import `test/integration/index.js`, which installs root hooks and starts a controller and host even for a targeted invocation.
Use `test/setup_logging.js` when an isolated test needs the shared logger configured.
Reuse `test/mock.js` and helpers in `test/common.js`, including JSON round-trip/schema assertions, `slowTest`, and `externalTest`.

The integration harness uses `temp/test/`, HTTP port 8880, and HTTPS port 4443, and recreates its test configs, database, mods, and instances.
Do not run competing integration suites in the same checkout or against those same ports.
It finds Factorio through `host.factorio_directory` in root `config-host.json`, defaulting to `factorio/`.
Factorio-dependent tests can be skipped when an installation is unavailable; report those skips rather than claiming Factorio behavior was validated.
Consult [.github/workflows/node.js.yml](.github/workflows/node.js.yml) for the current Node/Factorio matrix and [manual tests](test/manual/README.md) for checks requiring a running game/UI.

For behavior changes, add a regression test at the layer that owns the behavior, including relevant failure paths.
Start with focused tests, then run `pnpm test` and `pnpm lint` for code changes when the environment permits.
Use the relevant production bundle, mod build, or manual scenario when the change affects those surfaces.
For documentation-only changes, verify paths, commands, and formatting; a full application test run is unnecessary.
Report exactly what ran, failures and skipped coverage, and what remains unverified; keep local checks and hosted CI results distinct.


## Contracts to preserve

- **Messages:** Shared definitions live in `packages/lib/src/data/` and routing/validation in `packages/lib/src/link/`.
  Keep schemas, serialization/deserialization, allowed source/destination types, permissions, registration, and handlers consistent.
  Exercise JSON round trips and invalid/unauthorized inputs when changing these contracts.
  For wire compatibility changes, also inspect `scripts/version-compat-test.js` and the CI `version-compat` job; it tests local/published controller and host combinations and requires npm access.
- **Authorization and configuration:** Controller-side permission checks are authoritative; hiding a UI control is insufficient.
  Preserve config field access rules and use the existing migration mechanisms when renaming/removing persisted fields or permissions.
  See `packages/lib/src/config/definitions.ts`, `packages/controller/src/ControlConnection.ts`, and the migration sections of the plugin docs.
- **Plugins:** Prefer the current default async entrypoint function and named hook handlers, as demonstrated by `plugins/global_chat/instance.ts`.
  Class-based `Base*Plugin` entrypoints remain supported for compatibility but are deprecated.
  Keep plugin metadata, config fields, permissions, messages, and Node/web entrypoints aligned.
  For discovery failures, inspect `packages/lib/src/load_plugin_list.ts`, `plugin-list.json`, and package metadata.
  Automatically discovered npm plugins need the `clusterio-plugin` keyword, a usable `main` (or `index.js`), and an exposed `./package.json` when using an exports map.
- **Node/browser boundaries:** Import shared public APIs through `@clusterio/lib` rather than reaching into its internals from production consumers.
  Check both `packages/lib/index.ts` and `packages/lib/browser.ts` when adding public shared exports; keep Node-only dependencies out of browser code.
  Follow the repository's ESM imports, including `.js` extensions in TypeScript relative imports.
- **Factorio/Lua:** Preserve the supported-version behavior described in `docs/decisions.md` and the existing compatibility helpers.
  Save-patched modules/scenarios use `event_handler`; direct `script.on_*` registration can overwrite other modules' handlers.
  Validate changes against relevant Factorio versions and save/load lifecycle, not just the Node build.


## Keep guidance synchronized

Treat `AGENTS.md` and affected project documentation as part of every code change.
When adding, changing, moving, or removing code, check whether the project map, commands, setup requirements, debugging steps, tests, or contracts documented here are still accurate.
Update affected guidance in the same change; do not leave known stale instructions for a later task.
Keep this file focused on durable development guidance and link to detailed docs instead of duplicating them.

If you encounter a discrepancy between `AGENTS.md`, other documentation, and the actual source, scripts, tests, or observed behavior, explicitly warn the user.
Identify the conflicting file/section, give the evidence for the discrepancy, and propose concrete edits to reconcile it.
Distinguish confirmed behavior from assumptions and intended policy: a code/docs mismatch may be a code defect, so do not silently redefine the intended behavior to match the implementation.
Apply clear documentation corrections within the authorized task and summarize them; for unrelated discrepancies or unclear intent, report the proposed edits and any unresolved decision without expanding the implementation scope.
Before handing off, verify that guidance affected by your changes is synchronized and list any discrepancies still unresolved.


## Change hygiene

Match nearby code and `eslint.config.mjs`: tabs, double-quoted strings, semicolons, and a 120-character code line limit.
Use camelCase for JavaScript/TypeScript values, PascalCase for classes, and lowercase_underscore for config fields and Lua names.
Suffix non-base time units in names, such as `timeoutMs`.
Keep Markdown sentences on separate lines and follow the surrounding document format.

Inspect `git status` before editing and preserve unrelated work and external plugin checkouts.
Work on a feature branch; do not rewrite or switch an existing task branch merely to follow a generic setup recipe.
Keep fixes scoped and update affected docs/templates when changing public commands or plugin APIs.
Do not commit local configs, authentication tokens, databases, saves, logs, or generated build output.
`pnpm clean` removes build output; `node clean.js tests` also removes test artifacts; `node clean.js all` additionally deletes cluster configs and runtime data.
Inspect `node clean.js --help` and use `--dry-run` before cleanup; deleting runtime data requires explicit authorization.

Follow [.github/pull_request_template.md](.github/pull_request_template.md), including its `### Changelog` section (`None.` when appropriate).
For release work, follow [release workflow](docs/release-workflow.md), verify the actual upstream remote and current `master`, and prepare version/changelog changes in a PR.
Tagging, publishing a GitHub release, and npm/mod publication are separate release actions requiring authorization.
Publishing a GitHub release triggers publication; pushing a tag alone does not.
