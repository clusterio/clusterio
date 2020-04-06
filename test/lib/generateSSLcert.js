const assert = require("assert");
const fs = require("fs-extra");
const path = require("path");

const generateSSLcert = require("lib/generateSSLcert")

describe("generateSSLcert.js(options)", ()=>{
	let testDir = path.join("temp", "test", "certTest");
	before(async function() {
		await fs.remove(testDir);
	});

	it("Creates a folder with a .crt and .key file in it", async function() {
		this.timeout(1000);
		if (process.env.FAST_TEST) {
			this.skip();
		}

		let certPath = path.join(testDir, "cert.crt");
		let privKeyPath = path.join(testDir, "cert.key");

		await generateSSLcert({
			bits: 512, // This is too small for real world usage, but faster to test
			sslCertPath: certPath,
			sslPrivKeyPath: privKeyPath,
			doLogging: false,
		});

		assert(await fs.exists(certPath), "cert file was not created");
		assert(await fs.exists(privKeyPath), "key file was not created");
	});
});
