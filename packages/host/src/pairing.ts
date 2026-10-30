import { setTimeout as sleep } from "node:timers/promises";

import * as lib from "@clusterio/lib";
import { logger } from "@clusterio/lib";

/** Time to wait for a response from the controller */
const requestTimeoutMs = 30e3;
/** Placeholder token of a host that has not been paired */
const unpairedToken = "enter token here";

/** Error responded by the controller */
export class PairingError extends Error {
	constructor(
		message: string,
		/** HTTP status the controller responded with */
		public status?: number,
	) {
		super(message);
		this.name = "PairingError";
	}
}

export interface PairingResult {
	hostId: number;
	token: string;
	name: string;
}

export interface PairHostOptions {
	/** URL of the controller, ending with a slash */
	controllerUrl: string;
	/** Name to request for the host */
	name: string;
	/** Version of the host, shown with the request */
	version?: string;
	/** Token of a user allowed to approve hosts, approves the host without waiting */
	token?: string;
	/** Interval to poll for the result at */
	pollIntervalMs?: number;
	/** Delay before trying again when the controller can't be reached or is busy */
	retryDelayMs?: number;
	/** Called with the code to approve the request with each time a request is made */
	onPending?: (code: string) => void;
	/** Called when the controller can't be reached or is busy and the request is retried */
	onRetry?: (err: Error, delayMs: number) => void;
	/** Signal to cancel pairing with */
	signal?: AbortSignal;
}

interface Response {
	status: number;
	headers: Headers;
	json: any;
}

async function request(
	controllerUrl: string,
	route: string,
	options: { body?: object, token?: string, signal?: AbortSignal, timeoutMs?: number },
): Promise<Response> {
	const headers: Record<string, string> = { "Accept": "application/json" };
	if (options.body) {
		headers["Content-Type"] = "application/json";
	}
	if (options.token) {
		headers["Authorization"] = `Bearer ${options.token}`;
	}
	const timeout = AbortSignal.timeout(options.timeoutMs ?? requestTimeoutMs);
	const response = await fetch(new URL(route, controllerUrl), {
		method: options.body ? "POST" : "GET",
		headers,
		body: options.body ? JSON.stringify(options.body) : undefined,
		signal: options.signal ? AbortSignal.any([options.signal, timeout]) : timeout,
	});
	let json;
	try {
		json = await response.json();
	} catch {
		json = undefined;
	}
	return { status: response.status, headers: response.headers, json };
}

function responseError(response: Response) {
	const message = typeof response.json?.error === "string"
		? response.json.error
		: `Unexpected response from controller: ${response.status}`;
	return new PairingError(message, response.status);
}

function pairingResult(response: Response): PairingResult {
	const { hostId, token, name } = response.json ?? {};
	if (!Number.isInteger(hostId) || typeof token !== "string" || typeof name !== "string") {
		throw new PairingError("Invalid response from controller", response.status);
	}
	return { hostId, token, name };
}

/** Responses that are worth trying again later */
function isTemporary(status: number) {
	return status === 429 || status >= 500;
}

function retryDelay(response: Response, defaultMs: number) {
	const seconds = Number(response.headers.get("retry-after"));
	return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : defaultMs;
}

/**
 * Poll a request until it is approved, rejected or no longer known by the controller
 *
 * @returns the result if approved, or null if the controller no longer knows the request.
 */
async function poll(requestId: string, options: Required<Pick<PairHostOptions, "pollIntervalMs">> & PairHostOptions) {
	let failing = false;
	while (true) {
		await sleep(options.pollIntervalMs, undefined, { signal: options.signal });
		let response;
		try {
			response = await request(options.controllerUrl, "api/host-pairing/poll", {
				body: { requestId }, signal: options.signal,
			});
		} catch (err: any) {
			if (options.signal?.aborted) {
				throw err;
			}
			// Keep polling through network errors, the request is made again if it expired meanwhile.
			if (!failing) {
				options.onRetry?.(err, options.pollIntervalMs);
				failing = true;
			}
			continue;
		}
		failing = false;
		if (response.status === 200) {
			return pairingResult(response);
		}
		if (response.status === 404) {
			return null;
		}
		if (response.status !== 202 && !isTemporary(response.status)) {
			throw responseError(response);
		}
	}
}

/**
 * Request to join the cluster and wait until the request is approved
 *
 * Waits through network errors and controller restarts, making a new request
 * if the controller no longer knows the previous one.
 *
 * @param options - Pairing options.
 * @returns id, token and approved name of the host.
 * @throws {PairingError} if the controller refuses or rejects the request.
 * @throws {DOMException} AbortError if the signal is aborted.
 */
export async function pairHost(options: PairHostOptions): Promise<PairingResult> {
	const opts = { pollIntervalMs: 2000, retryDelayMs: 10e3, version: "", ...options };
	let requestId: string | undefined;
	try {
		while (true) {
			opts.signal?.throwIfAborted();
			let response;
			try {
				response = await request(opts.controllerUrl, "api/host-pairing", {
					body: { name: opts.name, version: opts.version }, token: opts.token, signal: opts.signal,
				});
			} catch (err: any) {
				if (opts.signal?.aborted) {
					throw err;
				}
				opts.onRetry?.(err, opts.retryDelayMs);
				await sleep(opts.retryDelayMs, undefined, { signal: opts.signal });
				continue;
			}

			if (response.status === 200) {
				return pairingResult(response);
			}
			if (isTemporary(response.status)) {
				const delayMs = retryDelay(response, opts.retryDelayMs);
				opts.onRetry?.(responseError(response), delayMs);
				await sleep(delayMs, undefined, { signal: opts.signal });
				continue;
			}
			if (response.status === 404) {
				throw new PairingError("The controller must be updated to a version that supports host pairing", 404);
			}
			if (response.status !== 202) {
				throw responseError(response);
			}
			if (typeof response.json?.requestId !== "string" || typeof response.json.code !== "string") {
				throw new PairingError("Invalid response from controller", response.status);
			}

			requestId = response.json.requestId as string;
			opts.onPending?.(response.json.code);
			const result = await poll(requestId, opts);
			requestId = undefined;
			if (result) {
				return result;
			}
		}

	} catch (err) {
		if (!opts.signal?.aborted) {
			throw err;
		}
		if (requestId !== undefined) {
			await request(opts.controllerUrl, "api/host-pairing/cancel", {
				body: { requestId }, timeoutMs: 5e3,
			}).catch(() => {});
		}
		throw new DOMException("Pairing was cancelled", "AbortError");
	}
}

/**
 * Check if the controller accepts a host token
 *
 * @param controllerUrl - URL of the controller, ending with a slash.
 * @param token - Host token to check.
 * @returns true if the token is valid and its host is registered.
 * @throws {PairingError} if the controller gives an unexpected response.
 */
export async function checkHostToken(controllerUrl: string, token: string) {
	const response = await request(controllerUrl, "api/host-pairing/check", { token });
	if (response.status === 200) {
		return true;
	}
	if (response.status === 401) {
		return false;
	}
	throw responseError(response);
}

/**
 * Pair the host with the controller if it has not been paired, or the controller no longer accepts it
 *
 * Waits until the request is approved and saves the id, name and token of the host to its config.
 *
 * @param config - Config of the host.
 * @param options - Pairing options.
 * @throws {PairingError} if the controller refuses or rejects the request.
 * @throws {DOMException} AbortError if the signal is aborted.
 */
export async function ensurePaired(
	config: lib.HostConfig,
	options: { version: string, userToken?: string, signal?: AbortSignal },
) {
	const controllerUrl = config.get("host.controller_url");
	const token = config.get("host.controller_token");
	if (token && token !== unpairedToken) {
		let valid;
		try {
			valid = await checkHostToken(controllerUrl, token);
		} catch (err: any) {
			// Connecting reports the problem, or authenticates if the controller predates pairing.
			logger.verbose(`Unable to check if the controller accepts this host: ${err.message}`);
			return;
		}
		if (valid) {
			return;
		}
		logger.warn("The controller no longer accepts this host, requesting to join again");
	}

	const name = config.get("host.name");
	logger.info(`Requesting to join the cluster at ${controllerUrl} as "${name}"`);
	const result = await pairHost({
		controllerUrl,
		name,
		version: options.version,
		token: options.userToken,
		signal: options.signal,
		onPending: code => {
			logger.info(
				`Waiting for approval. Approve "${name}" with code ${code} on the Hosts page of ` +
				`${controllerUrl}, or run: npx clusterioctl host approve ${code}`
			);
		},
		onRetry: (err, delayMs) => {
			logger.warn(`Requesting to join failed: ${err.message}, trying again in ${Math.ceil(delayMs / 1000)}s`);
		},
	});

	config.set("host.id", result.hostId);
	config.set("host.name", result.name);
	config.set("host.controller_token", result.token);
	await config.save();
	logger.info(`Host approved as "${result.name}" with id ${result.hostId}`);
}
