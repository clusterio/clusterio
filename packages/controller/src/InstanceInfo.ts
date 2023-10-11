import type * as lib from "@clusterio/lib";

/**
 * Current status of the instance. One of:
 * - `unknown`: Instance is assigned to a host but this host is currently
 *   not connected to the contreller.
 * - `unassigned`: Instance is not assigned to a a host and exists only on
 *   the controller.
 * - `stopped`: Instance is stopped.
 * - `starting`: Instance is in the process of starting up.
 * - `running`: Instance is running normally.
 * - `stopping`: Instance is in the process of stopping.
 * - `creating_save`: Instance is in the process of creating a save.
 * - `exporting_data`: Instance is in the process of exporting game data.
 * - `deleted`: Instance has been deleted.
 */
export type InstanceStatus =
		"unknown" | "unassigned" | "stopped" | "starting" | "running" |
		"stopping" | "creating_save" | "exporting_data" | "deleted";


/**
 * Runtime status of an instance on the controller
 * @alias module:controller/src/InstanceInfo
 */
export default class InstanceInfo {
	config: lib.InstanceConfig;
	status: InstanceStatus;
	game_port: number | null = null;

	constructor(
		{ config, status }:
		{ config: lib.InstanceConfig, status: InstanceStatus }
	) {
		this.config = config;
		this.status = status;
	}

	toJSON() {
		return {
			config: this.config.serialize(),
			status: this.status,
		};
	}

	/** Shorthand for `instance.config.get("instance.id")` */
	get id():number {
		return this.config.get("instance.id");
	}
}
