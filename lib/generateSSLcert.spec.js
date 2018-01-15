var assert = require("assert");
var fs = require("fs");

var fileOps = require("./fileOps.js");
var generateSSLcert = require("./generateSSLcert.js")

describe("generateSSLcert.js(options)", ()=>{
	it("Creates a folder with a .crt and .key file in it", ()=>{
		let certPath = "lib/certTestPlsDelete";
		assert(!fs.existsSync(certPath)); // if it already exsits, the test might pass because of leftover data (which is bad)
		
		generateSSLcert({
			// bits:512, // supported, but I just use the default of 2048 for this test
			certificatePath:certPath,
			doLogging: false,
		});
		
		assert(fs.existsSync(certPath));
		assert(fs.existsSync(certPath+"/cert.key")); // private key
		assert(fs.existsSync(certPath+"/cert.crt")); // certificate file
		
		// remove certificates and data from the test
		fileOps.deleteFolderRecursiveSync(certPath);
	}).timeout(10000);
});