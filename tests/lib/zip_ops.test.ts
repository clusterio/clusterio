import t from "tap";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import stream from "node:stream";
import zlib from "node:zlib";
import * as lib from "@clusterio/lib";

async function readAll(readable: AsyncIterable<Buffer>) {
	const chunks: Buffer[] = [];
	for await (const chunk of readable) {
		chunks.push(chunk);
	}
	return Buffer.concat(chunks);
}

// Build a zip with ZipWriter, names ending in / are directories
async function zipBuffer(files: [string, string | Buffer][], options?: lib.ZipWriterOptions) {
	const writer = new lib.ZipWriter(options);
	const output = readAll(writer.outputStream);
	for (const [name, content] of files) {
		await writer.addBuffer(Buffer.from(content), name, { mtime: new Date(2020, 0, 2, 3, 4, 6) });
	}
	await writer.end();
	return await output;
}

const sourceFiles: [string, string][] = [
	["root/", ""],
	["root/foo.txt", "foo"],
	["root/big.txt", "lorem ipsum ".repeat(10000)],
	["root/ünïcode.txt", "unicode"],
];

// Incompressible, so writing it fills the output stream buffer
const bigData = crypto.randomBytes(256 * 1024);

// Resolve once a write to the writer is waiting for drain
async function waitForBackpressure(writer: lib.ZipWriter) {
	while (!writer.outputStream.writableNeedDrain) {
		await new Promise(resolve => setImmediate(resolve));
	}
}

t.test("ZipArchive", async t1 => {
	t1.test("fromBuffer()", async t2 => {
		t2.test("reads the entries in order", async t3 => {
			const zip = await lib.ZipArchive.fromBuffer(await zipBuffer(sourceFiles));
			t3.strictSame([...zip.entries.keys()], sourceFiles.map(([name]) => name));
			zip.close();
		});
		t2.test("rejects data that is not a zip", async t3 => {
			await t3.rejects(lib.ZipArchive.fromBuffer(Buffer.from("not a zip file")));
		});
		t2.test("rejects a corrupt central directory", async t3 => {
			const buffer = await zipBuffer([["root/foo.txt", "foo"]]);
			// Break the signature of the first central directory header
			const cd = buffer.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
			buffer[cd] = 0;
			await t3.rejects(lib.ZipArchive.fromBuffer(buffer), /invalid central directory file header signature/);
		});
	});
	t1.test("fromFile()", async t2 => {
		t2.test("reads a zip from disk", async t3 => {
			const dir = t3.testdir();
			const zipPath = path.join(dir, "test.zip");
			await fs.writeFile(zipPath, await zipBuffer(sourceFiles));
			const zip = await lib.ZipArchive.fromFile(zipPath);
			t3.teardown(() => zip.close());
			t3.equal((await zip.readFile("root/foo.txt"))?.toString(), "foo");
		});
		t2.test("rejects a missing file", async t3 => {
			const dir = t3.testdir();
			await t3.rejects(lib.ZipArchive.fromFile(path.join(dir, "missing.zip")), { code: "ENOENT" });
		});
	});
	t1.test("file()", async t2 => {
		const zip = await lib.ZipArchive.fromBuffer(await zipBuffer(sourceFiles));
		t2.teardown(() => zip.close());
		t2.test("returns the entry of a file", async t3 => {
			t3.equal(zip.file("root/foo.txt")?.fileName, "root/foo.txt");
		});
		t2.test("returns null for a missing file", async t3 => {
			t3.equal(zip.file("root/missing.txt"), null);
		});
		t2.test("returns null for a directory", async t3 => {
			t3.equal(zip.file("root/"), null);
		});
	});
	t1.test("readFile()", async t2 => {
		const zip = await lib.ZipArchive.fromBuffer(await zipBuffer(sourceFiles));
		t2.teardown(() => zip.close());
		t2.test("returns the decompressed content", async t3 => {
			t3.equal((await zip.readFile("root/big.txt"))?.toString(), sourceFiles[2][1]);
			t3.equal((await zip.readFile("root/ünïcode.txt"))?.toString(), "unicode");
		});
		t2.test("returns null for a missing file", async t3 => {
			t3.equal(await zip.readFile("root/missing.txt"), null);
		});
	});
	t1.test("openRawStream()", async t2 => {
		t2.test("returns the content as stored", async t3 => {
			const zip = await lib.ZipArchive.fromBuffer(await zipBuffer(sourceFiles));
			t3.teardown(() => zip.close());
			const entry = zip.file("root/big.txt")!;
			const raw = await readAll(await zip.openRawStream(entry));
			t3.equal(raw.length, entry.compressedSize);
			// eslint-disable-next-line node/no-sync
			t3.equal(zlib.inflateRawSync(raw).toString(), sourceFiles[2][1]);
		});
	});
	t1.test("close()", async t2 => {
		t2.test("closes the file it was opened from", async t3 => {
			const dir = t3.testdir();
			const zipPath = path.join(dir, "test.zip");
			await fs.writeFile(zipPath, await zipBuffer(sourceFiles));
			const zip = await lib.ZipArchive.fromFile(zipPath);
			zip.close();
			await t3.rejects(zip.readFile("root/foo.txt"), /closed/);
		});
	});
});

t.test("findRoot()", async t1 => {
	t1.test("returns the folder of the first entry", async t2 => {
		const zip = await lib.ZipArchive.fromBuffer(await zipBuffer([["root/foo.txt", ""], ["root/bar.txt", ""]]));
		t2.equal(lib.findRoot(zip), "root");
	});
	t1.test("returns the folder of the first entry when there are several", async t2 => {
		const zip = await lib.ZipArchive.fromBuffer(await zipBuffer([["root-1/foo.txt", ""], ["root-2/bar.txt", ""]]));
		t2.equal(lib.findRoot(zip), "root-1");
	});
	t1.test("returns the top folder of a nested entry", async t2 => {
		const zip = await lib.ZipArchive.fromBuffer(await zipBuffer([["root/sub/foo.txt", ""]]));
		t2.equal(lib.findRoot(zip), "root");
	});
	t1.test("throws if the first entry is in the root", async t2 => {
		const zip = await lib.ZipArchive.fromBuffer(await zipBuffer([["bar.txt", ""], ["root/foo.txt", ""]]));
		t2.throws(() => lib.findRoot(zip), new Error("Zip contains file 'bar.txt' in root dir"));
	});
	t1.test("throws on an empty zip", async t2 => {
		const zip = await lib.ZipArchive.fromBuffer(await zipBuffer([]));
		t2.throws(() => lib.findRoot(zip), new Error("Empty zip file"));
	});
});

t.test("zipOutputStream()", async t1 => {
	t1.test("returns the output stream", async t2 => {
		const outputStream = new stream.PassThrough();
		const zipFile = Object.assign(new stream.EventEmitter(), { outputStream });
		t2.equal(lib.zipOutputStream(zipFile), outputStream);
	});
	t1.test("destroys the output stream with errors from the zip file", async t2 => {
		const outputStream = new stream.PassThrough();
		const zipFile = Object.assign(new stream.EventEmitter(), { outputStream });
		const output = lib.zipOutputStream(zipFile);
		const error = new Error("Test error");
		const piped = stream.promises.pipeline(output, new stream.PassThrough());
		zipFile.emit("error", error);
		await t2.rejects(piped, error);
		t2.equal(output.destroyed, true);
	});
});

t.test("ZipWriter", async t1 => {
	async function roundTrip(forceZip64: boolean) {
		const source = await lib.ZipArchive.fromBuffer(await zipBuffer(sourceFiles));
		const writer = new lib.ZipWriter({ forceZip64 });
		const output = readAll(writer.outputStream);
		for (const entry of source.entries.values()) {
			await writer.addEntry(source, entry);
		}
		await writer.addBuffer(Buffer.from("added"), "root/added.txt", { mtime: new Date(2020, 0, 2, 3, 4, 6) });
		await writer.end();
		return { source, copy: await lib.ZipArchive.fromBuffer(await output) };
	}

	for (const forceZip64 of [false, true]) {
		t1.test(`copies entries and adds files${forceZip64 ? " with forceZip64" : ""}`, async t2 => {
			const { source, copy } = await roundTrip(forceZip64);
			t2.strictSame([...copy.entries.keys()], [...source.entries.keys(), "root/added.txt"]);
			for (const [name, sourceEntry] of source.entries) {
				const entry = copy.entries.get(name)!;
				t2.equal(entry.compressionMethod, sourceEntry.compressionMethod, name);
				t2.equal(entry.compressedSize, sourceEntry.compressedSize, name);
				t2.equal(entry.uncompressedSize, sourceEntry.uncompressedSize, name);
				t2.equal(entry.crc32, sourceEntry.crc32, name);
				t2.equal(entry.versionNeededToExtract, forceZip64 ? 45 : 20, name);
				t2.equal(entry.generalPurposeBitFlag & 0x808, 0x800, name);
				t2.same(entry.getLastModDate(), sourceEntry.getLastModDate({ forceDosFormat: true }), name);
				if (!name.endsWith("/")) {
					const content = await copy.readEntry(entry);
					t2.same(content, await source.readEntry(sourceEntry), name);
					t2.equal(zlib.crc32(content), entry.crc32, name);
				}
			}
			const added = copy.entries.get("root/added.txt")!;
			t2.equal((await copy.readEntry(added)).toString(), "added");
			t2.equal(added.crc32, zlib.crc32("added"));
			t2.same(added.getLastModDate(), new Date(2020, 0, 2, 3, 4, 6));
		});
	}

	t1.test("constructor", async t2 => {
		t2.test("defaults to no options", async t3 => {
			const writer = new lib.ZipWriter();
			const output = readAll(writer.outputStream);
			await writer.end();
			const buffer = await output;
			// Only the end of central directory record
			t3.equal(buffer.length, 22);
			t3.equal(buffer.readUInt32LE(0), 0x06054b50);
		});
	});

	t1.test("addBuffer()", async t2 => {
		t2.test("records the current time by default", async t3 => {
			// DOS times have a 2 second resolution
			const before = Date.now() - 2000;
			const writer = new lib.ZipWriter();
			const output = readAll(writer.outputStream);
			await writer.addBuffer(Buffer.from("x"), "x.txt");
			await writer.end();
			const zip = await lib.ZipArchive.fromBuffer(await output);
			const recorded = zip.file("x.txt")!.getLastModDate().getTime();
			t3.ok(recorded >= before && recorded <= Date.now(), "recorded time is now");
		});
		t2.test("records dates before 1980 as the start of 1980", async t3 => {
			const writer = new lib.ZipWriter();
			const output = readAll(writer.outputStream);
			await writer.addBuffer(Buffer.from("x"), "x.txt", { mtime: new Date(1970, 0, 1) });
			await writer.end();
			const zip = await lib.ZipArchive.fromBuffer(await output);
			t3.same(zip.file("x.txt")!.getLastModDate(), new Date(1980, 0, 1));
		});
		t2.test("records dates after 2107 with the year 2107", async t3 => {
			const writer = new lib.ZipWriter();
			const output = readAll(writer.outputStream);
			await writer.addBuffer(Buffer.from("x"), "x.txt", { mtime: new Date(2200, 3, 4, 5, 6, 8) });
			await writer.end();
			const zip = await lib.ZipArchive.fromBuffer(await output);
			t3.same(zip.file("x.txt")!.getLastModDate(), new Date(2107, 3, 4, 5, 6, 8));
		});
	});

	t1.test("end()", async t2 => {
		t2.test("writes ZIP64 end records when forced", async t3 => {
			const writer = new lib.ZipWriter({ forceZip64: true });
			const output = readAll(writer.outputStream);
			await writer.addBuffer(Buffer.from("x"), "x.txt");
			await writer.end();
			const buffer = await output;
			const eocd = buffer.subarray(-22);
			t3.equal(eocd.readUInt16LE(8), 0xffff);
			t3.equal(eocd.readUInt32LE(12), 0xffffffff);
			const locator = buffer.subarray(-42, -22);
			t3.equal(locator.readUInt32LE(0), 0x07064b50);
			const record = buffer.subarray(Number(locator.readBigUInt64LE(8)));
			t3.equal(record.readUInt32LE(0), 0x06064b50);
			t3.equal(record.readBigUInt64LE(24), 1n);
		});
		t2.test("writes ZIP64 end records when there are 65535 entries", async t3 => {
			const writer = new lib.ZipWriter();
			// Add the entry list directly, compressing 65535 files takes too long
			(writer as any).entries = Array.from({ length: 0xffff }, () => ({
				fileName: Buffer.from("a"), fileComment: Buffer.alloc(0), versionMadeBy: 20,
				generalPurposeBitFlag: 0x800, compressionMethod: 0, lastModFileTime: 0, lastModFileDate: 0x21,
				crc32: 0, compressedSize: 0, uncompressedSize: 0, externalFileAttributes: 0, offset: 0,
			}));
			const output = readAll(writer.outputStream);
			await writer.end();
			const buffer = await output;
			t3.equal(buffer.subarray(-42, -38).readUInt32LE(0), 0x07064b50);
			t3.equal(buffer.subarray(-22).readUInt16LE(8), 0xffff);
		});
		t2.test("uses ZIP64 fields for entries past 4 GiB", async t3 => {
			const writer = new lib.ZipWriter();
			const big = 0x100000000;
			(writer as any).entries = [{
				fileName: Buffer.from("a"), fileComment: Buffer.alloc(0), versionMadeBy: 20,
				generalPurposeBitFlag: 0x800, compressionMethod: 0, lastModFileTime: 0, lastModFileDate: 0x21,
				crc32: 0, compressedSize: big, uncompressedSize: big, externalFileAttributes: 0, offset: big,
			}];
			(writer as any).offset = big + 30;
			const output = readAll(writer.outputStream);
			await writer.end();
			const buffer = await output;
			t3.equal(buffer.readUInt32LE(0), 0x02014b50);
			t3.equal(buffer.readUInt16LE(6), 45);
			t3.equal(buffer.readUInt32LE(42), 0xffffffff);
			const extra = buffer.subarray(46 + 1, 46 + 1 + 28);
			t3.equal(extra.readUInt16LE(0), 1);
			t3.equal(extra.readBigUInt64LE(4), BigInt(big));
			t3.equal(extra.readBigUInt64LE(12), BigInt(big));
			t3.equal(extra.readBigUInt64LE(20), BigInt(big));
			// Central directory starts past 4 GiB
			t3.equal(buffer.subarray(-22).readUInt32LE(16), 0xffffffff);
		});
	});

	t1.test("write", async t2 => {
		t2.test("rejects writes after the output stream is destroyed with an error", async t3 => {
			const writer = new lib.ZipWriter();
			writer.outputStream.on("error", () => {});
			writer.outputStream.destroy(new Error("Test error"));
			await t3.rejects(writer.addBuffer(Buffer.from(""), "foo.txt"), new Error("Test error"));
			await t3.rejects(writer.end(), new Error("Test error"));
		});
		t2.test("rejects writes after the output stream is destroyed", async t3 => {
			const writer = new lib.ZipWriter();
			writer.outputStream.destroy();
			await t3.rejects(writer.addBuffer(Buffer.from(""), "foo.txt"), new Error("Zip output stream was closed"));
		});
		t2.test("waits for drain when the output is full", async t3 => {
			const writer = new lib.ZipWriter();
			writer.outputStream.pause();
			let done = false;
			const adding = writer.addBuffer(bigData, "foo.txt").then(() => { done = true; });
			await waitForBackpressure(writer);
			await new Promise(resolve => setImmediate(resolve));
			t3.equal(done, false);
			const output = readAll(writer.outputStream);
			await adding;
			await writer.end();
			const zip = await lib.ZipArchive.fromBuffer(await output);
			t3.same(await zip.readFile("foo.txt"), bigData);
		});
		t2.test("fails when the output is destroyed while waiting for drain", async t3 => {
			const writer = new lib.ZipWriter();
			writer.outputStream.pause();
			const adding = writer.addBuffer(bigData, "foo.txt");
			await waitForBackpressure(writer);
			writer.outputStream.destroy();
			await t3.rejects(adding, new Error("Zip output stream was closed"));
		});
		t2.test("fails with the error when the output errors while waiting for drain", async t3 => {
			const writer = new lib.ZipWriter();
			writer.outputStream.pause();
			writer.outputStream.on("error", () => {});
			const adding = writer.addBuffer(bigData, "foo.txt");
			await waitForBackpressure(writer);
			writer.outputStream.destroy(new Error("Test error"));
			await t3.rejects(adding, new Error("Test error"));
		});
	});
});
