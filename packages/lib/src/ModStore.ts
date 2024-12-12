import fs from "fs-extra";
import path from "path";
import { Static, StringContentEncodingOption, Type } from "@sinclair/typebox";
import { logger } from "./logging";
import { ModInfo } from "./data";
import * as libSchema from "./schema";
import TypedEventEmitter from "./TypedEventEmitter";
import { safeOutputFile } from "./file_ops";

export interface ModStoreEvents {
	/** A stored mod was created, updated or deleted */
	change: (mod: ModInfo) => void;
}

interface ModRelease {
	download_url: string,
	// /download/maraxsis/670de301df21001f6147fd1c -- append to mods.factorio.com to download file, auth required
	file_name: string,
	// maraxsis_1.8.0.zip -- the file name of the downloaded file ^^
	info_json: {
		dependencies?: Array<string>,
		factorio_version: string;
	};
	released_at: string,
	// 2024-10-15T03:35:29.892000Z -- (ISO 8601)
	sha1: string,
	// e227ee560d93485c7f215c9451eaa9cc38d81c98
	version: string; // 1.8.0 -- just a normal version string
}

interface ModImage {
	id: string,
	thumbnail: string,
	url: string;
}

interface ModLicense {
	description: string,
	id: string,
	name: string,
	title: string,
	url: string;
}

interface ModDetails {
	category: string, // content -- what mod catogory is this apart of, a mod can only be apart of 1 category
	download_count: number, // 3653 -- how many downloads does the mod have as a number
	name: string, // maraxsis -- the name of the mod
	owner: string, // notnotmelon -- the name of the author of the mod
	releases: Array<ModRelease>, // an array of all releases and version of the mod
	score: number, // 1054.8333333333333 -- it's prob used for sorting purposes
	summary: string, // the mod description
	thumbnail: string, // append path to assets-mods.factorio.com to get full url to thumbnail file
	title: string, // the full title of the mod, shown on the mod page
	changelog?: string,
	created_at?: string,
	description?: string,
	homepage?: string,
	images?: Array<ModImage>,
	license?: ModLicense,
	source_url?: string,
	tags?: Array<string>,
	updated_at?: string,
	deprecated?: boolean;
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

	// gets the latest version of the mod provided as a string
	static async fetchLatestVersionString(modName: string): Promise<string> {
		const modDetails: ModDetails = await (
			await fetch(`https://mods.factorio.com/api/mods/${modName}`)
		).json() as ModDetails;
		return modDetails.releases[modDetails.releases.length].version;
	}

	// gets the latest version of the mod provided as a string
	static async fetchLatestVersionModInfo(modName: string): Promise<ModInfo> {
		const modDetails: ModDetails = await (
			await fetch(`https://mods.factorio.com/api/mods/${modName}/full`)
		).json() as ModDetails;
		const latestRelease: ModRelease = modDetails.releases[modDetails.releases.length];
		let modInfo = new ModInfo();
		const info_json = latestRelease.info_json;

		// info.json fields
		if (modDetails.name) { modInfo.name = modDetails.name; }
		if (latestRelease.version) { modInfo.version = latestRelease.version; }
		if (modDetails.title) { modInfo.title = modDetails.title; }
		if (modDetails.owner) { modInfo.author = modDetails.owner; }
		if (modDetails.homepage) { modInfo.homepage = modDetails.homepage; }
		if (modDetails.description) { modInfo.description = modDetails.description; }
		if (info_json.factorio_version) { modInfo.factorioVersion = info_json.factorio_version; }
		if (info_json.dependencies) { modInfo.dependencies = info_json.dependencies; }

		const infoJsonSchema = Type.Object({
			"name": Type.String(),
			"version": Type.String(),
			"title": Type.String(),
			"author": Type.String(),
			"contact": Type.Optional(Type.String()),
			"homepage": Type.Optional(Type.String()),
			"description": Type.Optional(Type.String()),
			"factorio_version": Type.Optional(Type.String()),
			"dependencies": Type.Optional(Type.Array(Type.String())),
		});

		const validateInfo = libSchema.compile<Static<typeof infoJsonSchema>>(infoJsonSchema as any);

		const valid = validateInfo(modInfo);

		if (valid) {
			return modInfo;
		}

		return modInfo;

	}
}
