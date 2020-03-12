"use strict";
const events = require("events");
const fs = require("fs-extra");
const JSZip = require("jszip");
const klaw = require("klaw");
const path = require("path");
const yargs = require("yargs");


// Location of mod source files
const sourceDir = "mod";

// Paths to additional files to put into the mod's folder.
const additionalFiles = [
	path.join("modules", "clusterio", "serialize.lua"),
];

async function main() {
	const args = yargs
		.scriptName("build")
		.options({
			'clean': { describe: "Remove previous builds", type: 'boolean', default: false },
			'build': { describe: "Build mod", type: 'boolean', default: true },
			'pack': { describe: "Pack into zip file", type: 'boolean', default: true },
			'output-dir': { describe: "Path to output built mod", nargs: 1, type: 'string', default: "dist" },
		})
		.argv
	;

	let info = JSON.parse(await fs.readFile(path.join(sourceDir, "info.json")));

	if (args.clean) {
		let splitter = /^(.*)_(\d+\.\d+\.\d+)(\.zip)?$/
		for (let entry of await fs.readdir(args.outputDir)) {
			let match = splitter.exec(entry);
			if (match) {
				let [, name, version] = match;
				if (name === info.name) {
					let modPath = path.join(args.outputDir, entry);
					console.log(`Removing ${modPath}`);
					await fs.remove(modPath);
				}
			}
		}
	}

	if (args.build) {
		await fs.ensureDir(args.outputDir);
		let modName = `${info.name}_${info.version}`;

		if (args.pack) {
			let zip = new JSZip();
			let walker = klaw(sourceDir)
				.on('data', item => {
					if (item.stats.isFile()) {
						// On Windows the path created uses backslashes as the directory sepparator
						// but the zip file needs to use forward slashes.  We can't use the posix
						// version of relative here as it doesn't work with Windows style paths.
						let basePath = path.relative(sourceDir, item.path).replace(/\\/g, "/");
						zip.file(path.posix.join(modName, basePath), fs.createReadStream(item.path));
					}
				})
			;
			await events.once(walker, 'end');

			for (let filePath of additionalFiles) {
				zip.file(path.posix.join(modName, path.basename(filePath)), fs.createReadStream(filePath));
			}

			let modPath = path.join(args.outputDir, `${modName}.zip`);
			console.log(`Writing ${modPath}`);
			let writeStream = zip.generateNodeStream().pipe(fs.createWriteStream(modPath));
			await events.once(writeStream, 'finish');

		} else {
			let modDir = path.join(args.outputDir, modName);
			if (await fs.exists(modDir)) {
				console.log(`Removing existing build ${modDir}`);
				await fs.remove(modDir);
			}
			console.log(`Building ${modDir}`);
			await fs.copy(sourceDir, modDir);
			for (let filePath of additionalFiles) {
				await fs.copy(filePath, path.join(modDir, path.basename(filePath)));
			}
		}
	}
}

if (module === require.main) {
	main().catch(err => { console.log(err) });
}
