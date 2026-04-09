/* eslint-disable no-console */
"use strict";
const fs = require("node:fs/promises");
const JSZip = require("jszip");
const path = require("path");
const stream = require("stream");
const util = require("util");
const yargs = require("yargs");

const finished = util.promisify(stream.finished);


async function buildMod(args, info, modName) {
	if (args.build) {
		await fs.mkdir(args.outputDir, { recursive: true });
		modName = args.modName ?? `${info.name}_${info.version}`;

		if (args.pack) {
			let zip = new JSZip();
			for await (const dirent of await fs.opendir(args.sourceDir, { recursive: true })) {
				if (dirent.isFile()) {
					const itemPath = path.join(dirent.parentPath, dirent.name);
					// On Windows the path created uses backslashes as the directory sepparator
					// but the zip file needs to use forward slashes.  We can't use the posix
					// version of relative here as it doesn't work with Windows style paths.
					let basePath = path.relative(args.sourceDir, itemPath).replace(/\\/g, "/");
					// eslint-disable-next-line max-depth
					if (basePath === "info.json") {
						// The info.json file is overridden later.
						continue;
					}
					zip.file(path.posix.join(modName, basePath), (await fs.open(itemPath)).createReadStream());
				}
			}

			for (let [fileName, pathParts] of Object.entries(info.additional_files || {})) {
				let filePath = path.join(args.sourceDir, ...pathParts);
				let fileStream;
				try {
					fileStream = (await fs.open(filePath)).createReadStream();
				} catch (err) {
					throw new Error(`Error reading additional file ${filePath}`, { cause: err });
				}
				zip.file(path.posix.join(modName, fileName), fileStream);
			}
			delete info.additional_files;

			zip.file(path.posix.join(modName, "info.json"), JSON.stringify(info, null, "\t"));

			let modPath = path.join(args.outputDir, `${modName}.zip`);
			console.log(`Writing ${modPath}`);
			let writeStream = zip.generateNodeStream().pipe(
				(await fs.open(modPath, "w")).createWriteStream()
			);
			await finished(writeStream);

		} else {
			let modDir = path.join(args.outputDir, modName);
			console.log(`Removing potentially existing build ${modDir}`);
			await fs.rm(modDir, { force: true, recursive: true, maxRetries: 10 });
			console.log(`Building ${modDir}`);
			await fs.cp(args.sourceDir, modDir, {
				errorOnExists: true,
				mode: fs.constants.COPYFILE_FICLONE,
				recursive: true,
			});
			for (let [fileName, pathParts] of Object.entries(info.additional_files) || []) {
				let filePath = path.join(...pathParts);
				await fs.copyFile(
					filePath,
					path.join(modDir, fileName),
					fs.constants.COPYFILE_EXCL | fs.constants.COPYFILE_FICLONE,
				);
			}
			delete info.additional_files;

			await fs.writeFile(path.join(modDir, "info.json"), JSON.stringify(info, null, "\t"));
		}
	}
}

async function build(args) {
	let info = JSON.parse(await fs.readFile(path.join(args.sourceDir, "info.json")));

	if (args.factorioVersion) {
		info.factorio_version = args.factorioVersion;
	}

	if (args.dependencies) {
		info.dependencies = args.dependencies;
	}

	if (args.clean) {
		let splitter = /^(.*)_(\d+\.\d+\.\d+)(\.zip)?$/;
		for (let entry of await fs.readdir(args.outputDir)) {
			let match = splitter.exec(entry);
			if (match) {
				let name = match[1];
				if (name === info.name) {
					let modPath = path.join(args.outputDir, entry);
					console.log(`Removing ${modPath}`);
					await fs.rm(modPath, { force: true, recursive: true, maxRetries: 10 });
				}
			}
		}
	}

	if (info.variants) {
		for (let variantOverrides of info.variants) {
			let variantInfo = {
				...info,
				...variantOverrides,
			};
			delete variantInfo.variants;
			await buildMod(args, variantInfo);
		}
	} else {
		await buildMod(args, info);
	}
}


async function main() {
	const args = yargs
		.scriptName("build")
		.options({
			"clean": { describe: "Remove previous builds", type: "boolean", default: false },
			"build": { describe: "Build mod(s)", type: "boolean", default: true },
			"pack": { describe: "Pack into zip file", type: "boolean", default: true },
			"factorio-version": { describe: "Override factorio_version", type: "string" },
			"source-dir": {
				describe: "Path to mod source files",
				type: "string",
				nargs: 1,
				normalize: true,
				demandOption: true,
			},
			"output-dir": {
				describe: "Path to output built mod(s)",
				type: "string",
				nargs: 1,
				normalize: true,
				default: "dist/factorio",
			},
		})
		.strict()
		.argv
	;

	await build(args);
}

if (module === require.main) {
	main().catch(err => { console.log(err); });
}

module.exports = {
	build,
};
