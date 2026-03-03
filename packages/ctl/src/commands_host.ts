import fs from "fs-extra";
import asTableModule from "as-table";
import events from "events";
import os from "os";
import child_process from "child_process";

import * as lib from "@clusterio/lib";
import { logger } from "@clusterio/lib";
import type { Control } from "../ctl";
import { print } from "./command_ops";
import { serializedConfigToString, getEditor, configToKeyVal } from "./config_ops";

const asTable = asTableModule.configure({ delimiter: " | " });

export const hostCommands = new lib.CommandTree({ name: "host", description: "Host management" });
hostCommands.add(new lib.Command({
	definition: ["stop <host>", "Stop the given host", (yargs) => {
		yargs.positional("host", { describe: "Host to stop", type: "string" });
	}],
	handler: async function(args: { host: string }, control: Control) {
		let hostId = await lib.resolveHost(control, args.host);
		await control.sendTo({ hostId }, new lib.HostStopRequest());
	},
}));

hostCommands.add(new lib.Command({
	definition: ["restart <host>", "Restart the given host", (yargs) => {
		yargs.positional("host", { describe: "Host to restart", type: "string" });
	}],
	handler: async function(args: { host: string }, control: Control) {
		let hostId = await lib.resolveHost(control, args.host);
		await control.sendTo({ hostId }, new lib.HostRestartRequest());
	},
}));

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
		let config = await control.send(
			new lib.HostConfigCreateRequest(args.id, args.name, args.generateToken)
		);

		let content = JSON.stringify(config, null, "\t");
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
hostCommands.add(new lib.Command({
	definition: ["update <host>", "Update the host", (yargs) => {
		yargs.positional("host", { describe: "Host to update", type: "string" });
		yargs.option("restart", { alias: "r", type: "boolean", description: "Restart after update" });
	}],
	handler: async function(args: { host: string, restart: boolean }, control: Control) {
		let hostId = await lib.resolveHost(control, args.host);
		await control.sendTo({ hostId }, new lib.HostUpdateRequest());
		if (args.restart) {
			await control.sendTo({ hostId }, new lib.HostRestartRequest());
		} else {
			print("Host updated; a restart is required to apply the changes.");
		}
	},
}));


const hostConfigCommands = new lib.CommandTree({
	name: "config", alias: ["c"], description: "Host config management",
});
hostConfigCommands.add(new lib.Command({
	definition: ["list <host>", "List configuration for a host", (yargs) => {
		yargs.positional("host", { describe: "Host to list config for", type: "string" });
	}],
	handler: async function(args: { host: string }, control: Control) {
		let hostId = await lib.resolveHost(control, args.host);
		let config = await control.sendTo({ hostId }, new lib.HostConfigGetRequest());

		for (let [name, value] of Object.entries(config)) {
			print(`${name} ${JSON.stringify(value)}`);
		}
	},
}));

hostConfigCommands.add(new lib.Command({
	definition: ["set <host> <field> [value]", "Set field in host config", (yargs) => {
		yargs.positional("host", { describe: "Host to set config on", type: "string" });
		yargs.positional("field", { describe: "Field to set", type: "string" });
		yargs.positional("value", { describe: "Value to set", type: "string" });
		yargs.options({
			"stdin": { describe: "read value from stdin", nargs: 0, type: "boolean" },
		});
	}],
	handler: async function(
		args: { host: string, field: string, value?: string, stdin?: boolean },
		control: Control,
	) {
		let hostId = await lib.resolveHost(control, args.host);
		if (args.stdin) {
			args.value = (await lib.readStream(process.stdin)).toString().replace(/\r?\n$/, "");
		} else if (args.value === undefined) {
			args.value = "";
		}
		await control.sendTo({ hostId }, new lib.HostConfigSetFieldRequest(args.field, args.value));
	},
}));

hostConfigCommands.add(new lib.Command({
	definition: ["set-prop <host> <field> <prop> [value]", "Set property of field in host config", (yargs) => {
		yargs.positional("host", { describe: "Host to set config on", type: "string" });
		yargs.positional("field", { describe: "Field to set", type: "string" });
		yargs.positional("prop", { describe: "Property to set", type: "string" });
		yargs.positional("value", { describe: "JSON parsed value to set", type: "string" });
		yargs.options({
			"stdin": { describe: "read value from stdin", nargs: 0, type: "boolean" },
		});
	}],
	handler: async function(
		args: { host: string, field: string, prop: string, value?: string, stdin?: boolean },
		control: Control
	) {
		let hostId = await lib.resolveHost(control, args.host);
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
		await control.sendTo({ hostId }, new lib.HostConfigSetPropRequest(args.field, args.prop, value));
	},
}));

hostConfigCommands.add(new lib.Command({
	definition: ["edit <host> [editor]", "Edit host configuration", (yargs) => {
		yargs.positional("host", { describe: "Host to set config on", type: "string" });
		yargs.positional("editor", {
			describe: "Editor to use",
			type: "string",
			default: "",
		});
	}],
	handler: async function(args: { host: string, editor: string }, control: Control) {
		let hostId = await lib.resolveHost(control, args.host);
		let config = await control.sendTo({ hostId }, new lib.HostConfigGetRequest());
		let tmpFile = await lib.getTempFile("ctl-", "-tmp", os.tmpdir());
		let editor = await getEditor(args.editor);
		if (editor === undefined) {
			throw new lib.CommandError(`No editor avalible. Checked CLI input, EDITOR and VISUAL env vars
							  Try "ctl controller config edit <editor of choice>"`);
		}
		let disallowedList = {"host.id": 0};
		let allConfigElements = serializedConfigToString(
			config,
			lib.HostConfig,
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
					await control.sendTo({ hostId }, new lib.HostConfigSetFieldRequest(
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

hostCommands.add(hostConfigCommands);


const hostPluginCommands = new lib.CommandTree({
	name: "plugin", alias: ["p"], description: "host plugin inspection",
});
hostPluginCommands.add(new lib.Command({
	definition: ["list <host>", "List plugins on a host", (yargs) => {
		yargs.positional("host", { describe: "Host to list for", type: "string" });
	}],
	handler: async function(args: { host: string }, control: Control) {
		let hostId = await lib.resolveHost(control, args.host);
		const plugins = await control.sendTo({ hostId }, new lib.PluginListRequest());
		print(asTable(plugins.map(p => ({
			title: p.title, version: p.version, loaded: p.loaded, enabled: p.enabled, npmPackage: p.npmPackage,
		}))));
	},
}));
hostPluginCommands.add(new lib.Command({
	definition: ["update <host> <plugin>", "Update a plugin on a host", (yargs) => {
		yargs.positional("host", { describe: "Host to update on", type: "string" });
		yargs.positional("plugin", { describe: "Plugin to update", type: "string" });
		yargs.option("restart", { alias: "r", type: "boolean", description: "Restart after update" });
	}],
	handler: async function(args: { host: string, plugin: string, restart: boolean }, control: Control) {
		let hostId = await lib.resolveHost(control, args.host);
		await control.sendTo({ hostId }, new lib.PluginUpdateRequest(args.plugin));
		if (args.restart) {
			await control.sendTo({ hostId }, new lib.HostRestartRequest());
		} else {
			print("Plugin updated; a restart is required to apply the changes.");
		}
	},
}));
hostPluginCommands.add(new lib.Command({
	definition: ["install <host> <plugin>", "Install a plugin on a host", (yargs) => {
		yargs.positional("host", { describe: "Host to install on", type: "string" });
		yargs.positional("plugin", { describe: "Plugin to install", type: "string" });
		yargs.option("restart", { alias: "r", type: "boolean", description: "Restart after update" });
	}],
	handler: async function(args: { host: string, plugin: string, restart: boolean }, control: Control) {
		let hostId = await lib.resolveHost(control, args.host);
		await control.sendTo({ hostId }, new lib.PluginInstallRequest(args.plugin));
		if (args.restart) {
			await control.sendTo({ hostId }, new lib.HostRestartRequest());
		} else {
			print("Plugin installed; a restart is required to apply the changes.");
		}
	},
}));
hostCommands.add(hostPluginCommands);
