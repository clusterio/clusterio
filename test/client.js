const assert = require('assert').strict;
const path = require('path');

const client = require("../client");

describe("Client testing", function() {
	describe("class Instance", function() {
		let instance = new client._Instance("dir", "foo")
		it("should give the name on .name", function() {
			assert.equal(instance.name, "foo");
		})

		it("should give the path to it on .path()", function() {
			assert.equal(instance.path(), "dir");
		})

		it("should join path on .path(...parts)", function() {
			assert.equal(instance.path("bar"), path.join("dir", "bar"));
		})
	});

	describe("checkFilename()", function() {
		it("should allow a basic name", function() {
			client._checkFilename("file");
		});

		function check(item, msg) {
			assert.throws(() => client._checkFilename(item), new Error(msg));
		}

		it("should throw on non-string", function() {
			check(undefined, "must be a string");
			check(null, "must be a string");
			check({}, "must be a string");
			check([], "must be a string");
			check(0, "must be a string");
			check(false, "must be a string");
		});

		it("should throw on empty name", function() {
			check("", "cannot be empty");
		});

		it("should throw on <>:\"\\/|?* \\x00\\r\\n\\t", function() {
			for (let char of '<>:"\\/|?*\x00\r\n\t') {
				check(char, 'cannot contain <>:"\\/|=* or control characters');
			}
		});

		it("should throw on CON, PRN, AUX, NUL, COM1, LPT1", function() {
			for (let bad of ['CON', 'PRN', 'AUX', 'NUL', 'COM1', 'LPT1']) {
				check(
					bad, 'cannot be named any of . ..'
					+' CON PRN AUX NUL COM1-9 and LPT1-9'
				);
			}
		});

		it("should throw on . and ..", function() {
			for (let bad of ['.', '..']) {
				check(
					bad, 'cannot be named any of . ..'
					+' CON PRN AUX NUL COM1-9 and LPT1-9'
				);
			}
		});

		it("should throw on names ending with . or space", function() {
			check("a ", "cannot end with . or space");
			check("a.", "cannot end with . or space");
		});
	});

	describe("randomDynamicPort()", function() {
		it("should return a port number", function() {
			let port = client._randomDynamicPort()
			assert.equal(typeof port, "number");
			assert(Number.isInteger(port));
			assert(0 <= port && port < 2**16);
		});

		it("should return a port number in the dynamic range", function() {
			function validate(port) {
				return 49152 <= port && port <= 65535;
			}
			for (let i=0; i < 20; i++) {
				assert(validate(client._randomDynamicPort()));
			}
		});
	});

	describe("generatePassword()", function() {
		it("should return a string", async function() {
			let password = await client._generatePassword(1);
			assert.equal(typeof password, "string");
		});

		it("should return a string of the given length", async function() {
			let password = await client._generatePassword(10);
			assert.equal(password.length, 10);
		});

		it("should contain only a-z, A-Z, 0-9", async function() {
			let password = await client._generatePassword(10);
			assert(/^[a-zA-Z0-9]+$/.test(password), `${password} failed test`);
		});
	});
});
