import fs from "node:fs/promises";
import events from "events";
import os from "os";
import child_process from "child_process";

import * as lib from "@clusterio/lib";
import { logger } from "@clusterio/lib";
import type { Ctl } from "../ctl.js";
import { asTable, print } from "./command_ops.js";
import {
	serializedConfigToString, getEditor, configToKeyVal, printConfig, printRestartRequired,
} from "./config_ops.js";

export const controllerCommands = new lib.CommandTree({ name: "controller", description: "Controller management" });
controllerCommands.add(new lib.Command({
	definition: ["stop", "Stop controller"],
	handler: async function(_args: object, ctl: Ctl) {
		await ctl.send(new lib.ControllerStopRequest());
	},
}));

controllerCommands.add(new lib.Command({
	definition: ["restart", "Restart controller"],
	handler: async function(_args: object, ctl: Ctl) {
		await ctl.send(new lib.ControllerRestartRequest());
	},
}));
controllerCommands.add(new lib.Command({
	definition: ["mark-restart-required", "Mark the controller as requiring a restart"],
	handler: async function(_args: object, ctl: Ctl) {
		await ctl.send(new lib.ControllerMarkRestartRequiredRequest());
	},
}));
controllerCommands.add(new lib.Command({
	definition: ["update", "Update the controller", (yargs) => {
		yargs.option("restart", { alias: "r", type: "boolean", description: "Restart after update" });
		yargs.option("all", { alias: "a", type: "boolean", description: "Also update all plugins" });
	}],
	handler: async function(args: { restart: boolean, all: boolean }, ctl: Ctl) {
		if (args.all) {
			await ctl.send(new lib.UpdateAllRequest());
		} else {
			await ctl.send(new lib.ControllerUpdateRequest());
		}
		if (args.restart) {
			await ctl.send(new lib.ControllerRestartRequest());
		}
		printRestartRequired(ctl, !args.restart, "Controller updated");
	},
}));

const controllerConfigCommands = new lib.CommandTree({
	name: "config", alias: ["c"], description: "controller config management",
});

controllerConfigCommands.add(new lib.Command({
	definition: ["list", "List controller configuration"],
	handler: async function(args: object, ctl: Ctl) {
		printConfig(ctl, await ctl.send(new lib.ControllerConfigGetRequest()));
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
	handler: async function(args: { field: string, value?: string, stdin?: boolean }, ctl: Ctl) {
		if (args.stdin) {
			args.value = (await lib.readStream(process.stdin)).toString().replace(/\r?\n$/, "");
		} else if (args.value === undefined) {
			args.value = "";
		}
		await ctl.send(new lib.ControllerConfigSetFieldRequest(args.field, args.value));
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
	handler: async function(args: { field: string, prop: string, value?: string, stdin?: boolean }, ctl: Ctl) {
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
		await ctl.send(new lib.ControllerConfigSetPropRequest(args.field, args.prop, value));
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
	handler: async function(args: { editor: string }, ctl: Ctl) {
		let config = await ctl.send(new lib.ControllerConfigGetRequest());
		let tmpFile = await lib.getTempFile("ctl-", "-tmp", os.tmpdir());
		let editor = await getEditor(args.editor);
		if (editor === undefined) {
			throw new lib.CommandError(`No editor avalible. Checked CLI input, EDITOR and VISUAL env vars
							  Try "ctl controller config edit <editor of choice>"`);
		}
		let allConfigElements = serializedConfigToString(config, lib.ControllerConfig);
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
					await ctl.send(new lib.ControllerConfigSetFieldRequest(
						index,
						final[index],
					));
				} catch (err: any) {
					// If the string is empty, it's better to just print "" instead of nothing
					logger.error(
						`Attempt to set ${index} to ${final[index] || String(null)} failed; ` +
						`set back to previous value: ${err.message}`
					);
				}
			}
		}
		try {
			await fs.unlink(tmpFile);
		} catch (err) {
			logger.warn(
				`Temporary file ${tmpFile} could not be deleted. ` +
				"This is not fatal, but they may build up over time if the issue persists."
			);
		}
	},
}));

controllerCommands.add(controllerConfigCommands);


const controllerPluginCommands = new lib.CommandTree({
	name: "plugin", alias: ["p"], description: "controller plugin inspection",
});
controllerPluginCommands.add(new lib.Command({
	definition: ["list", "List plugins on controller"],
	handler: async function(args: object, ctl: Ctl) {
		let url = new URL(ctl.config.get("ctl.controller_url")!);
		url.pathname += "api/plugins";
		let response = await fetch(url);
		ctl.output.table(await response.json() as object[]);
	},
}));
controllerPluginCommands.add(new lib.Command({
	definition: ["update <plugin>", "Update a plugin on the controller", (yargs) => {
		yargs.positional("plugin", { describe: "Plugin to update, optionally as name@version", type: "string" });
		yargs.option("restart", { alias: "r", type: "boolean", description: "Restart after update" });
	}],
	handler: async function(args: { plugin: string, restart: boolean }, ctl: Ctl) {
		await ctl.sendTo("controller", new lib.PluginUpdateRequest(args.plugin));
		if (args.restart) {
			await ctl.send(new lib.ControllerRestartRequest());
		}
		printRestartRequired(ctl, !args.restart, "Plugin updated");
	},
}));
controllerPluginCommands.add(new lib.Command({
	definition: ["search [query]", "Search npm for plugins", (yargs) => {
		yargs.positional("query", { describe: "Text to search for", type: "string", default: "" });
		yargs.option("page", { type: "number", description: "Page of results to show", default: 1 });
		yargs.option("page-size", { type: "number", description: "Results per page", default: 20 });
	}],
	handler: async function(args: { query: string, page: number, pageSize: number }, ctl: Ctl) {
		const response = await ctl.sendTo(
			"controller", new lib.PluginSearchRequest(args.query, args.page, args.pageSize)
		);
		const results = response.results.map(plugin => ({
			name: plugin.name,
			version: plugin.version,
			publisher: plugin.publisher ?? "",
			description: plugin.description ?? "",
		}));
		ctl.output.result({ total: response.total, results }, () => {
			print(asTable(results));
			print(`Showing ${results.length} of ${response.total} results`);
		});
	},
}));
controllerPluginCommands.add(new lib.Command({
	definition: ["install <plugin>", "Install a plugin on the controller", (yargs) => {
		yargs.positional("plugin", { describe: "Plugin to install, optionally as name@version", type: "string" });
		yargs.option("restart", { alias: "r", type: "boolean", description: "Restart after update" });
	}],
	handler: async function(args: { plugin: string, restart: boolean }, ctl: Ctl) {
		await ctl.sendTo("controller", new lib.PluginInstallRequest(args.plugin));
		if (args.restart) {
			await ctl.send(new lib.ControllerRestartRequest());
		}
		printRestartRequired(ctl, !args.restart, "Plugin installed");
	},
}));

controllerCommands.add(controllerPluginCommands);
