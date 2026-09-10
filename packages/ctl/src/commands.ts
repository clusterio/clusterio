import type { Argv } from "yargs";

import * as lib from "@clusterio/lib";
import type BaseCtlPlugin from "./BaseCtlPlugin.js";
import { controllerCommands } from "./commands_controller.js";
import { hostCommands } from "./commands_host.js";
import { instanceCommands } from "./commands_instance.js";
import { modPackCommands } from "./commands_mod_pack.js";
import { modCommands } from "./commands_mod.js";
import { permissionCommands } from "./commands_permission.js";
import { roleCommands } from "./commands_role.js";
import { userCommands } from "./commands_user.js";
import { logCommands } from "./commands_log.js";
import { debugCommands } from "./commands_debug.js";

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
