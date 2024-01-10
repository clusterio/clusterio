import fs from "fs-extra";
import path from "path";
import { logger } from "./logging";
import { ModInfo } from "./data";
import TypedEventEmitter from "./TypedEventEmitter";

export interface ModStoreEvents {
	/** A stored mod was created, updated or deleted */
	change: (mod: ModInfo) => void;
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
		modInfo.updatedAt = Date.now();
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
		const files = new Map<string, ModInfo>();
		for (let entry of await fs.readdir(modsDirectory, { withFileTypes: true })) {
			if (entry.isDirectory()) {
				logger.warn(`Ignoring ${entry.name}${path.sep} in mods directory.`);
				continue;
			}

			if (entry.name.toLowerCase().endsWith(".tmp.zip")) {
				continue;
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

		return new this(modsDirectory, files);
	}
}
