# Decisions

This document outlines key decisions taken by the project team that should be followed by all maintainers and contributors.
If there is a particular issue or concern you would like the team to comment on then please create a github issue for it.

<!-- Try to use categories that already exist if possible -->
<!-- Sublists should be alphabetical, avoiding starting with "the" -->
<!-- For code style, add (Lang) to section names if present in both -->

1. Documentation
    - [Decision Log](#decision-log)
    - [TSDoc](#tsdoc)
2. Code Style (General)
    - [Indenting](#indenting)
    - [Line Length](#line-length)
    - [Naming Booleans](#naming-booleans)
    - [Naming Files](#naming-files)
    - [Naming Times and Durations](#naming-times-and-durations)
    - [Strings](#strings)
3. Code Style (TS / JS / Web)
    - [ESLint](#eslint)
    - [Imports Within `lib` Package](#imports-within-lib-package)
    - [Name Style](#name-style-ts)
4. Code Style (Lua)
    - [FMTK](#fmtk)
    - [Name Style](#name-style-lua)
5. Code Style (Other)
    - [Markdown](#markdown)
6. Repository Structure
    - [External Plugins](#external-plugins)
    - [First Party Plugins](#first-party-plugins)
    - [Core Packages](#core-packages)
    - [TypeScript Configs](#typescript-configs)
    - [Workspace](#workspace)
7. Project Architecture
    - [Deprecation of Phin in favour of `fetch`](#deprecation-of-phin-in-favour-of-fetch)
    - [Minimal Dependencies](#minimal-dependencies)
    - [React](#react)
    - [Separation of Host and Controller](#separation-of-host-and-controller)
    - [Typescript](#typescript)
    - [Webpack](#webpack)
8. Supportability
    - [Breaking Changes](#breaking-changes)
    - [Distribution](#distribution)
    - [Factorio](#factorio)
    - [General Support](#general-support)
    - [NodeJS](#nodejs)
    - [Operating System](#operating-systems)
9. Testing
    - [Continuous Integration](#continuous-integration)
    - [Continuous Deployment](#continuous-deployment)
    - [Mocha](#mocha)
    - [Version Matrix](#version-matrix)

> [!note]
> The use of `Time Immemorial` indicates an obsverion of a previously undocumented decision with no known start date, which has remained unchallenged.

<!--
### Template

🧾 0th Month 2000 | Source

> A short sentence describing the action to take in the context of our project.

Write a breif description which includes: the reason a decision was needed, the outcome of the discussion, and the justification of the outcome.
Write using the active voice in third person "we".
Remember to have one sentence per line.
-->


## Documentation

### Decision Log

🧾 22nd December 2024 | Discord Voice Call

> Maintain a document that includes a brief description of the outcomes and the reasoning behind our decisions, along with links to the relevant sources for further reading.

We discovered that we were beginning to ask similar questions to other maintainers that we had previously raised, which led to a waste of time for all involved.
Consequently, we decided that a log of important decisions should be kept for the benefit of ourselves and future maintainers.


### TSDoc

🧾 12th August 2023 | [Discord Discussion](https://discord.com/channels/450361298220351489/450361298220351491/1320573126731370506) | Github PR #493

> When a function or it's arguments do not have a clear purpose, a TSDoc comment should be used to describe it.

While TypeScript provides useful type infomation in function hover text, it does not allow for comments about the purpose of functions and their arguments.
Therefore, we decided to use TSDoc comments for this purpose as it is well intergrated in many text editors and IDEs (such as VSCode).
Our specific implementation is TypeDoc because it is lightweight it and can output TSDoc comments as html.
API Extractor was also considered but not selected.


## Code Style (General)

### Indenting

🧾 Time Immemorial  

> Use tabs for indention. Except for Markdown where spaces carry meaning.

We needed to maintain a consistent whitespace style across all our files.
Therefore, we selected tabs as our standard.


### Line Length

🧾 Time Immemorial  

> Lines are limited to 120 characters where tabs count as 4 characters.

We needed to maintain a consistent max line legnth across all our files.
Therefore, we selected 120 characters as our standard.


### Naming Booleans

🧾 25th November 2024 | [Discord Discussion](https://discord.com/channels/450361298220351489/450361298220351491/1310611960508977223)

> Variable and member properties which contain booleans should be named starting with a verb unless it ends with "ed", e.g. `canRestart` `expectEmpty` `hasFallback` `connected` `enabled` `loaded` `banned`

We had inconsistencies in our naming of booleans and aimed to standardise them.
There was little preference for any particular approach, so we chose the one that would require the fewest changes to existing code.
As a result, all boolean values should begin with a verb, unless they end with "ed." For clarity, both "is" and "has" are considered verbs.


### Naming Files

🧾 Time Immemorial  

> Files use lowercase_underscore if multiple values are exported. If a single class is exported then it uses the class name in PascalCase.

We needed to maintain a consistent name style across all our files.
Therefore, we selected lowercase undercore for most files, with class files using PascalCase.


### Naming Times and Durations

🧾 18th January 2024 | [Discord Discussion](https://discord.com/channels/450361298220351489/450361298220351491/1197566542548828170)

> Variable and member properties which contain times or durations should end with their SI unit of messure, e.g. `updatedAtMs`

We found verifying the units of measurement used in different locations to be a simple yet repetitive task that could lead to errors.
Our main concern was the mixing of variables containing seconds and milliseconds.
Therefore, we decided that times and durations should explicitly include their units, whereas other value types do not require any units.


### Strings

🧾 Time Immemorial  

> Strings should use double quotes `"` unless the string contains them, in which case single quotes `'` can be used. For JS string templates use backticks ``` ` ``` as normal.

We needed to maintain a consistent string style across all our files.
Therefore, we selected double quotes as our standard.

## Code Style (TS / JS / Web)

### ESLint

🧾 Time Immemorial  

> Use ESLint for style checking.

We needed to maintain a consistent style across all our files.
Therefore, we utilise the industry-standard ESLint, as it is familiar and highly configurable.


### Imports Within `lib` Package

🧾 Time Immemorial  

> When importing files within the lib package, all names should be prefixed with "lib".

The exports of the various library files are often very generic and may conflict with variable names.
Therefore, when importing these files the "lib" prefix should be used to avoid confussing.
This only applies to files within `lib` importing other files in `lib` because all other packages import the whole of `lib` as a single package.


### Name Style (TS)

🧾 Time Immemorial  

> Variables and members of classes use camelCase. Classes use PascalCase. Config values use lowercase_underscore. Exceptions allowed for over the write objects.

We needed to maintain a consistent name style across all our files.
Therefore, we follow common practive for JavaScript of using camelCase and PascalCase.
Although, we have also allowed the use of lowercase_underscore for config values to distinguish them from other variables.


## Code Style (Lua)

### FMTK

🧾 14th June 2024 | [External PR](https://github.com/justarandomgeek/vscode-factoriomod-debug/pull/126)

> Use of FMTK is not required but is advised.
> To enable Clusterio support, use the CLI flag `--clusterio-modules` under `Lua.runtime.pluginArgs`.

We needed to maintain a consistent style across all our files.
There are multiple competing standards for Lua code, and given the limited amount of Lua code in this project, we chose not to adopt any automatic linting or shared luarc file.
Nevertheless, we recomend the use of [FMTK](https://github.com/justarandomgeek/vscode-factoriomod-debug) and have taken steps towords supporting it in Clusterio.


### Name Style (Lua)

🧾 Time Immemorial  

> Everything uses lowercase_underscore

We needed to maintain a consistent name style across all our files.
Therefore, we follow common practive for Lua of using lowercase_underscore.


## Code Style (Other)

### Markdown

🧾 Time Immemorial  

> Use one sentence per line.
> Place two lines before each heading, except for the first one or when two headings are adjacent.

We needed to maintain a consistent code style across all our markdown files.
Therefore, we selected an approach which makes diff reports more useful and which makes headings use additional space to make them stand out.


## Repository Structure

### External Plugins

🧾 Time Immemorial

> No external plugins should be included in the main repository.
> A folder will exist which external plugin repositories can be cloned into and will be given the same treatment as first party plugins.

We require a designated space for developers to create their plugins without the concern of conflicts with first-party plugins.
To address this, we have introduced a dedicated folder for external plugins.
This solution is straightforward and has since proven to be highly effective.


### First Party Plugins

🧾 Time Immemorial

> First party plugins are included in the main repository.
> Those selected to be first party are held to the same stanards which apply to the core packages.
> Each will recieve a new release in step with the core packages.

We require a designated space for first-party plugins, separate from the core packages, to clearly represent the dependency between them.
Creating a folder provided a simple solution to this.


### Core Packages

🧾 Time Immemorial

> All core packages will be contained in the packages folder of the repository.
> They are allowed to be interdependent on each other.

We require a set of core packages to represent the different applications used in a cluster.
See [Separation of Host and Controller](#separation-of-host-and-controller).
To avoid putting more files into the repository root we created a folder for the core packages.


### TypeScript Configs

🧾 26th August 2023 | Github PR #504

> Each package / plugin may contain any of: `tsconfig.json` `tsconfig.node.json` and `tsconfig.web.json`.
> The main respository root will contain all three files in addition to `tsconfig.base.json` which node and web extend from.
> The configs inside packages / plugins should extend from those in the respository root.

We found that maintaining independent tsconfig files became burdensome and required a way to consolidate them.
Initially, we introduced a base configuration file; however, this proved insufficient, so we extended it to include separate configurations for Node.js and the Web.
This approach led to each package having up to three tsconfig files.
Nevertheless, we believe this to be justified, given the need to differentiate between Node.js and Web builds while maintaining a single, shared configuration.


### Workspace

🧾 Time Immemorial

> The workspace root should contain only: configuration files, scripts used to build / clean the workspace, the readme, and the changelog.

We need to maintain a clean workspace root by only including files which effect all pacakges and plugins such as configuration files.
We have allowed for build and clean scripts to exist here as long as they are not published as part of any package or plugin.


## Project Architecture

### Deprecation of Phin in favour of `fetch`

🧾 12th December 2024 | [Discord Discussion Dec 24](https://discord.com/channels/450361298220351489/450361298220351491/1316781609206419567) | [Discord Discussion May 25](https://discord.com/channels/450361298220351489/450361298220351491/1240246997496102942)

> The builtin `fetch` method should be used as a replacement of the deprecated Phin module.

We required a replacement for the deprecated Phin HTTP client, which was used for making server-side requests and as part of testing.
With `fetch` being marked as stable in Node.js v21.0.0 and having first been made available in v16.15.0, it serves as a suitable replacement without the need to add new dependencies.
It had previously not been used because it was not marked as stable in any LTS version of NodeJS.


### Minimal Dependencies

🧾 Time Immemorial

> Any new dependencies need to be well justified.

We aim to minimise our exposure to upstream changes by using a minimal number of dependencies.
This also serves to reduce the bloat of a cluster installation and improve installation times.
Consequently, the addition of any new dependencies must be thoroughly justified, with evidence of research into alternative options and comparisons between them.


### React

🧾 Time Immemorial

> Our web stack uses ReactJS

We require a reactive website for our control panel, and ReactJS was selected due to its widespread use and familiarity.
Switching away from React for any reason would represent a significant undertaking.


### Separation of Host and Controller

🧾 Time Immemorial

> The primary application locations are Control (web and cli), Controller, and Host.
> Therefore the core packages are: `ctl` `controller` `host`. There are two libaray packages `lib` and `web_ui`.
> Additionally `create` exists to provide easy creation of a cluster.

A single application to perform all the duties of a cluster would complicate the reasoning and maintenance of the project, so we decided to split it into several packages.
The primary components of a cluster include servers connected to an instance, which runs on a host that connects to the controller, whose configuration is managed via a control connection from a CLI or web portal.
Based on this structure, we found it logical to divide the packages according to their installation location, resulting in `ctl`, `controller`, and `host`, with shared code separated into `lib` and `web_ui` depending on where it is utilised.
The additional `create` package is used by `npm create` to provide a user-friendly installation process.


### TypeScript

🧾 6th August 2023 | Github PR #491

> We use TypeScript as our language of choice.

We previously used JavaScript and switched to TypeScript to provide a robust type system.
Transitioning to any other langauge would be too significant an undertaking.
Initially, we supported multiple languages for plugins, including Rust and Go; however, this approach was quickly abandoned due to its complexity.


### Webpack

🧾 Time Immemorial

> Our web stack uses Webpack and associated plugins.

We required a bundler for our web build, and at the time, Webpack was the standard.
While we have considered alternatives since, transitioning to another solution would be a significant undertaking.


## Supportability

### Breaking Changes

🧾 Time Immemorial

> We follow symver versioning for breaking changes.
> In our alpha stage, we allow every alpha to contain breaking changes as long as their are documented and provide migration actions.
> Once we enter beta, breaking changes will be more restricted.

We aim to be highly transparent with breaking changes and maintain compatibility with as many existing installations as possible.
However, as we are currently in the alpha stage, things are unstable, and breaking changes occur frequently.
As such, we have decided to document all breaking changes and provide migration steps where the changes are non-trivial.
Once we enter the beta stage, we will implement stricter restrictions on breaking changes.


### Distribution

🧾 Time Immemorial

> We use `git` and `pnpm` for development distribution.
> We use `npm` and the factorio mod portal for production distribution.

We need to distribute both production builds and development source code for the project.
By necessity, we use `npm` and the Factorio Mod Portal to distribute our production builds.
For development, we rely on `git` and GitHub, which are industry standards, while using `pnpm` as a more efficient variant of `npm` for development installations.
Although bun was considered upon its release, we were not convinced it was the right choice.


### Factorio

🧾 26th October 2024 | [Discord Discussion](https://discord.com/channels/450361298220351489/450361298220351491/1299637042350653461)

> We actively provide full support for the last two major versions of Factorio.
> This approach does not follow semantic versioning; instead, it follows the "middle" versions: 2.1 > 2.0 > 1.1 > 1.0 > 0.18 > 0.17.
> We offer passive support for all versions from 0.17 onwards, where implementation is trivial and does not impose restrictions on our actively supported versions.

Following the 2.0 update of Factorio, which introduced a large number of breaking changes, we needed to reconsider which versions would be actively supported, as it was no longer trivial to support all versions.
Anticipating that future breaking changes would also be significant, and assuming the majority of players would update to the latest stable version upon release, we decided to support the latest stable version and the previous major version that introduced breaking changes.
Support for other versions will not be removed if they have already been implemented and do not impose restrictions on our ability to support newer versions.


### General Support

🧾 Time Immemorial

> We provide full support via GitHub and our Discord server for the latest published version of Clusterio, as well as assistance with migrating from the previous published version.
> However, we do not offer any guarantees with our support; we assist when time permits and may not be able to resolve every issue.
> Additionally, while we offer support in setting up development workspaces and guidance for plugin development, we do not provide support for those running development builds as production instances.

We aim to support as many users of Clusterio as possible in setting up and using the platform for a variety of purposes, including setting up production instances, development workspaces, and providing guidance on plugin development.
However, our time to work on Clusterio is limited, and even more so our ability to offer support.
As such, we cannot assist with every issue and must set reasonable restrictions to ensure expectations are aligned.
Consequently, we do not offer any guarantees for our support, but we strive to provide as much assistance as possible for those setting up or running the latest published version.
Additionally, we support users in setting up development workspaces, as the more people willing to contribute, the better.


### NodeJS

🧾 Time Immemorial

> We support all LTS versions of NodeJS in their active and maintenance phases.

Our options were: supporting all versions, supporting all active versions, supporting all LTS versions, or supporting only the latest version.
As we aim to provide a stable, production-ready tool while still limiting the number of versions we need to manage, we chose to support all LTS versions because NodeJS can be installed by the majority of linux distro package managers which will always offer at least one LTS version.


### Operating Systems

🧾 Time Immemorial

> We support all major versions of Windows, Linux, and MacOS.
This is largely inpart to our use of NodeJS and is not a guarantee from us.

Our choice of Node.js has enabled us to support all major operating systems with minimal effort on our part.
Nevertheless, there have been instances where code paths have diverged between systems, and we have attempted to maintain support for as many systems as possible.
However, this is not a priority, and such support has often been reactive or provided by external contributors.


## Testing

### Continuous Integration

🧾 Time Immemorial

> We run unit and integration tests through GitHub CI actions as well as test coverage through CodeCov.

Continuous integration actions in GitHub are a valuable tool that we use to assist with the review of pull requests from both maintainers and contributors.
While we aim to increase the number of useful checks performed by CI in the future, this is not a priority over the development of new features.


### Continuous Deployment

🧾 Time Immemorial

> We do not use any CD actions, and have no plans of implementing them.

Unlike CI, we do not find continuous deployment useful at our current stage of the project.
This is due to the frequent breaking changes merged into the main branch, which we prefer to bundle together as a single version.
In the future, we may automate the deployment process, but it will always require manual activation.


### Mocha

🧾 Time Immemorial

> We use Mocha for testing and CodeCov for coverage.

We chose Mocha because it was a good fit when we selected it.
However, we are always looking for a better framework which is worth the effort of switching.


### Version Matrix

🧾 Time Immemorial

> We perform all tests through GitHub actions using Ubuntu latest, using all supported versions of node and all supported versions of factorio.

We perform tests on all versions of NodeJS and Factorio that we support.
However, we do not conduct tests on all supported operating systems, as the added demand on our testing resources would be significant, and the value it would provide for a cross-platform engine like NodeJS would be limited.
