// Pairing of hosts with the controller, used by the installer.
// Only uses Node.js builtins as it runs before or without Clusterio being installed.
import crypto from "node:crypto";
import fs from "node:fs/promises";
import http from "node:http";
import https from "node:https";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

/** Time to keep polling through network errors, the controller drops requests not polled for 30 seconds */
const pollRetryMs = 30e3;
/** Time to wait for a response from the controller */
const requestTimeoutMs = 30e3;
/** Largest response accepted from the controller */
const maxResponseSize = 64 * 1024;

/** Error responded by the controller, or for an invalid controller URL */
export class PairingError extends Error {
	/**
	 * @param {string} message - Description of the error.
	 * @param {number=} status - HTTP status the controller responded with.
	 */
	constructor(message, status) {
		super(message);
		this.name = "PairingError";
		/** @type {number | undefined} */
		this.status = status;
	}
}

function apiUrl(controllerUrl, route) {
	let url;
	try {
		url = new URL(route, controllerUrl.endsWith("/") ? controllerUrl : `${controllerUrl}/`);
	} catch (err) {
		throw new PairingError(`Invalid controller URL ${controllerUrl}`);
	}
	if (!["http:", "https:"].includes(url.protocol)) {
		throw new PairingError(`Controller URL ${controllerUrl} must start with http:// or https://`);
	}
	return url;
}

function request(url, { method = "POST", body, token, ca, signal, timeoutMs = requestTimeoutMs }) {
	return new Promise((resolve, reject) => {
		const data = body === undefined ? undefined : JSON.stringify(body);
		const headers = { "Accept": "application/json" };
		if (data !== undefined) {
			headers["Content-Type"] = "application/json";
			headers["Content-Length"] = Buffer.byteLength(data);
		}
		if (token) {
			headers["Authorization"] = `Bearer ${token}`;
		}
		const options = { method, headers, signal, timeout: timeoutMs };
		if (url.protocol === "https:" && ca) {
			options.ca = ca;
		}

		const req = (url.protocol === "https:" ? https : http).request(url, options, res => {
			const chunks = [];
			let size = 0;
			res.on("data", chunk => {
				size += chunk.length;
				if (size > maxResponseSize) {
					req.destroy(new PairingError("Response from controller is too large", res.statusCode));
					return;
				}
				chunks.push(chunk);
			});
			res.on("error", reject);
			res.on("end", () => {
				let json;
				try {
					json = JSON.parse(Buffer.concat(chunks).toString());
				} catch (err) {
					json = undefined;
				}
				resolve({ status: res.statusCode, headers: res.headers, json });
			});
		});
		req.on("timeout", () => {
			const err = new Error(`Request to ${url} timed out`);
			err.code = "ETIMEDOUT";
			req.destroy(err);
		});
		req.on("error", reject);
		req.end(data);
	});
}

function responseError(response) {
	let message = typeof response.json?.error === "string"
		? response.json.error
		: `Unexpected response from controller: ${response.status} ${http.STATUS_CODES[response.status] ?? ""}`.trim();
	const retryAfter = response.headers["retry-after"];
	if (response.status === 429 && retryAfter) {
		message += `, try again in ${retryAfter} seconds`;
	}
	return new PairingError(message, response.status);
}

function pairingResult(response) {
	const { hostId, token, name } = response.json ?? {};
	if (!Number.isInteger(hostId) || typeof token !== "string" || typeof name !== "string") {
		throw new PairingError("Invalid response from controller", response.status);
	}
	return { hostId, token, name };
}

async function pollUntilDone(controllerUrl, requestId, ca, pollIntervalMs, signal) {
	const url = apiUrl(controllerUrl, "api/host-pairing/poll");
	let lastResponseMs = Date.now();
	while (true) {
		await sleep(pollIntervalMs, undefined, { signal });
		let response;
		try {
			response = await request(url, { body: { requestId }, ca, signal });
		} catch (err) {
			if (signal?.aborted || Date.now() - lastResponseMs > pollRetryMs) {
				throw err;
			}
			continue;
		}
		lastResponseMs = Date.now();
		if (response.status === 200) {
			return pairingResult(response);
		}
		if (response.status !== 202) {
			throw responseError(response);
		}
	}
}

/**
 * Request to join the cluster and wait until the request is approved
 *
 * @param {object} options - Pairing options.
 * @param {string} options.controllerUrl - URL of the controller, with or without a trailing slash.
 * @param {string} options.name - Name to request for the host.
 * @param {string=} options.version - Version of the installer, shown with the request.
 * @param {string=} options.token -
 *     Token of a user allowed to approve hosts, approves the host without waiting.
 * @param {(string|Buffer)=} options.ca - Certificate to trust for a controller using a self-signed certificate.
 * @param {number=} options.pollIntervalMs - Interval to poll for the result at.
 * @param {function({ code: string }): void=} options.onPending -
 *     Called once with the code to approve the request with if it has to wait for approval.
 * @param {AbortSignal=} options.signal - Signal to cancel the request with.
 * @returns {Promise<{ hostId: number, token: string, name: string }>} id, token and approved name of the host.
 * @throws {PairingError} if the controller refuses or rejects the request.
 * @throws {DOMException} AbortError if the signal is aborted.
 */
export async function pairHost({
	controllerUrl, name, version = "", token, ca, pollIntervalMs = 2000, onPending, signal,
}) {
	let requestId;
	try {
		signal?.throwIfAborted();
		const response = await request(apiUrl(controllerUrl, "api/host-pairing"), {
			body: { name, version }, token, ca, signal,
		});
		if (response.status === 200) {
			return pairingResult(response);
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
		requestId = response.json.requestId;
		onPending?.({ code: response.json.code });
		return await pollUntilDone(controllerUrl, requestId, ca, pollIntervalMs, signal);

	} catch (err) {
		if (!signal?.aborted) {
			throw err;
		}
		if (requestId !== undefined) {
			await request(apiUrl(controllerUrl, "api/host-pairing/cancel"), {
				body: { requestId }, ca, timeoutMs: 5e3,
			}).catch(() => {});
		}
		throw new DOMException("Pairing was cancelled", "AbortError");
	}
}

/**
 * Check if the controller accepts a host token
 *
 * @param {object} options - Check options.
 * @param {string} options.controllerUrl - URL of the controller, with or without a trailing slash.
 * @param {string} options.token - Host token to check.
 * @param {(string|Buffer)=} options.ca - Certificate to trust for a controller using a self-signed certificate.
 * @returns {Promise<boolean>} true if the token is valid and its host is registered.
 * @throws {PairingError} if the controller gives an unexpected response.
 */
export async function checkHostToken({ controllerUrl, token, ca }) {
	const response = await request(apiUrl(controllerUrl, "api/host-pairing/check"), {
		method: "GET", token, ca,
	});
	if (response.status === 200) {
		return true;
	}
	if (response.status === 401) {
		return false;
	}
	throw responseError(response);
}

function signHostToken(payload, secret) {
	const encode = value => Buffer.from(JSON.stringify(value)).toString("base64url");
	const unsigned = `${encode({ alg: "HS256", typ: "JWT" })}.${encode(payload)}`;
	const signature = crypto.createHmac("sha256", secret).update(unsigned).digest("base64url");
	return `${unsigned}.${signature}`;
}

/**
 * Add a host to the database of a controller installed in the same directory
 *
 * The controller must not be running, as it would overwrite the database with
 * what it has in memory.
 *
 * @param {object} options - Host options.
 * @param {string=} options.directory - Directory with config-controller.json in it.
 * @param {string} options.name - Name of the host.
 * @param {number=} options.id -
 *     Id to give the host, picks a random unused id if not given. If a host with
 *     this id exists, a new token is signed for it and its name is kept.
 * @param {string=} options.version - Version to record for the host.
 * @returns {Promise<{ hostId: number, token: string, name: string }>} id, token and name of the host.
 */
export async function createLocalHost({ directory = ".", name, id, version = "" }) {
	const configPath = path.join(directory, "config-controller.json");
	const config = JSON.parse(await fs.readFile(configPath, "utf8"));
	const secret = config["controller.auth_secret"];
	if (typeof secret !== "string" || !secret) {
		throw new Error(`${configPath} has no controller.auth_secret`);
	}

	const databaseDirectory = path.resolve(directory, config["controller.database_directory"] ?? "database");
	const hostsPath = path.join(databaseDirectory, "hosts.json");
	let hosts = [];
	try {
		hosts = JSON.parse(await fs.readFile(hostsPath, "utf8"));
	} catch (err) {
		if (err.code !== "ENOENT") {
			throw err;
		}
	}

	const now = Math.floor(Date.now() / 1000);
	const existing = id === undefined ? undefined : hosts.find(host => host.id === id);
	let hostId = id;
	if (existing) {
		// Running the installer again signs a new token for the same host.
		name = existing.name;
	} else {
		const ids = new Set(hosts.map(host => host.id));
		while (hostId === undefined || ids.has(hostId)) {
			hostId = crypto.randomInt(1, 2 ** 31);
		}
		hosts.push({ id: hostId, name, version, plugins: {}, token_valid_after: now });
		await fs.mkdir(databaseDirectory, { recursive: true });
		const temporary = path.join(databaseDirectory, "hosts.tmp.json");
		await fs.writeFile(temporary, JSON.stringify(hosts, null, "\t"), { flush: true });
		await fs.rename(temporary, hostsPath);
	}

	const token = signHostToken({ aud: "host", host: hostId, iat: now }, Buffer.from(secret, "base64"));
	return { hostId, token, name };
}
