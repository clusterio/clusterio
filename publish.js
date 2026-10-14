/**
 * Publish any mods that need to be published
 */

import { openAsBlob } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import yargs from "yargs";

let DRY = false;

const modReleaseCache = new Map();
/**
 * Gets a list of all releases for a mod
 */
async function requestModReleases(mod) {
	const cache = modReleaseCache.get(mod);
	if (cache) {
		return cache;
	}

	// eslint-disable-next-line no-console
	console.log(`Requesting current releases of ${mod}`);

	const response = await fetch(`https://mods.factorio.com/api/mods/${mod}`);
	if (!response.ok) {
		throw new Error(`Failed request to mod portal api: ${response.statusText}\n${await response.text()}`);
	}

	const json = await response.json();
	modReleaseCache.set(mod, json.releases);
	return json.releases;
}

/**
 * Upload a mod to the mod portal
 */
export async function uploadModRelease(file, name) {
	// eslint-disable-next-line no-console
	console.log(`Uploading new release ${file}`);
	if (DRY) {
		return;
	}

	const headers = new Headers({
		Authorization: `Bearer ${process.env.FACTORIO_TOKEN}`,
	});

	// Start the upload process by requesting an upload url
	const initFormData = new FormData();
	initFormData.append("mod", name);

	const initResponse = await fetch("https://mods.factorio.com/api/v2/mods/releases/init_upload", {
		method: "POST",
		headers: headers,
		body: initFormData,
	});
	if (!initResponse.ok) {
		throw new Error(`Failed init mod upload: ${initResponse.statusText}\n${await initResponse.text()}`);
	}

	// Upload the new version of the mod
	const uploadUrl = (await initResponse.json()).upload_url;
	const uploadFormData = new FormData();
	uploadFormData.append("file", await openAsBlob(file), path.basename(file));

	const uploadResponse = await fetch(uploadUrl, {
		method: "POST",
		headers: headers,
		body: uploadFormData,
	});
	if (!uploadResponse.ok) {
		throw new Error(`Failed mod upload: ${uploadResponse.statusText}\n${await uploadResponse.text()}`);
	}
}

const regexModZip = /(\w+)_\d+.\d+.\d+\.zip/;
/**
 * Publishes all mods that require publishing
 */
export async function publishMods(dir) {
	const files = await fs.readdir(dir);
	const mods = files
		.sort((a, b) => a.localeCompare(b, "en", { numeric: true }))
		.map(file => regexModZip.exec(file))
		.filter(file => Boolean(file));

	for (const mod of mods) {
		const [file, name] = mod;
		const releases = await requestModReleases(name);
		if (!releases.some(release => release.file_name === file)) {
			// Upload in version order so the newest variant is published last.
			await uploadModRelease(path.join(dir, file), name);
		} else {
			// eslint-disable-next-line no-console
			console.log(`Skipped ${file}`);
		}
	}

}

/**
 * Main function for this script
 */
async function main() {
	await yargs(process.argv.slice(2))
		.scriptName("publish")
		.option("dry-run", {
			alias: "dry",
			nargs: 0,
			describe: "Will not publish anything",
			default: false,
			type: "boolean",
		})
		.command(["factorio <mods-dir>", "$0 <mods-dir>"], "Publish factorio mods", yargs => {
			yargs
				.positional("mods-dir", {
					describe: "Path to packed mods to publish",
					normalize: true,
					type: "string",
				})
				.demandOption("mods-dir", "A path to the mods dir must be specified");
		}, async argv => {
			DRY = argv.dry;
			await publishMods(argv.modsDir);
		})
		.strict()
		.parse();
}

// Run main if started from command line
if (import.meta.main) {
	main();
}
