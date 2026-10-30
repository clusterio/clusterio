import fs from "node:fs/promises";
import asTableModule from "as-table";
import events from "events";
import os from "os";
import child_process from "child_process";

import * as lib from "@clusterio/lib";
import type { Ctl } from "../ctl.js";
import { print } from "./command_ops.js";
import { serializedConfigToString, getEditor, configToKeyVal } from "./config_ops.js";

const asTable = asTableModule.configure({ delimiter: " | " });

export const hostCommands = new lib.CommandTree({ name: "host", description: "Host management" });
hostCommands.add(new lib.Command({
	definition: ["stop <host>", "Stop the given host", (yargs) => {
		yargs.positional("host", { describe: "Host to stop", type: "string" });
	}],
	handler: async function(args: { host: string }, ctl: Ctl) {
		let hostId = await lib.resolveHost(ctl, args.host);
		await ctl.sendTo({ hostId }, new lib.HostStopRequest());
	},
}));

hostCommands.add(new lib.Command({
	definition: ["restart <host>", "Restart the given host", (yargs) => {
		yargs.positional("host", { describe: "Host to restart", type: "string" });
	}],
	handler: async function(args: { host: string }, ctl: Ctl) {
		let hostId = await lib.resolveHost(ctl, args.host);
		await ctl.sendTo({ hostId }, new lib.HostRestartRequest());
	},
}));

hostCommands.add(new lib.Command({
	definition: ["mark-restart-required <host>", "Mark the given host as requiring a restart", (yargs) => {
		yargs.positional("host", { describe: "Host to mark", type: "string" });
	}],
	handler: async function(args: { host: string }, ctl: Ctl) {
		let hostId = await lib.resolveHost(ctl, args.host);
		await ctl.sendTo({ hostId }, new lib.HostMarkRestartRequiredRequest());
	},
}));

hostCommands.add(new lib.Command({
	definition: [["list", "l"], "List hosts connected to the controller"],
	handler: async function(args: object, ctl: Ctl) {
		let hosts = await ctl.send(new lib.HostListRequest());
		print(asTable(hosts));
	},
}));

/** Format a duration in milliseconds as a short age like "1m 5s" */
function formatAge(ms: number) {
	const seconds = Math.max(0, Math.floor(ms / 1000));
	if (seconds < 60) {
		return `${seconds}s`;
	}
	if (seconds < 3600) {
		return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
	}
	return `${Math.floor(seconds / 3600)}h ${Math.floor(seconds / 60) % 60}m`;
}

/** Strip case and separators the same way the controller does when matching pairing codes */
function plainCode(code: string) {
	return code.toUpperCase().replace(/[^0-9A-Z]/g, "");
}

hostCommands.add(new lib.Command({
	definition: ["pending", "List host installers waiting for approval"],
	handler: async function(args: object, ctl: Ctl) {
		let requests = await ctl.send(new lib.HostPairingListRequest());
		if (!requests.length) {
			print("No pending host requests");
			return;
		}
		let now = Date.now();
		print(asTable(requests.map(request => ({
			code: request.code,
			name: request.name,
			address: request.remoteAddress,
			age: formatAge(now - request.createdAtMs),
		}))));
	},
}));

hostCommands.add(new lib.Command({
	definition: ["approve <code>", "Approve a host installer waiting for approval", (yargs) => {
		yargs.positional("code", { describe: "Code shown by the installer", type: "string" });
		yargs.option("name", {
			type: "string", nargs: 1, describe: "Name to give the host instead of the one it asked for",
		});
	}],
	handler: async function(args: { code: string, name?: string }, ctl: Ctl) {
		let name = args.name?.trim();
		if (name === undefined) {
			let requests = await ctl.send(new lib.HostPairingListRequest());
			name = requests.find(request => plainCode(request.code) === plainCode(args.code))?.name;
		}
		let hostId = await ctl.send(new lib.HostPairingApproveRequest(args.code, args.name));
		print(name ? `Approved host ${name} with id ${hostId}` : `Approved host with id ${hostId}`);
	},
}));

hostCommands.add(new lib.Command({
	definition: ["reject <code>", "Reject a host installer waiting for approval", (yargs) => {
		yargs.positional("code", { describe: "Code shown by the installer", type: "string" });
	}],
	handler: async function(args: { code: string }, ctl: Ctl) {
		await ctl.send(new lib.HostPairingRejectRequest(args.code));
	},
}));

hostCommands.add(new lib.Command({
	definition: ["revoke <host>", "Remove a host from the cluster and disconnect it", (yargs) => {
		yargs.positional("host", { describe: "Host to revoke", type: "string" });
	}],
	handler: async function(args: { host: string }, ctl: Ctl) {
		let hostId = await lib.resolveHost(ctl, args.host);
		await ctl.send(new lib.HostRevokeRequest(hostId));
	},
}));

hostCommands.add(new lib.Command({
	definition: ["update <host>", "Update the host", (yargs) => {
		yargs.positional("host", { describe: "Host to update", type: "string" });
		yargs.option("restart", { alias: "r", type: "boolean", description: "Restart after update" });
		yargs.option("all", { alias: "a", type: "boolean", description: "Also update all plugins" });
	}],
	handler: async function(args: { host: string, restart: boolean, all: boolean }, ctl: Ctl) {
		let hostId = await lib.resolveHost(ctl, args.host);
		if (args.all) {
			await ctl.sendTo({ hostId }, new lib.UpdateAllRequest());
		} else {
			await ctl.sendTo({ hostId }, new lib.HostUpdateRequest());
		}
		if (args.restart) {
			await ctl.sendTo({ hostId }, new lib.HostRestartRequest());
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
	handler: async function(args: { host: string }, ctl: Ctl) {
		let hostId = await lib.resolveHost(ctl, args.host);
		let config = await ctl.sendTo({ hostId }, new lib.HostConfigGetRequest());

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
		ctl: Ctl,
	) {
		let hostId = await lib.resolveHost(ctl, args.host);
		if (args.stdin) {
			args.value = (await lib.readStream(process.stdin)).toString().replace(/\r?\n$/, "");
		} else if (args.value === undefined) {
			args.value = "";
		}
		await ctl.sendTo({ hostId }, new lib.HostConfigSetFieldRequest(args.field, args.value));
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
		ctl: Ctl
	) {
		let hostId = await lib.resolveHost(ctl, args.host);
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
		await ctl.sendTo({ hostId }, new lib.HostConfigSetPropRequest(args.field, args.prop, value));
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
	handler: async function(args: { host: string, editor: string }, ctl: Ctl) {
		let hostId = await lib.resolveHost(ctl, args.host);
		let config = await ctl.sendTo({ hostId }, new lib.HostConfigGetRequest());
		let tmpFile = await lib.getTempFile("ctl-", "-tmp", os.tmpdir());
		let editor = await getEditor(args.editor);
		if (editor === undefined) {
			throw new lib.CommandError(`No editor avalible. Checked CLI input, EDITOR and VISUAL env vars
							  Try "ctl host config edit <editor of choice>"`);
		}
		let allConfigElements = serializedConfigToString(config, lib.HostConfig);
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
					await ctl.sendTo({ hostId }, new lib.HostConfigSetFieldRequest(
						index,
						final[index],
					));
				} catch (err) {
					// eslint-disable-next-line
					print(`Attempt to set ${index} to ${final[index] || String(null)} failed; set back to previous value.`);
					// If the string is empty, it's better to just print "" instead of nothing
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
	handler: async function(args: { host: string }, ctl: Ctl) {
		let hostId = await lib.resolveHost(ctl, args.host);
		const plugins = await ctl.sendTo({ hostId }, new lib.PluginListRequest());
		print(asTable(plugins.map(p => ({
			title: p.title, version: p.version, loaded: p.loaded, enabled: p.enabled, npmPackage: p.npmPackage,
		}))));
	},
}));
hostPluginCommands.add(new lib.Command({
	definition: ["update <host> <plugin>", "Update a plugin on a host", (yargs) => {
		yargs.positional("host", { describe: "Host to update on", type: "string" });
		yargs.positional("plugin", { describe: "Plugin to update, optionally as name@version", type: "string" });
		yargs.option("restart", { alias: "r", type: "boolean", description: "Restart after update" });
	}],
	handler: async function(args: { host: string, plugin: string, restart: boolean }, ctl: Ctl) {
		let hostId = await lib.resolveHost(ctl, args.host);
		await ctl.sendTo({ hostId }, new lib.PluginUpdateRequest(args.plugin));
		if (args.restart) {
			await ctl.sendTo({ hostId }, new lib.HostRestartRequest());
		} else {
			print("Plugin updated; a restart is required to apply the changes.");
		}
	},
}));
hostPluginCommands.add(new lib.Command({
	definition: ["install <host> <plugin>", "Install a plugin on a host", (yargs) => {
		yargs.positional("host", { describe: "Host to install on", type: "string" });
		yargs.positional("plugin", { describe: "Plugin to install, optionally as name@version", type: "string" });
		yargs.option("restart", { alias: "r", type: "boolean", description: "Restart after update" });
	}],
	handler: async function(args: { host: string, plugin: string, restart: boolean }, ctl: Ctl) {
		let hostId = await lib.resolveHost(ctl, args.host);
		await ctl.sendTo({ hostId }, new lib.PluginInstallRequest(args.plugin));
		if (args.restart) {
			await ctl.sendTo({ hostId }, new lib.HostRestartRequest());
		} else {
			print("Plugin installed; a restart is required to apply the changes.");
		}
	},
}));
hostCommands.add(hostPluginCommands);
