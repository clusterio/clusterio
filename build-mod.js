"use strict";
const events = require("events");
const fs = require("fs-extra");
const JSZip = require("jszip");
const klaw = require("klaw");
const path = require("path");
const yargs = require("yargs");


async function main() {
	const libPath = path.join("lua", "clusterio_lib");
	const args = yargs
		.scriptName("build")
		.options({
			'clean': { describe: "Remove previous builds", type: 'boolean', default: false },
			'build': { describe: "Build mod", type: 'boolean', default: true },
			'pack': { describe: "Pack into zip file", type: 'boolean', default: true },
			"source-dir": { describe: "Path to mod source files", nargs: 1, type: "string", default: libPath },
			'output-dir': { describe: "Path to output built mod", nargs: 1, type: 'string', default: "dist" },
			"bump-patch": { describe: "Increment patch number of build", type: "boolean", default: false },
			"factorio-version": { describe: "Override factorio_version", type: "string" },
		})
		.strict()
		.argv
	;

	await build(args);
}

async function build(args) {
	let info = JSON.parse(await fs.readFile(path.join(args.sourceDir, "info.json")));

	if (args.bumpPatch) {
		let [major, minor, patch] = info.version.split(".");
		patch = String(Number.parseInt(patch, 10) + 1);
		info.version = [major, minor, patch].join(".");
	}

	if (args.factorioVersion) {
		info.factorio_version = args.factorioVersion;
	}

	if (args.dependencies) {
		info.dependencies = args.dependencies;
	}

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
			let walker = klaw(args.sourceDir)
				.on('data', item => {
					if (item.stats.isFile()) {
						// On Windows the path created uses backslashes as the directory sepparator
						// but the zip file needs to use forward slashes.  We can't use the posix
						// version of relative here as it doesn't work with Windows style paths.
						let basePath = path.relative(args.sourceDir, item.path).replace(/\\/g, "/");
						zip.file(path.posix.join(modName, basePath), fs.createReadStream(item.path));
					}
				})
			;
			await events.once(walker, 'end');

			for (let pathParts of info.additional_files || []) {
				let filePath = path.join(...pathParts);
				zip.file(path.posix.join(modName, path.basename(filePath)), fs.createReadStream(filePath));
			}
			delete info.additional_files;

			zip.file(path.posix.join(modName, "info.json"), JSON.stringify(info, null, 4));

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
			await fs.copy(args.sourceDir, modDir);
			for (let pathParts of info.additional_files || []) {
				let filePath = path.join(...pathParts);
				await fs.copy(filePath, path.join(modDir, path.basename(filePath)));
			}
			delete info.additional_files;

			await fs.writeFile(path.join(modDir, "info.json"), JSON.stringify(info, null, 4));
		}
	}
}

if (module === require.main) {
	main().catch(err => { console.log(err) });
}

module.exports = {
	build,
};
