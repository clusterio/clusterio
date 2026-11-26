import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { testLines } from "./factorio/lines.js";
import * as lib from "@clusterio/lib";
import "../setup_logging.js";


describe("lib/logging_utils.js", function() {
	describe("formatServerOutput", function() {
		it("should pass the test lines", function() {
			for (let [reference, output] of testLines) {
				let line = lib._formatServerOutput(output);
				// Strip colours
				line = line.replace(/\x1B\[\d+m/g, "");
				assert.deepEqual(line, reference);
			}
		});
	});

	let logDir = path.join("test", "file", "log");
	describe("class LogIndex", function() {
		it("should create a new empty index if index.json does not exist", async function() {
			let logIndex = await lib.LogIndex.load(logDir);
			assert.deepEqual(logIndex.index, new Map());
		});
		it("should build index of only past log files", async function() {
			let logIndex = await lib.LogIndex.load(logDir);
			await logIndex.buildIndex();
			assert.deepEqual(
				new Set(logIndex.index.keys()),
				new Set(["test-2021-12-10.log", "test-2021-12-11.log", "test-2021-12-12.log"])
			);
		});
		it("should roundtrip index on save load cycle", async function() {
			let logIndex = await lib.LogIndex.load(logDir);
			await logIndex.buildIndex();
			let tempDir = path.join("temp", "test", "log");
			logIndex.logDirectory = tempDir;
			await logIndex.save();
			let loadedIndex = await lib.LogIndex.load(tempDir);
			assert.deepEqual(
				loadedIndex,
				logIndex
			);
		});
		it("should reject indexing a file that fails to read", async function() {
			let tempDir = path.join("temp", "test", "log_index_read_error");
			await fs.rm(tempDir, { recursive: true, force: true });
			await fs.mkdir(path.join(tempDir, "test-2021-01-01.log"), { recursive: true });
			let logIndex = await lib.LogIndex.load(tempDir);
			await assert.rejects(logIndex.indexFile("test-2021-01-01.log"), { code: "EISDIR" });
		});
		it("should drop entries for files no longer present", async function() {
			let tempDir = path.join("temp", "test", "log_index_prune");
			await fs.rm(tempDir, { recursive: true, force: true });
			await fs.cp(logDir, tempDir, { recursive: true });
			let logIndex = await lib.LogIndex.load(tempDir);
			await logIndex.buildIndex();
			await fs.unlink(path.join(tempDir, "test-2021-12-10.log"));
			await logIndex.buildIndex();
			assert.deepEqual(
				new Set(logIndex.index.keys()),
				new Set(["test-2021-12-11.log", "test-2021-12-12.log"])
			);
		});
		it("should handle loading broken index", async function() {
			let tempDir = path.join("temp", "test", "log");
			await fs.writeFile(path.join(tempDir, "index.json"), "Broken JSON");
			let logIndex = await lib.LogIndex.load(tempDir);
			assert.deepEqual(logIndex.index, new Map());
		});
	});

	describe("class DailyFileTransport", function() {
		let tempDir = path.join("temp", "test", "daily_file");
		beforeEach(async function() {
			await fs.rm(tempDir, { recursive: true, force: true });
		});

		function create(now, dirname = tempDir) {
			return new lib.DailyFileTransport({ dirname, prefix: "test", now });
		}
		function write(transport, message) {
			transport.log({ [Symbol.for("message")]: JSON.stringify({ message }) }, () => {});
		}
		async function close(transport) {
			await new Promise(resolve => transport.close(resolve));
		}
		async function read(file) {
			let content = await fs.readFile(path.join(tempDir, file), "utf8");
			assert(content.endsWith(os.EOL));
			return content.split(os.EOL).slice(0, -1).map(line => JSON.parse(line).message);
		}

		it("should create the directory and write lines to the file for the UTC date", async function() {
			let transport = create(() => Date.parse("2026-11-19T12:00:00Z"), path.join(tempDir, "nested"));
			write(transport, "first");
			write(transport, "second");
			await close(transport);
			assert.deepEqual(await read(path.join("nested", "test-2026-11-19.log")), ["first", "second"]);
		});

		it("should append to an existing file", async function() {
			await fs.mkdir(tempDir, { recursive: true });
			await fs.writeFile(path.join(tempDir, "test-2026-11-19.log"), `{"message":"old"}${os.EOL}`);
			let transport = create(() => Date.parse("2026-11-19T12:00:00Z"));
			write(transport, "new");
			await close(transport);
			assert.deepEqual(await read("test-2026-11-19.log"), ["old", "new"]);
		});

		it("should switch files when the UTC date changes", async function() {
			let time = Date.parse("2026-11-19T23:59:59.999Z");
			let transport = create(() => time);
			write(transport, "before");
			time += 1;
			write(transport, "after");
			await close(transport);
			assert.deepEqual((await fs.readdir(tempDir)).sort(), ["test-2026-11-19.log", "test-2026-11-20.log"]);
			assert.deepEqual(await read("test-2026-11-19.log"), ["before"]);
			assert.deepEqual(await read("test-2026-11-20.log"), ["after"]);
		});

		it("should use the UTC date rather than the local one", async function() {
			let transport = create(() => Date.parse("2026-11-20T00:30:00+02:00"));
			write(transport, "message");
			await close(transport);
			assert.deepEqual(await fs.readdir(tempDir), ["test-2026-11-19.log"]);
		});

		it("should emit write errors", async function() {
			await fs.mkdir(path.join(tempDir, "test-2026-11-19.log"), { recursive: true });
			let transport = create(() => Date.parse("2026-11-19T12:00:00Z"));
			let error = new Promise(resolve => transport.once("error", resolve));
			write(transport, "message");
			assert.equal((await error).code, "EISDIR");
		});

		it("should close when nothing was written", async function() {
			await close(create(Date.now));
			assert.deepEqual(await fs.readdir(tempDir), []);
		});
	});

	describe("deleteOldLogs", function() {
		let tempDir = path.join("temp", "test", "log_retention");
		let files = [
			"cluster-2026-10-01.log",
			"cluster-2026-10-12.log",
			"cluster-2026-10-13.log",
			"cluster-2026-11-12.log",
			"index.json",
			"notes-2026-10-01.txt",
			".0123abcd-audit.json",
		];
		let now = Date.parse("2026-11-12T08:00:00Z");
		beforeEach(async function() {
			await fs.rm(tempDir, { recursive: true, force: true });
			await fs.mkdir(tempDir, { recursive: true });
			for (let file of files) {
				await fs.writeFile(path.join(tempDir, file), "");
			}
		});

		it("should delete only dated log files past the retention", async function() {
			let deleted = await lib.deleteOldLogs(tempDir, 30, now);
			assert.deepEqual(deleted.sort(), ["cluster-2026-10-01.log", "cluster-2026-10-12.log"]);
			assert.deepEqual(
				(await fs.readdir(tempDir)).sort(),
				files.filter(file => !deleted.includes(file)).sort(),
			);
		});
		it("should keep everything with a retention of 0", async function() {
			assert.deepEqual(await lib.deleteOldLogs(tempDir, 0, now), []);
			assert.deepEqual((await fs.readdir(tempDir)).sort(), [...files].sort());
		});
		it("should ignore a missing directory", async function() {
			assert.deepEqual(await lib.deleteOldLogs(path.join(tempDir, "missing"), 30, now), []);
		});
	});

	let allLines = [];
	let logIndex = null;
	before(async function() {
		for (let file of (await fs.readdir(logDir)).sort()) {
			if (file === "excluded.txt") {
				continue;
			}
			let fileStream = (await fs.open(path.join(logDir, file))).createReadStream();
			let lineStream = new lib.LineSplitter({ readableObjectMode: true });
			fileStream.pipe(lineStream);
			for await (let line of lineStream) {
				try {
					allLines.push(JSON.parse(line));
				} catch (err) {
					allLines.push({ "level": "info", "message": line.toString() });
				}
			}
		}

		logIndex = await lib.LogIndex.load(logDir);
		await logIndex.buildIndex();
	});

	describe("queryLog", function() {
		it("should reject when a log file fails to read", async function() {
			let tempDir = path.join("temp", "test", "log_query_read_error");
			await fs.rm(tempDir, { recursive: true, force: true });
			await fs.mkdir(path.join(tempDir, "test-2021-01-01.log"), { recursive: true });
			await assert.rejects(lib.queryLog(tempDir, { all: true }), { code: "EISDIR" });
		});
		for (let index of [() => undefined, () => logIndex]) {
			describe(index() === undefined ? "without index" : "with index", function() {
				it("returns nothing with an empty filter", async function() {
					let log = await lib.queryLog(logDir, {}, index());
					assert.deepEqual(log, []);
				});
				it("should return the whole log when querying all", async function() {
					let log = await lib.queryLog(logDir, { all: true }, index());
					assert.deepEqual(log, allLines);
				});
				it("should return the whole log in reverse when querying all desc", async function() {
					let log = await lib.queryLog(logDir, { all: true, order: "desc" }, index());
					assert.deepEqual(log, [...allLines].reverse());
				});
				it("should limit by limit", async function() {
					let log = await lib.queryLog(logDir, { limit: 2, all: true }, index());
					assert.deepEqual(log, allLines.slice(0, 2));
				});
				it("should filter by maxLevel", async function() {
					let log = await lib.queryLog(logDir, { maxLevel: "info", all: true }, index());
					assert.deepEqual(log, allLines.filter(
						info => ["fatal", "error", "warn", "audit", "info"].includes(info.level)
					));
					log = await lib.queryLog(logDir, { maxLevel: "fatal", all: true }, index());
					assert.deepEqual(log, allLines.filter(
						info => ["fatal"].includes(info.level)
					));
				});
				it("should filter by controller", async function() {
					let log = await lib.queryLog(logDir, { controller: true }, index());
					assert.deepEqual(log, allLines.filter(
						info => info.host_id === undefined && info.instance_id === undefined
					));
				});
				it("should filter by hostIds", async function() {
					let log = await lib.queryLog(logDir, { hostIds: [1, 2] }, index());
					assert.deepEqual(log, allLines.filter(
						info => [1, 2].includes(info.host_id) && info.instance_id === undefined
					));
				});
				it("should filter by instanceIds", async function() {
					let log = await lib.queryLog(logDir, { instanceIds: [10, 11] }, index());
					assert.deepEqual(log, allLines.filter(info => [10, 11].includes(info.instance_id)));
				});
			});
		}
	});
});
