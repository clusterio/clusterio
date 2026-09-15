import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

import * as lib from "@clusterio/lib";

describe("lib/bootstrap", function() {
	describe("loadConfigFromArgs()", function() {
		const folder = path.join("temp", "test", "bootstrap");
		const configPath = path.join(folder, "sample-config.json");
		const noentPath = path.join(folder, "noent-config.json");
		const createPath1 = path.join(folder, "create-config-1.json");
		const createPath2 = path.join(folder, "create-config-2.json");
		before(async function() {
			await fs.mkdir(folder, { recursive: true });
			await fs.writeFile(
				configPath,
				JSON.stringify({
					"ctl.controller_url": "http://example/foo",
				}),
				{ encoding: "utf8" },
			);
			await fs.unlink(noentPath).catch(() => {});
			await fs.unlink(createPath1).catch(() => {});
			await fs.unlink(createPath2).catch(() => {});
		});
		it("should load an existing config", async function() {
			const [config] = await lib.loadConfigFromArgs(
				{
					config: configPath,
					bypassLockFile: false,
					createConfig: false,
					_: ["run"],
				},
				lib.CtlConfig,
				"control",
			);
			assert.equal(config.get("ctl.controller_url"), "http://example/foo");
		});
		it("should reject if config does not exist", async function() {
			await assert.rejects(
				() => lib.loadConfigFromArgs(
					{
						config: noentPath,
						bypassLockFile: false,
						createConfig: false,
						_: ["run"],
					},
					lib.CtlConfig,
					"control",
				),
				/Error: Failed to load temp.test.bootstrap.noent-config\.json/
			);
		});
		it("should create the config if it does not exist and createConfig is set", async function() {
			const [config] = await lib.loadConfigFromArgs(
				{
					config: createPath1,
					bypassLockFile: false,
					createConfig: true,
					_: ["run"],
				},
				lib.CtlConfig,
				"control",
			);
			assert.equal(config.get("ctl.controller_url"), null);
			await assert.doesNotReject(fs.access(createPath1));
		});
		it("should create the config if it does not exist and the command is config create", async function() {
			const [config] = await lib.loadConfigFromArgs(
				{
					config: createPath2,
					bypassLockFile: false,
					createConfig: false,
					_: ["config", "create"],
				},
				lib.CtlConfig,
				"control",
			);
			assert.equal(config.get("ctl.controller_url"), null);
			await assert.doesNotReject(fs.access(createPath2));
		});
		it("should use the existing config if it does not exist and createConfig is set", async function() {
			const [config] = await lib.loadConfigFromArgs(
				{
					config: configPath,
					bypassLockFile: false,
					createConfig: true,
					_: ["run"],
				},
				lib.CtlConfig,
				"control",
			);
			assert.equal(config.get("ctl.controller_url"), "http://example/foo");
		});
	});
});
