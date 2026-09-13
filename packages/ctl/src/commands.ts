import type { Argv } from "yargs";

import * as lib from "@clusterio/lib";
import type BaseCtlPlugin from "./BaseCtlPlugin.ts";
import { controllerCommands } from "./commands_controller.ts";
import { hostCommands } from "./commands_host.ts";
import { instanceCommands } from "./commands_instance.ts";
import { modPackCommands } from "./commands_mod_pack.ts";
import { modCommands } from "./commands_mod.ts";
import { permissionCommands } from "./commands_permission.ts";
import { roleCommands } from "./commands_role.ts";
import { userCommands } from "./commands_user.ts";
import { logCommands } from "./commands_log.ts";
import { debugCommands } from "./commands_debug.ts";

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
