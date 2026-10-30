// Adds the host of a standalone install to the controller database, used by the installer.
// Only uses Node.js builtins as it runs before Clusterio is installed.
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

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
