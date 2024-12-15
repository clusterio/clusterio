import fs from "fs-extra";
import path from "path";
import { Static} from "@sinclair/typebox";
import { logger } from "./logging";
import { integerModVersion, ModInfo, ModPack, ModRecord } from "./data";
import TypedEventEmitter from "./TypedEventEmitter";
import { safeOutputFile } from "./file_ops";
import { Writable } from "stream";

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
	released_at: string, // ISO 8601
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
	score?: number,
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

	private static getLatestVersionFromReleases(releases: Array<ModRelease>) {
		if (releases.length === 0) {
			return undefined;
		}
		let latestVersion = releases[0].version;
		releases.forEach((release) => {
			if (integerModVersion(latestVersion) < integerModVersion(release.version)) {
				latestVersion = release.version;
			}
		});
		return latestVersion;
	}

	private static async getLatestVersionsChunk(modNames: string[], factorioVersion: string) {
		const url = new URL("https://mods.factorio.com/api/mods");
		url.searchParams.set("page_size", "max");
		url.searchParams.set("version", factorioVersion);
		const response = await fetch(url, {
			method: "POST",
			body: new URLSearchParams({ namelist: modNames }),
		});
		if (response.status !== 200) {
			throw Error(`Fetch: ${url} returned ${response.status} ${response.statusText}`);
		}
		const mods = (await response.json() as ModsInfoResponse).results;
		const versions = new Map<string, string>();
		mods.forEach((mod) => {
			const modName = mod.name;
			let latestVersion = ModStore.getLatestVersionFromReleases(mod.releases);
			if (latestVersion !== undefined) { versions.set(modName, latestVersion); }

		});
		return versions;
	}

	/**
	 *
	 * @param modNames an array of mod names to check for their latest version
	 * @param factorioVersion factorio version to filter for (mods are not guaranteed to work between Middle versions)
	 * @returns a Map with the keys being mod names and values being their latest version,
	 * it is not guarteed that all mods submited will be returned
	 */
	static async getLatestVersions(modNames: string[] | string, factorioVersion: string = "1.1") {
		if (typeof modNames === "string") {
			modNames = [modNames];
		}
		if (factorioVersion.split(".").length >= 3) {
			factorioVersion = factorioVersion.slice(0, factorioVersion.lastIndexOf("."));
		}
		modNames = modNames.filter((modName, index, array) => !(modName in ModPack.getBuiltinModNames(factorioVersion))
		);

		const chunkSize = 500;
		let versions = new Map<string, string>();
		for (let i = 0; i < modNames.length; i += chunkSize) {
			const chunk = (await ModStore.getLatestVersionsChunk(modNames.slice(i, i + chunkSize), factorioVersion));

			for (const [modName, version] of chunk) {
				versions.set(modName, version);
			}
		}
		return versions;
	}

	private async downloadModFromReleases(releases: Array<ModRelease>, version: string,
		username: string, token: string
	) {
		if (releases.length === 0) { }

		// releases.find() // work on this

		const latestRelease = releases.find(release => release.version === version);

		if (latestRelease === undefined) {
			return;
		}

		const url = new URL(`https://mods.factorio.com/${latestRelease.download_url}`);
		url.searchParams.set("username", username);
		url.searchParams.set("token", token);
		const fileName = `${this.modsDirectory}/${latestRelease.file_name}.tmp`;
		await ModStore.downloadFile(url, fileName);
		await fs.rename(fileName, `${this.modsDirectory}/${latestRelease.file_name}`);
		this.addMod(await this.loadFile(`${this.modsDirectory}/${latestRelease.file_name}`));
	}

	private async downloadModsChunk(
		modNames: string[], modVersions: string[], username: string, token: string, factorioVersion: string
	) {
		const url = new URL("https://mods.factorio.com/api/mods");
		url.searchParams.set("page_size", "max");
		url.searchParams.set("version", factorioVersion);
		const response = await fetch(url, {
			method: "POST",
			body: new URLSearchParams({ namelist: modNames }),
		});
		if (response.status !== 200) {
			throw Error(`Fetch: ${url} returned ${response.status} ${response.statusText}`);
		}
		const mods = (await response.json() as ModsInfoResponse).results;

		await Promise.all(mods.map((mod) => this.downloadModFromReleases(mod.releases,
			modVersions[modNames.indexOf(mod.name)], username, token)));
	}


	/**
	 *
	 * downloads mods to the mod dir, will not download mods for which are already in the mod directory
	 *
	 * @param modMap a map of what mods to download and what version to download
	 * @param username factorio username used for auth to download mods
	 * @param token factorio token used for auth to download mods
	 * @param factorioVersion factorio version to filter for (mods are not guaranteed to work between Middle versions)
	 *
	 */
	async downloadMods(modMap: Map<string, string>, username: string, token: string, factorioVersion: string = "1.1") {
		const chunkSize = 500;
		let futures: Promise<void>[] = [];
		modMap = new Map(modMap);
		if (factorioVersion.split(".").length >= 3) {
			factorioVersion = factorioVersion.slice(0, factorioVersion.lastIndexOf("."));
		}

		// get rid of mods already downloaded, why download what is already there
		modMap.forEach((modVersion, modName, map) => {
			const filename = `${modName}_${modVersion}.zip`;
			if (modName in ModPack.getBuiltinModNames(factorioVersion) || this.files.has(filename)) {
				map.delete(modName);
			}
		});

		const modNames = Array.from(modMap.keys());
		const modVersions = Array.from(modMap.values());
		for (let i = 0; i < modMap.size; i += chunkSize) {
			futures.push(
				this.downloadModsChunk(modNames.slice(i, i + chunkSize), modVersions.slice(i, i + chunkSize),
					username, token, factorioVersion)
			);
		}
		await Promise.all(futures);
	}

	static async downloadFile(url: string | URL, filePath: string) {
		try {
			const response = await fetch(url);

			if (!response.ok) {
				throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
			}

			const fileStream = fs.createWriteStream(filePath);

			// Check if the response body exists and pipe it to the file
			if (response.body) {
				const writer = Writable.toWeb(fileStream);
				await response.body.pipeTo(writer);
			} else {
				throw new Error("Response body is missing.");
			}
		} catch (error) {
			logger.error("Error downloading file:", error);
			throw error;
		}
	}

	async updateModpack(modPack: ModPack) {
		const modNames = Array.from(modPack.mods.keys());
		let currentVersions = new Map<string, string>();

		modPack.mods.forEach((value, key, map) => {
			currentVersions.set(key, value.version);
		});
		const factorioVersion = modPack.factorioVersion;

		const latestVersions = await ModStore.getLatestVersions(modNames, factorioVersion);

		let versionChanges = new Map<string, string>();
		for (const modName in latestVersions.keys()) {
			if (!latestVersions.has(modName)) { continue; }

			const latestVersion = latestVersions.get(modName) as string;

			const currentVerScore = integerModVersion(currentVersions.get(modName) as string);
			const latestVerScore = integerModVersion(latestVersion);
			const haveLatestVer = this.files.has(`${modName}_${latestVersion}.zip`);

			if (currentVerScore >= latestVerScore) {
				continue;
			}
			if (modName in ModPack.getBuiltinModNames(modPack.factorioVersion)) {
				continue;
			}
			if (haveLatestVer) {
				versionChanges.set(modName, latestVersion);
			}
		}

		return versionChanges;


	}


	/**
	 * goes through a modpack and updates all it's mods, whether that is switching to a newer version or
	 * downloading a newer version
	 *
	 * @param modPack what modpack to update
	 * @param username factorio username used for auth to download mods
	 * @param token factorio token used for auth to download mods
	 */
	async updateAndDownloadMods(modPack: ModPack, username: string, token: string) {
		const modNames = Array.from(modPack.mods.keys());
		const factorioVersion = modPack.factorioVersion;
		let modLatestVersion = await ModStore.getLatestVersions(modNames, factorioVersion);
		// TODO : change so it returns the changes, rather than change directly
		// get rid of mods from the map where we already are using or have the latest version
		modLatestVersion.forEach((modVersion, modName, map) => {
			const currentVerScore = integerModVersion(modPack.mods.get(modName)?.version as string);
			const latestVerScore = integerModVersion(modVersion);
			const haveLatestVer = this.files.has(`${modName}_${modVersion}.zip`);
			if (currentVerScore >= latestVerScore) {
				map.delete(modName);
				return;
			}
			if (modName in ModPack.getBuiltinModNames(modPack.factorioVersion)) {
				return;
			}
			if (haveLatestVer) {
				let mod = modPack.mods.get(modName) as ModRecord;
				mod.version = modVersion;
				map.delete(modName);
			}

		});

		// download latest version of mods
		await this.downloadMods(modLatestVersion, username, token, factorioVersion);

		// switch mods to use said latest version
		modLatestVersion.forEach((modVersion, modName, _map) => {
			const haveLatestVer = this.files.has(`${modName}_${modVersion}.zip`);
			if (haveLatestVer) {
				let mod = modPack.mods.get(modName) as ModRecord;
				mod.version = modVersion;
			}
		});
	}

}
