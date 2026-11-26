import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import util from "node:util";
import t from "tap";
import * as lib from "@clusterio/lib";
import { addr, recordedLink } from "../shared/link.ts";

const LEVEL = Symbol.for("level");
const MESSAGE = Symbol.for("message");

function plain(text: string) {
	return util.stripVTControlCharacters(text);
}

// Resolves once condition() is true, checking after each round of I/O
async function until(condition: () => boolean) {
	for (let i = 0; i < 1000 && !condition(); i++) {
		await new Promise(resolve => { setImmediate(resolve); });
	}
}

// Log files for queryLog and LogIndex, lines are objects or plain text
const logFiles: Record<string, (object | string)[]> = {
	"test-2021-12-10.log": [
		{ level: "verbose", message: "Controller start" },
		{ level: "info", message: "Ready" },
		{ host_id: 1, level: "verbose", message: "Host connected" },
		{ host_id: 1, instance_id: 10, level: "server", message: "Starting up" },
		{ host_id: 2, level: "info", message: "Host 2 connected" },
		{ host_id: 2, instance_id: 11, level: "warn", message: "Instance warning" },
	],
	"test-2021-12-11.log": [
		{ level: "fatal", message: "An error occured" },
		"plain text line",
		{ host_id: 3, level: "error", message: "Host error" },
	],
	"test-2021-12-12.log": [
		{ host_id: 1, instance_id: 12, level: "audit", message: "Audit entry" },
		{ host_id: 1, message: "No level" },
	],
};
const allLines = Object.values(logFiles).flat().map(
	line => (typeof line === "string" ? { level: "info", message: line } : line)
);

async function writeLogDir(dir: string) {
	for (const [file, lines] of Object.entries(logFiles)) {
		const content = lines.map(line => (typeof line === "string" ? line : JSON.stringify(line)));
		await fs.writeFile(path.join(dir, file), `${content.join("\n")}\n`);
	}
	await fs.writeFile(path.join(dir, "excluded.txt"), "Not a log file\n");
	await fs.writeFile(path.join(dir, "Test-2021-12-01.log"), "Not matched by the pattern\n");
}

async function logDir(t1: any) {
	const dir = t1.testdir();
	await writeLogDir(dir);
	return dir;
}

function filter(fields: Partial<lib.QueryLogFilter>): lib.QueryLogFilter {
	return { all: false, controller: false, hostIds: [], instanceIds: [], ...fields };
}

t.test("_formatServerOutput()", async t1 => {
	const format = (parsed: lib.ParsedFactorioOutput) => plain(lib._formatServerOutput(parsed));
	t1.test("formats log lines with the seconds timestamp padded", async t2 => {
		for (const level of ["Script", "Verbose", "Info", "Warning", "Error", "Debug"]) {
			t2.equal(
				format({
					source: "stdout", format: "seconds", time: "1.306", type: "log",
					level, file: "File.cpp:131", message: "Text",
				}),
				`   1.306 ${level} File.cpp:131: Text`,
			);
		}
	});
	t1.test("formats generic lines with the seconds timestamp", async t2 => {
		t2.equal(
			format({ source: "stdout", format: "seconds", time: "12.5", type: "generic", message: "Text" }),
			"    12.5 Text",
		);
	});
	t1.test("formats action lines with the date timestamp", async t2 => {
		t2.equal(
			format({
				source: "stdout", format: "date", time: "2021-12-10 10:00:00", type: "action",
				action: "CHAT", message: "player: hi",
			}),
			"2021-12-10 10:00:00 [CHAT] player: hi",
		);
	});
	t1.test("formats generic lines with the date timestamp", async t2 => {
		t2.equal(
			format({ source: "stderr", format: "date", time: "2021-12-10 10:00:00", type: "generic", message: "Text" }),
			"2021-12-10 10:00:00 Text",
		);
	});
	t1.test("formats lines without a timestamp", async t2 => {
		t2.equal(format({ source: "stdout", format: "none", type: "generic", message: "Text" }), "Text");
	});
});

t.test("TerminalFormat", async t1 => {
	function transform(info: any, options: lib.TerminalFormatOptions = {}) {
		const format = new lib.TerminalFormat(options);
		return plain(format.transform({ [LEVEL]: info.level, ...info }, format.options)[MESSAGE]);
	}

	t1.test("constructor", async t2 => {
		t2.test("defaults to no options", async t3 => {
			t3.strictSame(new lib.TerminalFormat().options, {});
		});
	});
	t1.test("transform()", async t2 => {
		t2.test("formats level and message", async t3 => {
			t3.equal(transform({ level: "info", message: "Text" }), "[info] Text");
		});
		t2.test("adds the timestamp when enabled", async t3 => {
			const info = { level: "info", message: "Text", timestamp: "2021-12-10T10:00:00.000Z" };
			t3.equal(transform(info, { showTimestamp: true }), "2021-12-10 10:00:00.000Z [info] Text");
			t3.equal(transform(info), "[info] Text");
			t3.equal(transform({ level: "info", message: "Text" }, { showTimestamp: true }), "[info] Text");
		});
		t2.test("adds the instance or host name", async t3 => {
			t3.equal(
				transform({ level: "info", message: "Text", instance_name: "a", host_name: "b" }),
				"[info] i:a Text",
			);
			t3.equal(transform({ level: "info", message: "Text", host_name: "b" }), "[info] h:b Text");
		});
		t2.test("adds the plugin", async t3 => {
			t3.equal(transform({ level: "info", message: "Text", plugin: "p" }), "[info] p: Text");
			t3.equal(
				transform({ level: "info", message: "Text", instance_name: "a", plugin: "p" }),
				"[info] i:a p: Text",
			);
		});
		t2.test("formats parsed server output", async t3 => {
			const parsed = { source: "stdout", format: "none", type: "generic", message: "Parsed" };
			t3.equal(transform({ level: "server", message: "Raw", parsed }), "[server] Parsed");
			t3.equal(transform({ level: "server", message: "Raw" }), "[server] Raw");
			t3.equal(transform({ level: "info", message: "Raw", parsed }), "[info] Raw");
		});
		t2.test("uses the stack over the message", async t3 => {
			t3.equal(
				transform({ level: "error", message: "Text", stack: "Error: x\n    at y" }),
				"[error] Error: x\n    at y",
			);
		});
		t2.test("colours the level", async t3 => {
			const format = new lib.TerminalFormat({ all: true });
			const info = format.transform({ [LEVEL]: "info", level: "info", message: "Text" }, format.options);
			t3.equal(plain(info.level), "info");
		});
	});
});

t.test("LinkTransport", async t1 => {
	const entry = { level: "info", message: "Text", timestamp: "2021-12-10T10:00:00.000Z" };
	function setup(linkFilter?: (info: any) => boolean) {
		const recorded = recordedLink(addr({ hostId: 1 }), addr("controller"));
		const transport = new lib.LinkTransport({ link: recorded.link, filter: linkFilter });
		return { ...recorded, transport };
	}
	function log(transport: lib.LinkTransport, info: any) {
		let called = 0;
		transport.log(info, () => { called += 1; });
		return called;
	}

	t1.test("constructor", async t2 => {
		t2.test("stores the link and filter", async t3 => {
			const filterFn = () => true;
			const { link, transport } = setup(filterFn);
			t3.equal(transport.link, link);
			t3.equal(transport.filter, filterFn);
		});
	});
	t1.test("log()", async t2 => {
		t2.test("sends a LogMessageEvent", async t3 => {
			const { transport, sent } = setup();
			t3.equal(log(transport, entry), 1);
			t3.equal(sent.length, 1);
			t3.equal(sent[0].name, lib.LogMessageEvent.name);
			t3.strictSame(sent[0].data, new lib.LogMessageEvent(entry as any));
		});
		t2.test("drops entries the filter rejects", async t3 => {
			const { transport, sent } = setup(info => info.message !== "Drop");
			t3.equal(log(transport, { ...entry, message: "Drop" }), 1);
			t3.equal(log(transport, entry), 1);
			t3.equal(sent.length, 1);
			t3.equal(sent[0].data.info.message, "Text");
		});
		t2.test("drops entries while the connector is not valid", async t3 => {
			const { transport, connector, sent } = setup();
			t3.intercept(connector, "valid", { value: false });
			t3.equal(log(transport, entry), 1);
			t3.equal(sent.length, 0);
		});
		t2.test("ignores lost sessions", async t3 => {
			const { transport, link } = setup();
			t3.capture(link, "send", () => { throw new lib.SessionLost("No session"); });
			t3.equal(log(transport, entry), 1);
		});
		t2.test("throws other errors", async t3 => {
			const { transport, link } = setup();
			t3.capture(link, "send", () => { throw new Error("test"); });
			t3.throws(() => log(transport, entry), new Error("test"));
		});
	});
});

t.test("DailyFileTransport", async t1 => {
	function create(dirname: string, now?: () => number) {
		return new lib.DailyFileTransport({ dirname, prefix: "test", now });
	}
	function write(transport: lib.DailyFileTransport, message: string) {
		let called = 0;
		transport.log({ [MESSAGE]: JSON.stringify({ message }) }, () => { called += 1; });
		return called;
	}
	async function close(transport: lib.DailyFileTransport) {
		await new Promise<void>(resolve => transport.close(resolve));
	}
	async function read(file: string) {
		const content = await fs.readFile(file, "utf8");
		return content.split(os.EOL).slice(0, -1).map(line => JSON.parse(line).message);
	}
	const noon = () => Date.parse("2026-11-19T12:00:00Z");

	t1.test("constructor", async t2 => {
		t2.test("creates the directory", async t3 => {
			const dir = path.join(t3.testdir(), "a", "b");
			create(dir, noon);
			t3.ok((await fs.stat(dir)).isDirectory());
		});
		t2.test("defaults to Date.now", async t3 => {
			t3.equal(create(t3.testdir()).now, Date.now);
		});
	});
	t1.test("log()", async t2 => {
		t2.test("writes lines to the file for the UTC date", async t3 => {
			const dir = t3.testdir();
			const transport = create(dir, noon);
			t3.equal(write(transport, "first"), 1);
			write(transport, "second");
			await close(transport);
			t3.strictSame(await read(path.join(dir, "test-2026-11-19.log")), ["first", "second"]);
		});
		t2.test("appends to an existing file", async t3 => {
			const dir = t3.testdir({ "test-2026-11-19.log": `{"message":"old"}${os.EOL}` });
			const transport = create(dir, noon);
			write(transport, "new");
			await close(transport);
			t3.strictSame(await read(path.join(dir, "test-2026-11-19.log")), ["old", "new"]);
		});
		t2.test("switches files when the UTC date changes", async t3 => {
			const dir = t3.testdir();
			let time = Date.parse("2026-11-19T23:59:59.999Z");
			const transport = create(dir, () => time);
			write(transport, "before");
			time += 1;
			write(transport, "after");
			await close(transport);
			t3.strictSame((await fs.readdir(dir)).sort(), ["test-2026-11-19.log", "test-2026-11-20.log"]);
			t3.strictSame(await read(path.join(dir, "test-2026-11-19.log")), ["before"]);
			t3.strictSame(await read(path.join(dir, "test-2026-11-20.log")), ["after"]);
		});
		t2.test("uses the UTC date rather than the local one", async t3 => {
			const dir = t3.testdir();
			const transport = create(dir, () => Date.parse("2026-11-20T00:30:00+02:00"));
			write(transport, "message");
			await close(transport);
			t3.strictSame(await fs.readdir(dir), ["test-2026-11-19.log"]);
		});
		t2.test("uses the current date by default", async t3 => {
			const dir = t3.testdir();
			const transport = create(dir);
			const before = new Date().toISOString().slice(0, 10);
			write(transport, "message");
			const after = new Date().toISOString().slice(0, 10);
			await close(transport);
			const [file] = await fs.readdir(dir);
			t3.ok([`test-${before}.log`, `test-${after}.log`].includes(file), file);
		});
		t2.test("emits write errors", async t3 => {
			const dir = t3.testdir({ "test-2026-11-19.log": {} });
			const transport = create(dir, noon);
			const error = new Promise<any>(resolve => transport.once("error", resolve));
			write(transport, "message");
			t3.equal((await error).code, "EISDIR");
		});
	});
	t1.test("close()", async t2 => {
		t2.test("calls back when nothing was written", async t3 => {
			const dir = t3.testdir();
			await close(create(dir, noon));
			t3.strictSame(await fs.readdir(dir), []);
		});
		t2.test("works without a callback", async t3 => {
			const dir = t3.testdir();
			create(dir, noon).close();
			const transport = create(dir, noon);
			write(transport, "message");
			const stream = transport.stream!;
			transport.close();
			t3.equal(transport.stream, undefined);
			await new Promise<void>(resolve => stream.once("finish", () => resolve()));
			t3.strictSame(await read(path.join(dir, "test-2026-11-19.log")), ["message"]);
		});
		t2.test("opens a new file on the next log", async t3 => {
			const dir = t3.testdir();
			const transport = create(dir, noon);
			write(transport, "first");
			await close(transport);
			write(transport, "second");
			await close(transport);
			t3.strictSame(await read(path.join(dir, "test-2026-11-19.log")), ["first", "second"]);
		});
	});
});

t.test("LogIndex", async t1 => {
	t1.test("constructor", async t2 => {
		t2.test("starts empty for an unknown version", async t3 => {
			const index = new lib.LogIndex("dir", { version: 1, files: { "a-2021-01-01.log": {} } });
			t3.equal(index.logDirectory, "dir");
			t3.strictSame(index.index, new Map());
		});
		t2.test("loads serialized entries", async t3 => {
			const index = new lib.LogIndex("dir", {
				version: 2,
				files: {
					"a-2021-01-01.log": { levels: ["info"], controller: true, hostIds: [1], instanceIds: [2] },
				},
			});
			t3.strictSame(index.index, new Map([["a-2021-01-01.log", {
				levels: new Set(["info"]), controller: true, hostIds: new Set([1]), instanceIds: new Set([2]),
			}]]));
		});
	});
	t1.test("serialize()", async t2 => {
		t2.test("round trips through the constructor", async t3 => {
			const serialized = {
				version: 2,
				files: {
					"a-2021-01-01.log": { levels: ["info", "warn"], controller: false, hostIds: [1], instanceIds: [] },
				},
			};
			t3.strictSame(new lib.LogIndex("dir", serialized).serialize(), serialized);
		});
	});
	t1.test("load()", async t2 => {
		t2.test("creates an empty index if index.json does not exist", async t3 => {
			const warn = t3.capture(lib.logger, "warn");
			const index = await lib.LogIndex.load(t3.testdir());
			t3.strictSame(index.index, new Map());
			t3.equal(warn.calls.length, 0);
		});
		t2.test("warns and creates an empty index for broken JSON", async t3 => {
			const warn = t3.capture(lib.logger, "warn");
			const dir = t3.testdir({ "index.json": "Broken JSON" });
			const index = await lib.LogIndex.load(dir);
			t3.strictSame(index.index, new Map());
			t3.equal(warn.calls.length, 1);
			t3.match(warn.calls[0].args[0], `Failed to load ${path.join(dir, "index.json")}: SyntaxError`);
		});
		t2.test("warns and creates an empty index if it cannot be read", async t3 => {
			const warn = t3.capture(lib.logger, "warn");
			const dir = t3.testdir({ "index.json": {} });
			const index = await lib.LogIndex.load(dir);
			t3.strictSame(index.index, new Map());
			t3.match(warn.calls[0].args[0], "EISDIR");
		});
	});
	t1.test("save()", async t2 => {
		t2.test("round trips through load()", async t3 => {
			const dir = await logDir(t3);
			const index = await lib.LogIndex.load(dir);
			await index.buildIndex();
			await index.save();
			t3.strictSame(await lib.LogIndex.load(dir), index);
			t3.strictSame(JSON.parse(await fs.readFile(path.join(dir, "index.json"), "utf8")), index.serialize());
		});
	});
	t1.test("indexFile()", async t2 => {
		t2.test("collects levels, hosts and instances", async t3 => {
			const index = await lib.LogIndex.load(await logDir(t3));
			t3.strictSame(await index.indexFile("test-2021-12-10.log"), {
				levels: new Set(["verbose", "info", "server", "warn"]),
				controller: true,
				hostIds: new Set([1, 2]),
				instanceIds: new Set([10, 11]),
			});
		});
		t2.test("counts plain text lines as controller info", async t3 => {
			const dir = t3.testdir({ "test-2021-12-11.log": "plain\n{\"host_id\":1}\n" });
			const index = await lib.LogIndex.load(dir);
			t3.strictSame(await index.indexFile("test-2021-12-11.log"), {
				levels: new Set(["info"]),
				controller: true,
				hostIds: new Set([1]),
				instanceIds: new Set(),
			});
		});
		t2.test("does not count instance lines as host or controller lines", async t3 => {
			const index = await lib.LogIndex.load(await logDir(t3));
			t3.strictSame(await index.indexFile("test-2021-12-12.log"), {
				levels: new Set(["audit"]),
				controller: false,
				hostIds: new Set([1]),
				instanceIds: new Set([12]),
			});
		});
		t2.test("rejects on read errors", async t3 => {
			const dir = await logDir(t3);
			const index = await lib.LogIndex.load(dir);
			const streamErrors = failReads(t3);
			const result = await lib.timeout(index.indexFile("test-2021-12-10.log").catch(err => err), 100, "timeout");
			t3.equal(streamErrors.length, 1);
			t3.not(result, "timeout");
		});
	});
	t1.test("buildIndex()", async t2 => {
		t2.test("indexes past log files only", async t3 => {
			const dir = await logDir(t3);
			await fs.writeFile(path.join(dir, "test-2021-12-13.log"), "");
			t3.capture(Date, "now", () => Date.parse("2021-12-13T12:00:00Z"));
			const index = await lib.LogIndex.load(dir);
			await index.buildIndex();
			t3.strictSame(
				new Set(index.index.keys()),
				new Set(["test-2021-12-10.log", "test-2021-12-11.log", "test-2021-12-12.log"]),
			);
		});
		t2.test("treats the 5 minutes after midnight as the previous day", async t3 => {
			const dir = await logDir(t3);
			t3.capture(Date, "now", () => Date.parse("2021-12-13T00:04:59Z"));
			const index = await lib.LogIndex.load(dir);
			await index.buildIndex();
			t3.notOk(index.index.has("test-2021-12-12.log"));
		});
		t2.test("keeps existing entries", async t3 => {
			const dir = await logDir(t3);
			const index = await lib.LogIndex.load(dir);
			const entry = {
				levels: new Set<any>(),
				controller: false,
				hostIds: new Set<number>(),
				instanceIds: new Set<number>(),
			};
			index.index.set("test-2021-12-10.log", entry);
			await index.buildIndex();
			t3.equal(index.index.get("test-2021-12-10.log"), entry);
			t3.equal(index.index.size, 3);
		});
		t2.test("drops entries for files no longer present", async t3 => {
			const dir = await logDir(t3);
			const index = await lib.LogIndex.load(dir);
			await index.buildIndex();
			await fs.unlink(path.join(dir, "test-2021-12-10.log"));
			await index.buildIndex();
			t3.strictSame(new Set(index.index.keys()), new Set(["test-2021-12-11.log", "test-2021-12-12.log"]));
		});
	});
	t1.test("filterIncludesFile()", async t2 => {
		const index = new lib.LogIndex("dir", {
			version: 2,
			files: {
				"controller.log": { levels: ["info"], controller: true, hostIds: [], instanceIds: [] },
				"host.log": { levels: ["error"], controller: false, hostIds: [1], instanceIds: [] },
				"instance.log": { levels: ["unknown"], controller: false, hostIds: [], instanceIds: [10] },
			},
		});
		const check = (file: string, fields: Partial<lib.LogFilter>) => index.filterIncludesFile(
			file, { all: false, controller: false, hostIds: [], instanceIds: [], ...fields } as lib.LogFilter
		);
		t2.test("includes files not in the index", async t3 => {
			t3.equal(check("missing.log", {}), true);
		});
		t2.test("includes everything for all", async t3 => {
			for (const file of ["controller.log", "host.log", "instance.log"]) {
				t3.equal(check(file, { all: true }), true, file);
			}
		});
		t2.test("excludes files with only more verbose levels", async t3 => {
			t3.equal(check("controller.log", { all: true, maxLevel: "warn" }), false);
			t3.equal(check("controller.log", { all: true, maxLevel: "info" }), true);
			t3.equal(check("host.log", { all: true, maxLevel: "warn" }), true);
		});
		t2.test("treats unknown levels in files as verbose", async t3 => {
			t3.equal(check("instance.log", { all: true, maxLevel: "server" }), false);
			t3.equal(check("instance.log", { all: true, maxLevel: "verbose" }), true);
		});
		t2.test("ignores an unknown maxLevel", async t3 => {
			t3.equal(check("controller.log", { all: true, maxLevel: "toString" as any }), true);
		});
		t2.test("matches the controller", async t3 => {
			t3.equal(check("controller.log", { controller: true }), true);
			t3.equal(check("host.log", { controller: true }), false);
		});
		t2.test("matches host ids", async t3 => {
			t3.equal(check("host.log", { hostIds: [2, 1] }), true);
			t3.equal(check("host.log", { hostIds: [2] }), false);
		});
		t2.test("matches instance ids", async t3 => {
			t3.equal(check("instance.log", { instanceIds: [10] }), true);
			t3.equal(check("instance.log", { instanceIds: [11] }), false);
		});
		t2.test("excludes files when nothing is selected", async t3 => {
			t3.equal(check("controller.log", {}), false);
			t3.equal(index.filterIncludesFile("controller.log", {} as lib.LogFilter), false);
		});
	});
});

// Make reads of files opened through fs/promises fail, returns the errors seen
function failReads(t1: any) {
	const errors: Error[] = [];
	const open = fs.open;
	t1.capture(fs, "open", async (...args: Parameters<typeof fs.open>) => {
		const handle = await open(...args);
		const createReadStream = handle.createReadStream.bind(handle);
		handle.createReadStream = (options?: any) => {
			const readStream = createReadStream(options);
			readStream.on("error", err => { errors.push(err); });
			readStream._read = () => { readStream.destroy(new Error("read failed")); };
			return readStream;
		};
		return handle;
	});
	return errors;
}

t.test("deleteOldLogs()", async t1 => {
	const files = [
		"cluster-2026-10-01.log",
		"cluster-2026-10-12.log",
		"cluster-2026-10-13.log",
		"cluster-2026-11-12.log",
		"index.json",
		"notes-2026-10-01.txt",
		".0123abcd-audit.json",
	];
	const now = Date.parse("2026-11-12T08:00:00Z");
	function setup(t2: any) {
		return t2.testdir(Object.fromEntries(files.map(file => [file, ""]))) as string;
	}

	t1.test("deletes only dated log files past the retention", async t2 => {
		const dir = setup(t2);
		const deleted = await lib.deleteOldLogs(dir, 30, now);
		t2.strictSame(deleted.sort(), ["cluster-2026-10-01.log", "cluster-2026-10-12.log"]);
		t2.strictSame((await fs.readdir(dir)).sort(), files.filter(file => !deleted.includes(file)).sort());
	});
	t1.test("keeps everything with a retention of 0 or less", async t2 => {
		const dir = setup(t2);
		for (const days of [0, -1, NaN]) {
			t2.strictSame(await lib.deleteOldLogs(dir, days, now), []);
		}
		t2.strictSame((await fs.readdir(dir)).sort(), [...files].sort());
	});
	t1.test("defaults to the current time", async t2 => {
		const dir = t2.testdir({ "a-2000-01-01.log": "", "a-2999-01-01.log": "" });
		t2.strictSame(await lib.deleteOldLogs(dir, 1), ["a-2000-01-01.log"]);
	});
	t1.test("ignores a missing directory", async t2 => {
		t2.strictSame(await lib.deleteOldLogs(path.join(t2.testdir(), "missing"), 30, now), []);
	});
	t1.test("throws other errors reading the directory", async t2 => {
		const dir = t2.testdir({ file: "" });
		await t2.rejects(lib.deleteOldLogs(path.join(dir, "file"), 30, now), { code: "ENOTDIR" });
	});
	t1.test("counts files deleted by someone else as deleted", async t2 => {
		const dir = setup(t2);
		t2.capture(fs, "unlink", async () => {
			throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
		});
		const deleted = await lib.deleteOldLogs(dir, 30, now);
		t2.strictSame(deleted.sort(), ["cluster-2026-10-01.log", "cluster-2026-10-12.log"]);
	});
	t1.test("throws other errors deleting files", async t2 => {
		const dir = setup(t2);
		t2.capture(fs, "unlink", async () => {
			throw Object.assign(new Error("EACCES"), { code: "EACCES" });
		});
		await t2.rejects(lib.deleteOldLogs(dir, 30, now), { code: "EACCES" });
	});
});

t.test("startLogRetention()", async t1 => {
	function setup(t2: any) {
		const timer = { unref: () => { timer.unrefed = true; return timer; }, unrefed: false };
		const intervals = t2.capture(globalThis, "setInterval", () => timer);
		const info = t2.capture(lib.logger, "info");
		const error = t2.capture(lib.logger, "error");
		return { timer, intervals, info, error };
	}

	t1.test("deletes old logs right away", async t2 => {
		const { timer, intervals, info } = setup(t2);
		const dir = t2.testdir({ "a-2000-01-01.log": "", "a-2000-01-02.log": "", "a-2999-01-01.log": "" });
		const result = lib.startLogRetention([dir], () => 7);
		t2.equal(result, timer);
		t2.equal(timer.unrefed, true);
		t2.equal(intervals.calls[0].args[1], 3600e3);
		await until(() => info.calls.length > 0);
		t2.strictSame(
			info.calls.map((call: any) => call.args),
			[[`Deleted 2 log files older than 7 days from ${dir}`]],
		);
		t2.strictSame(await fs.readdir(dir), ["a-2999-01-01.log"]);
	});
	t1.test("runs again every hour with the current retention", async t2 => {
		const { intervals, info } = setup(t2);
		const dir = t2.testdir({ "a-2000-01-01.log": "" });
		let days = 0;
		lib.startLogRetention([dir], () => days);
		await until(() => false);
		t2.equal(info.calls.length, 0);
		t2.strictSame(await fs.readdir(dir), ["a-2000-01-01.log"]);
		days = 1;
		intervals.calls[0].args[0]();
		await until(() => info.calls.length > 0);
		t2.strictSame(await fs.readdir(dir), []);
	});
	t1.test("logs errors and continues with the next directory", async t2 => {
		const { info, error } = setup(t2);
		const root = t2.testdir({ file: "", dir: { "a-2000-01-01.log": "" } });
		const file = path.join(root, "file");
		const dir = path.join(root, "dir");
		lib.startLogRetention([file, dir], () => 1);
		await until(() => info.calls.length > 0);
		t2.equal(error.calls.length, 1);
		t2.match(error.calls[0].args[0], `Failed to delete old logs from ${file}:\nError: ENOTDIR`);
		t2.strictSame(
			info.calls.map((call: any) => call.args),
			[[`Deleted 1 log files older than 1 days from ${dir}`]],
		);
	});
});

t.test("queryLog()", async t1 => {
	for (const withIndex of [false, true]) {
		t1.test(withIndex ? "with index" : "without index", async t2 => {
			const dir = await logDir(t2);
			let index: lib.LogIndex | null = null;
			if (withIndex) {
				index = await lib.LogIndex.load(dir);
				await index.buildIndex();
			}
			const query = (fields: Partial<lib.QueryLogFilter>) => lib.queryLog(dir, filter(fields), index);

			t2.test("returns nothing with an empty filter", async t3 => {
				t3.strictSame(await query({}), []);
			});
			t2.test("returns the whole log when querying all", async t3 => {
				t3.strictSame(await query({ all: true }), allLines);
			});
			t2.test("returns the log in reverse when ordered desc", async t3 => {
				t3.strictSame(await query({ all: true, order: "desc" }), [...allLines].reverse());
			});
			t2.test("limits the number of entries", async t3 => {
				t3.strictSame(await query({ all: true, limit: 2 }), allLines.slice(0, 2));
				t3.strictSame(await query({ all: true, limit: 8 }), allLines.slice(0, 8));
				t3.strictSame(await query({ all: true, limit: 6 }), allLines.slice(0, 6));
				t3.strictSame(await query({ all: true, limit: 3, order: "desc" }), [...allLines].reverse().slice(0, 3));
			});
			t2.test("defaults to a limit of 100", async t3 => {
				const big = t3.testdir({
					"big-2021-01-01.log": Array.from(
						{ length: 150 },
						(_, i) => JSON.stringify({ level: "info", message: `${i}` }),
					).join("\n"),
				});
				t3.equal((await lib.queryLog(big, filter({ all: true }), null)).length, 100);
			});
			t2.test("filters by maxLevel", async t3 => {
				t3.strictSame(
					await query({ all: true, maxLevel: "info" }),
					allLines.filter((info: any) => ["fatal", "error", "warn", "audit", "info"].includes(info.level)),
				);
				t3.strictSame(
					await query({ all: true, maxLevel: "fatal" }),
					allLines.filter((info: any) => info.level === "fatal"),
				);
			});
			t2.test("filters by controller", async t3 => {
				t3.strictSame(
					await query({ controller: true }),
					allLines.filter((info: any) => info.host_id === undefined && info.instance_id === undefined),
				);
			});
			t2.test("filters by hostIds", async t3 => {
				t3.strictSame(
					await query({ hostIds: [1, 3] }),
					allLines.filter((info: any) => [1, 3].includes(info.host_id) && info.instance_id === undefined),
				);
			});
			t2.test("filters by instanceIds", async t3 => {
				t3.strictSame(
					await query({ instanceIds: [10, 12] }),
					allLines.filter((info: any) => [10, 12].includes(info.instance_id)),
				);
			});
		});
	}
	t1.test("skips files the index excludes", async t2 => {
		const dir = await logDir(t2);
		const index = await lib.LogIndex.load(dir);
		await index.buildIndex();
		const opened: string[] = [];
		const open = fs.open;
		t2.capture(fs, "open", (file: any, ...rest: any[]) => {
			opened.push(path.basename(file));
			return open(file, ...rest);
		});
		t2.strictSame(await lib.queryLog(dir, filter({ hostIds: [3] }), index), [allLines[8]]);
		t2.strictSame(opened, ["test-2021-12-11.log"]);
	});
	t1.test("throws if the directory is missing", async t2 => {
		const missing = path.join(t2.testdir(), "missing");
		await t2.rejects(lib.queryLog(missing, filter({ all: true }), null), { code: "ENOENT" });
	});
	t1.test("rejects on read errors", async t2 => {
		const dir = await logDir(t2);
		const streamErrors = failReads(t2);
		const result = await lib.timeout(
			lib.queryLog(dir, filter({ all: true }), null).catch(err => err),
			100,
			"timeout",
		);
		t2.equal(streamErrors.length, 1);
		t2.not(result, "timeout");
	});
});

t.test("handleUnhandledErrors()", async t1 => {
	function setup(t2: any) {
		const handlers = new Map<string, (...args: any[]) => void>();
		t2.capture(process, "on", (event: string, handler: (...args: any[]) => void) => {
			handlers.set(event, handler);
			return process;
		});
		const exit = t2.capture(process, "exit", () => undefined as never);
		const fatal = t2.capture(lib.logger, "fatal");
		lib.handleUnhandledErrors();
		return { handlers, exit, fatal };
	}

	t1.test("registers handlers", async t2 => {
		const { handlers } = setup(t2);
		t2.strictSame([...handlers.keys()], ["uncaughtException", "unhandledRejection"]);
	});
	t1.test("logs uncaught exceptions and exits", async t2 => {
		const { handlers, exit, fatal } = setup(t2);
		const err = new Error("test");
		handlers.get("uncaughtException")!(err);
		t2.strictSame(fatal.calls.map((call: any) => call.args), [[`Uncaught exception:\n${err.stack}`]]);
		t2.strictSame(exit.calls.map((call: any) => call.args), [[1]]);
	});
	t1.test("logs unhandled rejections and exits", async t2 => {
		const { handlers, exit, fatal } = setup(t2);
		const err = new Error("test");
		handlers.get("unhandledRejection")!(err, Promise.resolve());
		handlers.get("unhandledRejection")!("reason", Promise.resolve());
		t2.strictSame(fatal.calls.map((call: any) => call.args), [
			[`Unhandled rejection:\n${err.stack}`],
			["Unhandled rejection:\nreason"],
		]);
		t2.strictSame(exit.calls.map((call: any) => call.args), [[1], [1]]);
	});
});
