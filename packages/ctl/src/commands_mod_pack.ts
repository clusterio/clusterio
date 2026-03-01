import asTableModule from "as-table";

import * as lib from "@clusterio/lib";
import { logger } from "@clusterio/lib";
import type { Control } from "../ctl";
import { print } from "./command_ops";

const asTable = asTableModule.configure({ delimiter: " | " });

export const modPackCommands = new lib.CommandTree({ name: "mod-pack", description: "Mod Pack" });
modPackCommands.add(new lib.Command({
	definition: ["show <mod-pack>", "Show details of mod pack", (yargs) => {
		yargs.positional("mod-pack", { describe: "Mod pack to show", type: "string" });
	}],
	handler: async function(args: { modPack: string }, control: Control) {
		let mods = new Map(
			(await control.send(new lib.ModListRequest())).map(m => [m.id, m])
		);
		let modPack = await control.send(
			new lib.ModPackGetRequest(await lib.resolveModPack(control, args.modPack))
		);

		for (let [field, value] of Object.entries(modPack)) {
			if (field === "mods") {
				print(`${field}:`);
				for (let [name, entry] of value) {
					const mod = mods.get(`${name}_${entry.version}`);
					const missing = !mod && "? ";
					const badChecksum = mod && entry.sha1 && entry.sha1 !== mod.sha1 && "! ";
					const warn = missing || badChecksum || "";
					const enabled = entry.enabled ? "" : "(disabled) ";
					print(`  ${warn}${enabled}${name} ${entry.version}${entry.sha1 ? ` (${entry.sha1})` : ""}`);
				}
			} else if (field === "settings") {
				print(`${field}:`);
				for (let [scope, settings] of Object.entries(value)) {
					print(`  ${scope}:`);
					for (let [setting, settingValue] of settings as any) {
						print(`    ${setting}: ${JSON.stringify(settingValue.value)}`);
					}
				}
			} else if (field === "exportManifest") {
				print(`${field}:`);
				if (value && value.assets) {
					print("  assets:");
					for (let [name, fileName] of Object.entries(value.assets)) {
						print(`    ${name}: ${fileName}`);
					}
				}

			} else {
				print(`${field}: ${value}`);
			}
		}
	},
}));

modPackCommands.add(new lib.Command({
	definition: [["list", "l"], "List mod packs in the cluster"],
	handler: async function(args: object, control: Control) {
		let modPacks = await control.send(new lib.ModPackListRequest());
		let fields = ["id", "name", "factorioVersion"];
		for (let entry of modPacks) {
			for (let field of Object.keys(entry)) {
				if (!fields.includes(field)) {
					// @ts-expect-error terrible hack
					delete entry[field];
				}
			}
		}
		print(asTable(modPacks));
	},
}));

function setModPackSettings(
	modPack: lib.ModPack,
	args: {
		boolSetting?: string[],
		intSetting?: string[],
		doubleSetting?: string[],
		stringSetting?: string[],
		colorSetting?: string[],
	},
) {
	function doSettings(settings: string[], cast: (value: string) => (string | number | boolean)) {
		for (let i = 0; i + 2 < settings.length; i += 3) {
			const [scope, name, value] = settings.slice(i, i + 3);
			if (!["startup", "runtime-global", "runtime-per-user"].includes(scope)) {
				throw new lib.CommandError(
					`Setting scope must be one of startup, runtime-gloabl, or runtime-per-user, not ${scope}`
				);
			}
			const checkedScope = scope as "startup" | "runtime-global" | "runtime-per-user";
			modPack.settings[checkedScope].set(name, { value: cast(value) });
		}
	}

	doSettings(args.boolSetting || [], value => {
		if (!["true", "false"].includes(value)) {
			throw new lib.CommandError(`boolean value must be one of true or false, not ${value}`);
		}
		return value === "true";
	});
	doSettings(args.intSetting || [], value => {
		// eslint-disable-next-line radix
		let number = Number.parseInt(value);
		if (isNaN(number)) {
			throw new lib.CommandError(`int value must be an integer, not ${value}`);
		}
		return number;
	});
	doSettings(args.doubleSetting || [], value => {
		let number = Number.parseFloat(value);
		if (isNaN(number)) {
			throw new lib.CommandError(`double value must be a number, not ${value}`);
		}
		return number;
	});
	doSettings(args.stringSetting || [], value => value);
	doSettings(args.colorSetting || [], value => {
		let color = JSON.parse(value);
		if (typeof color !== "object" || color === null) {
			throw new lib.CommandError("color value must be a JSON object with r, g, b, a properties");
		}
		return color;
	});
}

function setModPackMods(modPack: lib.ModPack, mods: string[] | undefined) {
	for (let mod of mods || []) {
		const [name, version, sha1] = mod.split(":");
		if (!version) {
			throw new lib.CommandError("Added mod must be formatted as name:version or name:version:sha1");
		}
		if (!lib.isFullVersion(version)) {
			throw new lib.CommandError("version must match the format digit.digit.digit");
		}
		if (sha1 && !/^[0-9a-f]{40}$/.test(sha1)) {
			throw new lib.CommandError("sha1 must be a 40 digit lower case hex string");
		}
		modPack.mods.set(name, { name, enabled: true, version, sha1 });
	}
}

function setModPackModsEnabled(modPack: lib.ModPack, mods: string[] | undefined, enabled: boolean) {
	for (let mod of mods || []) {
		if (!modPack.mods.has(mod)) {
			throw new lib.CommandError(`Mod named ${mod} does not exist in the mod pack`);
		}
		modPack.mods.get(mod)!.enabled = enabled;
	}
}

modPackCommands.add(new lib.Command({
	definition: ["create <name> <factorio-version>", "Create mod pack", (yargs) => {
		yargs.positional("name", { describe: "Name of mod pack to create", type: "string" });
		yargs.positional("factorio-version", { describe: "Version of factorio the mod pack is for", type: "string" });
		yargs.options({
			"description": { describe: "Description for mod pack", type: "string" },
			"mods": { describe: "Mods in the form of name:version[:sha1]", array: true, type: "string" },
			"disabled-mods": { describe: "Mods that are in the pack but not enabled", array: true, type: "string" },
			"bool-setting": { describe: "Set boolean setting", array: true, nargs: 3, type: "string" },
			"int-setting": { describe: "Set int setting", array: true, nargs: 3, type: "string" },
			"double-setting": { describe: "Set double setting", array: true, nargs: 3, type: "string" },
			"string-setting": { describe: "Set string setting", array: true, nargs: 3, type: "string" },
			"color-setting": { describe: "Set color setting", array: true, nargs: 3, type: "string" },
		});
	}],
	handler: async function(
		args: {
			name: string,
			factorioVersion: string,
			description?: string,
			mods?: string[],
			disabledMods?: string[],
			boolSetting?: string[],
			intSetting?: string[],
			doubleSetting?: string[],
			stringSetting?: string[],
			colorSetting?: string[],
		},
		control: Control,
	) {
		const modPack = new lib.ModPack();
		modPack.name = args.name;
		if (args.description) { modPack.description = args.description; }
		if (args.factorioVersion) {
			if (!lib.isPartialVersion(args.factorioVersion)) {
				throw new lib.CommandError("factorio-version must match the format digit.digit[.digit]");
			}
			modPack.factorioVersion = args.factorioVersion;
		}
		setModPackMods(modPack, args.mods);
		setModPackModsEnabled(modPack, args.disabledMods, false);
		setModPackSettings(modPack, args);
		await control.send(new lib.ModPackCreateRequest(modPack));
		print(`Created mod pack ${modPack.name} (${modPack.id})`);
	},
}));

modPackCommands.add(new lib.Command({
	definition: ["import <string>", "Import mod pack string", (yargs) => {
		yargs.positional("string", { describe: "Mod pack string to import", type: "string" });
	}],
	handler: async function(args: { string: string }, control: Control) {
		const modPack = lib.ModPack.fromModPackString(args.string);
		await control.send(new lib.ModPackCreateRequest(modPack));
		print(`Created mod pack ${modPack.name} (${modPack.id})`);
	},
}));

modPackCommands.add(new lib.Command({
	definition: ["export <mod-pack>", "Export mod pack string", (yargs) => {
		yargs.positional("string", { describe: "Mod pack to export", type: "string" });
	}],
	handler: async function(args: { modPack: string }, control: Control) {
		const modPack = await control.send(
			new lib.ModPackGetRequest(await lib.resolveModPack(control, args.modPack))
		);
		print(modPack.toModPackString());
	},
}));

modPackCommands.add(new lib.Command({
	definition: ["edit <mod-pack>", "Edit mod pack", (yargs) => {
		yargs.positional("mod-pack", { describe: "Mod pack to remove from", type: "string" });
		yargs.options({
			"name": { describe: "New name for mod pack", type: "string" },
			"description": { describe: "New description for mod pack", type: "string" },
			"factorio-version": { describe: "Set version of factorio the mod pack is for", type: "string" },
			"add-mods": { describe: "Mods in the form of name:version[:sha1] to add", array: true, type: "string" },
			"enable-mods": { describe: "Mods to set as enabled", array: true, type: "string" },
			"disable-mods": { describe: "Mods to set as disabled", array: true, type: "string" },
			"remove-mods": { describe: "Name of mods to remove", array: true, type: "string" },
			"bool-setting": { describe: "Set boolean setting", array: true, nargs: 3, type: "string" },
			"int-setting": { describe: "Set int setting", array: true, nargs: 3, type: "string" },
			"double-setting": { describe: "Set double setting", array: true, nargs: 3, type: "string" },
			"string-setting": { describe: "Set string setting", array: true, nargs: 3, type: "string" },
			"color-setting": { describe: "Set color setting", array: true, nargs: 3, type: "string" },
			"remove-setting": { describe: "Remove a setting", array: true, nargs: 2, type: "string" },
		});
	}],
	handler: async function(
		args: {
			modPack: string,
			name?: string,
			description?: string,
			factorioVersion?: string,
			addMods?: string[],
			enableMods?: string[],
			disableMods?: string[],
			removeMods?: string[],
			boolSetting?: string[],
			intSetting?: string[],
			doubleSetting?: string[],
			stringSetting?: string[],
			colorSetting?: string[],
			removeSetting?: string[],
		},
		control: Control,
	) {
		const modPack = await control.send(
			new lib.ModPackGetRequest(await lib.resolveModPack(control, args.modPack))
		);

		if (args.name) { modPack.name = args.name; }
		if (args.description) { modPack.description = args.description; }
		if (args.factorioVersion) {
			if (!lib.isPartialVersion(args.factorioVersion)) {
				throw new lib.CommandError("factorio-version must match the format digit.digit[.digit]");
			}
			modPack.factorioVersion = args.factorioVersion;
		}

		setModPackMods(modPack, args.addMods);
		for (let name of args.removeMods || []) {
			if (modPack.mods.has(name)) {
				modPack.mods.delete(name);
			} else {
				logger.warn(`Mod ${name} did not exist on ${modPack.name}`);
			}
		}
		setModPackModsEnabled(modPack, args.disableMods, false);
		setModPackModsEnabled(modPack, args.enableMods, true);

		setModPackSettings(modPack, args);
		if (args.removeSetting) {
			for (let i = 0; i + 1 < args.removeSetting.length; i += 2) {
				const [scope, name] = args.removeSetting.slice(i, i + 2);
				if (!["startup", "runtime-global", "runtime-per-user"].includes(scope)) {
					throw new lib.CommandError(
						`Setting scope must be one of startup, runtime-gloabl, or runtime-per-user, not ${scope}`
					);
				}
				const checkedScope = scope as "startup" | "runtime-global" | "runtime-per-user";
				if (modPack.settings[checkedScope].has(name)) {
					modPack.settings[checkedScope].delete(name);
				} else {
					logger.warn(`Mod setting ${scope} ${name} did not exist on ${modPack.name}`);
				}
			}
		}
		await control.send(new lib.ModPackUpdateRequest(modPack));
	},
}));

modPackCommands.add(new lib.Command({
	definition: ["delete <mod-pack>", "Delete mod pack", (yargs) => {
		yargs.positional("mod-pack", { describe: "Mod pack to delete", type: "string" });
	}],
	handler: async function(args: { modPack: string }, control: Control) {
		const id = await lib.resolveModPack(control, args.modPack);
		await control.send(new lib.ModPackDeleteRequest(id));
	},
}));
