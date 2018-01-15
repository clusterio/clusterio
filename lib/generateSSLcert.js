var forge = require("node-forge");
forge.options.usePureJavaScript = true;
var fs = require("fs");
var mkdirp = require("mkdirp");

var pki = forge.pki;
var rsa = forge.pki.rsa;
var startTime, endTime;



module.exports = function({
	bits = 2048,
	certificatePath = "database/certificate",
	doLogging = false,
} = {}){
	function log(t){
		if(doLogging) console.log("lib/generateSSLcert.js | "+t);
	}
	log("Generating SSL certificate with "+bits+" bits at "+certificatePath);

	startTime = Date.now();
	var keypair = rsa.generateKeyPair({bits: bits, e: 0x10001});
	endTime = Date.now();
	log("Generated 2048bit keypair in: "+(endTime-startTime)+" ms");

	startTime = Date.now();
	var cert = pki.createCertificate();
	cert.publicKey = keypair.publicKey;
	cert.serialNumber = "01";

	cert.validity.notBefore = new Date();
	cert.validity.notAfter = new Date(Date.now()+(1000*60*60*24*365)); // valid for one year

	// self-sign certificate
	cert.sign(keypair.privateKey);

	// Convert certificate to pem type and write it to a file
	if(certificatePath[certificatePath.length-1] != "/") certificatePath += "/";
	if(!fs.existsSync(certificatePath)) {
		mkdirp.sync(certificatePath);
		console.log("Created directory: "+certificatePath);
	}
	fs.writeFileSync(certificatePath+ "cert.key", pki.privateKeyToPem(keypair.privateKey));
	fs.writeFileSync(certificatePath+ "cert.crt", pki.certificateToPem(cert));

	endTime = Date.now();
	log("Generated certificate in: "+(endTime-startTime)+" ms");
}
