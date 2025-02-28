# Contributing to Clusterio

You are probably reading this because you want to contribute code to Clusterio.
Great!  We need people like you.
Though we have some conventions and workflows that we kindly ask you to follow.
We have included all the pratical considerations in this document.
Although, we recomend checking out out our [past decisions](/docs/decisions.md) if you have the time.


## Contents

- [Workflow](#workflow)
    - [Starting a Feature Branch](#starting-a-feature-branch)
    - [Setting up the Development Environment](#setting-up-the-development-environment)
    - [Checking your code for errors](#checking-your-code-for-errors)
    - [Submitting a Pull Request](#submitting-a-pull-request)
    - [Editing your Feature Branch](#editing-your-feature-branch)
    - [Resolving Merge Conflicts](#resolving-merge-conflicts)
    - [Updating Your GitHub Fork](#updating-your-github-fork)
    - [Publishing releases to npm](#publishing-releases-to-npm)
- [Changelog](#changelog)
- [Supported Node.js and Factorio Version](#supported-node.js-and-factorio-version)
- [Code Style](#code-style)
    - [Naming Style](#naming-style)
    - [Units](#units)
    - [Indenting](#indenting)
    - [Line Length](#line-length)
    - [Markdown](#markdown)


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

The project is organized into several packages that are all tied together using pnpm's workspace feature.
In order to get the development environment up and running you will need to run the following command:

    pnpm install

This installs dependencies needed by tests and links the packages up so they work from the git work tree.
To start a cluster from the repo you will first need to initialize it, this can be done using the installer:

    node packages/create --dev

To add plugins to use in the development environment use

    node packages/ctl plugin add ./path/to/plugin

It's important that the path starts with `./`.
The `plugins/` directory contains the core plugins for the project and can be added using the above mentioned command.

The documentation uses the binaries provided by the packages, but for the development environment you will need to call the packages directly:

    npx clusteriocontroller -> node packages/controller
    npx clusteriohost -> node packages/host
    npx clusterioctl -> node packages/ctl

By default node does not enable source maps, to get stack traces pointing to the `.ts` files you will need to pass `--enable-source-maps` to `node` or set the environment variable `NODE_OPTIONS=--enable-source-maps`.

Note that to use `clusterioctl` you will have to create a control config first:

    node packages/controller bootstrap create-ctl-config [admin-user]

Once you've set up the cluster you can use `node packages/controller run` to run the controller and `node packages/host run` to run the host which connects to the controller.

When editing TypeScript files ran by Node.js you need to run `pnpm build` to compile the files to JavaScript before restarting the controller/host/ctl for changes take effect.
To have TypeScript watch for changes and rebuild immediadly you may run `pnpm watch` instead.

For web development on the controller there are also the following flags:

`--dev` - Recompile the `web_ui` package on the fly providing live reloading of it.

`--dev-plugin [name]` - Recompile the web module for the given plugin on the fly proving live reloading of it.

These options can be combined and multiple plugins can be actived for dev mode.
Keep in mind if you're working on external plugins the `--dev-plugin` option is likely to only work if the plugin is placed inside the `external_plugins` directory and its dependencies are installed with pnpm as part of the clusterio repository workspace.
Note that webpack is configured to delete the web interface build when using these options, so you will have to run `pnpm run -r --if-present prepare` before you start the controller without these flags again.


### Starting a Feature Branch

Development is done exclusively in feature branches.
This means the first thing to do before starting any development at all is to make a new branch starting from the master branch of the main repository.
To do this check out that branch from the main repository.

    git fetch upstream
    git checkout upstream/master

This will give a warning about detached HEAD which means you did it correctly.
Now you can make a feature branch based on this with.

    git checkout -b my-feature-branch

The name of the branch is not important, as long as it's not a name you've used before.
But it's nice to have its name be somewhat descriptive of what it implements.


### Checking your code for errors

There's automated tests and linting setup for the project.
Please do add tests for any code you add and run both:

    pnpm run test
    pnpm run lint

To check that your changes pass the integration tests as well as the ESLint rules set up for the project.


### Submitting a Pull Request

Once you've commited changes to your feature branch that you want to have included into the main repository push it to you fork with

    git push origin my-feature-branch

and make a pull request through the GitHub web interface.
You can also pass the `--set-upstream` (or `-u`) flag to make `git push` do the same thing for this branch.
After your feature branch have been merged you should consider it final.
If there are more changes you want to have merged or mistakes you need to fix you must start a new feature branch and submit a new pull request.


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

Clusterio run on Node.js v18 and up, make sure to check that the Node builtin API's and npm packages you use are supported on these versions.
The GitHub Actions tests are run on whatever version of Node.js v18 and v20 is the default.

For Factorio Clusterio 2.0 aims to support version 0.17.69 and up, including the latest experimental release.
It's recommended that you use the lua API reference for 0.17.69, as there's no information on what version Factorio API's were introduced in.
The GitHub Actions tests are run against the latest experimental release.

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

Relative imports in lib package are prefixed with lib to make them easier to distinguish, as the names tend to be very generic.
E.g.:

    const libLink = require("./link");
    const libLuaTools = require("./lua_tools");

Note that no sub-modules of the lib package is imported directly from the outside of it with the exception of `build_mod`.

For lua code lowercase_underscore is used for everything.

### Units

When naming variables whos unit is not a base SI unit like seconds or metres the unit used should be suffixed in the variable name:
E.g.:

    const startTimeMs = date.now();
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
Headings have two spaces before them and on space after them to make them stand out, the heading at the top of the file does not have any spaces before it, and heading immediadly followed by another heading have one space between them.
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
