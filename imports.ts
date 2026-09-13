import * as fs from "node:fs";
import * as path from "node:path";

const dirs = ["packages", "plugins", "test"];
const ignore = ["dist", "node_modules"];

while (dirs.length) {
	const dir = dirs.shift();
	const entries = fs.readdirSync(dir, { withFileTypes: true });
	for (const entry of entries) {
		if (entry.isFile()) {
			if (/\.[cm]?[tj]s$/.test(entry.name)) {
				doFile(entry.parentPath + path.sep + entry.name);
			}
		} else if (entry.isDirectory()) {
			if (!ignore.includes(entry.name)) {
				dirs.push(entry.parentPath + path.sep + entry.name);
			}
		} else {
			console.log(`ignoring ${entry.parentPath}${path.sep}entry.name}`);
		}
	}
}

function doFile(filePath: string) {
	const content = fs.readFileSync(filePath, { encoding: "utf8" });
	const lines: string[] = content.split("\n");

	let modified = false;
	for (let pos = 0; pos < lines.length; pos++) {
		const line = lines[pos];
		const match = /(?:from|import) "((?:\.|@clusterio)[^"]+\.js)";?$/.exec(line);
		if (!match) {
			continue;
		}
		const importName = match[1];
		const module = match[1].replace("/dist/node", "");
		let refPath
		if (module.startsWith("@clusterio/")) {
			refPath = path.join("packages", module.slice("@clusterio/".length));
		} else {
			refPath = path.join(path.dirname(filePath), module);
		}
		const refPathAsTs = refPath.replace(/\.js$/, ".ts");
		if (fs.existsSync(refPath)) {
			if (importName === module) {
				continue
			}
		} else if (!fs.existsSync(refPathAsTs)) {
			console.log("import does not exists", filePath, module, refPath);
			continue;
		}
		lines[pos] = line.replace("/dist/node", "").replace(/\.js";?$/, '.ts";');
		modified = true;
	}
	if (modified) {
		console.log("writing modified", filePath);
		fs.writeFileSync(filePath, lines.join("\n"), { encoding: "utf8" });
	}
}
