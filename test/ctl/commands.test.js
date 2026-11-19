import assert from "node:assert/strict";
import * as lib from "@clusterio/lib";
import { modCommands } from "@clusterio/ctl/dist/node/src/commands_mod.js";
import { modPackCommands } from "@clusterio/ctl/dist/node/src/commands_mod_pack.js";
import { userCommands } from "@clusterio/ctl/dist/node/src/commands_user.js";
import { CommandOutput } from "@clusterio/ctl/dist/node/src/command_ops.js";

/** Run fn and return the lines it printed with console.log */
async function captureLog(fn) {
	const lines = [];
	const originalLog = console.log; // eslint-disable-line no-console
	console.log = (...args) => lines.push(args.join(" ")); // eslint-disable-line no-console
	try {
		await fn();
	} finally {
		console.log = originalLog; // eslint-disable-line no-console
	}
	return lines;
}

/** Mock ctl answering requests by their class */
function mockCtl(responses) {
	return {
		output: new CommandOutput(),
		async send(message) {
			return responses.get(message.constructor)(message);
		},
		async sendTo(destination, message) {
			return this.send(message);
		},
	};
}

describe("ctl/commands", function() {
	describe("mod show", function() {
		const show = modCommands.get("show");
		it("prints list fields one entry per line", async function() {
			const ctl = mockCtl(new Map([
				[lib.ModGetRequest, () => ({ name: "a_mod", dependencies: ["base", "? other"] })],
			]));
			const lines = await captureLog(() => show.run({ name: "a_mod", modVersion: "1.0.0" }, ctl));
			assert.deepEqual(lines, ["name: a_mod", "dependencies:", "  base", "  ? other"]);
		});
		it("rejects an invalid version", async function() {
			await assert.rejects(
				show.run({ name: "a_mod", modVersion: "latest" }, mockCtl(new Map())),
				new lib.CommandError("mod-version must match format digit.digit.digit"),
			);
		});
	});

	describe("mod-pack show", function() {
		it("marks missing mods and checksum mismatches and lists export assets", async function() {
			const modPack = lib.ModPack.fromJSON({ id: 7, name: "pack" });
			modPack.mods.set("gone", { name: "gone", enabled: true, version: "1.0.0" });
			modPack.mods.set("changed", { name: "changed", enabled: false, version: "1.0.0", sha1: "aaa" });
			modPack.exportManifest = { assets: { settings: "settings.json" } };
			const ctl = mockCtl(new Map([
				[lib.ModListRequest, () => [{ id: "changed_1.0.0", sha1: "bbb" }]],
				[lib.ModPackListRequest, () => [modPack]],
				[lib.ModPackGetRequest, () => modPack],
			]));
			const lines = await captureLog(() => modPackCommands.get("show").run({ modPack: "pack" }, ctl));
			assert(lines.includes("  ? gone 1.0.0"), lines.join("\n"));
			assert(lines.includes("  ! (disabled) changed 1.0.0 (aaa)"), lines.join("\n"));
			assert(lines.includes("    settings: settings.json"), lines.join("\n"));
		});
	});

	describe("user show", function() {
		const show = userCommands.get("show");
		it("prints stats per instance", async function() {
			const stats = new lib.PlayerStats();
			stats.joinCount = 2;
			const user = new lib.UserDetails("alice");
			user.instanceStats = new Map([[1, stats], [2, stats]]);
			user.recalculatePlayerStats();
			const ctl = mockCtl(new Map([
				[lib.UserGetRequest, () => user],
				[lib.InstanceDetailsListRequest, () => [{ id: 1, name: "one" }]],
			]));
			const lines = await captureLog(() => show.run({ name: "alice", instanceStats: true }, ctl));
			assert(lines.includes("Instance one (1):"), lines.join("\n"));
			assert(lines.includes("Instance <deleted> (2):"), lines.join("\n"));
			assert(lines.some(line => /joinCount +\| 4/.test(line)), lines.join("\n"));
		});
	});
});
