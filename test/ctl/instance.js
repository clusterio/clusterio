"use strict";

const assert = require("assert").strict;
const lib = require("@clusterio/lib");

// Import the command registration helper from the compiled Ctl package. This
// gives us access to the full command tree without spinning up a controller or
// host process.
const { registerCommands } = require("@clusterio/ctl/dist/node/src/commands");

// yargs instance used only for command registration (it will not parse any
// command-line input in these tests).
function createYargsStub() {
	const stub = {};
	for (const method of ["command", "option", "options", "positional"]) {
		stub[method] = () => stub;
	}
	return stub;
}
const yargs = createYargsStub();

/**
 * Fetches the requested sub-command from the command tree under the
 * "instance" command.
 *
 * @param {string} name – The name of the sub-command (e.g. "start-all").
 * @returns {Promise<object>} The command object.
 */
async function getInstanceSubCommand(name) {
	const rootCommands = await registerCommands(new Map(), yargs);
	const instanceTree = rootCommands.subCommands.get("instance");
	const command = instanceTree.subCommands.get(name);

	if (!command) {
		throw new Error(`${name} command was not found in command tree`);
	}
	return command;
}

/**
 * Constructs a mock control link implementing the minimal API surface
 * required by the *-all commands (send and sendTo).
 *
 * @param {lib.InstanceDetails[]} instances – List returned by the mocked
 *     InstanceDetailsListRequest.
 * @param {string} action – The property name ("started" | "stopped") that
 *     should collect the instance ids passed to sendTo.
 * @returns {object} The mock control link.
 */
function createMockControl(instances, action) {
	return {
		// Called by the command to fetch the instance list.
		async send(_request) {
			return instances;
		},

		// Populated by sendTo calls performed by the command.
		[action]: [],
		async sendTo(target, _request) {
			this[action].push(target.instanceId);
		},
	};
}

describe("ctl instance start-all command", function () {
	let startAllCommand;

	before(async function () {
		startAllCommand = await getInstanceSubCommand("start-all");
	});

	it("starts only stopped instances that are not excluded by default", async function () {
		const instances = [
			new lib.InstanceDetails("one", 1, undefined, undefined, "stopped", "1.1.0", 0, false),
			new lib.InstanceDetails("two", 2, undefined, undefined, "running", "1.1.0", 0, false),
			new lib.InstanceDetails("three", 3, undefined, undefined, "stopped", "1.1.0", 0, true),
		];
		const control = createMockControl(instances, "started");

		await startAllCommand.run({ force: false }, control);

		assert.deepEqual(control.started, [1], "Should only start non-excluded stopped instances");
	});

	it("starts excluded instances when --force flag is provided", async function () {
		const instances = [
			new lib.InstanceDetails("one", 1, undefined, undefined, "stopped", "1.1.0", 0, false),
			new lib.InstanceDetails("three", 3, undefined, undefined, "stopped", "1.1.0", 0, true),
		];
		const control = createMockControl(instances, "started");

		await startAllCommand.run({ force: true }, control);

		// Order is not guaranteed – sort before comparison.
		assert.deepEqual(control.started.sort(), [1, 3], "--force should include excluded instances");
	});
});

describe("ctl instance stop-all command", function () {
	let stopAllCommand;

	before(async function () {
		stopAllCommand = await getInstanceSubCommand("stop-all");
	});

	it("stops only running or starting instances", async function () {
		const instances = [
			new lib.InstanceDetails("one", 1, undefined, undefined, "stopped", "1.1.0", 0, false),
			// Does not care about excludeFromStartAll
			new lib.InstanceDetails("two", 2, undefined, undefined, "running", "1.1.0", 0, true),
			new lib.InstanceDetails("three", 3, undefined, undefined, "starting", "1.1.0", 0, false),
		];
		const control = createMockControl(instances, "stopped");

		await stopAllCommand.run({}, control);

		// Order is not guaranteed – sort before comparison.
		assert.deepEqual(control.stopped.sort(), [2, 3], "Should only stop running or starting instances");
	});
});
