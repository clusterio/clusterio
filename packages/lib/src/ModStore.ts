import fs from "fs-extra";
import path from "path";
import { Static, StringContentEncodingOption, Type } from "@sinclair/typebox";
import { logger } from "./logging";
import { integerModVersion, ModInfo } from "./data";
import * as libSchema from "./schema";
import TypedEventEmitter from "./TypedEventEmitter";
import { safeOutputFile } from "./file_ops";

export interface ModStoreEvents {
	/** A stored mod was created, updated or deleted */
	change: (mod: ModInfo) => void;
}

interface ModDownloadRequest {
	name: string;
	version?: string;
	sha1?: string;
}

interface ModRelease {
	download_url: string,
	file_name: string,
	info_json: { factorio_version: string; },
	releasted_at: string, // ISO 8601
	version: string,
	sha1: string;
}


interface ModDetails {
	name: string,
	title: string,
	owner: string,
	summary: string,
	downloads_count: number,
	category: string,
	score: number,
	releases: Array<ModRelease>,
}

interface ModsInfoResponse {
	pagination: any,
	results: Array<ModDetails>,
}

export default class ModStore extends TypedEventEmitter<keyof ModStoreEvents, ModStoreEvents> {
	constructor(
		public modsDirectory: string,
		public files: Map<string, ModInfo>,
	) {
		super();
	}

	getMod(name: string, version: string, sha1?: string) {
		const mod = this.files.get(ModInfo.filename(name, version));
		if (!mod || sha1 && sha1 !== mod.sha1) {
			return undefined;
		}
		return mod;
	}

	hasMod(name: string, version: string, sha1?: string): boolean {
		const mod = this.files.get(ModInfo.filename(name, version));
		return Boolean(mod && (!sha1 || sha1 !== mod.sha1));
	}

	mods() { return this.files.values(); }

	static async loadFile(modsDirectory: string, file: string) {
		let modInfo = await ModInfo.fromModFile(path.join(modsDirectory, file));
		if (modInfo.filename !== file) {
			throw new Error(`filename does not match the expected name ${modInfo.filename}.`);
		}
		return modInfo;
	}

	async loadFile(file: string) {
		let modInfo = await ModStore.loadFile(this.modsDirectory, file);
		this.files.set(modInfo.filename, modInfo);
		this.emit("change", modInfo);
		return modInfo;
	}

	async deleteFile(file: string) {
		let modInfo = this.files.get(file);
		if (!modInfo) {
			throw new Error(`Mod ${file} does not exist`);
		}

		await fs.unlink(path.join(this.modsDirectory, file));
		this.files.delete(file);
		modInfo.isDeleted = true;
		modInfo.updatedAtMs = Date.now();
		this.emit("change", modInfo);
	}

	addMod(modInfo: ModInfo) {
		this.files.set(modInfo.filename, modInfo);
		this.emit("change", modInfo);
	}

	async loadMod(name: string, version: string) {
		return await this.loadFile(ModInfo.filename(name, version));
	}

	async deleteMod(name: string, version: string) {
		return await this.deleteFile(ModInfo.filename(name, version));
	}

	static async fromDirectory(modsDirectory: string) {
		type ModInfoCache = Static<typeof ModInfo.jsonSchema>[];
		const cacheFilename = path.join(modsDirectory, "mod-info-cache.json");
		let cache = new Map<string, ModInfo>();
		try {
			const content = await fs.readFile(cacheFilename, "utf8");
			cache = new Map((JSON.parse(content) as ModInfoCache).map(item => {
				const mod = ModInfo.fromJSON(item);
				return [mod.filename, mod];
			}));
		} catch (err: any) {
			if (err.code !== "ENOENT") {
				logger.warn(`Error loading ${cacheFilename}:\n${err.stack}`);
			}
		}

		const files = new Map<string, ModInfo>();
		for (let entry of await fs.readdir(modsDirectory, { withFileTypes: true })) {
			if (entry.isDirectory()) {
				logger.warn(`Ignoring ${entry.name}${path.sep} in mods directory.`);
				continue;
			}

			if (!entry.name.toLowerCase().endsWith(".zip")) {
				continue;
			}

			if (entry.name.toLowerCase().endsWith(".tmp.zip")) {
				continue;
			}

			const cachedModInfo = cache.get(entry.name);
			if (cachedModInfo) {
				const stat = await fs.stat(path.join(modsDirectory, entry.name));
				if (cachedModInfo.mtimeMs === stat.mtimeMs) {
					files.set(cachedModInfo.filename, cachedModInfo);
					continue;
				}
			}

			logger.info(`Loading info for Mod ${entry.name}`);
			let modInfo: ModInfo;
			try {
				modInfo = await this.loadFile(modsDirectory, entry.name);
			} catch (err: any) {
				logger.error(`Error loading mod ${entry.name}: ${err.message}`);
				continue;
			}
			files.set(modInfo.filename, modInfo);
		}

		if (files.size) {
			logger.info(`Loaded info for ${files.size} mods`);
			const content: ModInfoCache = [...files.values()].map(mod => mod.toJSON());
			await safeOutputFile(cacheFilename, JSON.stringify(content));
		}

		return new this(modsDirectory, files);
	}

	static getLatestVersionFromReleases(releases: Array<ModRelease>): string | undefined {
		let latestVersion = "0.0.0";
		releases.forEach((release) => {
			if (integerModVersion(latestVersion) < integerModVersion(release.version)) {
				latestVersion = release.version;
			}
		});
		if (latestVersion === "0.0.0") {
			return undefined;
		}
		return latestVersion;
	}

	static async getLatestVersionsChunk(modNames: Array<string>): Promise<{ [key: string]: string | undefined; }> {
		const url = new URL("https://mods.factorio.com/api/mods");
		url.searchParams.set("page_size", "max");
		const response = await fetch(url, {
			method: "POST",
			body: new URLSearchParams({ namelist: modNames }),
		});
		if (response.status !== 200) {
			throw Error(`Fetch: ${url} returned ${response.status} ${response.statusText}`);
		}
		const mods = (await response.json() as ModsInfoResponse).results;
		const versions: { [key: string]: string | undefined; } = {};
		mods.forEach((mod) => {
			const modName = mod.name;
			let latestVersion = ModStore.getLatestVersionFromReleases(mod.releases);
			versions[modName] = latestVersion;
		});

		return versions;
	}

	static async getLatestVersions(modNames: Array<string>): Promise<{ [key: string]: string | undefined; }> {
		const chunkSize = 500;
		const chunks: Array<{ [key: string]: string | undefined; }> = [];
		for (let i = 0; i < modNames.length; i += chunkSize) {
			chunks.push(await ModStore.getLatestVersionsChunk(modNames.slice(i, i + chunkSize)));
		}
		const versions = chunks.reduce((acc, curr) => ({ ...acc, ...curr }), {});
		return versions;
	}


}
