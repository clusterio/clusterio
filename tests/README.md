# TAP tests

This suite uses [node-tap](https://node-tap.org/) and runs next to the Mocha suite in `test/`.
Mocha is removed once this suite has similar coverage.
Write new unit tests here.

Tests are TypeScript, run by Node.js directly with type stripping.
The `@tapjs/typescript` plugin is disabled in `.taprc`, so only [erasable syntax](https://www.typescriptlang.org/tsconfig/#erasableSyntaxOnly) works: no enums, parameter properties or namespaces.
Relative imports use the `.ts` extension.
Packages are imported by name, which resolves to their compiled output, so build before running.


## Layout

```
tests/
├── integrations/       # Cross-package and host integration tests
├── <package>/          # Unit tests, mirroring the package's src/
└── shared/             # Test utilities and fixtures

plugins/
└── <plugin>/
    └── test/           # Plugin-owned tests, named *.test.ts
```

Only files ending in `.test.ts` are run.
For example the tests for `packages/lib/src/link/link.ts` are in `tests/lib/link/link.test.ts`.


## Writing tests

Nest tests as `file > class > method > test name`, or `file > function > test name` for plain functions.
Name the imported instance `t` and the nested contexts `t1`, `t2`, `t3`.

```ts
import t from "tap";
import * as lib from "@clusterio/lib";

t.test("RoleMapping", async t1 => {
	t1.test("add()", async t2 => {
		t2.test("adds a role", async t3 => {
			// ...
		});
	});
	t1.test("remove()", async t2 => {
		t2.test("removes an existing role", async t3 => {
			// ...
		});
	});
});
```

- Use the real classes wherever practical.
- Mock single functions and methods with `t.intercept`, `t.capture` or `t.mockImport`, not whole classes.
- Mock external boundaries such as the network, timers and other nondeterministic sources.
- Each test creates the mutable state it needs.
  No test may depend on another test having run or passed.
- Share immutable fixtures and expensive read-only resources at module scope.
- Mark known bugs with `{ todo: "reason" }` so they show up without failing the run.

Each test file runs in its own process, in parallel with the others.
Keep files independent of each other.
Parallel subtests (`t.jobs`) are for independent asynchronous work within one file.
Tests that need an exclusive resource such as a fixed port go in a directory marked with `serial` in `.taprc`.


### Common tests

`shared/` builds tests that apply to many classes.
`shared/json_serialisable.ts` tests the [JSON serialisable class pattern](../docs/devs/json-serialisable-classes.md): a value survives `JSON.stringify` and `fromJSON`, and the serialised form matches `jsonSchema`.
Samples are generated from the schema, with and without optional properties.
On top of those, each union branch, enum value and boolean gets a sample where it differs from the default and everything else stays the same.
This covers every possible value of each union without trying every combination of them.
`lib/data/json_serialisable.test.ts` runs it for every serialisable class exported by `@clusterio/lib`, so new data classes and messages are covered without adding a test.
Schemas the generator cannot satisfy, such as strings that must parse as a mod dependency, get hand written samples in that file.


## Running

| Command | Runs |
| --- | --- |
| `pnpm test:tap` | Every TAP test in one shared worker pool, as CI does. |
| `pnpm test:unit` | `tests/<package>/`. |
| `pnpm test:integration` | `tests/integrations/`. |
| `pnpm test:plugins` | `plugins/*/test/**/*.test.ts`. |
| `pnpm test:coverage` | Every TAP test with a text and HTML coverage report in `.tap/report/`. |
| `pnpm test:typecheck` | `tsc` over the tests. |

These scripts build first.
For a single package or file, build and call tap directly.
Pass a file or a quoted glob, tap finds nothing when given a directory.

```sh
pnpm build
pnpm exec tap --disable-coverage "tests/lib/**/*.test.ts"
pnpm exec tap --disable-coverage tests/lib/link/link.test.ts
```

`--grep` selects subtests by name, one pattern per level.
`--jobs=<n>` sets the number of test files run at once, which defaults to the number of CPUs.
Run tap from the root rather than through `pnpm -r`, which would run a worker pool per package.

`pnpm install` runs `tap build` to apply the plugin list in `.taprc`.
Run it again after changing that list.

CI runs this suite in `.github/workflows/tap.yml` on the latest Node.js and Factorio only.
Coverage reported to Codecov still comes from the Mocha suite.
