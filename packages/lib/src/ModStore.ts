import fs from "fs-extra";
import path from "path";
import { Static } from "@sinclair/typebox";
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
	releases?: Array<ModRelease>,
	latest_release?: ModRelease,
}

interface ModsInfoResponse {
	pagination: any,
	results: Array<ModDetails>,
}

/**
 * Interface describing the structure of the pagination info from the portal API
 */
interface ModPortalPagination {
	count: number;
	links: { next?: string; prev?: string; };
	page: number;
	page_count: number;
	page_size: number;
}

/**
 * Interface describing the structure of the portal API response for a single page
 */
interface ModPortalResponse {
	pagination: ModPortalPagination;
	results: ModDetails[];
}

const MOD_PORTAL_API_URL = "https://mods.factorio.com/api/mods";
const MOD_PORTAL_MAX_PAGE_SIZE = 1000; // Or largest allowed by API

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
		this.addMod(modInfo);
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

	private async downloadModFromReleases(releases: Array<ModRelease>, version: string,
		username: string, token: string
	) {
		if (releases.length === 0) { return; }

		const latestRelease = releases.find(release => release.version === version);

		if (latestRelease === undefined) {
			logger.warn(`Mod release matching version ${version} not found.`);
			return;
		}

		try {
			const url = new URL(`https://mods.factorio.com/${latestRelease.download_url}`);
			url.searchParams.set("username", username);
			url.searchParams.set("token", token);
			const tempFileName = `${this.modsDirectory}/${latestRelease.file_name}.tmp`;
			const finalFileName = `${this.modsDirectory}/${latestRelease.file_name}`;

			await ModStore.downloadFile(url, tempFileName);
			await fs.rename(tempFileName, finalFileName);
			await this.loadFile(latestRelease.file_name);

		} catch (err: any) {
			logger.error(`Failed to download or load mod ${latestRelease.file_name} (${version}): ${err.message}`);
			// Attempt to clean up temp file if it exists
			try {
				const tempFileName = `${this.modsDirectory}/${latestRelease.file_name}.tmp`;
				await fs.unlink(tempFileName);
			} catch (unlinkErr: any) {
				if (unlinkErr.code !== "ENOENT") { // Ignore if file doesn't exist
					logger.warn(`Failed to clean up temp file ${latestRelease.file_name}.tmp: ${unlinkErr.message}`);
				}
			}
		}
	}

	private async downloadModsChunk(
		modNames: string[], modVersions: string[], username: string, token: string, factorioVersion: string
	) {
		const url = new URL("https://mods.factorio.com/api/mods");
		url.searchParams.set("page_size", "max");
		url.searchParams.set("version", factorioVersion);
		const response = await fetch(url, {
			method: "POST",
			body: new URLSearchParams({ namelist: modNames.join(",") }),
		});
		if (response.status !== 200) {
			throw Error(`Fetch: ${url} returned ${response.status} ${response.statusText}`);
		}
		const mods = (await response.json() as ModsInfoResponse).results;

		await Promise.all(mods.map((mod) => {
			if (mod.releases) {
				return this.downloadModFromReleases(mod.releases,
					modVersions[modNames.indexOf(mod.name)], username, token);
			} else if (mod.latest_release) {
				return this.downloadModFromReleases([mod.latest_release],
					modVersions[modNames.indexOf(mod.name)], username, token);
			}
			throw new Error(`Mod ${mod.name} has no releases or latest_release`);
		}));
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

		// Truncate factorioVersion to major.minor (e.g., "1.1.100" -> "1.1") for API/builtin checks
		const versionParts = factorioVersion.split(".");
		if (versionParts.length > 2) {
			factorioVersion = versionParts.slice(0, 2).join(".");
		}

		const builtInMods = new Set(ModPack.getBuiltinModNames(factorioVersion));

		// get rid of mods already downloaded, built-in, or core
		modMap.forEach((modVersion, modName, map) => {
			const filename = `${modName}_${modVersion}.zip`;
			// Filter existing, built-in from getBuiltinModNames, and explicitly filter "core"
			if (this.files.has(filename) || builtInMods.has(modName) || modName === "core") {
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

	/**
	 * Fetch all mods from the Factorio Mod Portal for a specific Factorio version.
	 *
	 * Handles pagination automatically to retrieve the complete list.
	 *
	 * @param factorioVersion - The Factorio version to fetch mods for (e.g., "1.1").
	 * @param hide_deprecated - Whether to exclude deprecated mods.
	 * @returns An array of mod details.
	 */
	static async fetchAllModsFromPortal(
		factorioVersion: string,
		hide_deprecated: boolean = false
	): Promise<ModDetails[]> {
		logger.info(`Fetching all mods for Factorio version ${factorioVersion}...`);
		let currentPage = 1;
		let allMods: ModDetails[] = [];
		let hasMorePages = true;

		while (hasMorePages) {
			const url = new URL(MOD_PORTAL_API_URL);
			url.searchParams.set("page_size", String(MOD_PORTAL_MAX_PAGE_SIZE));
			url.searchParams.set("version", factorioVersion);
			url.searchParams.set("page", String(currentPage));
			url.searchParams.set("hide_deprecated", String(hide_deprecated));

			logger.verbose(`Fetching mod portal page ${currentPage}: ${url.toString()}`);
			const response = await fetch(url.toString());

			if (!response.ok) {
				let errorDetail = "";
				try {
					errorDetail = await response.text();
				} catch (bodyError) {
					logger.warn("Failed to read response body for failed portal request");
				}
				let errorMessage = `Mod portal fetch page ${currentPage} failed: `;
				errorMessage += `${response.status} ${response.statusText}`;
				if (errorDetail) {
					errorMessage += ` - ${errorDetail}`;
				}
				throw new Error(errorMessage);
			}

			const data = await response.json() as ModPortalResponse;
			allMods = allMods.concat(data.results);

			hasMorePages = currentPage < data.pagination.page_count;
			currentPage += 1;
		}
		logger.info(`Successfully fetched ${allMods.length} mods for Factorio version ${factorioVersion}.`);
		return allMods;
	}
}
