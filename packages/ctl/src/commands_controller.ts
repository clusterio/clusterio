import fs from "fs-extra";
import asTableModule from "as-table";
import events from "events";
import phin from "phin";
import os from "os";
import child_process from "child_process";

import * as lib from "@clusterio/lib";
import type { Control } from "../ctl";
import { print } from "./command_ops";
import { serializedConfigToString, getEditor, configToKeyVal } from "./config_ops";

const asTable = asTableModule.configure({ delimiter: " | " });

export const controllerCommands = new lib.CommandTree({ name: "controller", description: "Controller management" });
controllerCommands.add(new lib.Command({
	definition: ["stop", "Stop controller"],
	handler: async function(_args: object, control: Control) {
		await control.send(new lib.ControllerStopRequest());
	},
}));

controllerCommands.add(new lib.Command({
	definition: ["restart", "Restart controller"],
	handler: async function(_args: object, control: Control) {
		await control.send(new lib.ControllerRestartRequest());
	},
}));
controllerCommands.add(new lib.Command({
	definition: ["update", "Update the controller", (yargs) => {
		yargs.option("restart", { alias: "r", type: "boolean", description: "Restart after update" });
	}],
	handler: async function(args: { restart: boolean }, control: Control) {
		await control.send(new lib.ControllerUpdateRequest());
		if (args.restart) {
			await control.send(new lib.ControllerRestartRequest());
		} else {
			print("Controller updated; a restart is required to apply the changes.");
		}
	},
}));

const controllerConfigCommands = new lib.CommandTree({
	name: "config", alias: ["c"], description: "controller config management",
});

controllerConfigCommands.add(new lib.Command({
	definition: ["list", "List controller configuration"],
	handler: async function(args: object, control: Control) {
		let config = await control.send(new lib.ControllerConfigGetRequest());

		for (let [name, value] of Object.entries(config)) {
			print(`${name} ${JSON.stringify(value)}`);
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
		await control.send(new lib.ControllerConfigSetFieldRequest(args.field, args.value));
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
		let config = await control.send(new lib.ControllerConfigGetRequest());
		let tmpFile = await lib.getTempFile("ctl-", "-tmp", os.tmpdir());
		let editor = await getEditor(args.editor);
		if (editor === undefined) {
			throw new lib.CommandError(`No editor avalible. Checked CLI input, EDITOR and VISUAL env vars
							  Try "ctl controller config edit <editor of choice>"`);
		}
		let allConfigElements = serializedConfigToString(
			config, lib.ControllerConfig, {}
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
		let url = new URL(control.config.get("control.controller_url")!);
		url.pathname += "api/plugins";
		let response = await phin<[]>({
			url,
			parse: "json",
			core: { ca: control.tlsCa } as object,
		});
		print(asTable(response.body));
	},
}));
controllerPluginCommands.add(new lib.Command({
	definition: ["update <plugin>", "Update a plugin on the controller", (yargs) => {
		yargs.positional("plugin", { describe: "Plugin to update", type: "string" });
		yargs.option("restart", { alias: "r", type: "boolean", description: "Restart after update" });
	}],
	handler: async function(args: { plugin: string, restart: boolean }, control: Control) {
		await control.sendTo("controller", new lib.PluginUpdateRequest(args.plugin));
		if (args.restart) {
			await control.send(new lib.ControllerRestartRequest());
		} else {
			print("Plugin updated; a restart is required to apply the changes.");
		}
	},
}));
controllerPluginCommands.add(new lib.Command({
	definition: ["install <plugin>", "Install a plugin on the controller", (yargs) => {
		yargs.positional("plugin", { describe: "Plugin to install", type: "string" });
		yargs.option("restart", { alias: "r", type: "boolean", description: "Restart after update" });
	}],
	handler: async function(args: { plugin: string, restart: boolean }, control: Control) {
		await control.sendTo("controller", new lib.PluginInstallRequest(args.plugin));
		if (args.restart) {
			await control.send(new lib.ControllerRestartRequest());
		} else {
			print("Plugin installed; a restart is required to apply the changes.");
		}
	},
}));

controllerCommands.add(controllerPluginCommands);
