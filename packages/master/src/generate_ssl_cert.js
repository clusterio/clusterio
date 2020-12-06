"use strict";
const forge = require("node-forge");
const fs = require("fs-extra");
const util = require("util");

const { logger } = require("@clusterio/lib/logging");

const hrtime = process.hrtime.bigint;


module.exports = async function({
	bits = 2048,
	sslCertPath,
	sslPrivKeyPath,
} = {}){
	logger.info(`Generating SSL certificate with ${bits} bits at ${sslCertPath}`);

	let startNs = hrtime();
	let keypair = await util.promisify(forge.pki.rsa.generateKeyPair)({ bits: bits, e: 0x10001 });
	logger.info(`Generated ${bits}bit keypair in: ${Number(hrtime()-startNs) / 1e6} ms`);

	startNs = hrtime();
	let cert = forge.pki.createCertificate();
	cert.publicKey = keypair.publicKey;
	cert.serialNumber = "01";

	cert.validity.notBefore = new Date();
	cert.validity.notAfter = new Date(Date.now()+(1000*60*60*24*365)); // valid for one year

	// XXX This should probably be limited to the actual hostname
	let attrs = [{ name: "commonName", value: "*" }];
	cert.setSubject(attrs);
	cert.setIssuer(attrs);

	// self-sign certificate
	cert.sign(keypair.privateKey);

	// Write certificate and private key to pem files
	await fs.outputFile(sslPrivKeyPath, forge.pki.privateKeyToPem(keypair.privateKey));
	await fs.outputFile(sslCertPath, forge.pki.certificateToPem(cert));

	logger.info(`Generated certificate in: ${Number(hrtime()-startNs) / 1e6} ms`);
};
