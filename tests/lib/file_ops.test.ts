import t from "tap";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import * as lib from "@clusterio/lib";

const fileOpsPath = "@clusterio/lib/dist/node/src/file_ops.js";

// Files in dir other than the expected names, such as temporaries left behind
async function strayFiles(dir: string, expected: string[]) {
	return (await fs.readdir(dir)).filter(name => !expected.includes(name));
}

t.test("getNewestFile()", async t1 => {
	t1.test("returns the file with the newest mtime", async t2 => {
		const dir = t2.testdir({ "old.txt": "", "new.txt": "", "mid.txt": "", "folder": {} });
		await fs.utimes(path.join(dir, "old.txt"), 1000, 1000);
		await fs.utimes(path.join(dir, "mid.txt"), 2000, 2000);
		await fs.utimes(path.join(dir, "new.txt"), 3000, 3000);
		await fs.utimes(path.join(dir, "folder"), 4000, 4000);
		t2.equal(await lib.getNewestFile(dir), "new.txt");
	});
	t1.test("skips files the filter rejects", async t2 => {
		const dir = t2.testdir({ "a.zip": "", "b.txt": "" });
		await fs.utimes(path.join(dir, "a.zip"), 1000, 1000);
		await fs.utimes(path.join(dir, "b.txt"), 2000, 2000);
		t2.equal(await lib.getNewestFile(dir, name => name.endsWith(".zip")), "a.zip");
	});
	t1.test("returns undefined if all files were filtered out", async t2 => {
		const dir = t2.testdir({ "a.txt": "", "b.txt": "" });
		t2.equal(await lib.getNewestFile(dir, name => !name.endsWith(".txt")), undefined);
	});
	t1.test("returns undefined for a directory without files", async t2 => {
		const dir = t2.testdir({ "folder": {} });
		t2.equal(await lib.getNewestFile(dir), undefined);
	});
	t1.test("rejects a missing directory", async t2 => {
		const dir = t2.testdir();
		await t2.rejects(lib.getNewestFile(path.join(dir, "missing")), { code: "ENOENT" });
	});
});

t.test("directorySize()", async t1 => {
	t1.test("sums the size of files in the directory", async t2 => {
		const dir = t2.testdir({ "a.txt": "contents", "b.txt": "more contents", "sub": { "c.txt": "nested" } });
		t2.equal(await lib.directorySize(dir), 21);
	});
	t1.test("returns 0 for an empty directory", async t2 => {
		t2.equal(await lib.directorySize(t2.testdir()), 0);
	});
	t1.test("returns 0 for a missing directory", async t2 => {
		t2.equal(await lib.directorySize(path.join(t2.testdir(), "missing")), 0);
	});
	t1.test("rejects other errors reading the directory", async t2 => {
		const dir = t2.testdir({ "file.txt": "" });
		await t2.rejects(lib.directorySize(path.join(dir, "file.txt")), { code: "ENOTDIR" });
	});
	t1.test("counts files it cannot stat as 0", async t2 => {
		const dir = t2.testdir({ "a.txt": "1234", "b.txt": "12" });
		const { directorySize }: typeof lib = await t2.mockImport(fileOpsPath, {
			"node:fs/promises": {
				...fs,
				stat: async (file: string) => {
					if (file.endsWith("a.txt")) {
						throw Object.assign(new Error("gone"), { code: "ENOENT" });
					}
					return await fs.stat(file);
				},
			},
		});
		t2.equal(await directorySize(dir), 2);
	});
});

t.test("getTempFile()", async t1 => {
	t1.test("uses the defaults", async t2 => {
		t2.match(await lib.getTempFile(), /^tmp\.[0-9a-f]{32}$/);
	});
	t1.test("uses prefix, suffix and directory", async t2 => {
		const file = await lib.getTempFile("pre-", ".zip", path.join("some", "dir"));
		t2.equal(path.dirname(file), path.join("some", "dir"));
		t2.match(path.basename(file), /^pre-[0-9a-f]{32}\.zip$/);
	});
	t1.test("returns a different name each call", async t2 => {
		t2.not(await lib.getTempFile(), await lib.getTempFile());
	});
});

t.test("atomicOverwriteFile()", async t1 => {
	t1.test("writes a new file", async t2 => {
		const dir = t2.testdir();
		const target = path.join(dir, "simple.txt");
		await lib.atomicOverwriteFile(target, "a text file", { encoding: "utf8" });
		t2.equal(await fs.readFile(target, "utf8"), "a text file");
		t2.strictSame(await strayFiles(dir, ["simple.txt"]), []);
	});
	t1.test("overwrites an existing file", async t2 => {
		const dir = t2.testdir({ "exists.txt": "previous" });
		const target = path.join(dir, "exists.txt");
		await lib.atomicOverwriteFile(target, Buffer.from("current"));
		t2.equal(await fs.readFile(target, "utf8"), "current");
		t2.strictSame(await strayFiles(dir, ["exists.txt"]), []);
	});
	t1.test("applies the mode to the file", { skip: process.platform === "win32" && "no modes" }, async t2 => {
		const dir = t2.testdir();
		const target = path.join(dir, "mode.txt");
		await lib.atomicOverwriteFile(target, "private", { mode: 0o600 });
		t2.equal((await fs.stat(target)).mode & 0o777, 0o600);
	});
	t1.test("creates missing parent directories", async t2 => {
		const dir = t2.testdir();
		const target = path.join(dir, "a", "b", "file.txt");
		await lib.atomicOverwriteFile(target, "nested");
		t2.equal(await fs.readFile(target, "utf8"), "nested");
	});
	t1.test("writes a file in the working directory", async t2 => {
		const dir = t2.testdir();
		const cwd = process.cwd();
		process.chdir(dir);
		t2.teardown(() => process.chdir(cwd));
		await lib.atomicOverwriteFile("cwd.txt", "here");
		t2.equal(await fs.readFile(path.join(dir, "cwd.txt"), "utf8"), "here");
	});
	t1.test("does not interfere between concurrent writes to the same file", async t2 => {
		const dir = t2.testdir();
		const target = path.join(dir, "concurrent.txt");
		const writes = [];
		for (let i = 0; i < 20; i++) {
			writes.push(lib.atomicOverwriteFile(target, `write ${i}`));
		}
		// Renames onto the same file may fail on Windows
		await Promise.allSettled(writes);
		t2.match(await fs.readFile(target, "utf8"), /^write \d+$/);
		t2.strictSame(await strayFiles(dir, ["concurrent.txt"]), []);
	});
	t1.test("rejects when the parent is a file", async t2 => {
		const dir = t2.testdir({ "file": "" });
		await t2.rejects(lib.atomicOverwriteFile(path.join(dir, "file", "x.txt"), "data"), { code: "ENOTDIR" });
	});
	t1.test("rejects and removes the temporary file when the rename fails", async t2 => {
		const dir = t2.testdir({ "target": {} });
		await t2.rejects(lib.atomicOverwriteFile(path.join(dir, "target"), "data"));
		t2.strictSame(await strayFiles(dir, ["target"]), []);
	});
});

t.test("checkFilename()", async t1 => {
	const check = (t2: any, name: unknown, message: string) => {
		t2.throws(() => lib.checkFilename(name as string), new Error(message), JSON.stringify(name));
	};
	t1.test("allows normal names", async t2 => {
		for (const name of ["file", "file.zip", "a b", ".hidden", "CONSOLE", "COM10", "LPT0", "_"]) {
			t2.doesNotThrow(() => lib.checkFilename(name), name);
		}
	});
	t1.test("rejects non-strings", async t2 => {
		for (const name of [undefined, null, {}, [], 0, false]) {
			check(t2, name, "must be a string");
		}
	});
	t1.test("rejects an empty name", async t2 => {
		check(t2, "", "cannot be empty");
	});
	t1.test("rejects reserved characters", async t2 => {
		for (const char of "<>:\"\\/|?*\x00\r\n\t\x1f") {
			check(t2, char, "cannot contain <>:\"\\/|=* or control characters");
			check(t2, `a${char}b`, "cannot contain <>:\"\\/|=* or control characters");
		}
	});
	t1.test("rejects reserved characters on every call", async t2 => {
		// A global regex keeps lastIndex between test() calls
		for (let i = 0; i < 3; i++) {
			check(t2, "ab/", "cannot contain <>:\"\\/|=* or control characters");
		}
	});
	t1.test("rejects . and ..", async t2 => {
		check(t2, ".", "cannot be named .");
		check(t2, "..", "cannot be named ..");
	});
	t1.test("rejects Windows device names", async t2 => {
		const message = "cannot be named any of CON PRN AUX NUL COM1-9 and LPT1-9";
		for (const bad of ["CON", "PRN", "AUX", "NUL", "COM1", "COM9", "LPT1", "LPT9", "con", "Lpt3"]) {
			check(t2, bad, message);
			check(t2, `${bad}.zip`, message);
			check(t2, `${bad}.anything.txt`, message);
			check(t2, `${bad}....a`, message);
			check(t2, `${bad}.`, message);
		}
	});
	t1.test("rejects names ending with . or space", async t2 => {
		check(t2, "a ", "cannot end with . or space");
		check(t2, "a.", "cannot end with . or space");
		check(t2, "...", "cannot end with . or space");
	});
});

t.test("cleanFilename()", async t1 => {
	t1.test("keeps normal names", async t2 => {
		for (const name of ["file", "file.zip", "a b", ".hidden", "CONSOLE"]) {
			t2.equal(lib.cleanFilename(name), name);
		}
	});
	t1.test("rejects non-strings", async t2 => {
		for (const name of [undefined, null, {}, [], 0, false]) {
			t2.throws(() => lib.cleanFilename(name as any), new Error("name must be a string"));
		}
	});
	t1.test("cleans an empty name", async t2 => {
		t2.equal(lib.cleanFilename(""), "_");
	});
	t1.test("replaces reserved characters", async t2 => {
		for (const char of "<>:\"\\/|?*\x00\r\n\t") {
			t2.equal(lib.cleanFilename(char), "_");
		}
		t2.equal(lib.cleanFilename("a/b\\c:d"), "a_b_c_d");
	});
	t1.test("cleans . and ..", async t2 => {
		// "." gets "_" appended and then the trailing . check does not apply
		t2.equal(lib.cleanFilename("."), "._");
		t2.equal(lib.cleanFilename(".."), ".._");
	});
	t1.test("cleans Windows device names", async t2 => {
		for (const bad of ["CON", "PRN", "AUX", "NUL", "COM1", "LPT1", "con"]) {
			t2.equal(lib.cleanFilename(bad), `${bad}_`);
			t2.equal(lib.cleanFilename(`${bad}.zip`), `${bad}_.zip`);
			t2.equal(lib.cleanFilename(`${bad}.anything.txt`), `${bad}_.anything.txt`);
			t2.equal(lib.cleanFilename(`${bad}....a`), `${bad}_....a`);
			t2.equal(lib.cleanFilename(`${bad}.`), `${bad}__`);
		}
	});
	t1.test("cleans names ending with . or space", async t2 => {
		t2.equal(lib.cleanFilename("a "), "a_");
		t2.equal(lib.cleanFilename("a."), "a_");
	});
	t1.test("returns names checkFilename() accepts", async t2 => {
		for (const name of ["", ".", "..", "CON.", "a/", "nul", " ", "x\x00y"]) {
			t2.doesNotThrow(() => lib.checkFilename(lib.cleanFilename(name)), JSON.stringify(name));
		}
	});
});

t.test("createTempWriteStream()", async t1 => {
	t1.test("opens a .tmp file next to the target", async t2 => {
		const dir = t2.testdir();
		const [tempPath, stream] = await lib.createTempWriteStream(path.join(dir, "file.zip"));
		t2.equal(tempPath, path.join(dir, "file.tmp.zip"));
		await new Promise<void>((resolve, reject) => stream.end("data", (err?: Error | null) => (
			err ? reject(err) : resolve()
		)));
		t2.equal(await fs.readFile(tempPath, "utf8"), "data");
	});
	t1.test("picks a numbered name when the temporary file exists", async t2 => {
		const dir = t2.testdir({ "file.tmp.zip": "old", "file-2.tmp.zip": "old" });
		const [tempPath, stream] = await lib.createTempWriteStream(path.join(dir, "file.zip"));
		stream.destroy();
		t2.equal(tempPath, path.join(dir, "file-3.tmp.zip"));
		t2.equal(await fs.readFile(path.join(dir, "file.tmp.zip"), "utf8"), "old");
	});
	t1.test("rejects other errors", async t2 => {
		const dir = t2.testdir();
		await t2.rejects(lib.createTempWriteStream(path.join(dir, "missing", "file.zip")), { code: "ENOENT" });
	});
});

t.test("downloadFile()", async t1 => {
	const fileContent = "mock file content";
	let onStream: (res: http.ServerResponse) => void = res => res.end();
	const server = http.createServer((req, res) => {
		if (req.url === "/simple-file") {
			res.writeHead(200, { "Content-Length": Buffer.byteLength(fileContent) }).end(fileContent);
		} else if (req.url === "/no-content") {
			res.writeHead(204).end();
		} else if (req.url === "/stream") {
			res.writeHead(200);
			res.write("streaming\n");
			onStream(res);
		} else {
			res.writeHead(404).end("not found");
		}
	});
	await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
	t1.teardown(() => {
		server.closeAllConnections();
		server.close();
	});
	const { port } = server.address() as { port: number };
	const url = (pathname: string) => new URL(pathname, `http://127.0.0.1:${port}`);

	for (const mode of ["overwrite", "rename", "error"] as const) {
		t1.test(`downloads to the file path with ${mode}`, async t2 => {
			const dir = t2.testdir();
			const target = path.join(dir, "file.txt");
			t2.equal(await lib.downloadFile(url("/simple-file"), target, mode), target);
			t2.equal(await fs.readFile(target, "utf8"), fileContent);
			t2.strictSame(await strayFiles(dir, ["file.txt"]), []);
		});
		t1.test(`rejects when the directory does not exist with ${mode}`, async t2 => {
			const dir = t2.testdir();
			await t2.rejects(
				lib.downloadFile(url("/simple-file"), path.join(dir, "missing", "file.txt"), mode),
				{ code: "ENOENT" },
			);
		});
	}
	t1.test("accepts the url as a string", async t2 => {
		const dir = t2.testdir();
		const target = path.join(dir, "file.txt");
		await lib.downloadFile(url("/simple-file").href, target, "overwrite");
		t2.equal(await fs.readFile(target, "utf8"), fileContent);
	});
	t1.test("downloads an empty body", async t2 => {
		const dir = t2.testdir();
		const target = path.join(dir, "file.txt");
		t2.intercept(globalThis, "fetch", {
			value: async () => new Response(new Uint8Array(0), { status: 200 }),
		});
		await lib.downloadFile(url("/empty"), target, "overwrite");
		t2.equal(await fs.readFile(target, "utf8"), "");
	});
	t1.test("overwrites an existing file with overwrite", async t2 => {
		const dir = t2.testdir({ "file.txt": "original" });
		const target = path.join(dir, "file.txt");
		t2.equal(await lib.downloadFile(url("/simple-file"), target, "overwrite"), target);
		t2.equal(await fs.readFile(target, "utf8"), fileContent);
	});
	t1.test("rejects an existing file with error", async t2 => {
		const dir = t2.testdir({ "file.txt": "original" });
		const target = path.join(dir, "file.txt");
		await t2.rejects(lib.downloadFile(url("/simple-file"), target, "error"), { code: "EEXIST" });
		t2.equal(await fs.readFile(target, "utf8"), "original");
	});
	t1.test("writes to a numbered file when the file exists with rename", async t2 => {
		const dir = t2.testdir({ "file.txt": "", "file-2.txt": "", "file-3.txt": "" });
		const target = path.join(dir, "file.txt");
		const written = await lib.downloadFile(url("/simple-file"), target, "rename");
		t2.equal(written, path.join(dir, "file-4.txt"));
		t2.equal(await fs.readFile(written, "utf8"), fileContent);
		t2.equal(await fs.readFile(target, "utf8"), "");
		t2.strictSame(await strayFiles(dir, ["file.txt", "file-2.txt", "file-3.txt", "file-4.txt"]), []);
	});
	t1.test("does not overwrite an existing temporary file", async t2 => {
		const dir = t2.testdir({ "file.tmp.txt": "original" });
		await lib.downloadFile(url("/simple-file"), path.join(dir, "file.txt"), "overwrite");
		t2.equal(await fs.readFile(path.join(dir, "file.tmp.txt"), "utf8"), "original");
	});
	t1.test("rejects a response that is not ok", async t2 => {
		const dir = t2.testdir();
		for (const mode of ["overwrite", "error"] as const) {
			await t2.rejects(
				lib.downloadFile(url("/not-found"), path.join(dir, "file.txt"), mode),
				new Error(`Failed to download ${url("/not-found")}: 404 Not Found`),
			);
			t2.strictSame(await fs.readdir(dir), [], mode);
		}
	});
	t1.test("rejects a response without a body", async t2 => {
		const dir = t2.testdir();
		await t2.rejects(
			lib.downloadFile(url("/no-content"), path.join(dir, "file.txt"), "overwrite"),
			new Error(`Failed to download ${url("/no-content")}: 204 No Content`),
		);
		t2.strictSame(await fs.readdir(dir), []);
	});
	t1.test("does not leak credentials from the url when rejecting", async t2 => {
		const dir = t2.testdir();
		const target = url("/not-found");
		target.searchParams.set("username", "user");
		target.searchParams.set("token", "secret");
		await t2.rejects(
			lib.downloadFile(target, path.join(dir, "file.txt"), "overwrite"),
			{ message: /username=user&token=REDACTED: 404/ },
		);
	});
	t1.test("removes the temporary file when the request fails", async t2 => {
		const dir = t2.testdir();
		const error = new TypeError("fetch failed");
		t2.intercept(globalThis, "fetch", { value: async () => { throw error; } });
		await t2.rejects(lib.downloadFile(url("/simple-file"), path.join(dir, "file.txt"), "overwrite"), error);
		t2.strictSame(await fs.readdir(dir), []);
	});
	t1.test("removes the temporary file when the download is interrupted", async t2 => {
		const dir = t2.testdir();
		onStream = res => res.destroy();
		await t2.rejects(lib.downloadFile(url("/stream"), path.join(dir, "file.txt"), "overwrite"));
		t2.strictSame(await fs.readdir(dir), []);
	});
	t1.test("removes the file when interrupted while writing with error", async t2 => {
		const dir = t2.testdir();
		onStream = res => {
			res.write(Buffer.alloc(1024 * 1024));
			setTimeout(() => res.destroy(), 10);
		};
		await t2.rejects(lib.downloadFile(url("/stream"), path.join(dir, "file.txt"), "error"));
		t2.strictSame(await fs.readdir(dir), []);
	});
	t1.test("rejects when the file is removed during the download", async t2 => {
		const dir = t2.testdir();
		const body = new ReadableStream({
			async start(controller) {
				controller.enqueue(new TextEncoder().encode("data"));
				// Remove the temporary file before the body ends
				await fs.rm(path.join(dir, "file.tmp.txt"));
				controller.close();
			},
		});
		t2.intercept(globalThis, "fetch", { value: async () => new Response(body) });
		await t2.rejects(lib.downloadFile(url("/x"), path.join(dir, "file.txt"), "overwrite"), { code: "ENOENT" });
	});
	t1.test("rejects errors removing the temporary file", async t2 => {
		const dir = t2.testdir();
		const error = Object.assign(new Error("busy"), { code: "EBUSY" });
		const { downloadFile }: typeof lib = await t2.mockImport(fileOpsPath, {
			"node:fs/promises": { ...fs, unlink: async () => { throw error; } },
		});
		t2.intercept(globalThis, "fetch", { value: async () => { throw new Error("fetch failed"); } });
		await t2.rejects(downloadFile(url("/simple-file"), path.join(dir, "file.txt"), "overwrite"), error);
	});
	t1.test(
		"rejects when the directory disappears with rename",
		{ skip: process.platform === "win32" && "can't remove an open directory" },
		async t2 => {
			const dir = t2.testdir({ "sub": {} });
			const sub = path.join(dir, "sub");
			const body = new ReadableStream({
				async start(controller) {
					controller.enqueue(new TextEncoder().encode("data"));
					await fs.rm(sub, { recursive: true });
					controller.close();
				},
			});
			t2.intercept(globalThis, "fetch", { value: async () => new Response(body) });
			await t2.rejects(lib.downloadFile(url("/x"), path.join(sub, "file.txt"), "rename"), { code: "ENOENT" });
		},
	);
	t1.test("rejects other errors claiming the numbered file with rename", async t2 => {
		const dir = t2.testdir();
		const error = Object.assign(new Error("denied"), { code: "EACCES" });
		const { downloadFile }: typeof lib = await t2.mockImport(fileOpsPath, {
			"node:fs/promises": {
				...fs,
				writeFile: async (file: string, ...args: any[]) => {
					if (file === path.join(dir, "file.txt")) {
						throw error;
					}
					return await (fs.writeFile as any)(file, ...args);
				},
			},
		});
		await t2.rejects(downloadFile(url("/simple-file"), path.join(dir, "file.txt"), "rename"), error);
	});
});
