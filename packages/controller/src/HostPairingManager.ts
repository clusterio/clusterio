import type Controller from "./Controller.js";

import crypto from "crypto";
import net from "net";

import * as lib from "@clusterio/lib";
import { logger } from "@clusterio/lib";

import HostRecord from "./HostRecord.js";

/** Symbols used in pairing codes, avoids 0/O and 1/I/L */
const codeAlphabet = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const codeLength = 6;

/** Time a request is kept after the last poll from the host */
export const pollTimeoutMs = 30e3;
/** Maximum number of pending requests from one address */
export const maxPendingPerAddress = 3;
/** Maximum length of a host name */
export const maxNameLength = 100;
/** Control and bidirectional override characters refused in host names */
const nameControlCharacters = /[\p{Cc}\u202a-\u202e\u2066-\u2069]/u;

/** Result of an approved request, sent to the host */
export interface HostPairingResult {
	hostId: number,
	token: string,
	name: string,
}

/** Error with an HTTP status code to respond to the host with */
export class HostPairingError extends Error {
	constructor(
		message: string,
		public status: number,
		/** Seconds to wait before trying again, for status 429 */
		public retryAfter?: number,
	) {
		super(message);
	}
}

type PairingRequest = {
	/** Secret the host polls with, never shown to users */
	secret: string,
	details: lib.HostPairingDetails,
	/** Address with IPv6 addresses grouped by /64, used for limits */
	addressKey: string,
	lastPollMs: number,
} & (
	{ state: "pending" | "rejected" } | { state: "approved", result: HostPairingResult }
);

/**
 * Strips the IPv4 mapped prefix and groups IPv6 addresses by their /64
 *
 * @param address - Address to make a key for
 * @returns key used to count requests from an address.
 */
export function addressKey(address: string) {
	if (address.startsWith("::ffff:") && net.isIPv4(address.slice(7))) {
		return address.slice(7);
	}
	if (!net.isIPv6(address)) {
		return address;
	}
	const [head, tail = ""] = address.split("::");
	const headParts = head ? head.split(":") : [];
	const tailParts = tail ? tail.split(":") : [];
	const missing = 8 - headParts.length - tailParts.length;
	const parts = address.includes("::")
		? [...headParts, ...new Array(missing).fill("0"), ...tailParts]
		: headParts;
	return `${parts.slice(0, 4).map(part => part.toLowerCase().replace(/^0+(?=.)/, "")).join(":")}::/64`;
}

/**
 * Normalise a pairing code typed by a user
 *
 * @param code - Code as typed, may contain dashes and lower case letters.
 * @returns code formatted as shown by the host.
 */
export function normaliseCode(code: string) {
	const plain = code.toUpperCase().replace(/[^0-9A-Z]/g, "");
	return `${plain.slice(0, 3)}-${plain.slice(3)}`;
}

function generateCode() {
	let code = "";
	for (let i = 0; i < codeLength; i++) {
		code += codeAlphabet[crypto.randomInt(codeAlphabet.length)];
	}
	return normaliseCode(code);
}

/**
 * Keeps track of requests from hosts to join the cluster
 *
 * Requests only live in memory, and only while the host keeps polling
 * for the result.
 */
export default class HostPairingManager {
	/** Pending requests by code, broadcast to subscribed control links */
	records = new lib.SubscribableDatastore<lib.HostPairingDetails>();
	private _bySecret = new Map<string, PairingRequest>();
	private _byCode = new Map<string, PairingRequest>();
	private _pruneInterval?: ReturnType<typeof setInterval>;

	constructor(
		private _controller: Controller,
	) { }

	start() {
		this._pruneInterval = setInterval(() => this.prune(), 5e3);
		this._pruneInterval.unref();
	}

	stop() {
		clearInterval(this._pruneInterval);
		this._pruneInterval = undefined;
	}

	/**
	 * Check and trim a host name given by a host or a user
	 *
	 * @param name - Name to check.
	 * @returns the trimmed name.
	 */
	static validateName(name: unknown) {
		if (typeof name !== "string" || !name.trim()) {
			throw new HostPairingError("Host name is required", 400);
		}
		const trimmed = name.trim();
		if (trimmed.length > maxNameLength) {
			throw new HostPairingError(`Host name must be at most ${maxNameLength} characters`, 400);
		}
		// Names come from unauthenticated requests and are printed to terminals and logs.
		if (nameControlCharacters.test(trimmed)) {
			throw new HostPairingError("Host name may not contain control characters", 400);
		}
		return trimmed;
	}

	/**
	 * Create an approved host with a new id and token
	 *
	 * @param name - Name of the host.
	 * @returns the id, token and name of the new host.
	 */
	createHost(name: string): HostPairingResult {
		const hosts = this._controller.hosts;
		let hostId;
		do {
			hostId = crypto.randomInt(1, 2 ** 31);
		} while (hosts.has(hostId));

		hosts.set(new HostRecord(
			hostId, name, "", new Map(), false, "", "", Math.floor(Date.now() / 1000),
		));
		return { hostId, token: this._controller.generateHostToken(hostId), name };
	}

	/**
	 * Create a pending request
	 *
	 * @param name - Name the host asked for.
	 * @param version - Version of the host.
	 * @param remoteAddress - Address the request came from.
	 * @returns the secret to poll with and the code to show the user.
	 */
	create(name: string, version: string, remoteAddress: string) {
		this.prune();
		const key = addressKey(remoteAddress);
		const now = Date.now();
		const pendingFromAddress = [...this._bySecret.values()].filter(
			request => request.addressKey === key && request.state === "pending"
		).length;
		if (pendingFromAddress >= maxPendingPerAddress) {
			throw new HostPairingError("Too many pending requests from this address", 429, 30);
		}
		const maxPending = this._controller.config.get("controller.host_pairing_max_pending");
		if (maxPending && this.records.size >= maxPending) {
			throw new HostPairingError("Too many pending requests", 429, 30);
		}

		let code;
		do {
			code = generateCode();
		} while (this._byCode.has(code));

		const request: PairingRequest = {
			secret: crypto.randomBytes(32).toString("base64url"),
			details: new lib.HostPairingDetails(code, name, remoteAddress, version, now),
			addressKey: key,
			lastPollMs: now,
			state: "pending",
		};
		this._bySecret.set(request.secret, request);
		this._byCode.set(code, request);
		this.records.set(request.details);
		logger.verbose(`Host pairing request ${code} for "${name}" from ${remoteAddress}`);
		return { requestId: request.secret, code };
	}

	/**
	 * Poll for the result of a request
	 *
	 * @param secret - Request id returned when the request was created.
	 * @returns the result if the request was approved, or null if still pending.
	 */
	poll(secret: string): HostPairingResult | null {
		this.prune();
		const request = this._bySecret.get(secret);
		if (!request) {
			throw new HostPairingError("Request not found", 404);
		}
		request.lastPollMs = Date.now();
		if (request.state === "approved") {
			this._remove(request);
			return request.result;
		}
		if (request.state === "rejected") {
			this._remove(request);
			throw new HostPairingError("Request was rejected", 403);
		}
		return null;
	}

	/**
	 * Cancel a pending request
	 *
	 * @param secret - Request id returned when the request was created.
	 */
	cancel(secret: string) {
		const request = this._bySecret.get(secret);
		if (request && request.state === "pending") {
			logger.verbose(`Host pairing request ${request.details.code} cancelled by the host`);
			this._remove(request);
		}
	}

	private _pending(code: string) {
		this.prune();
		const request = this._byCode.get(normaliseCode(code));
		if (!request || request.state !== "pending") {
			throw new lib.NotFoundError(`No pending host request with code ${code}`);
		}
		return request;
	}

	/**
	 * Approve a pending request, creating the host
	 *
	 * @param code - Code of the request.
	 * @param name - Name to give the host, defaults to the requested name.
	 * @param approvedBy - Name of the user approving it, for logging.
	 * @returns the id of the new host.
	 */
	approve(code: string, name: string | undefined, approvedBy: string) {
		const request = this._pending(code);
		let hostName;
		try {
			hostName = name === undefined ? request.details.name : HostPairingManager.validateName(name);
		} catch (err: any) {
			throw new lib.ValidationError(err.message);
		}

		const result = this.createHost(hostName);
		Object.assign(request, { state: "approved", result });
		this.records.delete(request.details);
		logger.audit(
			`User ${approvedBy} approved host ${result.name} (${result.hostId}) with code ` +
			`${request.details.code} from ${request.details.remoteAddress}`
		);
		return result.hostId;
	}

	/**
	 * Reject a pending request
	 *
	 * @param code - Code of the request.
	 * @param rejectedBy - Name of the user rejecting it, for logging.
	 */
	reject(code: string, rejectedBy: string) {
		const request = this._pending(code);
		request.state = "rejected";
		this.records.delete(request.details);
		logger.audit(
			`User ${rejectedBy} rejected host ${request.details.name} with code ` +
			`${request.details.code} from ${request.details.remoteAddress}`
		);
	}

	private _remove(request: PairingRequest) {
		this._bySecret.delete(request.secret);
		this._byCode.delete(request.details.code);
		this.records.delete(request.details);
	}

	/** Remove requests the host stopped polling for or that waited too long */
	prune() {
		const now = Date.now();
		const timeoutMs = this._controller.config.get("controller.host_pairing_timeout") * 1000;
		for (const request of this._bySecret.values()) {
			const timedOut = request.state === "pending" && timeoutMs > 0
				&& now - request.details.createdAtMs > timeoutMs;
			if (!timedOut && now - request.lastPollMs <= pollTimeoutMs) {
				continue;
			}
			if (request.state === "approved") {
				logger.warn(
					`Approved host ${request.result.name} (${request.result.hostId}) was never picked up ` +
					"by the host, revoke it on the hosts page if it is not needed"
				);
			}
			this._remove(request);
		}
	}
}
