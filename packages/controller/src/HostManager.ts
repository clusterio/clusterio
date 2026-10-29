import crypto from "node:crypto";
import jwt from "jsonwebtoken";

import * as lib from "@clusterio/lib";
import { logger } from "@clusterio/lib";

import type Controller from "./Controller.js";
import FailureLimiter from "./FailureLimiter.js";
import HostRecord from "./HostRecord.js";

/**
 * Access layer for hosts and host invites on the controller.
 *
 * @alias module:controller/src/HostManager
 */
export default class HostManager {
	/** Failed host invite attempts per client address */
	inviteLimiter = new FailureLimiter(5, 15 * 60e3);

	constructor(
		public readonly records: lib.SubscribableDatastore<HostRecord>,
		public readonly invites: lib.SubscribableDatastore<lib.HostInvite>,
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

	values(): IterableIterator<Readonly<HostRecord>> {
		return this.records.values();
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
			throw new lib.NotFoundError(`Host with ID ${hostId} does not exist`);
		}
		return host;
	}

	/* ------------------------------------------------------------------------- */
	/* Tokens                                                                    */
	/* ------------------------------------------------------------------------- */

	/** Random host id not used by a known host or an earlier invite claim */
	unusedId() {
		const claimedIds = new Set([...this.invites.values()].flatMap(invite => invite.hostIds));
		let hostId;
		do {
			hostId = crypto.randomInt(1, 2 ** 31);
		} while (this.records.has(hostId) || claimedIds.has(hostId));
		return hostId;
	}

	/**
	 * Generate access token for host
	 *
	 * @param hostId - ID of host to generate a token for.
	 * @returns access token for host
	 */
	createToken(hostId: number): string {
		return jwt.sign({ aud: "host", host: hostId }, this._controller.authSecret);
	}

	/**
	 * Invalidate all tokens issued to a host so far and disconnect it
	 *
	 * @param hostId - ID of host to revoke tokens for.
	 */
	revokeTokens(hostId: number) {
		const host = this.getForRequest(hostId);
		host.tokenValidAfter = Math.floor(Date.now() / 1000);

		const hostConnection = this._controller.wsServer.hostConnections.get(hostId);
		if (hostConnection) {
			hostConnection.connector.terminate();
		}

		this.records.set(host);
	}

	/* ------------------------------------------------------------------------- */
	/* Invites                                                                   */
	/* ------------------------------------------------------------------------- */

	static generateInviteCode() {
		const alphabet = lib.HostInvite.codeAlphabet;
		let code = "";
		for (let i = 0; i < lib.HostInvite.codeLength; i++) {
			code += alphabet[crypto.randomInt(alphabet.length)];
		}
		return code;
	}

	/** True if all invites are paused by controller.host_invites_paused */
	get invitesPaused() {
		return this._controller.config.get("controller.host_invites_paused");
	}

	/**
	 * Create an invite new hosts can use to get a host token
	 * @param expiresAtMs - Time the invite expires at, null for never.
	 * @param maxUses - Number of hosts that can use the invite, null for unlimited.
	 * @param createdBy - Name of the user creating the invite.
	 */
	createInvite(expiresAtMs: number | null, maxUses: number | null, createdBy = "") {
		if (expiresAtMs !== null && expiresAtMs <= Date.now()) {
			throw new lib.InvalidValueError("Expiry time must be in the future");
		}
		const codes = new Set([...this.invites.values()].map(invite => invite.code));
		let code;
		do {
			code = HostManager.generateInviteCode();
		} while (codes.has(code));
		let id;
		do {
			id = crypto.randomInt(1, 2 ** 31);
		} while (this.invites.has(id));

		const invite = new lib.HostInvite(id, code, createdBy, Date.now(), expiresAtMs, maxUses);
		this.invites.set(invite);
		logger.audit(`User ${createdBy} created host invite ${id}`);
		return invite;
	}

	/**
	 * Change the limits of a host invite or pause it
	 * @param id - Id of invite to change.
	 * @param changes - New values, undefined leaves a value unchanged and null removes a limit.
	 * @param updatedBy - Name of the user changing the invite.
	 */
	updateInvite(
		id: number,
		changes: { expiresAtMs?: number | null, maxUses?: number | null, paused?: boolean },
		updatedBy = "",
	) {
		const invite = this.invites.getMutable(id);
		if (!invite) {
			throw new lib.NotFoundError(`Host invite ${id} does not exist`);
		}
		if (invite.isDead()) {
			throw new lib.InvalidValueError(`Host invite ${id} expired over 24 hours ago and cannot be changed`);
		}
		if (changes.expiresAtMs !== undefined) {
			invite.expiresAtMs = changes.expiresAtMs;
		}
		if (changes.maxUses !== undefined) {
			invite.maxUses = changes.maxUses;
		}
		if (changes.paused !== undefined) {
			invite.paused = changes.paused;
		}
		this.invites.set(invite);
		logger.audit(`User ${updatedBy} updated host invite ${id}`);
	}

	revokeInvite(id: number, revokedBy = "") {
		const invite = this.invites.getMutable(id);
		if (!invite) {
			throw new lib.NotFoundError(`Host invite ${id} does not exist`);
		}
		this.invites.delete(invite);
		logger.audit(`User ${revokedBy} revoked host invite ${id}`);
	}

	/** Find the invite with the given code, comparing in constant time and skipping dead invites */
	findInvite(code: string, nowMs = Date.now()) {
		const codeBuffer = Buffer.from(code);
		let found: Readonly<lib.HostInvite> | undefined;
		for (const invite of this.invites.values()) {
			const inviteBuffer = Buffer.from(invite.code);
			if (inviteBuffer.length === codeBuffer.length && crypto.timingSafeEqual(inviteBuffer, codeBuffer)) {
				found = invite;
			}
		}
		return found && !found.isDead(nowMs) ? found : undefined;
	}

	/**
	 * Use up one claim of a host invite and issue a token for a new host id
	 *
	 * Runs synchronously so concurrent claims cannot exceed the use limit.
	 * @param code - Normalised invite code.
	 * @param remoteAddress - Address of the client claiming the invite, for logging.
	 * @param name - Name the host will use, for logging.
	 * @returns new host id and token, or null if the invite is not usable.
	 */
	claimInvite(code: string, remoteAddress = "", name?: string) {
		const nowMs = Date.now();
		const found = this.findInvite(code, nowMs);
		if (this.invitesPaused || !found || !found.isUsable(nowMs)) {
			return null;
		}
		const invite = this.invites.getMutable(found.id)!;
		const hostId = this.unusedId();
		invite.hostIds.push(hostId);
		invite.lastUsedAtMs = nowMs;
		this.invites.set(invite);
		logger.audit(
			`Host invite ${invite.id} used by ${remoteAddress} for new host ${hostId}` +
			`${name !== undefined ? ` named ${JSON.stringify(name)}` : ""}` +
			` (${invite.uses}/${invite.maxUses ?? "unlimited"} uses)`
		);
		return { hostId, token: this.createToken(hostId) };
	}

	/** Remove invites that have not been usable for longer than controller.host_invite_retention_days */
	pruneInvites(nowMs = Date.now()) {
		const retentionDays = this._controller.config.get("controller.host_invite_retention_days");
		if (retentionDays === 0) {
			return;
		}
		const retentionMs = retentionDays * 86400e3;
		const stale = [...this.invites.values()].filter(invite => {
			const inactiveSinceMs = invite.inactiveSinceMs(nowMs);
			return inactiveSinceMs !== null && inactiveSinceMs + retentionMs <= nowMs;
		}).map(invite => this.invites.getMutable(invite.id)!);
		if (stale.length) {
			this.invites.deleteMany(stale);
			logger.verbose(`Removed ${stale.length} expired or used up host invites`);
		}
	}
}
