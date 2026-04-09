"use strict";
const assert = require("assert").strict;
const fs = require("node:fs/promises");
const http = require("node:http");
const path = require("path");
const util = require("node:util");

const lib = require("@clusterio/lib");

describe("lib/file_ops", function() {
	let baseDir = path.join("temp", "test", "file_ops");
	async function setupTestingEnv() {
		await fs.mkdir(path.join(baseDir, "test", "folder"), { recursive: true });
		await fs.mkdir(path.join(baseDir, "test", "another folder"), { recursive: true });
		await fs.rm(path.join(baseDir, "safe"), { force: true, recursive: true, maxRetries: 10 });
		await fs.mkdir(path.join(baseDir, "safe"), { recursive: true });

		await fs.writeFile(path.join(baseDir, "test", "file.txt"), "contents");
		await fs.writeFile(path.join(baseDir, "test", "another file.txt"), "more contents");

		await fs.mkdir(path.join(baseDir, "find"), { recursive: true });
		await fs.writeFile(path.join(baseDir, "find", "file"), "contents");
		await fs.writeFile(path.join(baseDir, "find", "file.txt"), "contents");
		await fs.writeFile(path.join(baseDir, "find", "foo-1"), "contents");
		await fs.writeFile(path.join(baseDir, "find", "foo-2"), "contents");
		await fs.writeFile(path.join(baseDir, "find", "bar-1.txt"), "contents");
		await fs.writeFile(path.join(baseDir, "find", "bar-2.txt"), "contents");
	}

	before(setupTestingEnv);

	describe("getNewestFile()", function() {
		it("returns a string in a directory with files", async function() {
			let newest = await lib.getNewestFile(path.join(baseDir, "test"));
			assert.equal(typeof newest, "string");
		});
		it("returns undefined if all entries were filtered out", async function() {
			let newest = await lib.getNewestFile(path.join(baseDir, "test"), (name) => !name.endsWith(".txt"));
			assert.equal(newest, undefined);
		});
		it("returns undefined if directory is empty", async function() {
			let newest = await lib.getNewestFile(path.join(baseDir, "test", "folder"));
			assert.equal(newest, undefined);
		});
	});

	describe("getNewestFile()", function() {
		it("returns 0 if directory does not exist", async function() {
			let size = await lib.directorySize(path.join(baseDir, "invalid"));
			assert.equal(size, 0);
		});
		it("returns 0 if directory is empty", async function() {
			let size = await lib.directorySize(path.join(baseDir, "test", "folder"));
			assert.equal(size, 0);
		});
		it("returns size of files in directory", async function() {
			let size = await lib.directorySize(path.join(baseDir, "test"));
			assert.equal(size, 21);
		});
	});

	describe("findUnusedName()", function() {
		it("should return named unchanged if it does not exist", async function() {
			let cases = [
				[["file"], "file"],
				[["file", ".txt"], "file.txt"],
				[["file.txt", ".txt"], "file.txt"],
			];
			for (let [args, expected] of cases) {
				let actual = await lib.findUnusedName(path.join(baseDir, "test", "folder"), ...args);
				assert.equal(actual, expected);
			}
		});
		it("should return changed name if it does exist", async function() {
			let cases = [
				[["file"], "file-2"],
				[["file", ".txt"], "file-2.txt"],
				[["file.txt", ".txt"], "file-2.txt"],
				[["foo-1"], "foo-3"],
				[["bar-1", ".txt"], "bar-3.txt"],
				[["bar-1.txt", ".txt"], "bar-3.txt"],
			];
			for (let [args, expected] of cases) {
				let actual = await lib.findUnusedName(path.join(baseDir, "find"), ...args);
				assert.equal(actual, expected);
			}
		});
	});

	describe("safeOutputFile()", function() {
		it("should write new target file", async function() {
			let target = path.join(baseDir, "safe", "simple.txt");
			await lib.safeOutputFile(target, "a text file", "utf8");
			await assert.rejects(fs.access(target.replace(".txt", ".tmp.txt")), "temporary was left behind");
			assert.equal(await fs.readFile(target, "utf8"), "a text file");
		});
		it("should overwrite existing target file", async function() {
			let target = path.join(baseDir, "safe", "exists.txt");
			await fs.writeFile(target, "previous", "utf8");
			await lib.safeOutputFile(target, "current", "utf8");
			await assert.rejects(fs.access(target.replace(".txt", ".tmp.txt")), "temporary was left behind");
			assert.equal(await fs.readFile(target, "utf8"), "current");
		});
		it("should handle creating file in current working directory", async function() {
			let target = "temporary-file-made-to-test-cwd.txt";
			try {
				await lib.safeOutputFile(target, "a text file", "utf8");
			} finally {
				try {
					await fs.unlink(target);
				} catch (err) {
					if (err.code !== "ENOENT") {
						throw err;
					}
				}
			}
		});
	});

	describe("checkFilename()", function() {
		it("should allow a basic name", function() {
			lib.checkFilename("file");
		});

		function check(item, msg) {
			assert.throws(() => lib.checkFilename(item), new Error(msg));
		}

		it("should throw on non-string", function() {
			check(undefined, "must be a string");
			check(null, "must be a string");
			check({}, "must be a string");
			check([], "must be a string");
			check(0, "must be a string");
			check(false, "must be a string");
		});

		it("should throw on empty name", function() {
			check("", "cannot be empty");
		});

		it("should throw on <>:\"\\/|?* \\x00\\r\\n\\t", function() {
			for (let char of '<>:"\\/|?*\x00\r\n\t') {
				check(char, 'cannot contain <>:"\\/|=* or control characters');
			}
		});

		it("should throw on CON, PRN, AUX, NUL, COM1, LPT1", function() {
			for (let bad of ["CON", "PRN", "AUX", "NUL", "COM1", "LPT1"]) {
				check(bad, "cannot be named any of CON PRN AUX NUL COM1-9 and LPT1-9");
				check(`${bad}.zip`, "cannot be named any of CON PRN AUX NUL COM1-9 and LPT1-9");
				check(`${bad}.anything.txt`, "cannot be named any of CON PRN AUX NUL COM1-9 and LPT1-9");
				check(`${bad}....a`, "cannot be named any of CON PRN AUX NUL COM1-9 and LPT1-9");
				check(`${bad}.`, "cannot be named any of CON PRN AUX NUL COM1-9 and LPT1-9");
			}
		});

		it("should throw on . and ..", function() {
			for (let bad of [".", ".."]) {
				check(bad, `cannot be named ${bad}`);
			}
		});

		it("should throw on names ending with . or space", function() {
			check("a ", "cannot end with . or space");
			check("a.", "cannot end with . or space");
		});
	});

	describe("cleanFilename()", function() {
		function clean(item, expected) {
			assert.equal(lib.cleanFilename(item), expected);
		}

		it("should allow a basic name", function() {
			clean("file", "file");
		});

		function check(item, msg) {
			assert.throws(() => lib.cleanFilename(item), new Error(msg));
		}

		it("should throw on non-string", function() {
			check(undefined, "name must be a string");
			check(null, "name must be a string");
			check({}, "name must be a string");
			check([], "name must be a string");
			check(0, "name must be a string");
			check(false, "name must be a string");
		});

		it("should clean empty name", function() {
			clean("", "_");
		});

		it("should clean <>:\"\\/|?* \\x00\\r\\n\\t", function() {
			for (let char of '<>:"\\/|?*\x00\r\n\t') {
				clean(char, "_");
			}
		});

		it("should clean CON, PRN, AUX, NUL, COM1, LPT1", function() {
			for (let bad of ["CON", "PRN", "AUX", "NUL", "COM1", "LPT1"]) {
				clean(bad, `${bad}_`);
				clean(`${bad}.zip`, `${bad}_.zip`);
				clean(`${bad}.anything.txt`, `${bad}_.anything.txt`);
				clean(`${bad}....a`, `${bad}_....a`);
				clean(`${bad}.`, `${bad}__`);
			}
		});

		it("should clean . and ..", function() {
			for (let bad of [".", ".."]) {
				clean(bad, `${bad}_`);
			}
		});

		it("should clean names ending with . or space", function() {
			clean("a ", "a_");
			clean("a.", "a_");
		});
	});

	describe("downloadFile()", function () {
		const baseUrl = new URL("http://localhost/");
		const downloadDir = path.join("temp", "test", "downloadFile");
		const fileContent = "mock file content";
		let onStream;
		let server;

		before(async function () {
			await fs.rm(downloadDir, { force: true, recursive: true, maxRetries: 10 });
			await fs.mkdir(downloadDir, { recursive: true });
			server = http.createServer();
			server.unref();
			server.on("request", (req, res) => {
				if (req.url === "/simple-file") {
					res.writeHead(200, {
						"Content-Length": Buffer.byteLength(fileContent),
						"Content-Type": "text/plain",
					}).end(fileContent);
				} else if (req.url === "/empty-file") {
					res.writeHead(200, {
						"Content-Length": 0,
						"Content-Type": "text/plain",
					}).end();
				} else if (req.url === "/no-content") {
					res.writeHead(204).end();
				} else if (req.url === "/stream") {
					res.writeHead(200, {
						"Content-Type": "text/plain",
					});
					res.write("streaming\n");
					onStream(res);
				} else {
					const body = "not found";
					res.writeHead(404, {
						"Content-Length": Buffer.byteLength(body),
						"Content-Type": "text/plain",
					}).end(body);
				}
			});
			await util.promisify(server.listen.bind(server))();
			baseUrl.port = server.address().port;
		});
		after(function() {
			server.close();
			server.closeAllConnections();
		});

		it("should download content from URL to the specified file path", async function () {
			for (const mode of ["overwrite", "rename", "error"]) {
				const downloadUrl = new URL("/simple-file", baseUrl);
				const downloadPath = path.join(downloadDir, `simple-file-${mode}.txt`);
				const newDownloadPath = await lib.downloadFile(downloadUrl, downloadPath, mode);
				const writtenContent = await fs.readFile(downloadPath, "utf8");
				assert.equal(writtenContent, fileContent);
				assert.equal(downloadPath, newDownloadPath);
			}
		});

		it("should throw if fetch response is not ok", async function () {
			const downloadPath = path.join(downloadDir, "not-found.txt");
			await assert.rejects(
				lib.downloadFile(new URL("/not-found", baseUrl), downloadPath, "overwrite"),
				/Failed to download .* 404 Not Found/
			);
			await assert.rejects(
				fs.readFile(downloadPath),
				{ code: "ENOENT" },
			);
		});

		it("should throw if fetch response body is missing", async function () {
			const downloadPath = path.join(downloadDir, "not-content.txt");
			await assert.rejects(
				lib.downloadFile(new URL("/no-content", baseUrl), downloadPath, "overwrite"),
				/Failed to download .* 204 No Content/
			);
			await assert.rejects(
				fs.readFile(downloadPath),
				{ code: "ENOENT" },
			);
		});

		it("should throw if file exists and overwriteMode is error", async function () {
			const downloadPath = path.join(downloadDir, "exists.txt");
			await fs.writeFile(downloadPath, "");
			await assert.rejects(
				lib.downloadFile(new URL("/simple-file", baseUrl), downloadPath, "error"),
				{ code: "EEXIST" },
			);
		});

		it("should throw if target directory does not exist", async function () {
			const downloadPath = path.join(downloadDir, "does-not-exist", "simple.txt");
			for (const mode of ["overwrite", "rename", "error"]) {
				await assert.rejects(
					lib.downloadFile(new URL("/simple-file", baseUrl), downloadPath, mode),
					{ code: "ENOENT" },
				);
			}
		});

		it("should write a new file if it exists and overwriteMode is rename", async function () {
			const downloadPath = path.join(downloadDir, "exists.txt");
			await fs.writeFile(downloadPath, "");
			const newDownloadPath = await lib.downloadFile(new URL("/simple-file", baseUrl), downloadPath, "rename");
			assert.equal(newDownloadPath, path.join(downloadDir, "exists-2.txt"));
			const writtenContent = await fs.readFile(newDownloadPath, "utf8");
			assert.equal(writtenContent, fileContent);
		});

		it("should write a new file if many files exists and overwriteMode is rename", async function () {
			const downloadPath = path.join(downloadDir, "contended.txt");
			const additionalPaths = [
				path.join(downloadDir, "contended-2.txt"),
				path.join(downloadDir, "contended-3.txt"),
				path.join(downloadDir, "contended-4.txt"),
			];
			await fs.writeFile(downloadPath, "");
			for (const additionalPath of additionalPaths) {
				await fs.writeFile(additionalPath, "");
			}
			const newDownloadPath = await lib.downloadFile(new URL("/simple-file", baseUrl), downloadPath, "rename");
			assert.equal(newDownloadPath, path.join(downloadDir, "contended-5.txt"));
			const writtenContent = await fs.readFile(newDownloadPath, "utf8");
			assert.equal(writtenContent, fileContent);
		});

		it("should overwrite existing file if overwriteMode is overwrite", async function () {
			const downloadPath = path.join(downloadDir, "overwrite.txt");
			await fs.writeFile(downloadPath, "original content");
			const newDownloadPath = await lib.downloadFile(new URL("/simple-file", baseUrl), downloadPath, "overwrite");
			assert.equal(newDownloadPath, downloadPath);
			const writtenContent = await fs.readFile(newDownloadPath, "utf8");
			assert.equal(writtenContent, fileContent);
		});

		it("should not overwrite existing temp files", async function () {
			const tempPath = path.join(downloadDir, "temp-exists.tmp.txt");
			await fs.writeFile(tempPath, "original content");
			const downloadPath = path.join(downloadDir, "temp-exists.txt");
			await lib.downloadFile(new URL("/simple-file", baseUrl), downloadPath, "overwrite");
			const writtenContent = await fs.readFile(tempPath, "utf8");
			assert.equal(writtenContent, "original content");
		});

		it("should throw if overwriteMode is rename and directory disappeared", async function () {
			if (process.platform === "win32") {
				// Can't remove the directory while the stream is running on Windows.
				this.skip();
			}
			function stageWaiter() {
				let stage;
				let waitForStage = new Promise(resolve => { stage = resolve; });
				return [stage, waitForStage];
			}

			const downloadSubdir = path.join(downloadDir, "subdir");
			const downloadPath = path.join(downloadSubdir, "test.txt");
			await fs.mkdir(downloadSubdir, { recursive: true });

			const [stage1, waitForStage1] = stageWaiter();
			const [stage2, waitForStage2] = stageWaiter();

			onStream = async (res) => {
				stage1();
				await waitForStage2;
				res.end("done");
			};
			const download = lib.downloadFile(new URL("/stream", baseUrl), downloadPath, "rename");
			download.catch(() => {});
			await waitForStage1;

			await fs.rm(downloadSubdir, { recursive: true, maxRetries: 10 });
			stage2();

			await assert.rejects(
				download,
				{ code: "ENOENT" },
			);
		});
	});
});
