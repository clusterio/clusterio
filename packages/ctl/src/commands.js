"use strict";
const fs = require("fs-extra");
const asTable = require("as-table").configure({ delimiter: " | " });
const events = require("events");
const path = require("path");
const winston = require("winston");
const phin = require("phin");
const os = require("os");
const child_process = require("child_process");
const stream = require("stream");
const util = require("util");

const libLink = require("@clusterio/lib/link");
const libErrors = require("@clusterio/lib/errors");
const libConfig = require("@clusterio/lib/config");
const libCommand = require("@clusterio/lib/command");
const libData = require("@clusterio/lib/data");
const { ConsoleTransport, levels, logger } = require("@clusterio/lib/logging");
const libLoggingUtils = require("@clusterio/lib/logging_utils");
const libHelpers = require("@clusterio/lib/helpers");
const libFactorio = require("@clusterio/lib/factorio");
const libFileOps = require("@clusterio/lib/file_ops");

const finished = util.promisify(stream.finished);


function print(...content) {
	// eslint-disable-next-line no-console
	console.log(...content);
}

async function getEditor(argsEditor) {
	// eslint-disable-next-line
	return argsEditor || process.env.EDITOR || process.env.VISUAL || -1
	// needed for the process.env statements to not be flagged by eslint
	// priority for editors is CLI argument > env.EDITOR > env.VISUAL
}

async function configToKeyVal(data) {
	let final = {};
	let splitData = data.split(/\r?\n/);
	// split on newlines
	let filtered = splitData.filter((value) => value[0] !== "#").filter((a) => a);
	// the last filter removes empty elements left by the first. Not done on one line due to readability.
	for (let index in filtered) {
		if (index in filtered) {
			filtered[index] = filtered[index].split("=");
			let finalIndex = filtered[index][0].trim();
			// split on the = we added earlier, giving us both value and key
			let part = "";
			try {
				part = filtered[index][1].trim();
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

async function serializedConfigToString(serializedConfig, configGroup, disallowedList) {
	let allConfigElements = "";
	for (let group of serializedConfig.groups) {
		for (let [name, value] of Object.entries(group.fields)) {
			if (`${group.name}.${name}` in disallowedList) {
				continue;
			}
			let desc = "";
			try {
				desc += configGroup.groups.get(group.name)._definitions.get(name).description;
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

const masterCommands = new libCommand.CommandTree({ name: "master", description: "Master management" });
const masterConfigCommands = new libCommand.CommandTree({
	name: "config", alias: ["c"], description: "master config management",
});
masterConfigCommands.add(new libCommand.Command({
	definition: ["list", "List master configuration"],
	handler: async function(args, control) {
		let response = await libLink.messages.getMasterConfig.send(control);

		for (let group of response.serialized_config.groups) {
			for (let [name, value] of Object.entries(group.fields)) {
				print(`${group.name}.${name} ${JSON.stringify(value)}`);
			}
		}
	},
}));

masterConfigCommands.add(new libCommand.Command({
	definition: ["set <field> [value]", "Set field in master config", (yargs) => {
		yargs.positional("field", { describe: "Field to set", type: "string" });
		yargs.positional("value", { describe: "Value to set", type: "string" });
		yargs.options({
			"stdin": { describe: "read value from stdin", nargs: 0, type: "boolean" },
		});
	}],
	handler: async function(args, control) {
		if (args.stdin) {
			args.value = (await libHelpers.readStream(process.stdin)).toString().replace(/\r?\n$/, "");
		} else if (args.value === undefined) {
			args.value = "";
		}
		await libLink.messages.setMasterConfigField.send(control, {
			field: args.field,
			value: args.value,
		});
	},
}));

masterConfigCommands.add(new libCommand.Command({
	definition: ["set-prop <field> <prop> [value]", "Set property of field in master config", (yargs) => {
		yargs.positional("field", { describe: "Field to set", type: "string" });
		yargs.positional("prop", { describe: "Property to set", type: "string" });
		yargs.positional("value", { describe: "JSON parsed value to set", type: "string" });
		yargs.options({
			"stdin": { describe: "read value from stdin", nargs: 0, type: "boolean" },
		});
	}],
	handler: async function(args, control) {
		if (args.stdin) {
			args.value = (await libHelpers.readStream(process.stdin)).toString().replace(/\r?\n$/, "");
		}
		let request = {
			field: args.field,
			prop: args.prop,
		};
		try {
			if (args.value !== undefined) {
				request.value = JSON.parse(args.value);
			}
		} catch (err) {
			// See note for the instance version of set-prop
			if (args.stdin || /^(\[.*]|{.*}|".*")$/.test(args.value)) {
				throw new libErrors.CommandError(`In parsing value '${args.value}': ${err.message}`);
			}
			request.value = args.value;
		}
		await libLink.messages.setMasterConfigProp.send(control, request);
	},
}));
masterConfigCommands.add(new libCommand.Command({
	definition: ["edit [editor]", "Edit master configuration", (yargs) => {
		yargs.positional("editor", {
			describe: "Editor to use",
			type: "string",
			default: "",
		});
	}],
	handler: async function(args, control) {
		let response = await libLink.messages.getMasterConfig.send(control);
		let tmpFile = await libFileOps.getTempFile("ctl-", "-tmp", os.tmpdir());
		let editor = await getEditor(args.editor);
		if (editor === -1) {
			throw new libErrors.CommandError(`No editor avalible. Checked CLI input, EDITOR and VISUAL env vars
							  Try "ctl master config edit <editor of choice>"`);
		}
		let allConfigElements = await serializedConfigToString(response.serialized_config, libConfig.MasterConfig, {});
		await fs.writeFile(tmpFile, allConfigElements, (err) => {
			if (err) {
				throw err;
			}
		});
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
						await libLink.messages.setMasterConfigField.send(control, {
							field: index,
							value: final[index],
						});
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
		await fs.unlink(tmpFile, (err) => {
			if (err) {
				print("err: temporary file", tmpFile, "could not be deleted.");
				print("This is not fatal, but they may build up over time if the issue persists.");
			}
		});
	},
}));

masterCommands.add(masterConfigCommands);


const masterPluginCommands = new libCommand.CommandTree({
	name: "plugin", alias: ["p"], description: "master plugin inspection",
});
masterPluginCommands.add(new libCommand.Command({
	definition: ["list", "List plugins on master"],
	handler: async function(args, control) {
		let url = new URL(control.config.get("control.master_url"));
		url.pathname += "api/plugins";
		let response = await phin({
			url,
			parse: "json",
			core: { ca: control.tlsCa },
		});
		print(asTable(response.body));
	},
}));
masterCommands.add(masterPluginCommands);


const slaveCommands = new libCommand.CommandTree({ name: "slave", description: "Slave management" });
slaveCommands.add(new libCommand.Command({
	definition: [["list", "l"], "List slaves connected to the master"],
	handler: async function(args, control) {
		let response = await libLink.messages.listSlaves.send(control);
		print(asTable(response.list));
	},
}));

slaveCommands.add(new libCommand.Command({
	definition: ["generate-token", "Generate token for a slave", (yargs) => {
		yargs.option("id", { type: "number", nargs: 1, describe: "Slave id" });
	}],
	handler: async function(args, control) {
		let slaveId = typeof args.id === "number" ? args.id : null;
		let response = await libLink.messages.generateSlaveToken.send(control, { slave_id: slaveId });
		print(response.token);
	},
}));

slaveCommands.add(new libCommand.Command({
	definition: ["create-config", "Create slave config", (yargs) => {
		yargs.option("id", { type: "number", nargs: 1, describe: "Slave id", default: null });
		yargs.option("name", { type: "string", nargs: 1, describe: "Slave name", default: null });
		yargs.option("generate-token", {
			type: "boolean", nargs: 0, describe: "Generate authentication token", default: false,
		});
		yargs.option("output", {
			type: "string", nargs: 1, describe: "Path to output config (- for stdout)", default: "config-slave.json",
		});
	}],
	handler: async function(args, control) {
		let response = await libLink.messages.createSlaveConfig.send(control, {
			id: args.id, name: args.name, generate_token: args.generateToken,
		});

		let content = JSON.stringify(response.serialized_config, null, 4);
		if (args.output === "-") {
			print(content);
		} else {
			logger.info(`Writing ${args.output}`);
			try {
				await fs.outputFile(args.output, content, { flag: "wx" });
			} catch (err) {
				if (err.code === "EEXIST") {
					throw new libErrors.CommandError(`File ${args.output} already exists`);
				}
				throw err;
			}
		}
	},
}));


const instanceCommands = new libCommand.CommandTree({
	name: "instance", alias: ["i"], description: "Instance management",
});
instanceCommands.add(new libCommand.Command({
	definition: [["list", "l"], "List instances known to the master"],
	handler: async function(args, control) {
		let response = await libLink.messages.listInstances.send(control);
		print(asTable(response.list));
	},
}));

instanceCommands.add(new libCommand.Command({
	definition: ["create <name>", "Create an instance", (yargs) => {
		// XXX TODO: set any specific options?
		yargs.positional("name", { describe: "Instance name", type: "string" });
		yargs.options({
			"id": { type: "number", nargs: 1, describe: "Instance id" },
		});
	}],
	handler: async function(args, control) {
		let instanceConfig = new libConfig.InstanceConfig("control");
		await instanceConfig.init();
		if (args.id) {
			instanceConfig.set("instance.id", args.id);
		}
		instanceConfig.set("instance.name", args.name);
		let serialized_config = instanceConfig.serialize("master");
		await libLink.messages.createInstance.send(control, { serialized_config });
	},
}));

const instanceConfigCommands = new libCommand.CommandTree({
	name: "config", alias: ["c"], description: "Instance config management",
});
instanceConfigCommands.add(new libCommand.Command({
	definition: ["list <instance>", "List configuration for an instance", (yargs) => {
		yargs.positional("instance", { describe: "Instance to list config for", type: "string" });
	}],
	handler: async function(args, control) {
		let instanceId = await libCommand.resolveInstance(control, args.instance);
		let response = await libLink.messages.getInstanceConfig.send(control, { instance_id: instanceId });

		for (let group of response.serialized_config.groups) {
			for (let [name, value] of Object.entries(group.fields)) {
				print(`${group.name}.${name} ${JSON.stringify(value)}`);
			}
		}
	},
}));

instanceConfigCommands.add(new libCommand.Command({
	definition: ["set <instance> <field> [value]", "Set field in instance config", (yargs) => {
		yargs.positional("instance", { describe: "Instance to set config on", type: "string" });
		yargs.positional("field", { describe: "Field to set", type: "string" });
		yargs.positional("value", { describe: "Value to set", type: "string" });
		yargs.options({
			"stdin": { describe: "read value from stdin", nargs: 0, type: "boolean" },
		});
	}],
	handler: async function(args, control) {
		let instanceId = await libCommand.resolveInstance(control, args.instance);
		if (args.stdin) {
			args.value = (await libHelpers.readStream(process.stdin)).toString().replace(/\r?\n$/, "");
		} else if (args.value === undefined) {
			args.value = "";
		}
		await libLink.messages.setInstanceConfigField.send(control, {
			instance_id: instanceId,
			field: args.field,
			value: args.value,
		});
	},
}));

instanceConfigCommands.add(new libCommand.Command({
	definition: ["set-prop <instance> <field> <prop> [value]", "Set property of field in instance config", (yargs) => {
		yargs.positional("instance", { describe: "Instance to set config on", type: "string" });
		yargs.positional("field", { describe: "Field to set", type: "string" });
		yargs.positional("prop", { describe: "Property to set", type: "string" });
		yargs.positional("value", { describe: "JSON parsed value to set", type: "string" });
		yargs.options({
			"stdin": { describe: "read value from stdin", nargs: 0, type: "boolean" },
		});
	}],
	handler: async function(args, control) {
		let instanceId = await libCommand.resolveInstance(control, args.instance);
		if (args.stdin) {
			args.value = (await libHelpers.readStream(process.stdin)).toString().replace(/\r?\n$/, "");
		}
		let request = {
			instance_id: instanceId,
			field: args.field,
			prop: args.prop,
		};
		try {
			if (args.value !== undefined) {
				request.value = JSON.parse(args.value);
			}
		} catch (err) {
			// If this is from stdin or looks like an array, object or string
			// literal throw the parse error, otherwise assume this is a string.
			// The resoning behind this is that correctly quoting the string
			// with the all the layers of quote removal at play is difficult.
			// See the following table for how to pass "That's a \" quote" in
			// different environments:
			// cmd              : """""That's a \\"" quote"""""
			// cmd + npx        : """""""""""That's a \\\\"""" quote"""""""""""
			// PowerShell       : '"""""That''s a \\"" quote"""""'
			// PowerShell + npx : '"""""""""""That''s a \\\\"""" quote"""""""""""'
			// bash             : '""That'\''s a \" quote""'
			// bash + npx       : '""That'\''s a \" quote""'
			// bash + npx -s sh : "'\"\"That'\\''s a \\\" quote\"\"'"
			if (args.stdin || /^(\[.*]|{.*}|".*")$/.test(args.value)) {
				throw new libErrors.CommandError(`In parsing value '${args.value}': ${err.message}`);
			}
			request.value = args.value;
		}
		await libLink.messages.setInstanceConfigProp.send(control, request);
	},
}));

instanceConfigCommands.add(new libCommand.Command({
	definition: ["edit <instance> [editor]", "Edit instance configuration", (yargs) => {
		yargs.positional("instance", { describe: "Instance to set config on", type: "string" });
		yargs.positional("editor", {
			describe: "Editor to use",
			type: "string",
			default: "",
		});
	}],
	handler: async function(args, control) {
		let instanceId = await libCommand.resolveInstance(control, args.instance);
		let response = await libLink.messages.getInstanceConfig.send(control, { instance_id: instanceId });
		let tmpFile = await libFileOps.getTempFile("ctl-", "-tmp", os.tmpdir());
		let editor = await getEditor(args.editor);
		if (editor === -1) {
			throw new libErrors.CommandError(`No editor avalible. Checked CLI input, EDITOR and VISUAL env vars
							  Try "ctl master config edit <editor of choice>"`);
		}
		let disallowedList = {"instance.id": 0, "instance.assigned_slave": 0, "factorio.settings": 0};
		let allConfigElements = await serializedConfigToString(
			response.serialized_config,
			libConfig.InstanceConfig,
			disallowedList
		);
		await fs.writeFile(tmpFile, allConfigElements, (err) => {
			if (err) {
				throw err;
			}
		});
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
						await libLink.messages.setInstanceConfigField.send(control, {
							instance_id: instanceId,
							field: index,
							value: final[index],
						});
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
		await fs.unlink(tmpFile, (err) => {
			if (err) {
				print("err: temporary file", tmpFile, "could not be deleted.");
				print("This is not fatal, but they may build up over time if the issue persists.");
			}
		});
	},
}));
instanceCommands.add(instanceConfigCommands);

instanceCommands.add(new libCommand.Command({
	definition: ["assign <instance> [slave]", "Assign instance to a slave", (yargs) => {
		yargs.positional("instance", { describe: "Instance to assign", type: "string" });
		yargs.positional("slave", { describe: "Slave to assign to or unassign if none", type: "string" });
	}],
	handler: async function(args, control) {
		let instanceId = await libCommand.resolveInstance(control, args.instance);
		let slaveId = args.slave ? await libCommand.resolveSlave(control, args.slave) : null;
		await libLink.messages.assignInstanceCommand.send(control, {
			instance_id: instanceId,
			slave_id: slaveId,
		});
	},
}));

async function loadMapSettings(args) {
	let seed = args.seed !== undefined ? args.seed : null;
	let mapGenSettings = null;
	let mapSettings = null;
	if (args.mapExchangeString) {
		let parsed = libFactorio.readMapExchangeString(args.mapExchangeString);
		mapGenSettings = parsed.map_gen_settings;
		mapSettings = parsed.map_settings;
	}
	if (args.mapGenSettings) {
		mapGenSettings = JSON.parse(await fs.readFile(args.mapGenSettings));
	}
	if (args.mapSettings) {
		mapSettings = JSON.parse(await fs.readFile(args.mapSettings));
	}

	return {
		seed,
		mapGenSettings,
		mapSettings,
	};
}

const instanceSaveCommands = new libCommand.CommandTree({
	name: "save", alias: ["s"], description: "Instance save management",
});
instanceSaveCommands.add(new libCommand.Command({
	definition: ["list <instance>", "list saves on an instance", (yargs) => {
		yargs.positional("instance", { describe: "Instance to list saves on", type: "string" });
	}],
	handler: async function(args, control) {
		let instanceId = await libCommand.resolveInstance(control, args.instance);
		let response = await libLink.messages.listSaves.send(control, { instance_id: instanceId });
		for (let entry of response.list) {
			entry.mtime = new Date(entry.mtime_ms).toLocaleString();
			delete entry.mtime_ms;
		}
		print(asTable(response.list));
	},
}));

instanceSaveCommands.add(new libCommand.Command({
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
	handler: async function(args, control) {
		let instanceId = await libCommand.resolveInstance(control, args.instance);
		let { seed, mapGenSettings, mapSettings } = await loadMapSettings(args);
		await control.setLogSubscriptions({ instance_ids: [instanceId] });
		await libLink.messages.createSave.send(control, {
			instance_id: instanceId,
			name: args.name,
			seed,
			map_gen_settings: mapGenSettings,
			map_settings: mapSettings,
		});
	},
}));

instanceSaveCommands.add(new libCommand.Command({
	definition: ["rename <instance> <old-name> <new-name>", "Rename a save on an instance", (yargs) => {
		yargs.positional("instance", { describe: "Instance to rename save on", type: "string" });
		yargs.positional("old-name", { describe: "Old name of save.", type: "string" });
		yargs.positional("new-name", { describe: "New name of save.", type: "string" });
	}],
	handler: async function(args, control) {
		let instanceId = await libCommand.resolveInstance(control, args.instance);
		await libLink.messages.renameSave.send(control, {
			instance_id: instanceId,
			old_name: args.oldName,
			new_name: args.newName,
		});
	},
}));

instanceSaveCommands.add(new libCommand.Command({
	definition: ["copy <instance> <source> <destination>", "Copy a save on an instance", (yargs) => {
		yargs.positional("instance", { describe: "Instance to copy save on", type: "string" });
		yargs.positional("source", { describe: "Save to copy.", type: "string" });
		yargs.positional("destination", { describe: "Name of copy.", type: "string" });
	}],
	handler: async function(args, control) {
		let instanceId = await libCommand.resolveInstance(control, args.instance);
		await libLink.messages.copySave.send(control, {
			instance_id: instanceId,
			source: args.source,
			destination: args.destination,
		});
	},
}));

instanceSaveCommands.add(new libCommand.Command({
	definition: ["upload <instance> <filepath>", "Upload a save to an instance", (yargs) => {
		yargs.positional("instance", { describe: "Instance to upload to", type: "string" });
		yargs.positional("filepath", { describe: "Path to save to upload", type: "string" });
		yargs.options({
			"name": { describe: "Name to give save on server", nargs: 1, type: "string" },
		});
	}],
	handler: async function(args, control) {
		let filename = args.name || path.basename(args.filepath);
		if (!filename.endsWith(".zip")) {
			throw new libErrors.CommandError("Save name must end with .zip");
		}
		// phin doesn't support streaming requests :(
		let content = await fs.readFile(args.filepath);

		let instanceId = await libCommand.resolveInstance(control, args.instance);
		let url = new URL(control.config.get("control.master_url"));
		url.pathname += "api/upload-save";
		url.searchParams.append("instance_id", instanceId);
		url.searchParams.append("filename", filename);

		let result = await phin({
			url, method: "POST",
			headers: {
				"X-Access-Token": control.config.get("control.master_token"),
				"Content-Type": "application/zip",
			},
			core: { ca: control.tlsCa },
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
			throw new libErrors.CommandError("Uploading save failed");
		}
	},
}));

instanceSaveCommands.add(new libCommand.Command({
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
	handler: async function(args, control) {
		let sourceInstanceId = await libCommand.resolveInstance(control, args.sourceInstance);
		let targetInstanceId = await libCommand.resolveInstance(control, args.targetInstance);
		let result = await libLink.messages.transferSave.send(control, {
			instance_id: sourceInstanceId,
			source_save: args.sourceSave,
			target_instance_id: targetInstanceId,
			target_save: args.targetSave || args.sourceSave,
			copy: args.copy,
		});
		print(`Transferred as ${result.save} to ${args.targetInstance}.`);
	},
}));

instanceSaveCommands.add(new libCommand.Command({
	definition: ["download <instance> <save>", "Download a save from an instance", (yargs) => {
		yargs.positional("instance", { describe: "Instance to download save from", type: "string" });
		yargs.positional("save", { describe: "Save to download", type: "string" });
	}],
	handler: async function(args, control) {
		let instanceId = await libCommand.resolveInstance(control, args.instance);
		let result = await libLink.messages.downloadSave.send(control, {
			instance_id: instanceId,
			save: args.save,
		});

		let url = new URL(control.config.get("control.master_url"));
		url.pathname += `api/stream/${result.stream_id}`;
		let response = await phin({
			url, method: "GET",
			core: { ca: control.tlsCa },
			stream: true,
		});

		let writeStream;
		let tempFilename = args.save.replace(/(\.zip)?$/, ".tmp.zip");
		while (true) {
			try {
				writeStream = fs.createWriteStream(tempFilename, { flags: "wx" });
				await events.once(writeStream, "open");
				break;
			} catch (err) {
				if (err.code === "EEXIST") {
					tempFilename = await libFileOps.findUnusedName(".", tempFilename, ".tmp.zip");
				} else {
					throw err;
				}
			}
		}
		response.pipe(writeStream);
		await finished(writeStream);

		let filename = await libFileOps.findUnusedName(".", args.save, ".zip");
		await fs.rename(tempFilename, filename);

		logger.info(`Downloaded ${args.save}${args.save === filename ? "" : ` as ${filename}`}`);
	},
}));

instanceSaveCommands.add(new libCommand.Command({
	definition: ["delete <instance> <save>", "Delete a save from an instance", (yargs) => {
		yargs.positional("instance", { describe: "Instance to delete save from", type: "string" });
		yargs.positional("save", { describe: "Save to delete", type: "string" });
	}],
	handler: async function(args, control) {
		let instanceId = await libCommand.resolveInstance(control, args.instance);
		await libLink.messages.deleteSave.send(control, {
			instance_id: instanceId,
			save: args.save,
		});
	},
}));
instanceCommands.add(instanceSaveCommands);

instanceCommands.add(new libCommand.Command({
	definition: ["export-data <instance>", "Export item icons and locale from instance", (yargs) => {
		yargs.positional("instance", { describe: "Instance to export from", type: "string" });
	}],
	handler: async function(args, control) {
		let instanceId = await libCommand.resolveInstance(control, args.instance);
		await control.setLogSubscriptions({ instance_ids: [instanceId] });
		await libLink.messages.exportData.send(control, {
			instance_id: instanceId,
		});
	},
}));

instanceCommands.add(new libCommand.Command({
	definition: ["extract-players <instance>", "Extract players from running save into the cluster.", (yargs) => {
		yargs.positional("instance", { describe: "Instance to extract players and online time from", type: "string" });
	}],
	handler: async function(args, control) {
		let instanceId = await libCommand.resolveInstance(control, args.instance);
		await control.setLogSubscriptions({ instance_ids: [instanceId] });
		await libLink.messages.extractPlayers.send(control, {
			instance_id: instanceId,
		});
	},
}));

instanceCommands.add(new libCommand.Command({
	definition: ["start <instance>", "Start instance", (yargs) => {
		yargs.positional("instance", { describe: "Instance to start", type: "string" });
		yargs.options({
			"save": { describe: "Save load, defaults to latest", nargs: 1, type: "string" },
			"keep-open": { describe: "Keep console open", nargs: 0, type: "boolean", default: false },
		});
	}],
	handler: async function(args, control) {
		let instanceId = await libCommand.resolveInstance(control, args.instance);
		await control.setLogSubscriptions({ instance_ids: [instanceId] });
		await libLink.messages.startInstance.send(control, {
			instance_id: instanceId,
			save: args.save || null,
		});
		control.keepOpen = args.keepOpen;
	},
}));

instanceCommands.add(new libCommand.Command({
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
	handler: async function(args, control) {
		let instanceId = await libCommand.resolveInstance(control, args.instance);
		await control.setLogSubscriptions({ instance_ids: [instanceId] });
		let { seed, mapGenSettings, mapSettings } = await loadMapSettings(args);
		await libLink.messages.loadScenario.send(control, {
			instance_id: instanceId,
			scenario: args.scenario,
			seed,
			map_gen_settings: mapGenSettings,
			map_settings: mapSettings,
		});
		control.keepOpen = args.keepOpen;
	},
}));

instanceCommands.add(new libCommand.Command({
	definition: ["stop <instance>", "Stop instance", (yargs) => {
		yargs.positional("instance", { describe: "Instance to stop", type: "string" });
	}],
	handler: async function(args, control) {
		let instanceId = await libCommand.resolveInstance(control, args.instance);
		await control.setLogSubscriptions({ instance_ids: [instanceId] });
		await libLink.messages.stopInstance.send(control, {
			instance_id: instanceId,
		});
	},
}));

instanceCommands.add(new libCommand.Command({
	definition: ["kill <instance>", "Kill instance", (yargs) => {
		yargs.positional("instance", { describe: "Instance to kill", type: "string" });
	}],
	handler: async function(args, control) {
		let instanceId = await libCommand.resolveInstance(control, args.instance);
		await control.setLogSubscriptions({ instance_ids: [instanceId] });
		await libLink.messages.killInstance.send(control, {
			instance_id: instanceId,
		});
	},
}));

instanceCommands.add(new libCommand.Command({
	definition: ["delete <instance>", "Delete instance", (yargs) => {
		yargs.positional("instance", { describe: "Instance to delete", type: "string" });
	}],
	handler: async function(args, control) {
		await libLink.messages.deleteInstance.send(control, {
			instance_id: await libCommand.resolveInstance(control, args.instance),
		});
	},
}));

instanceCommands.add(new libCommand.Command({
	definition: ["send-rcon <instance> <command>", "Send RCON command", (yargs) => {
		yargs.positional("instance", { describe: "Instance to send to", type: "string" });
		yargs.positional("command", { describe: "command to send", type: "string" });
	}],
	handler: async function(args, control) {
		let response = await libLink.messages.sendRcon.send(control, {
			instance_id: await libCommand.resolveInstance(control, args.instance),
			command: args.command,
		});

		// Factorio includes a newline in it's response output.
		process.stdout.write(response.result);
	},
}));

const modPackCommands = new libCommand.CommandTree({ name: "mod-pack", description: "Mod Pack" });
modPackCommands.add(new libCommand.Command({
	definition: ["show <mod-pack>", "Show details of mod pack", (yargs) => {
		yargs.positional("mod-pack", { describe: "Mod pack to show", type: "string" });
	}],
	handler: async function(args, control) {
		let response = await libLink.messages.getModPack.send(control, {
			id: await libCommand.resolveModPack(control, args.modPack),
		});

		for (let [field, value] of Object.entries(response.mod_pack)) {
			if (field === "mods") {
				print(`${field}:`);
				for (let entry of value) {
					print(`  ${entry.name} ${entry.version}${entry.hash ? ` (${entry.hash})` : ""}`);
				}
			} else if (field === "settings") {
				print(`${field}:`);
				for (let [scope, settings] of Object.entries(value)) {
					print(`  ${scope}:`);
					for (let [setting, settingValue] of Object.entries(settings)) {
						print(`    ${setting}: ${JSON.stringify(settingValue.value)}`);
					}
				}

			} else {
				print(`${field}: ${value}`);
			}
		}
	},
}));

modPackCommands.add(new libCommand.Command({
	definition: [["list", "l"], "List mod packs in the cluster"],
	handler: async function(args, control) {
		let response = await libLink.messages.listModPacks.send(control);
		let fields = ["id", "name", "factorio_version"];
		for (let entry of response.list) {
			for (let field of Object.keys(entry)) {
				if (!fields.includes(field)) {
					delete entry[field];
				}
			}
		}
		print(asTable(response.list));
	},
}));

function setModPackSettings(modPack, args) {
	function doSettings(settings, cast) {
		for (let i = 0; i + 2 < settings.length; i += 3) {
			const [scope, name, value] = settings.slice(i, i + 3);
			if (!["startup", "runtime-global", "runtime-per-user"].includes(scope)) {
				throw new libErrors.CommandError(
					`Setting scope must be one of startup, runtime-gloabl, or runtime-per-user, not ${scope}`
				);
			}
			modPack.settings[scope].set(name, { value: cast(value) });
		}
	}

	doSettings(args.boolSetting || [], value => {
		if (!["true", "false"].includes(value)) {
			throw new libErrors.CommandError(`boolean value must be one of true or false, not ${value}`);
		}
		return value === "true";
	});
	doSettings(args.intSetting || [], value => {
		// eslint-disable-next-line radix
		let number = Number.parseInt(value);
		if (isNaN(number)) {
			throw new libErrors.CommandError(`int value must be an integer, not ${value}`);
		}
		return number;
	});
	doSettings(args.doubleSetting || [], value => {
		let number = Number.parseFloat(value);
		if (isNaN(number)) {
			throw new libErrors.CommandError(`double value must be a number, not ${value}`);
		}
		return number;
	});
	doSettings(args.stringSetting || [], value => value);
}

function setModPackMods(modPack, mods) {
	for (let mod of mods || []) {
		const [name, version, sha1] = mod.split(":");
		if (!version) {
			throw new libErrors.CommandError("Added mod must be formatted as name:version or name:version:sha1");
		}
		if (!/^\d+\.\d+\.\d+$/.test(version)) {
			throw new libErrors.CommandError("version must match the format digit.digit.digit");
		}
		if (sha1 && !/^[0-9a-f]{40}$/.test(sha1)) {
			throw new libErrors.CommandError("sha1 must be a 40 digit lower case hex string");
		}
		modPack.mods.set(name, { name, version, hash: sha1 ? `sha1:${sha1}` : undefined });
	}
}

modPackCommands.add(new libCommand.Command({
	definition: ["create <name> <factorio-version>", "Create mod-pack", (yargs) => {
		yargs.positional("name", { describe: "Name of mod pack to create", type: "string" });
		yargs.positional("factorio-version", { describe: "Version of factorio the mod pack is for", type: "string" });
		yargs.options({
			"description": { describe: "Description for mod pack", type: "string" },
			"mods": { describe: "Mods in the form of name:version[:sha1]", array: true, type: "string" },
			"bool-setting": { describe: "Set boolean setting", array: true, nargs: 3, type: "string" },
			"int-setting": { describe: "Set int setting", array: true, nargs: 3, type: "string" },
			"double-setting": { describe: "Set double setting", array: true, nargs: 3, type: "string" },
			"string-setting": { describe: "Set string setting", array: true, nargs: 3, type: "string" },
		});
	}],
	handler: async function(args, control) {
		const modPack = new libData.ModPack();
		modPack.name = args.name;
		if (args.description) { modPack.description = args.description; }
		if (args.factorioVersion) {
			if (!/^\d+\.\d+(\.\d+)?$/.test(args.factorioVersion)) {
				throw new libErrors.CommandError("factorio-version must match the format digit.digit[.digit]");
			}
			modPack.factorioVersion = args.factorioVersion;
		}
		setModPackMods(modPack, args.mods);
		setModPackSettings(modPack, args);
		await libLink.messages.createModPack.send(control, { mod_pack: modPack.toJSON() });
		print(`Created mod pack ${modPack.name} (${modPack.id})`);
	},
}));

modPackCommands.add(new libCommand.Command({
	definition: ["edit <mod-pack>", "Edit mod-pack", (yargs) => {
		yargs.positional("mod-pack", { describe: "Mod pack to remove from", type: "string" });
		yargs.options({
			"name": { describe: "New name for mod pack", type: "string" },
			"description": { describe: "New description for mod pack", type: "string" },
			"factorio-version": { describe: "Set version of factorio the mod pack is for", type: "string" },
			"add-mods": { describe: "Mods in the form of name:version[:sha1] to add", array: true, type: "string" },
			"remove-mods": { describe: "Name of mods to remove", array: true, type: "string" },
			"bool-setting": { describe: "Set boolean setting", array: true, nargs: 3, type: "string" },
			"int-setting": { describe: "Set int setting", array: true, nargs: 3, type: "string" },
			"double-setting": { describe: "Set double setting", array: true, nargs: 3, type: "string" },
			"string-setting": { describe: "Set string setting", array: true, nargs: 3, type: "string" },
			"remove-setting": { describe: "Remove a setting", array: true, nargs: 2, type: "string" },
		});
	}],
	handler: async function(args, control) {
		let response = await libLink.messages.getModPack.send(control, {
			id: await libCommand.resolveModPack(control, args.modPack),
		});
		let modPack = new libData.ModPack(response.mod_pack);

		if (args.name) { modPack.name = args.name; }
		if (args.description) { modPack.description = args.description; }
		if (args.factorioVersion) {
			if (!/^\d+\.\d+(\.\d+)?$/.test(args.factorioVersion)) {
				throw new libErrors.CommandError("factorio-version must match the format digit.digit[.digit]");
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

		setModPackSettings(modPack, args);
		if (args.removeSetting) {
			for (let i = 0; i + 1 < args.removeSetting.length; i += 2) {
				const [scope, name] = settings.slice(i, i + 2);
				if (!["startup", "runtime-global", "runtime-per-user"].includes(scope)) {
					throw new libErrors.CommandError(
						`Setting scope must be one of startup, runtime-gloabl, or runtime-per-user, not ${scope}`
					);
				}
				if (modPack.settings[scope].has(name)) {
					modPack.settings[scope].delete(name);
				} else {
					logger.warn(`Mod setting ${scope} ${name} did not exist on ${modPack.name}`);
				}
			}
		}
		await libLink.messages.updateModPack.send(control, { mod_pack: modPack.toJSON() });
	},
}));

modPackCommands.add(new libCommand.Command({
	definition: ["delete <mod-pack>", "Delete mod-pack", (yargs) => {
		yargs.positional("mod-pack", { describe: "Mod pack to delete", type: "string" });
	}],
	handler: async function(args, control) {
		const id = await libCommand.resolveModPack(control, args.modPack);
		await libLink.messages.deleteModPack.send(control, { id });
	},
}));

const modCommands = new libCommand.CommandTree({ name: "mod", description: "Manage uploaded mods" });
modCommands.add(new libCommand.Command({
	definition: ["show <name> <mod-version>", "Show details for a mod stored in the cluster", (yargs) => {
		yargs.positional("name", { describe: "Mod name to show details for", type: "string" });
		yargs.positional("mod-version", { describe: "Version of the mod", type: "string" });
	}],
	handler: async function(args, control) {
		let response = await libLink.messages.getMod.send(control, { name: args.name, version: args.modVersion });
		for (let [field, value] of Object.entries(response.mod)) {
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

modCommands.add(new libCommand.Command({
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
	handler: async function(args, control) {
		let response = await libLink.messages.listMods.send(control);
		if (!args.fields.includes("all")) {
			for (let entry of response.list) {
				for (let field of Object.keys(entry)) {
					if (!args.fields.includes(field)) {
						delete entry[field];
					}
				}
			}
		}
		print(asTable(response.list));
	},
}));

modCommands.add(new libCommand.Command({
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
	handler: async function(args, control) {
		let response = await libLink.messages.searchMods.send(control, {
			"query": args.query,
			"factorio_version": args.factorioVersion,
			"page_size": args.pageSize,
			"page": args.page,
			"sort": args.sort,
			"sort_order": args.sortOrder,
		});
		let results = response.results.flatMap(result => result.versions);
		if (!args.fields.includes("all")) {
			for (let entry of results) {
				for (let field of Object.keys(entry)) {
					if (!args.fields.includes(field)) {
						delete entry[field];
					}
				}
			}
		}
		for (let issue of response.query_issues) {
			print(issue);
		}
		print(`page ${args.page} of ${response.page_count} (${response.result_count} results)`);
		print(asTable(results));
	},
}));

modCommands.add(new libCommand.Command({
	definition: ["upload <file>", "Upload mod to the cluster", (yargs) => {
		yargs.positional("file", { describe: "File to upload", type: "string" });
	}],
	handler: async function(args, control) {
		let filename = path.basename(args.file);
		if (!filename.endsWith(".zip")) {
			throw new libErrors.CommandError("Mod filename must end with .zip");
		}
		// phin doesn't support streaming requests :(
		let content = await fs.readFile(args.file);

		let url = new URL(control.config.get("control.master_url"));
		url.pathname += "api/upload-mod";
		url.searchParams.append("filename", filename);

		let result = await phin({
			url, method: "POST",
			headers: {
				"X-Access-Token": control.config.get("control.master_token"),
				"Content-Type": "application/zip",
			},
			core: { ca: control.tlsCa },
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
			logger.info(`Successfully uploaded ${result.body.mods[0].filename}`);
		}

		if ((result.body.errors || []).length || (result.body.request_errors || []).length) {
			throw new libErrors.CommandError("Uploading mod failed");
		}
	},
}));

modCommands.add(new libCommand.Command({
	definition: ["download <name> <mod-version>", "Download a mod from the cluster", (yargs) => {
		yargs.positional("name", { describe: "Internal name of mod to download", type: "string" });
		yargs.positional("mod-version", { describe: "Version of mod to download", type: "string" });
	}],
	handler: async function(args, control) {
		let result = await libLink.messages.downloadMod.send(control, {
			name: args.name,
			version: args.modVersion,
		});

		let url = new URL(control.config.get("control.master_url"));
		url.pathname += `api/stream/${result.stream_id}`;
		let response = await phin({
			url, method: "GET",
			core: { ca: control.tlsCa },
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
			} catch (err) {
				if (err.code === "EEXIST") {
					tempFilename = await libFileOps.findUnusedName(".", tempFilename, ".tmp.zip");
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

modCommands.add(new libCommand.Command({
	definition: ["delete <name> <mod-version>", "Delete a mod stored in the cluster", (yargs) => {
		yargs.positional("name", { describe: "Name of mod to delete", type: "string" });
		yargs.positional("mod-version", { describe: "Version of mod to delete", type: "string" });
	}],
	handler: async function(args, control) {
		await libLink.messages.deleteMod.send(control, { name: args.name, version: args.modVersion });
	},
}));

const permissionCommands = new libCommand.CommandTree({ name: "permission", description: "Permission inspection" });
permissionCommands.add(new libCommand.Command({
	definition: [["list", "l"], "List permissions in the cluster"],
	handler: async function(args, control) {
		let response = await libLink.messages.listPermissions.send(control);
		print(asTable(response.list));
	},
}));


const roleCommands = new libCommand.CommandTree({ name: "role", description: "Role management" });
roleCommands.add(new libCommand.Command({
	definition: [["list", "l"], "List roles in the cluster"],
	handler: async function(args, control) {
		let response = await libLink.messages.listRoles.send(control);
		print(asTable(response.list));
	},
}));

roleCommands.add(new libCommand.Command({
	definition: ["create <name>", "Create a new role", (yargs) => {
		yargs.positional("name", { describe: "Name of role to create", type: "string" });
		yargs.options({
			"description": { describe: "Description for role", nargs: 1, type: "string", default: "" },
			"permissions": { describe: "Permissions role grants", nargs: 1, array: true, type: "string", default: [] },
		});
	}],
	handler: async function(args, control) {
		let response = await libLink.messages.createRole.send(control, {
			name: args.name,
			description: args.description,
			permissions: args.permissions,
		});
		logger.info(`Created role ID ${response.id}`);
	},
}));

roleCommands.add(new libCommand.Command({
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
	handler: async function(args, control) {
		let role = await libCommand.retrieveRole(control, args.role);

		if (args.name !== undefined) {
			role.name = args.name;
		}
		if (args.description !== undefined) {
			role.description = args.description;
		}
		if (args.addPerms) {
			role.permissions = role.permissions.concat(args.addPerms);
		}
		if (args.removePerms) {
			let perms = new Set(role.permissions);
			for (let perm of args.removePerms) {
				perms.delete(perm);
			}
			role.permissions = [...perms];
		}
		if (args.setPerms !== undefined) {
			role.permissions = args.setPerms;
		}
		await libLink.messages.updateRole.send(control, role);

		if (args.grantDefault) {
			await libLink.messages.grantDefaultRolePermissions.send(control, { id: role.id });
		}
	},
}));

roleCommands.add(new libCommand.Command({
	definition: ["delete <role>", "Delete role", (yargs) => {
		yargs.positional("role", { describe: "Role to delete", type: "string" });
	}],
	handler: async function(args, control) {
		let role = await libCommand.retrieveRole(control, args.role);
		await libLink.messages.deleteRole.send(control, { id: role.id });
	},
}));


const userCommands = new libCommand.CommandTree({ name: "user", alias: ["u"], description: "User management" });
userCommands.add(new libCommand.Command({
	definition: ["show <name>", "Show details for one user", (yargs) => {
		yargs.positional("name", { decribe: "Name of user to show", type: "string" });
		yargs.options({
			"instance-stats": { describe: "include per-instance stats", nargs: 0, type: "boolean", default: false },
		});
	}],
	handler: async function(args, control) {
		let response = await libLink.messages.getUser.send(control, { name: args.name });
		delete response["seq"];
		Object.assign(response, response["player_stats"]);
		delete response["player_stats"];
		let instanceStats = response["instance_stats"];
		delete response["instance_stats"];
		print(asTable(Object.entries(response).map(([property, value]) => ({ property, value }))));

		if (args.instanceStats) {
			let instances = (await libLink.messages.listInstances.send(control)).list;
			function instanceName(id) {
				let instance = instances.find(i => i.id === id);
				if (instance) {
					return instance.name;
				}
				return "<deleted>";
			}
			for (let [id, playerInstanceStats] of instanceStats) {
				print();
				print(`Instance ${instanceName(id)} (${id}):`);
				print(asTable(Object.entries(playerInstanceStats).map(([property, value]) => ({ property, value }))));
			}
		}
	},
}));

userCommands.add(new libCommand.Command({
	definition: [["list", "l"], "List user in the cluster", (yargs) => {
		yargs.options({
			"stats": { describe: "include user stats", nargs: 0, type: "boolean", default: false },
			"attributes": { describe: "include admin/whitelisted/banned", nargs: 0, type: "boolean", default: false },
		});
	}],
	handler: async function(args, control) {
		let response = await libLink.messages.listUsers.send(control);
		for (let user of response.list) {
			if (args.stats) {
				Object.assign(user, user["player_stats"]);
			}
			delete user["player_stats"];
			if (!args.attributes) {
				delete user["is_admin"];
				delete user["is_whitelisted"];
				delete user["is_banned"];
			}
		}
		print(asTable(response.list));
	},
}));

userCommands.add(new libCommand.Command({
	definition: ["create <name>", "Create a user", (yargs) => {
		yargs.positional("name", { describe: "Name of user to create", type: "string" });
	}],
	handler: async function(args, control) {
		await libLink.messages.createUser.send(control, { name: args.name });
	},
}));

userCommands.add(new libCommand.Command({
	definition: ["set-admin <user>", "Promote or demote a user to admin", (yargs) => {
		yargs.positional("user", { describe: "Name of user set admin status for", type: "string" });
		yargs.options({
			"revoke": { describe: "Revoke admin status", nargs: 0, type: "boolean", default: false },
			"create": { describe: "Create user if it does not exist", nargs: 0, type: "boolean", default: false },
		});
	}],
	handler: async function(args, control) {
		await libLink.messages.setUserAdmin.send(control, {
			name: args.user, create: args.create, admin: !args.revoke,
		});
	},
}));

userCommands.add(new libCommand.Command({
	definition: ["set-whitelisted <user>", "Add or remove user from the whitelist", (yargs) => {
		yargs.positional("user", { describe: "Name of user to set whitelist status for", type: "string" });
		yargs.options({
			"remove": { describe: "Remove from whitelist", nargs: 0, type: "boolean", default: false },
			"create": { describe: "Create user if it does not exist", nargs: 0, type: "boolean", default: false },
		});
	}],
	handler: async function(args, control) {
		await libLink.messages.setUserWhitelisted.send(control, {
			name: args.user, create: args.create, whitelisted: !args.remove,
		});
	},
}));

userCommands.add(new libCommand.Command({
	definition: ["set-banned <user>", "Ban or pardon user from banlist", (yargs) => {
		yargs.positional("user", { describe: "Name of user to set ban status for", type: "string" });
		yargs.options({
			"pardon": { describe: "Remove from banlist", nargs: 0, type: "boolean", default: false },
			"reason": { describe: "Ban reason", nargs: 1, type: "string", default: "" },
			"create": { describe: "Create user if it does not exist", nargs: 0, type: "boolean", default: false },
		});
	}],
	handler: async function(args, control) {
		await libLink.messages.setUserBanned.send(control, {
			name: args.user, create: args.create, banned: !args.pardon, reason: args.reason,
		});
	},
}));

userCommands.add(new libCommand.Command({
	definition: ["set-roles <user> [roles...]", "Replace user roles", (yargs) => {
		yargs.positional("user", { describe: "Name of user to change roles for", type: "string" });
		yargs.positional("roles", { describe: "roles to assign", type: "string" });
	}],
	handler: async function(args, control) {
		let response = await libLink.messages.listRoles.send(control);

		let resolvedRoles = [];
		for (let roleName of args.roles) {
			if (/^-?\d+$/.test(roleName)) {
				let roleId = parseInt(roleName, 10);
				resolvedRoles.push(roleId);

			} else {
				let found = false;
				for (let role of response.list) {
					if (role.name === roleName) {
						resolvedRoles.push(role.id);
						found = true;
						break;
					}
				}

				if (!found) {
					throw new libErrors.CommandError(`No role named ${roleName}`);
				}
			}
		}

		await libLink.messages.updateUserRoles.send(control, { name: args.user, roles: resolvedRoles });
	},
}));

userCommands.add(new libCommand.Command({
	definition: ["delete <user>", "Delete user", (yargs) => {
		yargs.positional("user", { describe: "Name of user to delete", type: "string" });
	}],
	handler: async function(args, control) {
		await libLink.messages.deleteUser.send(control, { name: args.user });
	},
}));

const logCommands = new libCommand.CommandTree({ name: "log", description: "Log inspection" });
logCommands.add(new libCommand.Command({
	definition: ["follow", "follow cluster log", (yargs) => {
		yargs.options({
			"all": { describe: "Follow the whole cluster log", nargs: 0, type: "boolean", default: false },
			"master": { describe: "Follow log of the master server", nargs: 0, type: "boolean", default: false },
			"slave": { describe: "Follow log of given slave", nargs: 1, type: "string", default: null },
			"instance": { describe: "Follow log of given instance", nargs: 1, type: "string", default: null },
		});
	}],
	handler: async function(args, control) {
		if (!args.all && !args.master && !args.slave && !args.instance) {
			logger.error("At least one of --all, --master, --slave and --instance must be passed");
			process.exitCode = 1;
			return;
		}
		let instance_ids = args.instance ? [await libCommand.resolveInstance(control, args.instance)] : [];
		let slave_ids = args.slave ? [await libCommand.resolveSlave(control, args.slave)] : [];
		await control.setLogSubscriptions({ all: args.all, master: args.master, slave_ids, instance_ids });
		control.keepOpen = true;
	},
}));

logCommands.add(new libCommand.Command({
	definition: ["query", "Query cluster log", (yargs) => {
		yargs.options({
			"all": { describe: "Query the whole cluster log", nargs: 0, type: "boolean", default: false },
			"master": { describe: "Query log of the master server", nargs: 0, type: "boolean", default: false },
			"slave": { describe: "Query log of given slave", nargs: 1, type: "string", default: null },
			"instance": { describe: "Query log of given instance", nargs: 1, type: "string", default: null },
			"max-level": { describe: "Maximum log level to return", nargs: 1, type: "string", default: null },
			"limit": { describe: "Max number of entries to return", nargs: 1, type: "number", default: 1000 },
			"start": { describe: "Limit from the start instead of the end", nargs: 0, type: "boolean", default: false },
		});
	}],
	handler: async function(args, control) {
		if (!args.all && !args.master && !args.slave && !args.instance) {
			logger.error("At least one of --all, --master, --slave and --instance must be passed");
			process.exitCode = 1;
			return;
		}
		let instance_ids = args.instance ? [await libCommand.resolveInstance(control, args.instance)] : [];
		let slave_ids = args.slave ? [await libCommand.resolveSlave(control, args.slave)] : [];
		let result = await libLink.messages.queryLog.send(control, {
			all: args.all,
			master: args.master,
			slave_ids,
			instance_ids,
			max_level: args.maxLevel,
			limit: args.limit,
			order: args.start ? "asc" : "desc",
		});

		if (!args.start) {
			result.log.reverse();
		}

		let stdoutLogger = winston.createLogger({
			level: "verbose",
			levels,
			format: new libLoggingUtils.TerminalFormat({ showTimestamp: true }),
			transports: [
				new ConsoleTransport({ errorLevels: [], warnLevels: [] }),
			],
		});
		for (let info of result.log) {
			stdoutLogger.log(info);
		}
	},
}));

const debugCommands = new libCommand.CommandTree({ name: "debug", description: "Debugging utilities" });
debugCommands.add(new libCommand.Command({
	definition: ["dump-ws", "Dump WebSocket messages sent and received by master", (yargs) => { }],
	handler: async function(args, control) {
		await libLink.messages.debugDumpWs.send(control);
		control.keepOpen = true;
	},
}));

async function registerCommands(controlPlugins, yargs) {
	const rootCommands = new libCommand.CommandTree({ name: "clusterioctl", description: "Manage cluster" });
	rootCommands.add(masterCommands);
	rootCommands.add(slaveCommands);
	rootCommands.add(instanceCommands);
	rootCommands.add(modPackCommands);
	rootCommands.add(modCommands);
	rootCommands.add(permissionCommands);
	rootCommands.add(roleCommands);
	rootCommands.add(userCommands);
	rootCommands.add(logCommands);
	rootCommands.add(debugCommands);

	for (let controlPlugin of controlPlugins.values()) {
		await controlPlugin.addCommands(rootCommands);
	}

	for (let [name, command] of rootCommands.subCommands) {
		if (name === command.name) {
			command.register(yargs);
		}
	}

	return rootCommands;
}

module.exports = {
	registerCommands,
};
