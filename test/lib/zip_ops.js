"use strict";
const assert = require("assert").strict;
const zlib = require("zlib");

const { ZipArchive, ZipWriter, findRoot } = require("@clusterio/lib");
const { createZipBuffer } = require("../common");


async function readAll(stream) {
	const chunks = [];
	for await (const chunk of stream) {
		chunks.push(chunk);
	}
	return Buffer.concat(chunks);
}


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

	describe("class ZipWriter", function() {
		const sourceFiles = [
			["root/", ""],
			["root/foo.txt", "foo"],
			["root/big.txt", "lorem ipsum ".repeat(10000)],
			["root/ünïcode.txt", "unicode"],
		];

		async function roundTrip(forceZip64) {
			const source = await ZipArchive.fromBuffer(await createZipBuffer(sourceFiles));
			const writer = new ZipWriter({ forceZip64 });
			const output = readAll(writer.outputStream);
			for (const entry of source.entries.values()) {
				await writer.addEntry(source, entry);
			}
			await writer.addBuffer(Buffer.from("added"), "root/added.txt", { mtime: new Date(2020, 0, 2, 3, 4, 6) });
			await writer.end();
			return { source, copy: await ZipArchive.fromBuffer(await output) };
		}

		async function assertRoundTrip(forceZip64) {
			const { source, copy } = await roundTrip(forceZip64);
			assert.deepEqual([...copy.entries.keys()], [...source.entries.keys(), "root/added.txt"]);
			for (const [name, sourceEntry] of source.entries) {
				const entry = copy.entries.get(name);
				assert.equal(entry.compressionMethod, sourceEntry.compressionMethod, name);
				assert.equal(entry.compressedSize, sourceEntry.compressedSize, name);
				assert.equal(entry.uncompressedSize, sourceEntry.uncompressedSize, name);
				assert.equal(entry.crc32, sourceEntry.crc32, name);
				assert.deepEqual(entry.getLastModDate(), sourceEntry.getLastModDate({ forceDosFormat: true }), name);
				if (!name.endsWith("/")) {
					const content = await copy.readEntry(entry);
					assert.deepEqual(content, await source.readEntry(sourceEntry), name);
					assert.equal(zlib.crc32(content), entry.crc32, name);
				}
			}
			const added = copy.entries.get("root/added.txt");
			assert.equal((await copy.readEntry(added)).toString(), "added");
			assert.equal(zlib.crc32("added"), added.crc32);
			assert.deepEqual(added.getLastModDate(), new Date(2020, 0, 2, 3, 4, 6));
			assert.equal(added.versionNeededToExtract, forceZip64 ? 45 : 20);
		}

		it("should copy entries and add files", async function() {
			await assertRoundTrip(false);
		});
		it("should write ZIP64 structures when forced", async function() {
			await assertRoundTrip(true);
		});
		it("should reject writes after the output stream is destroyed", async function() {
			const writer = new ZipWriter();
			writer.outputStream.on("error", () => {});
			writer.outputStream.destroy(new Error("Test error"));
			await assert.rejects(writer.addBuffer(Buffer.from(""), "foo.txt"), new Error("Test error"));
			await assert.rejects(writer.end(), new Error("Test error"));
		});
		it("should fail when the output stream is destroyed while waiting for drain", async function() {
			const writer = new ZipWriter();
			writer.outputStream.pause();
			const adding = writer.addBuffer(Buffer.alloc(1024 * 1024), "foo.txt");
			writer.outputStream.destroy();
			await assert.rejects(adding, new Error("Zip output stream was closed"));
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
