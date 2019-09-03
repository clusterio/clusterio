var assert = require("assert");
var fs = require("fs-extra");

var fileOps = require("lib/fileOps");
var generateSSLcert = require("lib/generateSSLcert")

describe("generateSSLcert.js(options)", ()=>{
	it("Creates a folder with a .crt and .key file in it", async function() {
		/* istanbul ignore if */ if (process.env.FAST_TEST) this.skip();
		let certPath = "lib/certTestPlsDelete/cert.crt";
		let privKeyPath = "lib/certTestPlsDelete/cert.key";
		assert(!await fs.exists(certPath)); // if it already exsits, the test might pass because of leftover data (which is bad)
		
		await generateSSLcert({
			// bits:512, // supported, but I just use the default of 2048 for this test
			sslCertPath: certPath,
			sslPrivKeyPath: privKeyPath,
			doLogging: false,
		});
		
		assert(await fs.exists(certPath)); // private key
		assert(await fs.exists(privKeyPath)); // certificate file
		
		// remove certificates and data from the test
		fileOps.deleteFolderRecursiveSync("lib/certTestPlsDelete");
	}).timeout(10000);
});
