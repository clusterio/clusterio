import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

import * as lib from "@clusterio/lib";


describe("lib/hash", function() {
	describe("hashStream()", function() {
		it("should hash a stream of bytes", async function() {
			let stream = (await fs.open(path.join("test", "file", "hash.txt"))).createReadStream();
			let result = await lib.hashStream(stream);
			assert.equal(result, "be417768b5c3c5c1d9bcb2e7c119196dd76b5570");
		});
	});

	describe("hashFile()", function() {
		it("should hash a file", async function() {
			let result = await lib.hashFile(path.join("test", "file", "hash.txt"));
			assert.equal(result, "be417768b5c3c5c1d9bcb2e7c119196dd76b5570");
		});
	});
});
