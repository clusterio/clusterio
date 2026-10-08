import assert from "node:assert/strict";
import * as lib from "@clusterio/lib";
import { configToKeyVal, serializedConfigToString } from "@clusterio/ctl/dist/node/src/config_ops.js";

describe("ctl/config_ops", function() {
	it("preserves full field names with LF and CRLF input", async function() {
		for (let newline of ["\n", "\r\n"]) {
			const data = [
				"# Clusterio configuration",
				"",
				"instance.name = Example",
				"inventory_sync.load_plugin = false",
				"",
			].join(newline);

			assert.deepEqual(await configToKeyVal(data), {
				"instance.name": "Example",
				"inventory_sync.load_plugin": "false",
			});
		}
	});

	it("keeps = inside values", async function() {
		assert.deepEqual(await configToKeyVal("a = {\"b\":\"c=d\"}\nempty =\nmissing\n"), {
			"a": "{\"b\":\"c=d\"}",
			"empty": "",
			"missing": "",
		});
	});

	describe("serializedConfigToString()", function() {
		const serialized = new lib.InstanceConfig("controller").toRemote("control");

		it("writes descriptions above each value", function() {
			const output = serializedConfigToString(serialized, lib.InstanceConfig);
			const description = lib.InstanceConfig.fieldDefinitions["instance.auto_start"].description;
			assert(output.includes(`# ${description}\ninstance.auto_start = false\n\n`));
			assert(output.includes("# No description found\ninstance.name = New Instance\n\n"));
		});

		it("skips hidden, inaccessible and unknown fields", function() {
			const output = serializedConfigToString(
				{ ...serialized, "unknown.field": "value" }, lib.InstanceConfig
			);
			const names = [...output.matchAll(/^([^#\n][^=]*) =/gm)].map(match => match[1]);
			assert(!names.includes("instance.id"));
			assert(!names.includes("instance.assigned_host"));
			assert(!names.includes("unknown.field"));
			for (const name of names) {
				const def = lib.InstanceConfig.fieldDefinitions[name];
				assert(!def.hidden, `${name} is hidden`);
			}
		});

		it("round trips object values through configToKeyVal", async function() {
			const settings = { name: "a=b", tags: ["x"] };
			const output = serializedConfigToString(
				{ ...serialized, "factorio.settings": settings }, lib.InstanceConfig
			);
			const parsed = await configToKeyVal(output);
			assert.deepEqual(JSON.parse(parsed["factorio.settings"]), settings);
		});
	});
});
