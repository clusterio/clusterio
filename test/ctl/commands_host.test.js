import assert from "node:assert/strict";
import * as lib from "@clusterio/lib";
import { hostCommands } from "@clusterio/ctl/dist/node/src/commands_host.js";

/** Stand-in for Ctl that answers requests from a map of handlers and records what was sent */
class FakeCtl {
	constructor(handlers) {
		this.handlers = new Map(handlers);
		this.sent = [];
	}

	async send(request) {
		return await this.sendTo("controller", request);
	}

	async sendTo(dst, request) {
		this.sent.push(request);
		const handler = this.handlers.get(request.constructor);
		if (!handler) {
			throw new Error(`Unexpected ${request.constructor.name}`);
		}
		return handler(request);
	}
}

async function run(command, args, ctl) {
	const lines = [];
	const originalLog = console.log; // eslint-disable-line no-console
	console.log = (...content) => lines.push(content.join(" ")); // eslint-disable-line no-console
	try {
		await hostCommands.get(command).run(args, ctl);
	} finally {
		console.log = originalLog; // eslint-disable-line no-console
	}
	return lines;
}

describe("ctl/commands_host", function() {
	// Created when the request is handled, the ages printed depend on the current time.
	const pending = () => [
		new lib.HostPairingDetails("ABC-DEF", "new-box", "192.0.2.10", "2.0.3", Date.now() - 65500),
		new lib.HostPairingDetails("XYZ-234", "other-box", "2001:db8::1", "", Date.now() - 3720500),
	];
	const hosts = [{ id: 7, name: "basement-box" }, { id: 12, name: "attic-box" }];

	it("no longer has the token based commands", function() {
		for (const name of ["generate-token", "revoke-token", "create-config"]) {
			assert.equal(hostCommands.get(name), undefined, `host ${name} still exists`);
		}
	});

	describe("host pending", function() {
		it("should list pending requests with their age", async function() {
			const ctl = new FakeCtl([[lib.HostPairingListRequest, pending]]);
			const lines = await run("pending", {}, ctl);
			const output = lines.join("\n");
			assert.match(output, /code\s*\|\s*name\s*\|\s*address\s*\|\s*age/);
			assert.match(output, /ABC-DEF\s*\|\s*new-box\s*\|\s*192\.0\.2\.10\s*\|\s*1m 5s/);
			assert.match(output, /XYZ-234\s*\|\s*other-box\s*\|\s*2001:db8::1\s*\|\s*1h 2m/);
		});

		it("should say so when nothing is pending", async function() {
			const ctl = new FakeCtl([[lib.HostPairingListRequest, () => []]]);
			assert.deepEqual(await run("pending", {}, ctl), ["No pending host requests"]);
		});
	});

	describe("host approve", function() {
		it("should approve with the requested name and print it", async function() {
			const ctl = new FakeCtl([
				[lib.HostPairingListRequest, pending],
				[lib.HostPairingApproveRequest, () => 42],
			]);
			const lines = await run("approve", { code: "abcdef" }, ctl);
			const approve = ctl.sent.find(request => request instanceof lib.HostPairingApproveRequest);
			assert.equal(approve.code, "abcdef");
			assert.equal(approve.name, undefined);
			assert.deepEqual(lines, ["Approved host new-box with id 42"]);
		});

		it("should pass --name and print it without listing requests", async function() {
			const ctl = new FakeCtl([[lib.HostPairingApproveRequest, () => 43]]);
			const lines = await run("approve", { code: "ABC-DEF", name: " renamed " }, ctl);
			assert.equal(ctl.sent.length, 1);
			assert.equal(ctl.sent[0].code, "ABC-DEF");
			assert.equal(ctl.sent[0].name, " renamed ");
			assert.deepEqual(lines, ["Approved host renamed with id 43"]);
		});

		it("should pass on errors from the controller", async function() {
			const ctl = new FakeCtl([
				[lib.HostPairingListRequest, () => []],
				[lib.HostPairingApproveRequest, () => {
					throw new lib.NotFoundError("No pending host request with code AAA-AAA");
				}],
			]);
			await assert.rejects(
				run("approve", { code: "AAA-AAA" }, ctl),
				new lib.NotFoundError("No pending host request with code AAA-AAA"),
			);
		});
	});

	describe("host reject", function() {
		it("should send the code to the controller", async function() {
			const ctl = new FakeCtl([[lib.HostPairingRejectRequest, () => undefined]]);
			assert.deepEqual(await run("reject", { code: "abc-def" }, ctl), []);
			assert.equal(ctl.sent.length, 1);
			assert(ctl.sent[0] instanceof lib.HostPairingRejectRequest);
			assert.equal(ctl.sent[0].code, "abc-def");
		});
	});

	describe("host revoke", function() {
		function revokeCtl() {
			return new FakeCtl([
				[lib.HostListRequest, () => hosts],
				[lib.HostRevokeRequest, () => undefined],
			]);
		}

		it("should revoke a host given by name", async function() {
			const ctl = revokeCtl();
			await run("revoke", { host: "basement-box" }, ctl);
			const revoke = ctl.sent.at(-1);
			assert(revoke instanceof lib.HostRevokeRequest);
			assert.equal(revoke.hostId, 7);
		});

		it("should revoke a host given by id", async function() {
			const ctl = revokeCtl();
			await run("revoke", { host: "12" }, ctl);
			assert.equal(ctl.sent.at(-1).hostId, 12);
		});

		it("should fail for an unknown host", async function() {
			const ctl = revokeCtl();
			await assert.rejects(
				run("revoke", { host: "missing" }, ctl),
				new lib.CommandError("No host named missing"),
			);
			assert(!ctl.sent.some(request => request instanceof lib.HostRevokeRequest));
		});
	});
});
