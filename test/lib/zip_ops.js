"use strict";
const assert = require("assert").strict;

const { ZipArchive, findRoot } = require("@clusterio/lib");
const { createZipBuffer } = require("../common");


describe("lib/zip_ops", function() {
	describe("class ZipArchive", function() {
		it("should read files from a zip", async function() {
			const zip = await ZipArchive.fromBuffer(await createZipBuffer([
				["root/foo.txt", "foo"],
				["root/bar.txt", "bar"],
			]));
			assert.deepEqual([...zip.entries.keys()], ["root/foo.txt", "root/bar.txt"]);
			assert.equal((await zip.readFile("root/foo.txt")).toString(), "foo");
			assert.equal(await zip.readFile("root/missing.txt"), null);
			assert.equal(zip.file("root/missing.txt"), null);
			assert.equal(zip.file("root/bar.txt").fileName, "root/bar.txt");
		});
		it("should reject invalid zips", async function() {
			await assert.rejects(ZipArchive.fromBuffer(Buffer.from("not a zip file")));
		});
	});

	describe("findRoot()", function() {
		it("should find the root of a zip", async function() {
			const zip = await ZipArchive.fromBuffer(await createZipBuffer([
				["root/foo.txt", ""],
				["root/bar.txt", ""],
			]));
			assert.equal(findRoot(zip), "root");
		});

		it("should throw if the first file is at the root of the zip", async function() {
			const zip = await ZipArchive.fromBuffer(await createZipBuffer([
				["bar.txt", ""],
				["root/foo.txt", ""],
			]));
			assert.throws(
				() => findRoot(zip),
				new Error("Zip contains file 'bar.txt' in root dir")
			);
		});

		it("should return directory of first file if there are multiple root dirs", async function() {
			const zip = await ZipArchive.fromBuffer(await createZipBuffer([
				["root-1/foo.txt", ""],
				["root-2/bar.txt", ""],
			]));
			assert.equal(findRoot(zip), "root-1");
		});

		it("should throw if given an empty zip file", async function() {
			const zip = await ZipArchive.fromBuffer(await createZipBuffer([]));
			assert.throws(
				() => findRoot(zip),
				new Error("Empty zip file")
			);
		});
	});
});
