import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { publishMods, uploadModRelease } from "../publish.js";

const execFileAsync = promisify(execFile);


describe("mod publishing", function() {
	let originalFetch;
	let directory;

	beforeEach(async function() {
		originalFetch = global.fetch;
		await fs.mkdir("temp", { recursive: true });
		directory = await fs.mkdtemp("temp/publish-test-");
	});

	afterEach(async function() {
		global.fetch = originalFetch;
		await fs.rm(directory, { recursive: true, force: true });
	});

	it("sends multipart mod and file fields accepted by native fetch", async function() {
		const name = "multipart_test";
		const filename = `${name}_1.0.0.zip`;
		const contents = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0xff]);
		const file = path.join(directory, filename);
		await fs.writeFile(file, contents);
		let calls = 0;
		global.fetch = async (url, options) => {
			calls += 1;
			const request = new Request(url, options);
			assert.match(request.headers.get("content-type"), /^multipart\/form-data; boundary=/);
			const form = await request.formData();
			if (calls === 1) {
				assert.equal(url, "https://mods.factorio.com/api/v2/mods/releases/init_upload");
				assert.equal(form.get("mod"), name);
				return Response.json({ upload_url: "https://upload.example.test/release" });
			}
			assert.equal(url, "https://upload.example.test/release");
			const uploaded = form.get("file");
			assert.equal(uploaded.name, filename);
			assert.deepEqual(Buffer.from(await uploaded.arrayBuffer()), contents);
			return Response.json({ success: true });
		};
		await uploadModRelease(file, name);
		assert.equal(calls, 2);
	});

	it("reads archives from the supplied directory and uploads unpublished versions in order", async function() {
		const name = "ordered_publish_test";
		for (const version of ["1.0.9", "1.0.10", "1.0.2"]) {
			await fs.writeFile(path.join(directory, `${name}_${version}.zip`), version);
		}
		const uploaded = [];
		let uploading = false;
		global.fetch = async (url, options) => {
			if (url === `https://mods.factorio.com/api/mods/${name}`) {
				return Response.json({ releases: [{ file_name: `${name}_1.0.2.zip` }] });
			}
			const form = await new Request(url, options).formData();
			if (url.endsWith("/init_upload")) {
				assert.equal(uploading, false, "previous upload must complete first");
				uploading = true;
				return Response.json({ upload_url: "https://upload.example.test/release" });
			}
			const file = form.get("file");
			uploaded.push([file.name, await file.text()]);
			await new Promise(resolve => setImmediate(resolve));
			uploading = false;
			return Response.json({ success: true });
		};
		await publishMods(directory);
		assert.deepEqual(uploaded, [
			[`${name}_1.0.9.zip`, "1.0.9"],
			[`${name}_1.0.10.zip`, "1.0.10"],
		]);
	});

	it("runs the CLI in dry-run mode without uploading unpublished archives", async function() {
		const filename = "cli_publish_test_1.0.0.zip";
		await fs.writeFile(path.join(directory, filename), "dry-run archive");
		const mockFetch = `
			import assert from "node:assert/strict";
			global.fetch = async (url, options = {}) => {
				assert.equal(url, "https://mods.factorio.com/api/mods/cli_publish_test");
				assert.equal(options.method ?? "GET", "GET", "dry-run must not upload");
				return Response.json({ releases: [] });
			};
		`;
		const { stdout, stderr } = await execFileAsync(process.execPath, [
			"--import", `data:text/javascript,${encodeURIComponent(mockFetch)}`,
			"publish.js", "factorio", directory, "--dry-run",
		]);
		assert.equal(stderr, "");
		assert(stdout.includes("Requesting current releases of cli_publish_test"));
		assert(stdout.includes(path.join(directory, filename)));
	});
});
