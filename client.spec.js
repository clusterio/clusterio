const assert = require('assert').strict;

const client = require("./client");

describe("Client testing", function() {
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
