"use strict";
const assert = require("assert").strict;
const fs = require("fs-extra");
const path = require("path");
const util = require("util");


const { testLines } = require("./factorio/lines");
const libLoggingUtils = require("@clusterio/lib/logging_utils");
const libStream = require("@clusterio/lib/stream");


describe("lib/logging_utils.js", function() {
	describe("formatServerOutput", function() {
		it("should pass the test lines", function() {
			for (let [reference, output] of testLines) {
				let line = libLoggingUtils._formatServerOutput(output);
				// Strip colours
				line = line.replace(/\x1B\[\d+m/g, "");
				assert.deepEqual(line, reference);
			}
		});
	});

	let logDir = path.join("test", "file", "log");
	describe("class LogIndex", function() {
		it("should create a new empty index if index.json does not exist", async function() {
			let logIndex = await libLoggingUtils.LogIndex.load(logDir);
			assert.deepEqual(logIndex.index, new Map());
		});
		it("should build index of only past log files", async function() {
			let logIndex = await libLoggingUtils.LogIndex.load(logDir);
			await logIndex.buildIndex();
			assert.deepEqual(
				new Set(logIndex.index.keys()),
				new Set(["test-2021-12-10.log", "test-2021-12-11.log", "test-2021-12-12.log"])
			);
		});
		it("should roundtrip index on save load cycle", async function() {
			let logIndex = await libLoggingUtils.LogIndex.load(logDir);
			await logIndex.buildIndex();
			let tempDir = path.join("temp", "test", "log");
			logIndex.logDirectory = tempDir;
			await logIndex.save();
			let loadedIndex = await libLoggingUtils.LogIndex.load(tempDir);
			assert.deepEqual(
				loadedIndex,
				logIndex
			);
		});
		it("should handle loading broken index", async function() {
			let tempDir = path.join("temp", "test", "log");
			await fs.outputFile(path.join(tempDir, "index.json"), "Broken JSON");
			let logIndex = await libLoggingUtils.LogIndex.load(tempDir);
			assert.deepEqual(logIndex.index, new Map());
		});
	});

	let allLines = [];
	let logIndex = null;
	before(async function() {
		for (let file of (await fs.readdir(logDir)).sort()) {
			if (file === "excluded.txt") {
				continue;
			}
			let fileStream = fs.createReadStream(path.join(logDir, file));
			let lineStream = new libStream.LineSplitter({ readableObjectMode: true });
			fileStream.pipe(lineStream);
			for await (let line of lineStream) {
				try {
					allLines.push(JSON.parse(line));
				} catch (err) {
					allLines.push({ "level": "info", "message": line.toString() });
				}
			}
		}

		logIndex = await libLoggingUtils.LogIndex.load(logDir);
		await logIndex.buildIndex();
	});

	describe("queryLog", function() {
		for (let index of [() => undefined, () => logIndex]) {
			describe(index() === undefined ? "without index" : "with index", function() {
				it("returns nothing with an empty filter", async function() {
					let log = await libLoggingUtils.queryLog(logDir, {}, index());
					assert.deepEqual(log, []);
				});
				it("should return the whole log when querying all", async function() {
					let log = await libLoggingUtils.queryLog(logDir, { all: true }, index());
					assert.deepEqual(log, allLines);
				});
				it("should return the whole log in reverse when querying all desc", async function() {
					let log = await libLoggingUtils.queryLog(logDir, { all: true, order: "desc" }, index());
					assert.deepEqual(log, [...allLines].reverse());
				});
				it("should limit by limit", async function() {
					let log = await libLoggingUtils.queryLog(logDir, { limit: 2, all: true }, index());
					assert.deepEqual(log, allLines.slice(0, 2));
				});
				it("should filter by maxLevel", async function() {
					let log = await libLoggingUtils.queryLog(logDir, { maxLevel: "info", all: true }, index());
					assert.deepEqual(log, allLines.filter(
						info => ["fatal", "error", "warn", "audit", "info"].includes(info.level)
					));
					log = await libLoggingUtils.queryLog(logDir, { maxLevel: "fatal", all: true }, index());
					assert.deepEqual(log, allLines.filter(
						info => ["fatal"].includes(info.level)
					));
				});
				it("should filter by controller", async function() {
					let log = await libLoggingUtils.queryLog(logDir, { controller: true }, index());
					assert.deepEqual(log, allLines.filter(
						info => info.host_id === undefined && info.instance_id === undefined
					));
				});
				it("should filter by hostIds", async function() {
					let log = await libLoggingUtils.queryLog(logDir, { hostIds: [1, 2] }, index());
					assert.deepEqual(log, allLines.filter(
						info => [1, 2].includes(info.host_id) && info.instance_id === undefined
					));
				});
				it("should filter by instanceIds", async function() {
					let log = await libLoggingUtils.queryLog(logDir, { instanceIds: [10, 11] }, index());
					assert.deepEqual(log, allLines.filter(info => [10, 11].includes(info.instance_id)));
				});
			});
		}
	});
});
