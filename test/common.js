import assert from "node:assert/strict";
import yazl from "yazl";
import { compile, zipOutputStream } from "@clusterio/lib";

/**
 * Generate a flat array of tests from a matrix of inputs.
 *
 * @template {any[][]} T
 * @param {T} arrays - A list of arrays representing the different values for each argument
 * @returns {Array<{ [K in keyof T]: T[K][number] }>}
 * 		An array of tuples, each containing one value from each input array.
 */
export function testMatrix(...arrays) {
	return arrays.reduce((acc, curr) => acc.flatMap(a => curr.map(b => [...a, b])), [[]]);
}

/**
 * Test that a class is round trip json serialisable across multiple test cases.
 *
 * @template {any[]} T - Constructor arguments
 * @param {{new(...args: T): object}} Class - The class which has toJSON and fromJSON methods.
 * @param {T[]} tests - The tests inputs to pass to the class constructor.
 */
export function testRoundTripJsonSerialisable(Class, tests) {
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
 * Mark that this test takes a lot of time, or depends on a test that takes a
 * lot of time.
 */
export function slowTest(test) {
	if (process.env.FAST_TEST) {
		test.skip();
	}
	test.timeout(30000);
}

/**
 * Mark that this test depends on an external API and may be slow or flaky.
 */
export function externalTest(test) {
	if (process.env.NO_EXTERNAL_TEST) {
		test.skip();
	}
	test.timeout(60000);
}

/**
 * Create a zip file in memory
 *
 * @param {Iterable<[string, string | Buffer]>} files -
 *     Paths and content of the files to add, paths ending with / are directories.
 * @returns {yazl.ZipFile} zip file with the output stream ready to be read.
 */
export function createZip(files) {
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
export async function createZipBuffer(files) {
	const chunks = [];
	for await (const chunk of zipOutputStream(createZip(files))) {
		chunks.push(chunk);
	}
	return Buffer.concat(chunks);
}
