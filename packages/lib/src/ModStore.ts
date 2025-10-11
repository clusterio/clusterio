import fs from "fs-extra";
import path from "path";
import events from "events";
import { Static } from "@sinclair/typebox";
import { logger } from "./logging";
import { safeOutputFile } from "./file_ops";
import { Writable } from "stream";
import { ModPortalReleaseSchema, ModPortalDetailsSchema, ModNameVersionPair } from "./data/messages_mod";
import { ModInfo, ModPack, FullVersion, ApiVersion, ModVersionEquality } from "./data";

export interface ModStoreEvents {
	/** A stored mod was created, updated or deleted */
	"change": [ mod: ModInfo ];
}

interface ModsInfoResponse {
	pagination: any,
	results: Array<Static<typeof ModPortalDetailsSchema>>,
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
	results: Static<typeof ModPortalDetailsSchema>[];
}

export default class ModStore extends events.EventEmitter<ModStoreEvents> {
	constructor(
		public modsDirectory: string,
		public files: Map<string, ModInfo>,
	) {
		super();
	}

	getMod(name: string, version: FullVersion, sha1?: string) {
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

	async loadMod(name: string, version: FullVersion) {
		return await this.loadFile(ModInfo.filename(name, version));
	}

	async deleteMod(name: string, version: FullVersion) {
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

	/**
	 * Stream a url's content into a file.
	 *
	 * @param url - Web path to stream from.
	 * @param filePath - File path to stream to.
	 */
	private static async downloadFile(url: string | URL, filePath: string) {
		try {
			const response = await fetch(url);

			if (!response.ok) {
				throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
			}

			if (!response.body) {
				throw new Error("Response body is missing.");
			}

			const fileStream = fs.createWriteStream(filePath);
			const writer = Writable.toWeb(fileStream);
			await response.body.pipeTo(writer);
		} catch (error) {
			logger.error("Error downloading file:", error);
			throw error;
		}
	}

	/**
	 * Download a matching version from a selection of available versions.
	 *
	 * @param releases - Array of mod releases taken from the mod portal.
	 * @param version - The required version to install.
	 * @param username - Factorio username to download using.
	 * @param token - Factorio token to download using.
	 */
	private async downloadModFromReleases(
		releases: Array<Static<typeof ModPortalReleaseSchema>>, version: ModVersionEquality,
		username: string, token: string
	) {
		const selectedRelease = releases.find(release => version.testVersion(release.version));

		if (selectedRelease === undefined) {
			logger.warn(`Mod release matching version ${version} not found.`);
			return;
		}

		try {
			const url = new URL(`https://mods.factorio.com/${selectedRelease.download_url}`);
			url.searchParams.set("username", username);
			url.searchParams.set("token", token);
			const tempFileName = `${this.modsDirectory}/${selectedRelease.file_name}.tmp`;
			const finalFileName = `${this.modsDirectory}/${selectedRelease.file_name}`;

			await ModStore.downloadFile(url, tempFileName);
			await fs.rename(tempFileName, finalFileName);
			await this.loadFile(selectedRelease.file_name);

		} catch (err: any) {
			logger.error(`Failed to download or load mod ${selectedRelease.file_name} (${version}): ${err.message}`);
			// Attempt to clean up temp file if it exists
			try {
				const tempFileName = `${this.modsDirectory}/${selectedRelease.file_name}.tmp`;
				await fs.unlink(tempFileName);
			} catch (unlinkErr: any) {
				if (unlinkErr.code !== "ENOENT") { // Ignore if file doesn't exist
					logger.warn(`Failed to clean up temp file ${selectedRelease.file_name}.tmp: ${unlinkErr.message}`);
				}
			}
		}
	}

	/**
	 * Downloads all provided mods, does not perform chunking or filtering of builtins
	 *
	 * @param mods - An array of mods to download
	 * @param username - Factorio username used for auth to download mods
	 * @param token - Factorio token used for auth to download mods
	 * @param factorioVersion - Factorio version to filter for (mods are not guaranteed to work between Middle versions)
	 */
	private async downloadModsChunk(
		mods: ModNameVersionPair[],
		username: string, token: string,
		factorioVersion: ApiVersion,
	) {
		const url = new URL("https://mods.factorio.com/api/mods");
		url.searchParams.set("page_size", "max");
		url.searchParams.set("version", factorioVersion);
		const response = await fetch(url, {
			method: "POST",
			body: new URLSearchParams({ namelist: mods.map(m => m.name).join(",") }),
		});

		if (response.status !== 200) {
			throw Error(`Fetch: ${url} returned ${response.status} ${response.statusText}`);
		}

		const modReleases = (await response.json() as ModsInfoResponse).results;
		await Promise.all(modReleases.map((mod) => {
			const modVersion = mods.find(m => m.name === mod.name)!.version;
			if (mod.releases) {
				return this.downloadModFromReleases(mod.releases, modVersion, username, token);
			} else if (mod.latest_release) {
				return this.downloadModFromReleases([mod.latest_release], modVersion, username, token);
			}
			throw new Error(`Mod ${mod.name} has no releases or latest_release`);
		}));
	}

	/**
	 * Downloads all provided mods to the mod dir.
	 *
	 * Handles chunking to prevent errors due to URL length.
	 * Will re-download if mod is already present, if this is undesired use filterInstalled first.
	 *
	 * @param mods - An array of mods to download.
	 * @param username - Factorio username used for auth to download mods.
	 * @param token - Factorio token used for auth to download mods.
	 * @param factorioVersion - Factorio version to filter for (mods are not guaranteed to work between Middle versions)
	 */
	async downloadMods(
		mods: ModNameVersionPair[], username: string, token: string, factorioVersion: ApiVersion = "1.1"
	) {
		const chunkSize = 500;
		const futures: Promise<void>[] = [];
		const builtInMods = new Set(ModPack.getBuiltinModNames(factorioVersion));
		mods = mods.filter(mod => !(builtInMods.has(mod.name) || mod.name === "core"));

		for (let i = 0; i < mods.length; i += chunkSize) {
			futures.push(
				this.downloadModsChunk(mods.slice(i, i + chunkSize), username, token, factorioVersion)
			);
		}

		await Promise.all(futures);
	}

	/**
	 * Filter an array of mods based on if they are installed.
	 *
	 * @param mods - Array of mods to filer.
	 * @param installed - `true` to keep installed mods, `false` to keep uninstalled mods.
	 * @returns Filtered array of mods based on install state.
	 */
	filterInstalled(mods: ModNameVersionPair[], installed: boolean) {
		const installedMods = Array.from(this.mods());
		return mods.filter(mod => (
			installed === installedMods.some(m => mod.name === m.name && mod.version.testVersion(m.version))
		));
	}

	/**
	 * Fetch all mods from the Factorio Mod Portal for a specific Factorio version.
	 *
	 * Handles pagination automatically to retrieve the complete list.
	 *
	 * @param factorioVersion - The Factorio version to fetch mods for (e.g., "1.1").
	 * @param pageSize - The page size for fetching mods.
	 * @param hide_deprecated - Whether to exclude deprecated mods.
	 * @returns An array of mod details.
	 */
	static async fetchAllModsFromPortal(
		factorioVersion: string,
		pageSize: number,
		hide_deprecated: boolean = false
	): Promise<Static<typeof ModPortalDetailsSchema>[]> {
		logger.info(`Fetching all mods for Factorio version ${factorioVersion}...`);
		let currentPage = 1;
		let allMods: Static<typeof ModPortalDetailsSchema>[] = [];
		let hasMorePages = true;

		while (hasMorePages) {
			const url = new URL("https://mods.factorio.com/api/mods");
			url.searchParams.set("page_size", String(pageSize));
			url.searchParams.set("version", factorioVersion);
			url.searchParams.set("page", String(currentPage));
			url.searchParams.set("hide_deprecated", String(hide_deprecated));

			logger.verbose(`Fetching mod portal page ${currentPage}: ${url.toString()}`);
			const response = await fetch(url.toString());

			if (!response.ok) {
				let errorMessage = `Mod portal fetch page ${currentPage} failed: `;
				errorMessage += `${response.status} ${response.statusText}`;
				try {
					errorMessage += ` - ${await response.text()}`;
				} catch (bodyError) {
					logger.warn("Failed to read response body for failed portal request");
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

	/**
	 * Fetch the full release list for a mod including dependencies.
	 *
	 * @param modName - Name of the mod to fetch the releases of
	 * @returns Mod portal response
	 */
	static async fetchModReleases(modName: string) {
		const url = `https://mods.factorio.com/api/mods/${modName}/full`;
		const response = await fetch(url);
		if (!response.ok) {
			throw Error(`Fetch: ${url} returned ${response.status} ${response.statusText}`);
		}
		return await response.json() as ModsInfoResponse["results"][number];
	}
}
