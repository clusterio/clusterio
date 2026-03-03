import fs from "fs-extra";
import asTableModule from "as-table";
import events from "events";
import path from "path";
import phin from "phin";
import os from "os";
import child_process from "child_process";
import stream from "stream";
import util from "util";

import * as lib from "@clusterio/lib";
import { logger } from "@clusterio/lib";
import type { Control } from "../ctl";
import { print } from "./command_ops";
import { serializedConfigToString, getEditor, configToKeyVal } from "./config_ops";

const asTable = asTableModule.configure({ delimiter: " | " });
const finished = util.promisify(stream.finished);

export const instanceCommands = new lib.CommandTree({
	name: "instance", alias: ["i"], description: "Instance management",
});
instanceCommands.add(new lib.Command({
	definition: [["list", "l"], "List instances known to the controller"],
	handler: async function(args: object, control: Control) {
		let list = await control.send(new lib.InstanceDetailsListRequest());
		print(asTable(list));
	},
}));

instanceCommands.add(new lib.Command({
	definition: ["create <name>", "Create an instance", (yargs) => {
		// XXX TODO: set any specific options?
		yargs.positional("name", { describe: "Instance name", type: "string" });
		yargs.options({
			"id": { type: "number", nargs: 1, describe: "Instance id" },
			"from": { type: "number", nargs: 1, describe: "Clone config from instance id" },
		});
	}],
	handler: async function(args: { name: string, id?: number, from?: number, }, control: Control) {
		let instanceConfig = new lib.InstanceConfig("control");
		if (args.id !== undefined) {
			instanceConfig.set("instance.id", args.id);
		}
		instanceConfig.set("instance.name", args.name);
		await control.send(new lib.InstanceCreateRequest(
			instanceConfig.toRemote("controller", [
				"instance.id", "instance.name",
			]),
			args.from
		));
	},
}));

const instanceConfigCommands = new lib.CommandTree({
	name: "config", alias: ["c"], description: "Instance config management",
});
instanceConfigCommands.add(new lib.Command({
	definition: ["list <instance>", "List configuration for an instance", (yargs) => {
		yargs.positional("instance", { describe: "Instance to list config for", type: "string" });
	}],
	handler: async function(args: { instance: string }, control: Control) {
		let instanceId = await lib.resolveInstance(control, args.instance);
		let config = await control.send(new lib.InstanceConfigGetRequest(instanceId));

		for (let [name, value] of Object.entries(config)) {
			print(`${name} ${JSON.stringify(value)}`);
		}
	},
}));

instanceConfigCommands.add(new lib.Command({
	definition: ["set <instance> <field> [value]", "Set field in instance config", (yargs) => {
		yargs.positional("instance", { describe: "Instance to set config on", type: "string" });
		yargs.positional("field", { describe: "Field to set", type: "string" });
		yargs.positional("value", { describe: "Value to set", type: "string" });
		yargs.options({
			"stdin": { describe: "read value from stdin", nargs: 0, type: "boolean" },
		});
	}],
	handler: async function(
		args: { instance: string, field: string, value?: string, stdin?: boolean },
		control: Control,
	) {
		let instanceId = await lib.resolveInstance(control, args.instance);
		if (args.stdin) {
			args.value = (await lib.readStream(process.stdin)).toString().replace(/\r?\n$/, "");
		} else if (args.value === undefined) {
			args.value = "";
		}
		await control.send(new lib.InstanceConfigSetFieldRequest(instanceId, args.field, args.value));
	},
}));

instanceConfigCommands.add(new lib.Command({
	definition: ["set-prop <instance> <field> <prop> [value]", "Set property of field in instance config", (yargs) => {
		yargs.positional("instance", { describe: "Instance to set config on", type: "string" });
		yargs.positional("field", { describe: "Field to set", type: "string" });
		yargs.positional("prop", { describe: "Property to set", type: "string" });
		yargs.positional("value", { describe: "JSON parsed value to set", type: "string" });
		yargs.options({
			"stdin": { describe: "read value from stdin", nargs: 0, type: "boolean" },
		});
	}],
	handler: async function(
		args: { instance: string, field: string, prop: string, value?: string, stdin?: boolean },
		control: Control
	) {
		let instanceId = await lib.resolveInstance(control, args.instance);
		if (args.stdin) {
			args.value = (await lib.readStream(process.stdin)).toString().replace(/\r?\n$/, "");
		}
		let value;
		try {
			if (args.value !== undefined) {
				value = JSON.parse(args.value);
			}
		} catch (err: any) {
			// If this is from stdin or looks like an array, object or string
			// literal throw the parse error, otherwise assume this is a string.
			// The resoning behind this is that correctly quoting the string
			// with the all the layers of quote removal at play is difficult.
			// See the following table for how to pass "That's a \" quote" in
			// different environments:
			// ----------------------- WARNING -------------------------------
			// This table is most likely invalid due a change in yargs parsing
			// ---------------------------------------------------------------
			// cmd              : """""That's a \\"" quote"""""
			// cmd + npx        : """""""""""That's a \\\\"""" quote"""""""""""
			// PowerShell       : '"""""That''s a \\"" quote"""""'
			// PowerShell + npx : '"""""""""""That''s a \\\\"""" quote"""""""""""'
			// bash             : '""That'\''s a \" quote""'
			// bash + npx       : '""That'\''s a \" quote""'
			// bash + npx -s sh : "'\"\"That'\\''s a \\\" quote\"\"'"
			if (args.stdin || /^(\[.*]|{.*}|".*")$/.test(args.value!)) {
				throw new lib.CommandError(`In parsing value '${args.value}': ${err.message}`);
			}
			value = args.value;
		}
		await control.send(new lib.InstanceConfigSetPropRequest(instanceId, args.field, args.prop, value));
	},
}));

instanceConfigCommands.add(new lib.Command({
	definition: ["edit <instance> [editor]", "Edit instance configuration", (yargs) => {
		yargs.positional("instance", { describe: "Instance to set config on", type: "string" });
		yargs.positional("editor", {
			describe: "Editor to use",
			type: "string",
			default: "",
		});
	}],
	handler: async function(args: { instance: string, editor: string }, control: Control) {
		let instanceId = await lib.resolveInstance(control, args.instance);
		let config = await control.send(new lib.InstanceConfigGetRequest(instanceId));
		let tmpFile = await lib.getTempFile("ctl-", "-tmp", os.tmpdir());
		let editor = await getEditor(args.editor);
		if (editor === undefined) {
			throw new lib.CommandError(`No editor avalible. Checked CLI input, EDITOR and VISUAL env vars
							  Try "ctl controller config edit <editor of choice>"`);
		}
		let disallowedList = {"instance.id": 0, "instance.assigned_host": 0, "factorio.settings": 0};
		let allConfigElements = serializedConfigToString(
			config,
			lib.InstanceConfig,
			disallowedList
		);
		await fs.writeFile(tmpFile, allConfigElements);
		let editorSpawn = child_process.spawn(editor, [tmpFile], {
			stdio: "inherit",
			detached: false,
		});
		editorSpawn.on("data", (data) => {
			process.stdout.pipe(data);
		});
		await events.once(editorSpawn, "exit");
		const data = await fs.readFile(tmpFile, "utf8");
		const final = await configToKeyVal(data);
		for (let index in final) {
			if (index in final) {
				try {
					await control.send(new lib.InstanceConfigSetFieldRequest(
						instanceId,
						index,
						final[index],
					));
				} catch (err) {
					// eslint-disable-next-line
					print(`\n\n\nAttempt to set ${index} to ${final[index] || String(null)} failed; set back to previous value.`);
					// If the string is empty, it's better to just print "" instead of nothing
					print("This message shouldn't normally appear; if the below message does not indicate it");
					print("was a user mistake, please report it to the clustorio devs.");
					// added this because it could be a missed entry in disallowedList
					// i've added all the vanilla clustorio configs, but there may be
					// some modded ones that need to be added.
					print(err);
				}
			}
		}
		try {
			await fs.unlink(tmpFile);
		} catch (err) {
			print("err: temporary file", tmpFile, "could not be deleted.");
			print("This is not fatal, but they may build up over time if the issue persists.");
		}
	},
}));
instanceCommands.add(instanceConfigCommands);

instanceCommands.add(new lib.Command({
	definition: ["assign <instance> [host]", "Assign instance to a host", (yargs) => {
		yargs.positional("instance", { describe: "Instance to assign", type: "string" });
		yargs.positional("host", { describe: "Host to assign to or unassign if none", type: "string" });
	}],
	handler: async function(args: { instance: string, host?: string }, control: Control) {
		let instanceId = await lib.resolveInstance(control, args.instance);
		let hostId = args.host ? await lib.resolveHost(control, args.host) : undefined;
		await control.send(new lib.InstanceAssignRequest(instanceId, hostId));
	},
}));

async function loadMapSettings(
	args: { seed?: number, mapExchangeString?: string, mapGenSettings?: string, mapSettings?: string},
) {
	let seed = args.seed;
	let mapGenSettings;
	let mapSettings;
	if (args.mapExchangeString) {
		let parsed = lib.readMapExchangeString(args.mapExchangeString);
		mapGenSettings = parsed.map_gen_settings;
		mapSettings = parsed.map_settings;
	}
	if (args.mapGenSettings) {
		mapGenSettings = JSON.parse((await fs.readFile(args.mapGenSettings)).toString());
	}
	if (args.mapSettings) {
		mapSettings = JSON.parse((await fs.readFile(args.mapSettings)).toString());
	}

	return {
		seed,
		mapGenSettings,
		mapSettings,
	};
}

const instanceSaveCommands = new lib.CommandTree({
	name: "save", alias: ["s"], description: "Instance save management",
});
instanceSaveCommands.add(new lib.Command({
	definition: ["list <instance>", "list saves on an instance", (yargs) => {
		yargs.positional("instance", { describe: "Instance to list saves on", type: "string" });
	}],
	handler: async function(args: { instance: string }, control: Control) {
		let instanceId = await lib.resolveInstance(control, args.instance);
		let saves = await control.sendTo("controller", new lib.InstanceSaveDetailsListRequest());
		saves = saves.filter(save => save.instanceId === instanceId);
		print(asTable(saves.map(
			({ mtimeMs, ...rest }) => ({ ...rest, mtime: new Date(mtimeMs).toLocaleString() })
		)));
	},
}));

instanceSaveCommands.add(new lib.Command({
	definition: ["create <instance> [name]", "Create a new save on an instance", (yargs) => {
		yargs.positional("instance", { describe: "Instance to create on", type: "string" });
		yargs.positional("name", { describe: "Name of save to create.", type: "string", default: "world.zip" });
		yargs.options({
			"seed": { describe: "Seed to use, takes precedence over map-gen-settings", nargs: 1, type: "number" },
			"map-exchange-string": { describe: "Map exchange string to use for the save", nargs: 1, type: "string" },
			"map-gen-settings": { describe: "path to file to use for map-gen-settings", nargs: 1, type: "string" },
			"map-settings": { describe: "path to file to use for map-settings", nargs: 1, type: "string" },
		});
	}],
	handler: async function(
		args: {
			instance: string,
			name: string,
			seed?: number,
			mapExchangeString?: string,
			mapGenSettings?: string,
			mapSettings?: string,
		},
		control: Control
	) {
		let instanceId = await lib.resolveInstance(control, args.instance);
		let { seed, mapGenSettings, mapSettings } = await loadMapSettings(args);
		await control.setLogSubscriptions({ instanceIds: [instanceId] });
		await control.sendTo(
			{ instanceId },
			new lib.InstanceCreateSaveRequest(args.name, seed, mapGenSettings, mapSettings),
		);
	},
}));

instanceSaveCommands.add(new lib.Command({
	definition: ["rename <instance> <old-name> <new-name>", "Rename a save on an instance", (yargs) => {
		yargs.positional("instance", { describe: "Instance to rename save on", type: "string" });
		yargs.positional("old-name", { describe: "Old name of save.", type: "string" });
		yargs.positional("new-name", { describe: "New name of save.", type: "string" });
	}],
	handler: async function(args: { instance: string, oldName: string, newName: string }, control: Control) {
		let instanceId = await lib.resolveInstance(control, args.instance);
		await control.send(new lib.InstanceRenameSaveRequest(instanceId, args.oldName, args.newName));
	},
}));

instanceSaveCommands.add(new lib.Command({
	definition: ["copy <instance> <source> <destination>", "Copy a save on an instance", (yargs) => {
		yargs.positional("instance", { describe: "Instance to copy save on", type: "string" });
		yargs.positional("source", { describe: "Save to copy.", type: "string" });
		yargs.positional("destination", { describe: "Name of copy.", type: "string" });
	}],
	handler: async function(args: { instance: string, source: string, destination: string }, control: Control) {
		let instanceId = await lib.resolveInstance(control, args.instance);
		await control.send(new lib.InstanceCopySaveRequest(instanceId, args.source, args.destination));
	},
}));

instanceSaveCommands.add(new lib.Command({
	definition: ["upload <instance> <filepath>", "Upload a save to an instance", (yargs) => {
		yargs.positional("instance", { describe: "Instance to upload to", type: "string" });
		yargs.positional("filepath", { describe: "Path to save to upload", type: "string" });
		yargs.options({
			"name": { describe: "Name to give save on server", nargs: 1, type: "string" },
		});
	}],
	handler: async function(args: { instance: string, filepath: string, name?: string }, control: Control) {
		let filename = args.name || path.basename(args.filepath);
		if (!filename.endsWith(".zip")) {
			throw new lib.CommandError("Save name must end with .zip");
		}
		// phin doesn't support streaming requests :(
		let content = await fs.readFile(args.filepath);

		let instanceId = await lib.resolveInstance(control, args.instance);
		let url = new URL(control.config.get("control.controller_url")!);
		url.pathname += "api/upload-save";
		url.searchParams.append("instance_id", String(instanceId));
		url.searchParams.append("filename", filename);

		let result = await phin<{ errors?: string[], request_errors?: string[], saves?: string[] }>({
			url, method: "POST",
			headers: {
				"X-Access-Token": control.config.get("control.controller_token"),
				"Content-Type": "application/zip",
			},
			core: { ca: control.tlsCa } as object,
			data: content,
			parse: "json",
		});

		for (let error of result.body.errors || []) {
			logger.error(error);
		}

		for (let requestError of result.body.request_errors || []) {
			logger.error(requestError);
		}

		if (result.body.saves && result.body.saves.length) {
			logger.info(`Successfully uploaded as ${result.body.saves[0]}`);
		}

		if ((result.body.errors || []).length || (result.body.request_errors || []).length) {
			throw new lib.CommandError("Uploading save failed");
		}
	},
}));

instanceSaveCommands.add(new lib.Command({
	definition: [
		"transfer <source-instance> <source-save> <target-instance> [target-save]",
		"Transfer a save between instances",
		(yargs) => {
			yargs.positional("source-instance", { describe: "Instance to transfer save from", type: "string" });
			yargs.positional("source-save", { describe: "Save to transfer.", type: "string" });
			yargs.positional("target-instance", { describe: "Instance to transfer to", type: "string" });
			yargs.positional("target-save", { describe: "Name to give transferred save.", type: "string" });
			yargs.options({
				"copy": { describe: "Copy instead of moving the save", type: "boolean", default: false },
			});
		},
	],
	handler: async function(
		args: {
			sourceInstance: string,
			sourceSave: string,
			targetInstance: string,
			targetSave: string,
			copy: boolean,
		},
		control: Control
	) {
		let sourceInstanceId = await lib.resolveInstance(control, args.sourceInstance);
		let targetInstanceId = await lib.resolveInstance(control, args.targetInstance);
		let storedName = await control.send(
			new lib.InstanceTransferSaveRequest(
				sourceInstanceId,
				args.sourceSave,
				targetInstanceId,
				args.targetSave || args.sourceSave,
				args.copy
			)
		);
		print(`Transferred as ${storedName} to ${args.targetInstance}.`);
	},
}));

instanceSaveCommands.add(new lib.Command({
	definition: ["download <instance> <save>", "Download a save from an instance", (yargs) => {
		yargs.positional("instance", { describe: "Instance to download save from", type: "string" });
		yargs.positional("save", { describe: "Save to download", type: "string" });
	}],
	handler: async function(args: { instance: string, save: string }, control: Control) {
		let instanceId = await lib.resolveInstance(control, args.instance);
		let streamId = await control.send(new lib.InstanceDownloadSaveRequest(instanceId, args.save));

		let url = new URL(control.config.get("control.controller_url")!);
		url.pathname += `api/stream/${streamId}`;
		let response = await phin({
			url, method: "GET",
			core: { ca: control.tlsCa } as object,
			stream: true,
		});

		let writeStream;
		let tempFilename = args.save.replace(/(\.zip)?$/, ".tmp.zip");
		while (true) {
			try {
				writeStream = fs.createWriteStream(tempFilename, { flags: "wx" });
				await events.once(writeStream, "open");
				break;
			} catch (err: any) {
				if (err.code === "EEXIST") {
					tempFilename = await lib.findUnusedName(".", tempFilename, ".tmp.zip");
				} else {
					throw err;
				}
			}
		}
		response.pipe(writeStream);
		await finished(writeStream);

		let filename = await lib.findUnusedName(".", args.save, ".zip");
		await fs.rename(tempFilename, filename);

		logger.info(`Downloaded ${args.save}${args.save === filename ? "" : ` as ${filename}`}`);
	},
}));

instanceSaveCommands.add(new lib.Command({
	definition: ["delete <instance> <save>", "Delete a save from an instance", (yargs) => {
		yargs.positional("instance", { describe: "Instance to delete save from", type: "string" });
		yargs.positional("save", { describe: "Save to delete", type: "string" });
	}],
	handler: async function(args: { instance: string, save: string }, control: Control) {
		let instanceId = await lib.resolveInstance(control, args.instance);
		await control.send(new lib.InstanceDeleteSaveRequest(instanceId, args.save));
	},
}));
instanceCommands.add(instanceSaveCommands);

instanceCommands.add(new lib.Command({
	definition: ["export-data <instance>", "Export item icons and locale from instance", (yargs) => {
		yargs.positional("instance", { describe: "Instance to export from", type: "string" });
	}],
	handler: async function(args: { instance: string }, control: Control) {
		let instanceId = await lib.resolveInstance(control, args.instance);
		await control.setLogSubscriptions({ instanceIds: [instanceId] });
		await control.sendTo({ instanceId }, new lib.InstanceExportDataRequest());
	},
}));

instanceCommands.add(new lib.Command({
	definition: ["extract-players <instance>", "Extract players from running save into the cluster.", (yargs) => {
		yargs.positional("instance", { describe: "Instance to extract players and online time from", type: "string" });
	}],
	handler: async function(args: { instance: string }, control: Control) {
		let instanceId = await lib.resolveInstance(control, args.instance);
		await control.setLogSubscriptions({ instanceIds: [instanceId] });
		await control.sendTo({ instanceId }, new lib.InstanceExtractPlayersRequest());
	},
}));

instanceCommands.add(new lib.Command({
	definition: ["start <instance>", "Start instance", (yargs) => {
		yargs.positional("instance", { describe: "Instance to start", type: "string" });
		yargs.options({
			"save": { describe: "Save to load, defaults to latest", nargs: 1, type: "string" },
			"keep-open": { describe: "Keep console open", nargs: 0, type: "boolean", default: false },
		});
	}],
	handler: async function(args: { instance: string, save?: string, keepOpen: boolean }, control: Control) {
		const instanceId = await lib.resolveInstance(control, args.instance);
		await control.setLogSubscriptions({ instanceIds: [instanceId] });
		await control.sendTo({ instanceId }, new lib.InstanceStartRequest(args.save));
		control.keepOpen = args.keepOpen;
	},
}));
instanceCommands.add(new lib.Command({
	definition: ["restart <instance>", "Restart instance", (yargs) => {
		yargs.positional("instance", { describe: "Instance to restart", type: "string" });
		yargs.options({
			"save": { describe: "Save to load, defaults to latest", nargs: 1, type: "string" },
			"keep-open": { describe: "Keep console open", nargs: 0, type: "boolean", default: false },
		});
	}],
	handler: async function(args: { instance: string, save?: string, keepOpen: boolean }, control: Control) {
		const instanceId = await lib.resolveInstance(control, args.instance);
		await control.setLogSubscriptions({ instanceIds: [instanceId] });
		await control.sendTo({ instanceId }, new lib.InstanceRestartRequest(args.save));
		control.keepOpen = args.keepOpen;
	},
}));

instanceCommands.add(new lib.Command({
	definition: ["start-all", "Start all stopped instances (respects exclude_from_start_all setting)", (yargs) => {
		yargs.options({
			"force": {
				describe: "Start instances even if they have exclude_from_start_all set",
				nargs: 0,
				type: "boolean",
				default: false,
			},
		});
	}],
	handler: async function(args: { force: boolean }, control: Control) {
		// Get all instances
		const instances = await control.send(new lib.InstanceDetailsListRequest());

		// Filter instances that should be started
		const instancesToStart = instances.filter((instance: lib.InstanceDetails) => {
			// Only start instances that are currently stopped
			if (instance.status !== "stopped") {
				return false;
			}

			// Respect exclude_from_start_all setting unless --force is used
			if (!args.force && instance.excludeFromStartAll) {
				return false;
			}

			return true;
		});

		if (instancesToStart.length === 0) {
			print("No instances to start.");
			return;
		}

		print(`Starting ${instancesToStart.length} instance(s):`);
		for (const instance of instancesToStart) {
			print(`  - ${instance.name} (ID: ${instance.id})`);
		}

		// Start all filtered instances
		const startPromises = instancesToStart.map(async (instance: lib.InstanceDetails) => {
			try {
				await control.sendTo({ instanceId: instance.id }, new lib.InstanceStartRequest());
				print(`✓ Started ${instance.name}`);
			} catch (error) {
				print(`✗ Failed to start ${instance.name}: ${error}`);
			}
		});

		await Promise.all(startPromises);
		print("Start all operation completed.");
	},
}));

instanceCommands.add(new lib.Command({
	definition: ["load-scenario <instance> <scenario>", "Start instance by loading a scenario", (yargs) => {
		yargs.positional("instance", { describe: "Instance to start", type: "string" });
		yargs.positional("scenario", { describe: "Scenario to load", type: "string" });
		yargs.options({
			"seed": { describe: "Seed to use, takes precedence over map-gen-settings", nargs: 1, type: "number" },
			"map-exchange-string": { describe: "Map exchange string to use for the save", nargs: 1, type: "string" },
			"map-gen-settings": { describe: "path to file to use for map-gen-settings", nargs: 1, type: "string" },
			"map-settings": { describe: "path to file to use for map-settings", nargs: 1, type: "string" },
			"keep-open": { describe: "Keep console open", nargs: 0, type: "boolean", default: false },
		});
	}],
	handler: async function(
		args: {
			instance: string,
			scenario: string,
			seed?: number,
			mapExchangeString?: string,
			mapGenSettings?: string,
			mapSettings?: string,
			keepOpen: boolean,
		},
		control: Control) {
		let instanceId = await lib.resolveInstance(control, args.instance);
		await control.setLogSubscriptions({ instanceIds: [instanceId] });
		let { seed, mapGenSettings, mapSettings } = await loadMapSettings(args);
		await control.sendTo(
			{ instanceId },
			new lib.InstanceLoadScenarioRequest(args.scenario, seed, mapGenSettings, mapSettings),
		);
		control.keepOpen = args.keepOpen;
	},
}));

instanceCommands.add(new lib.Command({
	definition: ["stop <instance>", "Stop instance", (yargs) => {
		yargs.positional("instance", { describe: "Instance to stop", type: "string" });
	}],
	handler: async function(args: { instance: string }, control: Control) {
		let instanceId = await lib.resolveInstance(control, args.instance);
		await control.setLogSubscriptions({ instanceIds: [instanceId] });
		await control.sendTo({ instanceId }, new lib.InstanceStopRequest());
	},
}));

instanceCommands.add(new lib.Command({
	definition: ["stop-all", "Stop all running instances", () => {}],
	handler: async function(_args, control: Control) {
		// Get all instances
		const instances = await control.send(new lib.InstanceDetailsListRequest());

		// Filter instances that should be stopped
		const instancesToStop = instances
			.filter((instance: lib.InstanceDetails) => ["starting", "running"].includes(instance.status));

		if (instancesToStop.length === 0) {
			print("No instances to stop.");
			return;
		}

		print(`Stopping ${instancesToStop.length} instance(s):`);
		for (const instance of instancesToStop) {
			print(`  - ${instance.name} (ID: ${instance.id})`);
		}

		// Stop all filtered instances
		const stopPromises = instancesToStop.map(async (instance: lib.InstanceDetails) => {
			try {
				await control.sendTo({ instanceId: instance.id }, new lib.InstanceStopRequest());
				print(`✓ Stopped ${instance.name}`);
			} catch (error) {
				print(`✗ Failed to stop ${instance.name}: ${error}`);
			}
		});

		await Promise.all(stopPromises);
		print("Stop all operation completed.");
	},
}));

instanceCommands.add(new lib.Command({
	definition: ["kill <instance>", "Kill instance", (yargs) => {
		yargs.positional("instance", { describe: "Instance to kill", type: "string" });
	}],
	handler: async function(args: { instance: string }, control: Control) {
		let instanceId = await lib.resolveInstance(control, args.instance);
		await control.setLogSubscriptions({ instanceIds: [instanceId] });
		await control.sendTo({ instanceId }, new lib.InstanceKillRequest());
	},
}));

instanceCommands.add(new lib.Command({
	definition: ["delete <instance>", "Delete instance", (yargs) => {
		yargs.positional("instance", { describe: "Instance to delete", type: "string" });
	}],
	handler: async function(args: { instance: string }, control: Control) {
		let instanceId = await lib.resolveInstance(control, args.instance);
		await control.send(new lib.InstanceDeleteRequest(instanceId));
	},
}));

instanceCommands.add(new lib.Command({
	definition: ["send-rcon <instance> <command>", "Send RCON command", (yargs) => {
		yargs.positional("instance", { describe: "Instance to send to", type: "string" });
		yargs.positional("command", { describe: "command to send", type: "string" });
	}],
	handler: async function(args: { instance: string, command: string }, control: Control) {
		let result = await control.sendTo(
			{ instanceId: await lib.resolveInstance(control, args.instance) },
			new lib.InstanceSendRconRequest(args.command),
		);

		// Factorio includes a newline in its response output.
		process.stdout.write(result);
	},
}));
