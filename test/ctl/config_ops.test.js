import assert from "node:assert/strict";
import { configToKeyVal } from "@clusterio/ctl/dist/node/src/config_ops.js";

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
});
