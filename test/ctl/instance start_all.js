"use strict";

const assert = require("assert").strict;
const lib = require("@clusterio/lib");

// Import the command registration helper from the compiled Ctl package.  This
// gives us access to the full command tree without spinning up a controller or
// host process.
const { registerCommands } = require("@clusterio/ctl/dist/node/src/commands");

// yargs instance used only for command registration (it will not parse any
// command-line input in this test).
function createYargsStub() {
	const stub = {};
	for (const method of ["command", "option", "options", "positional"]) {
		stub[method] = () => stub;
	}
	return stub;
}
const yargs = createYargsStub();

describe("ctl instance start-all command", function () {
	let startAllCommand;

	before(async function () {
		// Build the root command tree so we can fetch the start-all command.
		const rootCommands = await registerCommands(new Map(), yargs);
		const instanceTree = rootCommands.subCommands.get("instance");
		startAllCommand = instanceTree.subCommands.get("start-all");

		if (!startAllCommand) {
			throw new Error("start-all command was not found in command tree");
		}
	});

	/**
	 * Helper that constructs a mock control link implementing the minimal API
	 * surface required by the start-all command (send and sendTo).
	 *
	 * @param {lib.InstanceDetails[]} instances – list returned by the mocked
	 *     InstanceDetailsListRequest.
	 */
	function createMockControl(instances) {
		return {
			// Called by the command to fetch the instance list.
			async send(_request) {
				return instances;
			},

			// Called by the command for each instance that should be started.
			started: [],
			async sendTo(target, _request) {
				this.started.push(target.instanceId);
			},
		};
	}

	it("starts only stopped instances that are not excluded by default", async function () {
		const instances = [
			new lib.InstanceDetails("one", 1, undefined, undefined, "stopped", "1.1.0", 0, false),
			new lib.InstanceDetails("two", 2, undefined, undefined, "running", "1.1.0", 0, false),
			new lib.InstanceDetails("three", 3, undefined, undefined, "stopped", "1.1.0", 0, true),
		];
		const control = createMockControl(instances);

		await startAllCommand.run({ force: false }, control);

		assert.deepEqual(control.started, [1], "Should only start non-excluded stopped instances");
	});

	it("starts excluded instances when --force flag is provided", async function () {
		const instances = [
			new lib.InstanceDetails("one", 1, undefined, undefined, "stopped", "1.1.0", 0, false),
			new lib.InstanceDetails("three", 3, undefined, undefined, "stopped", "1.1.0", 0, true),
		];
		const control = createMockControl(instances);

		await startAllCommand.run({ force: true }, control);

		// Order is not guaranteed – sort before comparison.
		assert.deepEqual(control.started.sort(), [1, 3], "--force should include excluded instances");
	});
});
