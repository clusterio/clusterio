"use strict";
const assert = require("assert").strict;
const yazl = require("yazl");
const { compile, zipOutputStream } = require("@clusterio/lib");

/**
 * Generate a flat array of tests from a matrix of inputs.
 *
 * @template {any[][]} T
 * @param {T} arrays - A list of arrays representing the different values for each argument
 * @returns {Array<{ [K in keyof T]: T[K][number] }>}
 * 		An array of tuples, each containing one value from each input array.
 */
function testMatrix(...arrays) {
	return arrays.reduce((acc, curr) => acc.flatMap(a => curr.map(b => [...a, b])), [[]]);
}

/**
 * Test that a class is round trip json serialisable across multiple test cases.
 *
 * @template {any[]} T - Constructor arguments
 * @param {{new(...args: T): object}} Class - The class which has toJSON and fromJSON methods.
 * @param {T[]} tests - The tests inputs to pass to the class constructor.
 */
function testRoundTripJsonSerialisable(Class, tests) {
	const validate = compile(Class.jsonSchema);
	for (const test of tests) {
		const original = new Class(...test);
		const serialised = JSON.stringify(original);
		const jsonObject = JSON.parse(serialised);
		const reconstructed = Class.fromJSON(jsonObject);
		assert.deepEqual(reconstructed, original, JSON.stringify(test));
		if (!validate(jsonObject)) {
			throw validate.errors;
		}
	}
}

/**
 * Create a zip file in memory
 *
 * @param {Iterable<[string, string | Buffer]>} files -
 *     Paths and content of the files to add, paths ending with / are directories.
 * @returns {yazl.ZipFile} zip file with the output stream ready to be read.
 */
function createZip(files) {
	const zip = new yazl.ZipFile();
	for (const [filePath, content] of files) {
		if (filePath.endsWith("/")) {
			zip.addEmptyDirectory(filePath);
		} else {
			zip.addBuffer(Buffer.from(content), filePath);
		}
	}
	zip.end();
	return zip;
}

/**
 * Create a zip file in memory and return its content
 *
 * @param {Iterable<[string, string | Buffer]>} files - Paths and content of the files to add.
 * @returns {Promise<Buffer>} content of the zip file.
 */
async function createZipBuffer(files) {
	const chunks = [];
	for await (const chunk of zipOutputStream(createZip(files))) {
		chunks.push(chunk);
	}
	return Buffer.concat(chunks);
}

module.exports = {
	testMatrix,
	testRoundTripJsonSerialisable,
	createZip,
	createZipBuffer,
};
