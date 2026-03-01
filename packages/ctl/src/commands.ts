import type { Argv } from "yargs";

import * as lib from "@clusterio/lib";
import type BaseCtlPlugin from "./BaseCtlPlugin";
import { controllerCommands } from "./commands_controller";
import { hostCommands } from "./commands_host";
import { instanceCommands } from "./commands_instance";
import { modPackCommands } from "./commands_mod_pack";
import { modCommands } from "./commands_mod";
import { permissionCommands } from "./commands_permission";
import { roleCommands } from "./commands_role";
import { userCommands } from "./commands_user";
import { logCommands } from "./commands_log";
import { debugCommands } from "./commands_debug";

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
