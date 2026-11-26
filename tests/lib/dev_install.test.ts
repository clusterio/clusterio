import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import t from "tap";
import { isDevInstall } from "@clusterio/lib/dist/node/src/dev_install.js";

const modulePath = fileURLToPath(import.meta.resolve("@clusterio/lib/dist/node/src/dev_install.js"));

t.test("isDevInstall()", async t1 => {
	t1.test("is true in a source checkout", async t2 => {
		t2.equal(isDevInstall(), true);
	});
	t1.test("is false for a copy installed under node_modules", async t2 => {
		const dir = t2.testdir({
			node_modules: { "@clusterio": { lib: { "package.json": '{ "type": "module" }' } } },
		});
		const srcDir = path.join(dir, "node_modules", "@clusterio", "lib", "dist", "node", "src");
		await fs.mkdir(srcDir, { recursive: true });
		await fs.copyFile(modulePath, path.join(srcDir, "dev_install.js"));
		const installed = await import(pathToFileURL(path.join(srcDir, "dev_install.js")).href);
		t2.equal(installed.isDevInstall(), false);
	});
});
