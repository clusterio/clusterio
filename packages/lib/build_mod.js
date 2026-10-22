/* eslint-disable no-console */
import fs from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import yargs from "yargs";
import yazl from "yazl";


async function addModFiles(args, info, modName, zip) {
	for await (const dirent of await fs.opendir(args.sourceDir, { recursive: true })) {
		if (dirent.isFile()) {
			const itemPath = path.join(dirent.parentPath, dirent.name);
			// On Windows the path created uses backslashes as the directory sepparator
			// but the zip file needs to use forward slashes.  We can't use the posix
			// version of relative here as it doesn't work with Windows style paths.
			let basePath = path.relative(args.sourceDir, itemPath).replace(/\\/g, "/");
			if (basePath === "info.json") {
				// The info.json file is overridden later.
				continue;
			}
			zip.addFile(itemPath, path.posix.join(modName, basePath));
		}
	}

	for (let [fileName, pathParts] of Object.entries(info.additional_files || {})) {
		let filePath = path.join(args.sourceDir, ...pathParts);
		try {
			await fs.access(filePath);
		} catch (err) {
			throw new Error(`Error reading additional file ${filePath}`, { cause: err });
		}
		zip.addFile(filePath, path.posix.join(modName, fileName));
	}
	delete info.additional_files;

	zip.addBuffer(Buffer.from(JSON.stringify(info, null, "\t")), path.posix.join(modName, "info.json"));
}

async function buildMod(args, info, modName) {
	if (args.build) {
		await fs.mkdir(args.outputDir, { recursive: true });
		modName = args.modName ?? `${info.name}_${info.version}`;

		if (args.pack) {
			let modPath = path.join(args.outputDir, `${modName}.zip`);
			console.log(`Writing ${modPath}`);
			let zip = new yazl.ZipFile();
			// yazl reports errors on the zip object, not the output stream.
			zip.on("error", err => zip.outputStream.destroy(err));
			// addFile() can fail before the traversal is done, so start writing first.
			const writing = pipeline(zip.outputStream, (await fs.open(modPath, "w")).createWriteStream());
			writing.catch(() => {});
			try {
				await addModFiles(args, info, modName, zip);
				zip.end();
				await writing;
			} catch (err) {
				zip.outputStream.destroy();
				await writing.catch(() => {});
				await fs.rm(modPath, { force: true });
				throw err;
			}

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

export async function build(args) {
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
	const args = yargs(process.argv.slice(2))
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
		.parse()
	;

	await build(args);
}

if (import.meta.main) {
	main().catch(err => { console.log(err); });
}
