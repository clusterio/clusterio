"use strict";
const assert = require("assert").strict;
const fs = require("fs");
const path = require("path");

const libHash = require("@clusterio/lib/hash");


describe("lib/hash", function() {
	describe("hashStream()", function() {
		it("should hash a stream of bytes", async function() {
			let stream = fs.createReadStream(path.join("test", "file", "hash.txt"));
			let result = await libHash.hashStream(stream);
			assert.equal(result, "be417768b5c3c5c1d9bcb2e7c119196dd76b5570");
		});
	});

	describe("hashFile()", function() {
		it("should hash a file", async function() {
			let result = await libHash.hashFile(path.join("test", "file", "hash.txt"));
			assert.equal(result, "be417768b5c3c5c1d9bcb2e7c119196dd76b5570");
		});
	});
});
