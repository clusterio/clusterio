import crypto from "node:crypto";
import jwt from "jsonwebtoken";

import * as lib from "@clusterio/lib";
import { logger } from "@clusterio/lib";

import type Controller from "./Controller.js";
import HostRecord from "./HostRecord.js";

/**
 * Access layer for hosts on the controller.
 *
 * @alias module:controller/src/HostManager
 */
export default class HostManager {
	constructor(
		public readonly records: lib.SubscribableDatastore<HostRecord>,
		private readonly _controller: Controller,
	) { }

	/* ------------------------------------------------------------------------- */
	/* Basic Accessors                                                           */
	/* ------------------------------------------------------------------------- */

	has(id: HostRecord["id"]): boolean {
		return this.records.has(id);
	}

	getMutable(id: HostRecord["id"]): HostRecord | undefined {
		return this.records.getMutable(id);
	}

	get(id: HostRecord["id"]): Readonly<HostRecord> | undefined {
		return this.records.get(id);
	}

	valuesMutable(): IterableIterator<HostRecord> {
		return this.records.values();
	}

	values(): IterableIterator<Readonly<HostRecord>> {
		return this.valuesMutable();
	}

	/**
	 * Get host by ID for a request.
	 *
	 * @param hostId - ID of host to get.
	 * @returns The host record.
	 * @throws {module:lib.NotFoundError} if the host does not exist.
	 */
	getForRequest(hostId: number): HostRecord {
		const host = this.records.getMutable(hostId);
		if (!host) {
			throw new lib.NotFoundError(`Unknown host id (${hostId})`);
		}
		return host;
	}

	/* ------------------------------------------------------------------------- */
	/* Lifecycle                                                                 */
	/* ------------------------------------------------------------------------- */

	/**
	 * Create a host record with a new random id
	 *
	 * @param name - Name of the host.
	 * @returns the created host record.
	 */
	createHost(name: string): HostRecord {
		let hostId;
		do {
			hostId = crypto.randomInt(1, 2 ** 31);
		} while (this.records.has(hostId));

		const host = new HostRecord(
			hostId, name, "", new Map(), false, "", "", Math.floor(Date.now() / 1000),
		);
		this.records.set(host);
		return host;
	}

	/**
	 * Delete a host, disconnect it and unassign its instances
	 *
	 * @param hostId - ID of host to revoke.
	 * @param revokedBy - Name of the user revoking it, for logging.
	 */
	async revokeHost(hostId: number, revokedBy: string) {
		const host = this.getForRequest(hostId);
		this.records.delete(host);
		this._controller.deleteNote("host", hostId, revokedBy);
		const system = this._controller.systems.getMutable(hostId);
		if (system) {
			this._controller.systems.delete(system);
		}

		// Disconnected first so unassigning the instances does not depend on the host responding.
		const hostConnection = this._controller.wsServer.hostConnections.get(hostId);
		if (hostConnection) {
			hostConnection.connector.terminate();
		}
		const assigned = [...this._controller.instances.values()].filter(
			instance => instance.config.get("instance.assigned_host") === hostId
		);
		for (const instance of assigned) {
			await this._controller.instances.unassignInstance(instance.id);
		}
		logger.audit(`User ${revokedBy} revoked host ${host.name} (${host.id})`);
	}

	/* ------------------------------------------------------------------------- */
	/* Helpers                                                                   */
	/* ------------------------------------------------------------------------- */

	/**
	 * Sign access token for the given host
	 *
	 * @param hostId - ID of host to sign token for.
	 * @returns JWT access token for the host.
	 */
	signHostToken(hostId: number): string {
		return jwt.sign({ aud: "host", host: hostId }, this._controller.authSecret);
	}

	/**
	 * Check a host token
	 *
	 * @param token - Host token to check.
	 * @returns ID of the host the token was issued to.
	 * @throws if the token is invalid, its host is not registered or it was issued before tokenValidAfter.
	 */
	verifyHostToken(token: string): number {
		// migrate: allow pre-rename tokens issued to hosts before alpha-14
		const payload = jwt.verify(token, this._controller.authSecret, { audience: ["host", "slave"] });
		if (typeof payload === "string") {
			throw new Error("unexpected JsonWebToken type");
		}
		const hostId = payload.host !== undefined ? payload.host : payload.slave;
		const host = this.records.get(hostId);
		if (!host) {
			throw new Error("host is not registered, start the host again to request to join the cluster");
		}
		if (!payload.iat || payload.iat < host.tokenValidAfter) {
			throw new Error("invalid token");
		}
		return hostId;
	}
}
