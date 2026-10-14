import * as lib from "@clusterio/lib";

export default function(context: lib.MigrationContext) {
	const { hooks, plugin } = context;
	// migrate: inventory_sync was renamed to player_sync in 2.0.0-alpha.28
	const renameFields = (config: lib.ConfigSchema) => (
		lib.renameConfigPrefix(config, "inventory_sync.", "player_sync.")
	);
	hooks.controllerConfig.attach(plugin.name, renameFields);
	hooks.hostConfig.attach(plugin.name, renameFields);
	hooks.instanceConfig.attach(plugin.name, renameFields);
	hooks.role.attach(plugin.name, role => lib.renamePermissionPrefix(role, "inventory_sync.", "player_sync."));
}
