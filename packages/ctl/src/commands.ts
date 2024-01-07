import fs from "fs-extra";
import asTableModule from "as-table";
import events from "events";
import path from "path";
import winston from "winston";
import phin from "phin";
import os from "os";
import child_process from "child_process";
import stream from "stream";
import util from "util";
import type { Argv } from "yargs";

import * as lib from "@clusterio/lib";
import { ConsoleTransport, levels, logger } from "@clusterio/lib";
import type { Control } from "../ctl";
import type BaseCtlPlugin from "./BaseCtlPlugin";

const asTable = asTableModule.configure({ delimiter: " | " });
const finished = util.promisify(stream.finished);


function print(...content: any) {
	// eslint-disable-next-line no-console
	console.log(...content);
}

async function getEditor(argsEditor: string) {
	// eslint-disable-next-line
	return argsEditor || process.env.EDITOR || process.env.VISUAL || undefined
	// needed for the process.env statements to not be flagged by eslint
	// priority for editors is CLI argument > env.EDITOR > env.VISUAL
}

async function configToKeyVal(data: string) {
	let final: Record<string, string> = {};
	let splitData = data.split(/\r?\n/);
	// split on newlines
	let filtered = splitData.filter((value) => value[0] !== "#").filter((a) => a);
	// the last filter removes empty elements left by the first. Not done on one line due to readability.
	for (let index in filtered) {
		if (index in filtered) {
			let split = filtered[index].split("=");
			let finalIndex = filtered[index][0].trim();
			// split on the = we added earlier, giving us both value and key
			let part = "";
			try {
				part = split[1].trim();
				// it's a string if we can read it
			} catch (err) {
				// if we can't read it, it's a empty field and therefor null
				part = "";
			}
			final[finalIndex] = part;
		}
	}
	return final;
}

async function serializedConfigToString(
	serializedConfig: any,
	configGroup: typeof lib.Config,
	disallowedList: Record<string, unknown>,
) {
	let allConfigElements = "";
	for (let group of serializedConfig.groups) {
		for (let [name, value] of Object.entries(group.fields)) {
			if (`${group.name}.${name}` in disallowedList) {
				continue;
			}
			let desc = "";
			try {
				desc += configGroup.groups.get(group.name)!._definitions.get(name)!.description;
			} catch (err) {
				desc += "No description found";
			}
			// split onto two lines for readability and es-lint
			if (String(value) === "null") {
				value = "";
			}
			allConfigElements += `${group.name}.${name} = ${value}\n\n`;
		}
	}
	return allConfigElements;
}

const controllerCommands = new lib.CommandTree({ name: "controller", description: "Controller management" });
const controllerConfigCommands = new lib.CommandTree({
	name: "config", alias: ["c"], description: "controller config management",
});

controllerConfigCommands.add(new lib.Command({
	definition: ["list", "List controller configuration"],
	handler: async function(args: object, control: Control) {
		let response = await control.send(new lib.ControllerConfigGetRequest());

		for (let group of (response.serializedConfig as any).groups) {
			for (let [name, value] of Object.entries(group.fields)) {
				print(`${group.name}.${name} ${JSON.stringify(value)}`);
			}
		}
	},
}));

controllerConfigCommands.add(new lib.Command({
	definition: ["set <field> [value]", "Set field in controller config", (yargs) => {
		yargs.positional("field", { describe: "Field to set", type: "string" });
		yargs.positional("value", { describe: "Value to set", type: "string" });
		yargs.options({
			"stdin": { describe: "read value from stdin", nargs: 0, type: "boolean" },
		});
	}],
	handler: async function(args: { field: string, value?: string, stdin?: boolean }, control: Control) {
		if (args.stdin) {
			args.value = (await lib.readStream(process.stdin)).toString().replace(/\r?\n$/, "");
		} else if (args.value === undefined) {
			args.value = "";
		}
		await control.send(new lib.ControllerConfigSetFieldRequest(args.field as string, args.value as string));
	},
}));

controllerConfigCommands.add(new lib.Command({
	definition: ["set-prop <field> <prop> [value]", "Set property of field in controller config", (yargs) => {
		yargs.positional("field", { describe: "Field to set", type: "string" });
		yargs.positional("prop", { describe: "Property to set", type: "string" });
		yargs.positional("value", { describe: "JSON parsed value to set", type: "string" });
		yargs.options({
			"stdin": { describe: "read value from stdin", nargs: 0, type: "boolean" },
		});
	}],
	handler: async function(args: { field: string, prop: string, value?: string, stdin?: boolean }, control: Control) {
		if (args.stdin) {
			args.value = (await lib.readStream(process.stdin)).toString().replace(/\r?\n$/, "");
		}
		let value;
		try {
			if (args.value !== undefined) {
				value = JSON.parse(args.value);
			}
		} catch (err: any) {
			// See note for the instance version of set-prop
			if (args.stdin || /^(\[.*]|{.*}|".*")$/.test(args.value!)) {
				throw new lib.CommandError(`In parsing value '${args.value}': ${err.message}`);
			}
			value = args.value;
		}
		await control.send(new lib.ControllerConfigSetPropRequest(args.field, args.prop, value));
	},
}));
controllerConfigCommands.add(new lib.Command({
	definition: ["edit [editor]", "Edit controller configuration", (yargs) => {
		yargs.positional("editor", {
			describe: "Editor to use",
			type: "string",
			default: "",
		});
	}],
	handler: async function(args: { editor: string }, control: Control) {
		let response = await control.send(new lib.ControllerConfigGetRequest());
		let tmpFile = await lib.getTempFile("ctl-", "-tmp", os.tmpdir());
		let editor = await getEditor(args.editor);
		if (editor === undefined) {
			throw new lib.CommandError(`No editor avalible. Checked CLI input, EDITOR and VISUAL env vars
							  Try "ctl controller config edit <editor of choice>"`);
		}
		let allConfigElements = await serializedConfigToString(
			response.serializedConfig, lib.ControllerConfig, {}
		);
		await fs.writeFile(tmpFile, allConfigElements);
		let editorSpawn = child_process.spawn(editor, [tmpFile], {
			stdio: "inherit",
			detached: false,
		});
		editorSpawn.on("data", (data) => {
			process.stdout.pipe(data);
		});
		let doneEmitter = new events.EventEmitter();
		editorSpawn.on("exit", async (exit) => {
			const data = await fs.readFile(tmpFile, "utf8");
			const final = await configToKeyVal(data);
			for (let index in final) {
				if (index in final) {
					try {
						await control.send(new lib.ControllerConfigSetFieldRequest(
							index,
							final[index],
						));
					} catch (err) {
						// eslint-disable-next-line
						print(`Attempt to set ${index} to ${final[index] || String(null)} failed; set back to previous value.`);
						print(err);
						// If the string is empty, it's better to just print "" instead of nothing
					}
				}
			}
			doneEmitter.emit("dot_on_done");
		});
		await events.once(doneEmitter, "dot_on_done");
		try {
			await fs.unlink(tmpFile);
		} catch (err) {
			print("err: temporary file", tmpFile, "could not be deleted.");
			print("This is not fatal, but they may build up over time if the issue persists.");
		}
	},
}));

controllerCommands.add(controllerConfigCommands);


const controllerPluginCommands = new lib.CommandTree({
	name: "plugin", alias: ["p"], description: "controller plugin inspection",
});
controllerPluginCommands.add(new lib.Command({
	definition: ["list", "List plugins on controller"],
	handler: async function(args: object, control: Control) {
		let url = new URL(control.config.get("control.controller_url") as string);
		url.pathname += "api/plugins";
		let response = await phin<[]>({
			url,
			parse: "json",
			core: { ca: control.tlsCa } as object,
		});
		print(asTable(response.body));
	},
}));
controllerCommands.add(controllerPluginCommands);


const hostCommands = new lib.CommandTree({ name: "host", description: "Host management" });
hostCommands.add(new lib.Command({
	definition: [["list", "l"], "List hosts connected to the controller"],
	handler: async function(args: object, control: Control) {
		let hosts = await control.send(new lib.HostListRequest());
		print(asTable(hosts));
	},
}));

hostCommands.add(new lib.Command({
	definition: ["generate-token", "Generate token for a host", (yargs) => {
		yargs.option("id", { type: "number", nargs: 1, describe: "Host id" });
	}],
	handler: async function(args: { id?: number }, control: Control) {
		let hostId = typeof args.id === "number" ? args.id : undefined;
		let response = await control.send(new lib.HostGenerateTokenRequest(hostId));
		print(response);
	},
}));

hostCommands.add(new lib.Command({
	definition: ["revoke-token <host>", "Revoke all tokens for a host", (yargs) => {
		yargs.positional("host", { describe: "Host to revoke tokens for", type: "string" });
	}],
	handler: async function(args: { host: string }, control: Control) {
		let hostId = await lib.resolveHost(control, args.host);
		await control.send(new lib.HostRevokeTokensRequest(hostId));
	},
}));

hostCommands.add(new lib.Command({
	definition: ["create-config", "Create host config", (yargs) => {
		yargs.option("id", { type: "number", nargs: 1, describe: "Host id" });
		yargs.option("name", { type: "string", nargs: 1, describe: "Host name" });
		yargs.option("generate-token", {
			type: "boolean", nargs: 0, describe: "Generate authentication token", default: false,
		});
		yargs.option("output", {
			type: "string", nargs: 1, describe: "Path to output config (- for stdout)", default: "config-host.json",
		});
	}],
	handler: async function(
		args: { id?: number, name?: string, generateToken: boolean, output: string },
		control: Control
	) {
		let rawConfig = await control.send(
			new lib.HostConfigCreateRequest(args.id, args.name, args.generateToken)
		);

		let content = JSON.stringify(rawConfig.serializedConfig, null, "\t");
		if (args.output === "-") {
			print(content);
		} else {
			logger.info(`Writing ${args.output}`);
			try {
				await fs.outputFile(args.output, content, { flag: "wx" });
			} catch (err: any) {
				if (err.code === "EEXIST") {
					throw new lib.CommandError(`File ${args.output} already exists`);
				}
				throw err;
			}
		}
	},
}));


const instanceCommands = new lib.CommandTree({
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
		});
	}],
	handler: async function(args: { name: string, id?: number }, control: Control) {
		let instanceConfig = new lib.InstanceConfig("control");
		await instanceConfig.init();
		if (args.id !== undefined) {
			instanceConfig.set("instance.id", args.id);
		}
		instanceConfig.set("instance.name", args.name);
		let serializedConfig = instanceConfig.serialize("controller");
		await control.send(new lib.InstanceCreateRequest(serializedConfig));
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
		let response = await control.send(new lib.InstanceConfigGetRequest(instanceId));

		for (let group of response.serializedConfig.groups) {
			for (let [name, value] of Object.entries(group.fields)) {
				print(`${group.name}.${name} ${JSON.stringify(value)}`);
			}
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
		let response = await control.send(new lib.InstanceConfigGetRequest(instanceId));
		let tmpFile = await lib.getTempFile("ctl-", "-tmp", os.tmpdir());
		let editor = await getEditor(args.editor);
		if (editor === undefined) {
			throw new lib.CommandError(`No editor avalible. Checked CLI input, EDITOR and VISUAL env vars
							  Try "ctl controller config edit <editor of choice>"`);
		}
		let disallowedList = {"instance.id": 0, "instance.assigned_host": 0, "factorio.settings": 0};
		let allConfigElements = await serializedConfigToString(
			response.serializedConfig,
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
		let doneEmitter = new events.EventEmitter();
		editorSpawn.on("exit", async (exit) => {
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
			doneEmitter.emit("dot_on_done");
		});
		await events.once(doneEmitter, "dot_on_done");
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
		let url = new URL(control.config.get("control.controller_url") as string);
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

		let url = new URL(control.config.get("control.controller_url") as string);
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
			"save": { describe: "Save load, defaults to latest", nargs: 1, type: "string" },
			"keep-open": { describe: "Keep console open", nargs: 0, type: "boolean", default: false },
		});
	}],
	handler: async function(args: { instance: string, save?: string, keepOpen: boolean }, control: Control) {
		let instanceId = await lib.resolveInstance(control, args.instance);
		await control.setLogSubscriptions({ instanceIds: [instanceId] });
		await control.sendTo({ instanceId }, new lib.InstanceStartRequest(args.save));
		control.keepOpen = args.keepOpen;
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

const modPackCommands = new lib.CommandTree({ name: "mod-pack", description: "Mod Pack" });
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
	args: { boolSetting?: string[], intSetting?: string[], doubleSetting?: string[], stringSetting?: string[] },
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
}

function setModPackMods(modPack: lib.ModPack, mods: string[] | undefined) {
	for (let mod of mods || []) {
		const [name, version, sha1] = mod.split(":");
		if (!version) {
			throw new lib.CommandError("Added mod must be formatted as name:version or name:version:sha1");
		}
		if (!/^\d+\.\d+\.\d+$/.test(version)) {
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
		},
		control: Control,
	) {
		const modPack = new lib.ModPack();
		modPack.name = args.name;
		if (args.description) { modPack.description = args.description; }
		if (args.factorioVersion) {
			if (!/^\d+\.\d+\.\d+?$/.test(args.factorioVersion)) {
				throw new lib.CommandError("factorio-version must match the format digit.digit.digit");
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
			if (!/^\d+\.\d+\.\d+?$/.test(args.factorioVersion)) {
				throw new lib.CommandError("factorio-version must match the format digit.digit.digit");
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

const modCommands = new lib.CommandTree({ name: "mod", description: "Manage uploaded mods" });
modCommands.add(new lib.Command({
	definition: ["show <name> <mod-version>", "Show details for a mod stored in the cluster", (yargs) => {
		yargs.positional("name", { describe: "Mod name to show details for", type: "string" });
		yargs.positional("mod-version", { describe: "Version of the mod", type: "string" });
	}],
	handler: async function(args: { name: string, modVersion: string }, control: Control) {
		let modInfo = await control.send(new lib.ModGetRequest(args.name, args.modVersion));
		for (let [field, value] of Object.entries(modInfo)) {
			if (value instanceof Array) {
				print(`${field}:`);
				for (let entry of value) {
					print(`  ${entry}`);
				}
			} else {
				print(`${field}: ${value}`);
			}
		}
	},
}));

modCommands.add(new lib.Command({
	definition: [["list", "l"], "List mods stored in the cluster", (yargs) => {
		yargs.options({
			"fields": {
				describe: "Fields to show, supports 'all'.",
				array: true,
				type: "string",
				default: ["name", "version", "title", "factorio_version"],
			},
		});
	}],
	handler: async function(args: { fields: string[] }, control: Control) {
		let mods = await control.send(new lib.ModListRequest());
		if (!args.fields.includes("all")) {
			for (let entry of mods) {
				for (let field of Object.keys(entry)) {
					if (!args.fields.includes(field)) {
						// @ts-expect-error terrible hack
						delete entry[field];
					}
				}
			}
		}
		print(asTable(mods));
	},
}));

modCommands.add(new lib.Command({
	definition: ["search <factorio-version> [query]", "Search mods stored in the cluster", (yargs) => {
		yargs.positional("factorio-version", { describe: "Major version of Factorio to search for", type: "string" });
		yargs.positional("query", { describe: "Search query", type: "string", default: "" });
		yargs.options({
			"page": {
				describe: "Result page to show",
				type: "number",
				default: 1,
			},
			"page-size": {
				describe: "Results per page to show",
				type: "number",
				default: 10,
			},
			"sort": {
				describe: "sort results by given field",
				type: "string",
			},
			"sort-order": {
				describe: "order to sort results in (asc/desc)",
				type: "string",
				default: "asc",
			},
			"fields": {
				describe: "Fields to show, supports 'all'.",
				array: true,
				type: "string",
				default: ["name", "version", "title", "factorio_version"],
			},
		});
	}],
	handler: async function(
		args: {
			factorioVersion: string,
			query: string,
			page: number,
			pageSize: number,
			sort?: string,
			sortOrder: "asc" | "desc",
			fields: string[],
		},
		control: Control
	) {
		let response = await control.send(new lib.ModSearchRequest(
			args.query,
			args.factorioVersion,
			args.page,
			args.pageSize,
			args.sort,
			args.sortOrder
		));
		let results = response.results.flatMap(result => result.versions);
		if (!args.fields.includes("all")) {
			for (let entry of results) {
				for (let field of Object.keys(entry)) {
					if (!args.fields.includes(field)) {
						// @ts-expect-error terrible hack
						delete entry[field];
					}
				}
			}
		}
		for (let issue of response.queryIssues) {
			print(issue);
		}
		print(`page ${args.page} of ${response.pageCount} (${response.resultCount} results)`);
		print(asTable(results));
	},
}));

modCommands.add(new lib.Command({
	definition: ["upload <file>", "Upload mod to the cluster", (yargs) => {
		yargs.positional("file", { describe: "File to upload", type: "string" });
	}],
	handler: async function(args: { file: string }, control: Control) {
		let filename = path.basename(args.file);
		if (!filename.endsWith(".zip")) {
			throw new lib.CommandError("Mod filename must end with .zip");
		}
		// phin doesn't support streaming requests :(
		let content = await fs.readFile(args.file);

		let url = new URL(control.config.get("control.controller_url") as string);
		url.pathname += "api/upload-mod";
		url.searchParams.append("filename", filename);

		let result = await phin<
			{ errors?: [], request_errors?: [], mods: Parameters<typeof lib.ModInfo.fromJSON>[0][]}
		>({
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

		if (result.body.mods && result.body.mods.length) {
			const mod = lib.ModInfo.fromJSON(result.body.mods[0]);
			logger.info(`Successfully uploaded ${mod.filename}`);
		}

		if ((result.body.errors || []).length || (result.body.request_errors || []).length) {
			throw new lib.CommandError("Uploading mod failed");
		}
	},
}));

modCommands.add(new lib.Command({
	definition: ["download <name> <mod-version>", "Download a mod from the cluster", (yargs) => {
		yargs.positional("name", { describe: "Internal name of mod to download", type: "string" });
		yargs.positional("mod-version", { describe: "Version of mod to download", type: "string" });
	}],
	handler: async function(args: { name: string, modVersion: string }, control: Control) {
		let streamId = await control.send(new lib.ModDownloadRequest(args.name, args.modVersion));

		let url = new URL(control.config.get("control.controller_url") as string);
		url.pathname += `api/stream/${streamId}`;
		let response = await phin({
			url, method: "GET",
			core: { ca: control.tlsCa } as object,
			stream: true,
		});

		let writeStream;
		let filename = `${args.name}_${args.modVersion}.zip`;
		let tempFilename = filename.replace(/(\.zip)?$/, ".tmp.zip");
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
		await fs.rename(tempFilename, filename);

		logger.info(`Downloaded ${filename}`);
	},
}));

modCommands.add(new lib.Command({
	definition: ["delete <name> <mod-version>", "Delete a mod stored in the cluster", (yargs) => {
		yargs.positional("name", { describe: "Name of mod to delete", type: "string" });
		yargs.positional("mod-version", { describe: "Version of mod to delete", type: "string" });
	}],
	handler: async function(args: { name: string, modVersion: string }, control: Control) {
		await control.send(new lib.ModDeleteRequest(args.name, args.modVersion));
	},
}));

const permissionCommands = new lib.CommandTree({ name: "permission", description: "Permission inspection" });
permissionCommands.add(new lib.Command({
	definition: [["list", "l"], "List permissions in the cluster"],
	handler: async function(args: object, control: Control) {
		let permissions = await control.send(new lib.PermissionListRequest());
		print(asTable(permissions));
	},
}));


const roleCommands = new lib.CommandTree({ name: "role", description: "Role management" });
roleCommands.add(new lib.Command({
	definition: [["list", "l"], "List roles in the cluster"],
	handler: async function(args: object, control: Control) {
		let roles = await control.send(new lib.RoleListRequest());
		print(asTable(roles));
	},
}));

roleCommands.add(new lib.Command({
	definition: ["create <name>", "Create a new role", (yargs) => {
		yargs.positional("name", { describe: "Name of role to create", type: "string" });
		yargs.options({
			"description": { describe: "Description for role", nargs: 1, type: "string", default: "" },
			"permissions": { describe: "Permissions role grants", nargs: 1, array: true, type: "string", default: [] },
		});
	}],
	handler: async function(args: { name: string, description: string, permissions: string[] }, control: Control) {
		let id = await control.send(new lib.RoleCreateRequest(
			args.name,
			args.description,
			args.permissions,
		));
		logger.info(`Created role ID ${id}`);
	},
}));

roleCommands.add(new lib.Command({
	definition: ["edit <role>", "Edit existing role", (yargs) => {
		yargs.positional("role", { describe: "Role to edit", type: "string" });
		yargs.options({
			"name": { describe: "New name for role", nargs: 1, type: "string" },
			"description": { describe: "New description for role", nargs: 1, type: "string" },
			"set-perms": { describe: "Set permissions for role", array: true, type: "string" },
			"add-perms": { describe: "Add permissions to role", array: true, type: "string", conflicts: "set-perms" },
			"remove-perms": {
				describe: "Remove permissions from role", array: true, type: "string", conflicts: "set-perms",
			},
			"grant-default": { describe: "Add default permissions to role", nargs: 0, type: "boolean" },
		});
	}],
	handler: async function(
		args: {
			role: string,
			name?: string,
			description?: string,
			setPerms?: string[],
			addPerms?: string[],
			removePerms?: string[],
			grantDefault?: boolean,
		},
		control: Control
	) {
		let role = await lib.retrieveRole(control, args.role);

		if (args.name !== undefined) {
			role.name = args.name;
		}
		if (args.description !== undefined) {
			role.description = args.description;
		}
		if (args.addPerms) {
			for (const perm of args.addPerms) {
				role.permissions.add(perm);
			}
		}
		if (args.removePerms) {
			for (let perm of args.removePerms) {
				role.permissions.delete(perm);
			}
		}
		if (args.setPerms !== undefined) {
			role.permissions = new Set(args.setPerms);
		}
		await control.send(new lib.RoleUpdateRequest(role.id, role.name, role.description, [...role.permissions]));

		if (args.grantDefault) {
			await control.send(new lib.RoleGrantDefaultPermissionsRequest(role.id));
		}
	},
}));

roleCommands.add(new lib.Command({
	definition: ["delete <role>", "Delete role", (yargs) => {
		yargs.positional("role", { describe: "Role to delete", type: "string" });
	}],
	handler: async function(args: { role: string }, control: Control) {
		let role = await lib.retrieveRole(control, args.role);
		await control.send(new lib.RoleDeleteRequest(role.id));
	},
}));


const userCommands = new lib.CommandTree({ name: "user", alias: ["u"], description: "User management" });
userCommands.add(new lib.Command({
	definition: ["show <name>", "Show details for one user", (yargs) => {
		yargs.positional("name", { decribe: "Name of user to show", type: "string" });
		yargs.options({
			"instance-stats": { describe: "include per-instance stats", nargs: 0, type: "boolean", default: false },
		});
	}],
	handler: async function(args: { name: string, instanceStats: boolean }, control: Control) {
		let user = await control.send(new lib.UserGetRequest(args.name));
		Object.assign(user, user.playerStats);
		// @ts-expect-error Terrible hack
		delete user.playerStats;
		let instanceStats = user.instanceStats;
		// @ts-expect-error Terrible hack
		delete user.instanceStats;
		print(asTable(Object.entries(user).map(([property, value]) => ({ property, value }))));

		if (args.instanceStats) {
			let instances = await control.send(new lib.InstanceDetailsListRequest());
			function instanceName(id: number) {
				let instance = instances.find(i => i.id === id);
				if (instance) {
					return instance.name;
				}
				return "<deleted>";
			}
			for (let [id, playerInstanceStats] of instanceStats || []) {
				print();
				print(`Instance ${instanceName(id)} (${id}):`);
				print(asTable(Object.entries(playerInstanceStats).map(([property, value]) => ({ property, value }))));
			}
		}
	},
}));

userCommands.add(new lib.Command({
	definition: [["list", "l"], "List user in the cluster", (yargs) => {
		yargs.options({
			"stats": { describe: "include user stats", nargs: 0, type: "boolean", default: false },
			"attributes": { describe: "include admin/whitelisted/banned", nargs: 0, type: "boolean", default: false },
		});
	}],
	handler: async function(args: { stats: boolean, attributes: boolean }, control: Control) {
		let users = await control.send(new lib.UserListRequest());
		for (let user of users) {
			if (args.stats) {
				Object.assign(user, user.playerStats);
			}
			// @ts-expect-error Terrible hack
			delete user.playerStats;
			// @ts-expect-error Terrible hack
			delete user.isDeleted;
			// @ts-expect-error Terrible hack
			delete user.banReason;
			// @ts-expect-error Terrible hack
			delete user.instanceStats;
			if (!args.attributes) {
				// @ts-expect-error Terrible hack
				delete user.isAdmin;
				// @ts-expect-error Terrible hack
				delete user.isWhitelisted;
				// @ts-expect-error Terrible hack
				delete user.isBanned;
			}
		}
		print(asTable(users));
	},
}));

userCommands.add(new lib.Command({
	definition: ["create <name>", "Create a user", (yargs) => {
		yargs.positional("name", { describe: "Name of user to create", type: "string" });
	}],
	handler: async function(args: { name: string }, control: Control) {
		await control.send(new lib.UserCreateRequest(args.name));
	},
}));

userCommands.add(new lib.Command({
	definition: ["revoke-token <name>", "Revoke token for user", (yargs) => {
		yargs.positional("name", { describe: "Name of user to revoke token for", type: "string" });
	}],
	handler: async function(args: { name: string }, control: Control) {
		await control.send(new lib.UserRevokeTokenRequest(args.name));
	},
}));

userCommands.add(new lib.Command({
	definition: ["set-admin <user>", "Promote or demote a user to admin", (yargs) => {
		yargs.positional("user", { describe: "Name of user set admin status for", type: "string" });
		yargs.options({
			"revoke": { describe: "Revoke admin status", nargs: 0, type: "boolean", default: false },
			"create": { describe: "Create user if it does not exist", nargs: 0, type: "boolean", default: false },
		});
	}],
	handler: async function(args: { user: string, revoke: boolean, create: boolean }, control: Control) {
		await control.send(new lib.UserSetAdminRequest(args.user, args.create, !args.revoke));
	},
}));

userCommands.add(new lib.Command({
	definition: ["set-whitelisted <user>", "Add or remove user from the whitelist", (yargs) => {
		yargs.positional("user", { describe: "Name of user to set whitelist status for", type: "string" });
		yargs.options({
			"remove": { describe: "Remove from whitelist", nargs: 0, type: "boolean", default: false },
			"create": { describe: "Create user if it does not exist", nargs: 0, type: "boolean", default: false },
		});
	}],
	handler: async function(args: { user: string, remove: boolean, create: boolean }, control: Control) {
		await control.send(new lib.UserSetWhitelistedRequest(args.user, args.create, !args.remove));
	},
}));

userCommands.add(new lib.Command({
	definition: ["set-banned <user>", "Ban or pardon user from banlist", (yargs) => {
		yargs.positional("user", { describe: "Name of user to set ban status for", type: "string" });
		yargs.options({
			"pardon": { describe: "Remove from banlist", nargs: 0, type: "boolean", default: false },
			"reason": { describe: "Ban reason", nargs: 1, type: "string", default: "" },
			"create": { describe: "Create user if it does not exist", nargs: 0, type: "boolean", default: false },
		});
	}],
	handler: async function(
		args: {
			user: string,
			pardon: boolean,
			reason: string,
			create: boolean
		},
		control: Control
	) {
		await control.send(new lib.UserSetBannedRequest(args.user, args.create, !args.pardon, args.reason));
	},
}));

userCommands.add(new lib.Command({
	definition: ["set-roles <user> [roles...]", "Replace user roles", (yargs) => {
		yargs.positional("user", { describe: "Name of user to change roles for", type: "string" });
		yargs.positional("roles", { describe: "roles to assign", type: "string" });
	}],
	handler: async function(args: { user: string, roles: string[] }, control: Control) {
		let roles = await control.send(new lib.RoleListRequest());

		let resolvedRoles = [];
		for (let roleName of args.roles) {
			if (/^-?\d+$/.test(roleName)) {
				let roleId = parseInt(roleName, 10);
				resolvedRoles.push(roleId);

			} else {
				let found = false;
				for (let role of roles) {
					if (role.name === roleName) {
						resolvedRoles.push(role.id);
						found = true;
						break;
					}
				}

				if (!found) {
					throw new lib.CommandError(`No role named ${roleName}`);
				}
			}
		}

		await control.send(new lib.UserUpdateRolesRequest(args.user, resolvedRoles));
	},
}));

userCommands.add(new lib.Command({
	definition: ["delete <user>", "Delete user", (yargs) => {
		yargs.positional("user", { describe: "Name of user to delete", type: "string" });
	}],
	handler: async function(args: { user: string }, control: Control) {
		await control.send(new lib.UserDeleteRequest(args.user));
	},
}));

const logCommands = new lib.CommandTree({ name: "log", description: "Log inspection" });
logCommands.add(new lib.Command({
	definition: ["follow", "follow cluster log", (yargs) => {
		yargs.options({
			"all": { describe: "Follow the whole cluster log", nargs: 0, type: "boolean", default: false },
			"controller": { describe: "Follow log of the controller", nargs: 0, type: "boolean", default: false },
			"host": { describe: "Follow log of given host", nargs: 1, type: "string", default: null },
			"instance": { describe: "Follow log of given instance", nargs: 1, type: "string", default: null },
		});
	}],
	handler: async function(
		args: { all: boolean, controller: boolean, host: string | null, instance: string | null },
		control: Control
	) {
		if (!args.all && !args.controller && !args.host && !args.instance) {
			logger.error("At least one of --all, --controller, --host and --instance must be passed");
			process.exitCode = 1;
			return;
		}
		let instanceIds = args.instance ? [await lib.resolveInstance(control, args.instance)] : [];
		let hostIds = args.host ? [await lib.resolveHost(control, args.host)] : [];
		await control.setLogSubscriptions({ all: args.all, controller: args.controller, hostIds, instanceIds });
		control.keepOpen = true;
	},
}));

logCommands.add(new lib.Command({
	definition: ["query", "Query cluster log", (yargs) => {
		yargs.options({
			"all": { describe: "Query the whole cluster log", nargs: 0, type: "boolean", default: false },
			"controller": { describe: "Query log of the controller", nargs: 0, type: "boolean", default: false },
			"host": { describe: "Query log of given host", nargs: 1, type: "string", default: null },
			"instance": { describe: "Query log of given instance", nargs: 1, type: "string", default: null },
			"max-level": { describe: "Maximum log level to return", nargs: 1, type: "string", default: undefined },
			"limit": { describe: "Max number of entries to return", nargs: 1, type: "number", default: 1000 },
			"start": { describe: "Limit from the start instead of the end", nargs: 0, type: "boolean", default: false },
		});
	}],
	handler: async function(
		args: {
			all: boolean,
			controller: boolean,
			host: string | null,
			instance: string | null,
			maxLevel?: string,
			limit: number,
			start: boolean,
		},
		control: Control
	) {
		if (!args.all && !args.controller && !args.host && !args.instance) {
			logger.error("At least one of --all, --controller, --host and --instance must be passed");
			process.exitCode = 1;
			return;
		}
		let instanceIds = args.instance ? [await lib.resolveInstance(control, args.instance)] : [];
		let hostIds = args.host ? [await lib.resolveHost(control, args.host)] : [];
		let result = await control.send(new lib.LogQueryRequest(
			args.all,
			args.controller,
			hostIds,
			instanceIds,
			args.maxLevel as keyof typeof levels,
			args.limit,
			args.start ? "asc" : "desc",
		));

		if (!args.start) {
			result.log.reverse();
		}

		let stdoutLogger = winston.createLogger({
			level: "verbose",
			levels,
			format: new lib.TerminalFormat({ showTimestamp: true }),
			transports: [
				new ConsoleTransport({ errorLevels: [], warnLevels: [] }),
			],
		});
		for (let info of result.log) {
			stdoutLogger.log(info as any);
		}
	},
}));

const debugCommands = new lib.CommandTree({ name: "debug", description: "Debugging utilities" });
debugCommands.add(new lib.Command({
	definition: ["dump-ws", "Dump WebSocket messages sent and received by controller"],
	handler: async function(args: object, control: Control) {
		await control.send(new lib.DebugDumpWsRequest());
		control.keepOpen = true;
	},
}));

export async function registerCommands(ctlPlugins: Map<string, BaseCtlPlugin>, yargs: Argv) {
	const rootCommands = new lib.CommandTree({ name: "clusterioctl", description: "Manage cluster" });
	rootCommands.add(controllerCommands);
	rootCommands.add(hostCommands);
	rootCommands.add(instanceCommands);
	rootCommands.add(modPackCommands);
	rootCommands.add(modCommands);
	rootCommands.add(permissionCommands);
	rootCommands.add(roleCommands);
	rootCommands.add(userCommands);
	rootCommands.add(logCommands);
	rootCommands.add(debugCommands);

	for (let controlPlugin of ctlPlugins.values()) {
		await controlPlugin.addCommands(rootCommands);
	}

	for (let [name, command] of rootCommands.subCommands) {
		if (name === command.name) {
			command.register(yargs);
		}
	}

	return rootCommands;
}
