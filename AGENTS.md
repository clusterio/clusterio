# Working on Clusterio

Clusterio manages distributed Factorio servers through a controller, hosts, and plugins.

Read [contributing](docs/contributing.md) for the project map, setup, commands, debugging, tests, and code style.
For PR reviews, follow the [review guide](docs/pr-review-guide.md), including its candidate ledger and final evidence audit.
Use the detailed guides for the affected area:

- [Communication and routing](docs/communication.md), [wire protocol](docs/devs/protocol.md), and [configuration](docs/config-system.md).
- [Plugins](docs/writing-plugins.md), [plugin migration](docs/devs/plugin-migration-to-2.0.md), and [Factorio/Lua](docs/developing-for-clusterio.md).
- [Compatibility policies](docs/decisions.md) and [releases](docs/release-workflow.md).


## Working rules

- Inspect `git status` before editing.
  Preserve unrelated work and external plugin repositories; continue an existing task branch.
- Read the relevant source and tests before changing behavior.
  If documentation and implementation disagree, report the discrepancy and distinguish observed behavior from intended policy.
  Update affected documentation in the same change.
- Follow nearby code and `.oxlintrc.json`: tabs, double quotes, semicolons, and `.js` extensions in relative TypeScript imports.
  Import shared public APIs through `@clusterio/lib` and check Node/browser exports when changing them.
- Run commands from the root using the pinned pnpm version and the [documented Node requirements](docs/contributing.md#supported-nodejs-and-factorio-versions).
  Install with `pnpm install --no-frozen-lockfile`; the lockfile is intentionally ignored.
- `pnpm build` compiles TypeScript.
  It does not regenerate validators or production web bundles; use the appropriate package's `prepare` script.
  Edit sources, not generated outputs.
- Start validation with focused tests, then run `pnpm test` and `pnpm lint` for code changes when possible.
  Root tests include integration setup even with fast/external exclusions.
  The harness needs Factorio, recreates `temp/test/`, and shares ports 8880/4443; do not run competing suites.
- Report checks, failures, skips, and unverified behavior precisely.
  Documentation-only changes need path, command, and formatting checks.
- Preview cleanup with `node clean.js --dry-run`; see the [cleanup scopes](docs/contributing.md#cleaning-generated-and-runtime-files).
  Runtime-data deletion and release publication require explicit authorization.
  Keep local configs, credentials, runtime data, and generated output out of commits.
- Follow the [PR template](.github/pull_request_template.md), including `### Changelog` (`None.` when appropriate).
