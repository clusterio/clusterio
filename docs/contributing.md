# Contributing to Clusterio

You are probably reading this because you want to contribute code to Clusterio.
Great!  We need people like you.
Though we have some conventions and workflows that we kindly ask you to follow.
This document covers the development workflow, commands, and repository layout.
Read our [past decisions](/docs/decisions.md) for compatibility policies and design rationale.


## Contents

- [Project map](#project-map)
- [Workflow](#workflow)
    - [Starting a Feature Branch](#starting-a-feature-branch)
    - [Setting up the Development Environment](#setting-up-the-development-environment)
    - [Build outputs](#build-outputs)
    - [Debugging](#debugging)
    - [Checking your code for errors](#checking-your-code-for-errors)
    - [Cleaning generated and runtime files](#cleaning-generated-and-runtime-files)
    - [Submitting a Pull Request](#submitting-a-pull-request)
    - [Editing your Feature Branch](#editing-your-feature-branch)
    - [Resolving Merge Conflicts](#resolving-merge-conflicts)
    - [Updating Your GitHub Fork](#updating-your-github-fork)
    - [Publishing releases to npm](#publishing-releases-to-npm)
- [Changelog](#changelog)
- [Supported Node.js and Factorio Versions](#supported-nodejs-and-factorio-versions)
- [Code Style](#code-style)
    - [Naming Style](#naming-style)
    - [Units](#units)
    - [Indenting](#indenting)
    - [Line Length](#line-length)
    - [Markdown](#markdown)


## Project map

Clusterio manages distributed Factorio servers through a controller, hosts, and plugins.

| Location | Responsibility |
| --- | --- |
| `packages/controller/` | Cluster state, users and roles, connections, HTTP API, and serving the web UI. Start with `src/Controller.ts` and `src/ControlConnection.ts`. |
| `packages/host/` | Instance lifecycle, Factorio processes, save patching, and exports. Start with `src/Host.ts`, `src/Instance.ts`, `src/server.ts`, and `src/patch.ts`. |
| `packages/ctl/` | Command-line administration and plugin commands. |
| `packages/lib/` | Shared messages, routing, config, permissions, plugin loading, logging, and utilities for Node and browser consumers. |
| `packages/web_ui/` | React/Ant Design interface and browser control connection; bundled through the controller's webpack build. |
| `packages/create/` | Installer and JavaScript/TypeScript plugin templates. |
| `plugins/` | Bundled plugins, including their Node, web, Lua, and test code. |
| `external_plugins/` | Plugins developed in independent repositories and included in the local workspace. |
| `packages/host/modules/` | Lua modules injected into saves. |
| `packages/host/lua/` | Factorio mod sources, including `clusterio_lib`. |
| `test/` | Root test suite, fixtures, helpers, integration harness, and manual tests. Plugin tests also live under `plugins/*/test/`. |

Start with [how it works](how-it-works.md), [communication](communication.md), and the [config system](config-system.md) for architecture.
See [writing plugins](writing-plugins.md) and [developing for Clusterio](developing-for-clusterio.md) for plugin and Factorio contracts.


## Workflow

While we don't require you to follow this workflow, it makes things much simpler for both you and us if you choose to do so.
Especially when it comes to making the commit history reflect what happened and not be a giant ball of mess.
GitHub's git workflow is less than ideal for dealing with small feature-branches so you might see things being done here a little diffrent than the usual.

It is recommended that you use the command line git version for doing the operations described here.
GUI wrappers tend to have different ideas of what is what and you might find it difficult to make it do the things described here.
For doing the actual commits though, your faviorit git GUI should work just fine.

If you pressed the fork button on GitHub and used `git clone` _on your own fork_ you can skip to the next paragraph.
Otherwise you will have to click the fork button and clone your fork.
If you already cloned the main GitHub repository you can change your clone to point at your own fork using the `git remote` command, but it's probably easier to delete your local clone and clone it again.

To keep your local repository up to to date with the main repository add the main repository as a remote.

    git remote add upstream https://github.com/clusterio/clusterio

After this running `git fetch upstream` will get the updated branches from the main repository.
Do not run `git pull upstream` it will mess thing up!


### Setting up the Development Environment

Run commands from the repository root unless stated otherwise.
Use the latest Node.js LTS release and the pnpm version pinned by `packageManager` in root `package.json`.
Install dependencies with:

    pnpm install --no-frozen-lockfile

This installs dependencies and builds the packages.
`pnpm-lock.yaml` is intentionally ignored; do not force-add it or assume a frozen-lockfile install is supported.
For a fresh development cluster, run the installer and select standalone mode to create `config-controller.json`, `config-host.json`, and the credentials needed to connect them:

    node packages/create --dev

You can skip this step if you already have a working controller and host configuration.

To add plugins to use in the development environment use

    node packages/ctl plugin add ./path/to/plugin

It's important that the path starts with `./`.
The `plugins/` directory contains the core plugins for the project and can be added using the above mentioned command.

The documentation uses the binaries provided by the packages, but for the development environment you will need to call the packages directly:

    npx clusteriocontroller -> node packages/controller
    npx clusteriohost -> node packages/host
    npx clusterioctl -> node packages/ctl

By default node does not enable source maps, to get stack traces pointing to the `.ts` files you will need to pass `--enable-source-maps` to `node` or set the environment variable `NODE_OPTIONS=--enable-source-maps`.

Note that to use `clusterioctl` you will have to create a ctl config first:

    node packages/controller bootstrap create-ctl-config <admin-user>

Use the name of an existing admin user.
Run `node --enable-source-maps packages/controller run` and `node --enable-source-maps packages/host run` in separate terminals.

When editing TypeScript files ran by Node.js you need to run `pnpm build` to compile the files to JavaScript before restarting the controller/host/ctl for changes take effect.
To have TypeScript watch for changes and rebuild immediadly you may run `pnpm watch` instead.

For web development on the controller there are also the following flags:

`--dev` - Recompile the `web_ui` package on the fly providing live reloading of it.

`--dev-plugin [name]` - Recompile the web module for the given plugin on the fly proving live reloading of it.

These options can be combined and multiple plugins can be actived for dev mode.
Keep in mind if you're working on external plugins the `--dev-plugin` option is likely to only work if the plugin is placed inside the `external_plugins` directory and its dependencies are installed with pnpm as part of the clusterio repository workspace.
Note that webpack is configured to delete the web interface build when using these options, so you will have to run `pnpm -r run prepare` before you start the controller without these flags again.


### Build outputs

| Command | Output |
| --- | --- |
| `pnpm build` | Compiled JavaScript and type declarations in each package's `dist/node/` and, where applicable, `dist/browser/`. |
| `pnpm watch` | TypeScript compilation as files change; restart affected Node processes afterward. |
| `pnpm -r run prepare` | Compiled packages, generated validators, and production web bundles. |
| `pnpm build-mod` | Factorio mod archives in root `dist/`. |
| `pnpm docs` | Generated API documentation. |

`pnpm build` alone does not regenerate the standalone validator or webpack bundles.
After changing `packages/lib/src/data/messages_core.ts`, run `pnpm -r run prepare` to compile the schema and regenerate its validator.


### Debugging

Establish the controller, host, instance, Factorio version, enabled plugins, and exact reproduction first.
Enable source maps and confirm the affected process is running rebuilt code.
Use the contextual logger so host, instance, and plugin metadata remain available.
Development logs are in `logs/`; integration logs are in `temp/test/logs/` and are uploaded by CI.

For a failing request or event, start with its handler and the input that triggers the failure.
Handlers are registered with `handle(MessageClass, handler)`; searching for the message class will help you find its handler.
Inspect the input and the state used by the failing operation, then try to reproduce the failure in a [focused test](#checking-your-code-for-errors).
If the handler is never reached, investigate message registration, routing, and permission checks using the [communication guide](communication.md).
For errors reported by Factorio, start with the Lua stack trace and the module or mod it identifies; the [developing-for-Clusterio guide](developing-for-clusterio.md) explains how that code communicates with the host.

For connection and recovery bugs, test disconnect, reconnect, timeout, and shutdown as applicable.
A cached controller status does not prove the current state of a host or Factorio process.
Recovery mode disables normal plugin loading; account for it when diagnosing missing plugin behavior and [Lua state migrations](developing-for-clusterio.md#initialisation-and-recovery).
Verify UI behavior in the browser: successful compilation does not verify rendering, permissions, or subscriptions.


### Starting a Feature Branch

Development is done exclusively in feature branches.
To start a new feature branch, first check out master from the main repository.

    git fetch upstream
    git checkout upstream/master

This will give a warning about detached HEAD which means you did it correctly.
Now you can make a feature branch based on this with.

    git checkout -b my-feature-branch

The name of the branch is not important, as long as it's not a name you've used before.
But it's nice to have its name be somewhat descriptive of what it implements.


### Checking your code for errors

Tests use Mocha and Node assertions, mostly as JavaScript ESM importing compiled packages.
Run the test suite and linter from the repository root:

    pnpm run test
    pnpm run lint

`pnpm test` builds TypeScript and runs root and bundled-plugin tests, excluding `test/manual/`.
Run tests from the root: individual package `test` scripts are often placeholders that deliberately fail.
Use `pnpm cover` for the full suite with c8 coverage.

The full test suite can take a while to run.
Use `pnpm run fast-test` to skip tests marked as slow, or `pnpm run no-external-test` to skip tests that depend on external APIs such as the Factorio mod portal or GitHub.
These correspond to setting the `FAST_TEST` and `NO_EXTERNAL_TEST` environment variables and can be combined.
For example, `FAST_TEST=y NO_EXTERNAL_TEST=y pnpm test` combines both exclusions.
These flags still run the remaining integration setup and tests; neither produces an isolated unit-test run.
When writing slow tests call `slowTest(this)`, and for external API tests call `externalTest(this)`; both are exported from `test/common.js`.
For tests that need a Factorio installation, call `requiresFactorio(this)` in the test or pass the suite to `requiresFactorio`, imported from `test/integration/index.js`.
`test/common.js` also provides JSON round-trip/schema helpers, and `test/mock.js` provides shared mocks.

For a focused test, build first and select the file explicitly instead of appending it to the full-suite script:

```sh
pnpm build
NODE_EXTRA_CA_CERTS="$PWD/test/file/tls/cert.pem" pnpm exec mocha \
  --enable-source-maps --check-leaks test/lib/helpers.js
```

Replace the example file with the relevant test; use `--grep` to narrow it further.
Preserve the test TLS CA configuration for HTTPS integration tests.
Use `--require ./test/setup_logging.js` when an isolated test needs the shared logger configured.
Some tests import `test/integration/index.js`, which installs root hooks and starts a controller and host even for a targeted invocation.

For asynchronous propagation, poll the observable state with a bounded timeout instead of assuming a fixed sleep is sufficient.
Check both controller state and the receiving instance, since a controller update does not acknowledge that the instance has applied it.
Use read-only queries when polling so that the check cannot apply the change it is intended to verify.

The integration harness recreates its configs, database, mods, and instances under `temp/test/` and uses HTTP port 8880 and HTTPS port 4443.
Do not run competing integration suites in the same checkout or on those ports.
It locates Factorio through `host.factorio_directory` in root `config-host.json`, defaulting to `factorio/`.
The full harness currently requires a usable Factorio installation: a missing directory fails discovery, and an empty directory fails setup while selecting a version.
Some individual tests have conditional skips, but these do not make a full run without Factorio succeed.

Use the relevant production bundle, mod build, or [manual scenario](../test/manual/README.md) for changes affecting those surfaces.
For documentation changes, check that links, paths, and example commands are correct.


### Cleaning generated and runtime files

Inspect `node clean.js --help` and preview the selected scope with `--dry-run` before cleaning.

| Command | Removal scope |
| --- | --- |
| `node clean.js --dry-run` | Preview workspace package/plugin build output and webpack caches; omit `--dry-run` to clean, or use `pnpm clean`. |
| `node clean.js tests --dry-run` | Also preview root `.nyc_output/`, `coverage/`, the whole `temp/` directory, and `static/`. |
| `node clean.js all --dry-run` | Also preview runtime databases, instances, logs, mods, local configs, `FactorioAdminToken.txt`, and `plugin-list.json`. |

`all` deletes cluster runtime data, including configurations and saves; back up anything you want to keep before using it.
The cleaner excludes `external_plugins/` and does not remove mod archives in root `dist/`.
Do not commit local configs, tokens, databases, saves, logs, or generated build output.


### Submitting a Pull Request

Once you've commited changes to your feature branch that you want to have included into the main repository push it to you fork with

    git push origin my-feature-branch

and make a pull request through the GitHub web interface.
You can also pass the `--set-upstream` (or `-u`) flag to make `git push` do the same thing for this branch.
After your feature branch have been merged you should consider it final.
If there are more changes you want to have merged or mistakes you need to fix you must start a new feature branch and submit a new pull request.

Pull request descriptions should contain a `### Changelog` section with additions for the changelog contained inside a code block, see the [CHANGELOG.md](/CHANGELOG.md) file for the formatting of changelog entries and possible sections to use.
If there are no changelog entries to add, remove the code block and start the changelog section with the text `None.`, followed by an optional reason for why it is not is needed.

### Editing your Feature Branch

Until your feature branch is merged you can edit it as you see fit by using the rebase tool.
If your feature branch has been merged however it's final and you will have to start a new feature branch and submit that in a new pull request.
The base usage of rebase assuming you are checked out on your feature branch is the following command

    git rebase -i upstream/master

This will open up an editor with the commits of your feature branch and let you reorder, edit, and remove commits as you see fit.

If the main repository has been updated and you have fetched down those updates with `git fetch upstream` this will also move your feature branch so that it is based on the latest commit from the main repository.

If you have already pushed your feature branch to your fork a simple `git push origin my-feature-branch` will no longer work as the histories are different, instead you will have to run

    git push origin +my-feature-branch

The + sign signifies a force push and should be used with care.
If you have a pull request that has not yet been merged submitted for this feature branch this will update the pull request too.


### Resolving Merge Conflicts

The best way to resolve merge conflicts in feature braches is to rebase it on top of the updated upstream.
Run the following commands

    git fetch upstream
    git rebase upstream/master

This will stop on the commit(s) that caused the merge conflict and let you resolve them manually before continuing.
Once you're done force push your updated feature branch with

    git push origin +my-feature-branch


### Updating Your GitHub Fork

No.
This is pointless busywork that accomplishes nothing.
Fetch the main repository directly as described above and base your feature branches on the refs from it.
GitHub has no interface or functionality for keeping the branches in your fork up to date with the branches in the main repository and there is no point in doing this for our feature branch based workflow.


### Publishing releases to npm

For publishing new releases see [package release workflow](./release-workflow.md#packages).

## Changelog

There's a [Changelog](../CHANGELOG.md) in the root of the project.
If you make changes that are visible to users of this project you should add an entry to the changelog describing what has changed.
The format of this log should be self explanatory, please follow it carefully. Please make sure to document any [breaking changes](/docs/decisions.md#breaking-changes).


## Supported Node.js and Factorio Versions

For development, use the latest Node.js LTS release, following the [installation instructions](../README.md#installation).
Make sure the Node.js built-in APIs and npm packages you use remain compatible with the supported versions.
The GitHub Actions tests currently run on Node.js 24 and 26 across the Factorio matrix, with Node.js 22 used for coverage; see the [CI workflow](../.github/workflows/node.js.yml) for the version matrix.

For Factorio, active support covers the latest stable version and the previous major version, using version lines such as 2.1, 2.0 and 1.1 as described in the [Factorio support policy](decisions.md#factorio).
Older versions from 0.17 onwards receive passive support where it does not restrict actively supported versions.
Check the Lua API documentation for the Factorio versions your changes target and preserve compatibility with the actively supported versions.
The GitHub Actions tests use pinned Factorio releases; see the [CI workflow](../.github/workflows/node.js.yml) for the current version matrix.

Check out all our of decisions for [node, factorio, and operation support](/docs/decisions.md#supportability).


## Code Style

The style of the code is a bit of a mixed bag at the moment.
But there are at least a few things that have been agreed upon.
See our [decisions document](/docs/decisions.md) for justifcations.

### Naming style

JavaScript variables in general uses camelCase.
The exception is for classes/constructors which use PascalCase and variables destructured from over the wire objects.

Fields in configs uses lowercase_underscore.

JavaScript files are named using lowercase_underscore for files that export multiple items.
Files containing and exporting a single class should be named the same as the class in PascalCase.

Use ESM imports, including `.js` extensions in TypeScript relative imports.
For namespace imports within lib, use the `lib` prefix to distinguish generic module names, for example `import * as libFileOps from "./file_ops.js";`.
Production consumers should import shared public APIs through `@clusterio/lib` rather than reaching into its internals.
When adding public shared exports, check both `packages/lib/index.ts` and `packages/lib/browser.ts` and keep Node-only dependencies out of browser code.

For lua code lowercase_underscore is used for everything.

### Units

When naming variables whos unit is not a base SI unit like seconds or metres the unit used should be suffixed in the variable name:
E.g.:

    const startTimeMs = Date.now();
    const endNs = process.hrtime();

This makes it easier to spot different unit bases are being mixed in the code.


### Strings

JavaScript and Lua code should use double quoted strings (`"string"`) for all strings with the only exception that strings that contain double quotes may use single quotes (i.e., `'String with "quotes"'`).
JavaScript template literals may also be used where appropriate.


### Indenting

JavaScript and Lua code should be indented with tabs.

Other files types should prefer tabs for indents where reasonable with the exception of Markdown.


### Line Length

Lines are limited to 120 characters where tabs count as 4 characters.
If the argument list for a function or expressino for compound statement gets very long break them out on their own line(s).
For example:

    function foo(
        really, long, argument, list,
        over, multiple, lines
    ) {
        if (
            really && long && expression
            || over && multiple && lines
        ) {
            // code
        }
    })


### Markdown

Markdown files are formatted using one line per sentence to improve diff reports when making changes.
Headings have two blank lines before them and one after them; the top heading has no blank lines before it, and consecutive headings have one blank line between them.
For example:

```md
# A markdown File

Sentence of text which end in a period.
Each sentence is on it's own line.
And there's two spaces before the next heading.


## Subheading

### Sub-subheading

Headings use the `# heading` format.
```
