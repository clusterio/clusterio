const assert = require('assert').strict;
const fs = require('fs');
const path = require('path');
const stream = require('stream');

const hash = require('lib/hash');


describe("lib/hash", function() {
	describe("hashStream()", function() {
		it("should hash a stream of bytes", async function() {
			let stream = fs.createReadStream(path.join("test", "file", "hash.txt"));
			let result = await hash.hashStream(stream);
			assert.equal(result, "be417768b5c3c5c1d9bcb2e7c119196dd76b5570");
		});
	});

	describe("hashFile()", function() {
		it("should hash a file", async function() {
			let result = await hash.hashFile(path.join("test", "file", "hash.txt"));
			assert.equal(result, "be417768b5c3c5c1d9bcb2e7c119196dd76b5570");
		});
	});
});
