import util from "util";
import path from "path";
import fs from "fs/promises";
import { unlinkSync } from "fs";
import { exec } from "child_process";
import { logger } from "./logging.js";
import { RequestError } from "./errors.js";
import type { PluginNodeEnvInfo } from "./plugin.js";
import { PluginSearchRequest, PluginSearchResult } from "./data/messages_plugin.js";
const execAsync = util.promisify(exec);

function isDev() {
	//  dev:                 <devRoot>/packages/lib/dist/src/rce_ops.js
	// prod: <prodRoot>/node_modules/@clusterio/lib/dist/src/rce_ops.js
	return import.meta.dirname.split(path.sep).at(-5) === "packages"; // opposed to "@clusterio"
}

const operationInProgressMessage = "Another package operation is already in progress on this machine";
// A lock file without a valid pid is left alone for this long, as it may still be being written
const lockWriteGraceMs = 10e3;
// The start time tells this process apart from an earlier one with the same pid, and is shared by
// every copy of lib loaded in this process
const lockContent = `${process.pid} ${performance.timeOrigin}\n`;

type LockSnapshot = { content: string, ino: bigint, mtimeNs: bigint };

/** Content and identity of a lock file, read through one handle so both belong to the same file */
async function readLock(lockPath: string): Promise<LockSnapshot | undefined> {
	let handle;
	try {
		handle = await fs.open(lockPath, "r");
	} catch (err: any) {
		if (err.code === "ENOENT") {
			return undefined;
		}
		throw err;
	}
	try {
		const stat = await handle.stat({ bigint: true });
		return { content: await handle.readFile("utf8"), ino: stat.ino, mtimeNs: stat.mtimeNs };
	} finally {
		await handle.close();
	}
}

function isSameLock(a: LockSnapshot, b: LockSnapshot) {
	return a.content === b.content && a.ino === b.ino && a.mtimeNs === b.mtimeNs;
}

/** True if the lock names a process that is still running, or may still be written to */
async function lockIsLive(lock: LockSnapshot) {
	const pid = Number(lock.content.split(" ")[0]);
	if (!Number.isInteger(pid) || pid <= 0) {
		return Date.now() - Number(lock.mtimeNs / 1000000n) < lockWriteGraceMs;
	}
	if (pid === process.pid) {
		// Held by this process, or left by an earlier process with the same pid
		return lock.content === lockContent;
	}
	try {
		// Signal 0 only checks that the process exists
		process.kill(pid, 0);
		return true;
	} catch (err: any) {
		return err.code !== "ESRCH";
	}
}

/**
 * Remove a stale lock file if it is still the same file. Clearing is done while holding a separate
 * recovery lock, so a lock another process took after the stale check is never removed.
 */
async function removeStaleLock(lockPath: string, stale: LockSnapshot) {
	const recoveryPath = `${lockPath}.recovery`;
	try {
		await fs.writeFile(recoveryPath, lockContent, { flag: "wx" });
	} catch (err: any) {
		if (err.code !== "EEXIST") {
			throw err;
		}
		const holder = await readLock(recoveryPath);
		if (holder && !await lockIsLive(holder)) {
			throw new RequestError(
				`Package operation lock recovery was interrupted, remove ${recoveryPath} to allow package operations`
			);
		}
		return; // Another process is clearing it
	}
	try {
		const current = await readLock(lockPath);
		if (current && isSameLock(current, stale)) {
			await fs.unlink(lockPath);
		}
	} finally {
		await fs.unlink(recoveryPath).catch(() => {});
	}
}

/**
 * Take the lock file guarding npm operations in a directory, rejects if another process holds it.
 * Locks left behind by processes that are no longer running are cleared.
 */
async function acquireNpmLock(lockPath: string) {
	let existing;
	for (let attempt = 0; attempt < 2; attempt++) {
		try {
			await fs.writeFile(lockPath, lockContent, { flag: "wx" });
			return;
		} catch (err: any) {
			if (err.code !== "EEXIST") {
				throw err;
			}
		}
		existing = await readLock(lockPath);
		if (existing) {
			if (await lockIsLive(existing)) {
				break;
			}
			await removeStaleLock(lockPath, existing);
		}
	}
	const holder = existing?.content.split(" ")[0].trim();
	throw new RequestError(
		`${operationInProgressMessage}${holder ? ` (${lockPath} is held by process ${holder})` : ""}`
	);
}

async function releaseNpmLock(lockPath: string) {
	// Only remove the lock if it is still ours
	const existing = await fs.readFile(lockPath, "utf8").catch(() => undefined);
	if (existing === lockContent) {
		await fs.unlink(lockPath).catch(() => {});
	}
}

let operationInProgress = false;

/**
 * Run an npm command, at most one at a time per installation. npm runs in the working directory,
 * which a standalone controller and host share, so a lock file there guards against operations
 * from other processes and other copies of lib. The flag makes concurrent calls through this copy
 * reject without racing a release of the lock.
 */
async function logExec(cmd: string) {
	// Checked and set before the first await so concurrent calls in this process can't interleave
	if (operationInProgress) {
		throw new RequestError(operationInProgressMessage);
	}
	operationInProgress = true;
	const lockPath = path.resolve("npm-operation.lock");
	// Only the exit event is used, signal and uncaughtException listeners would change how the process exits
	const removeLockOnExit = () => {
		try {
			unlinkSync(lockPath);
		} catch {
			// Ignored: the lock may already have been removed
		}
	};
	try {
		await acquireNpmLock(lockPath);
		process.on("exit", removeLockOnExit);
		try {
			logger.audit(`RCE | ${cmd}`);
			if (!isDev()) {
				await execAsync(cmd);
			}
		} finally {
			process.off("exit", removeLockOnExit);
			await releaseNpmLock(lockPath);
		}
	} finally {
		operationInProgress = false;
	}
}

export async function updatePackage(...names: string[]) {
	return logExec(`npm update --save ${names.join(" ")}`);
}

export async function installPackage(name: string) {
	return logExec(`npm install --save ${name}`);
}

export async function handleUpdateAll(corePackage: string, pluginInfos: PluginNodeEnvInfo[]) {
	const pluginPackages = pluginInfos
		.map(plugin => plugin.npmPackage)
		.filter((name): name is string => name !== undefined);
	return await updatePackage(corePackage, ...pluginPackages);
}

// One name segment, optionally after an @scope/ segment. Not starting with . or - keeps npm from
// reading the spec as a path, a git repository or a command line option.
// https://docs.npmjs.com/cli/v11/configuring-npm/package-json#name
const packageNamePattern = /^(?:@[a-zA-Z0-9][a-zA-Z0-9\-._~]*\/)?[a-zA-Z0-9][a-zA-Z0-9\-._~]*$/;

/**
 * Split a package spec into its name and optional version, as in name@version. The name itself
 * may start with @ for scoped packages.
 */
function parsePackageSpec(spec: string) {
	const versionSeparator = spec.lastIndexOf("@");
	const [name, version] = versionSeparator > 0
		? [spec.slice(0, versionSeparator), spec.slice(versionSeparator + 1)]
		: [spec, undefined];
	if (name.length > 214 || !packageNamePattern.test(name)) {
		throw new RequestError(`Invalid plugin name: ${spec}`);
	}
	if (version !== undefined && !/^[a-zA-Z0-9][a-zA-Z0-9\-.+]*$/.test(version)) {
		throw new RequestError(`Invalid plugin version: ${version}`);
	}
	return { name, version };
}

/** Throws unless the package, and version if given, is published on npm, returns the spec to install */
async function checkRegistry(name: string, version?: string) {
	const packageName = encodeURI(name);
	const spec = version !== undefined ? `${packageName}@${version}` : packageName;
	const registryPath = version !== undefined ? `${packageName}/${encodeURIComponent(version)}` : packageName;
	const npmRequest = await fetch(`https://registry.npmjs.com/${registryPath}`, {
		method: "HEAD",
		signal: AbortSignal.timeout(registryTimeoutMs),
	});
	if (!npmRequest.ok) {
		throw new RequestError(`Unknown plugin: ${spec}`);
	}
	return spec;
}

export async function handlePluginUpdate(pluginName: string, pluginInfos: PluginNodeEnvInfo[]) {
	// Optionally pinned to a version as name@version to update past the range in package.json
	const { name, version } = parsePackageSpec(pluginName);
	if (!pluginInfos.some(plugin => plugin.npmPackage === name)) {
		throw new RequestError(`Plugin ${name} is not installed on this machine`);
	}

	if (version === undefined) {
		return await updatePackage(name);
	}
	return await installPackage(await checkRegistry(name, version));
}

/** Install a plugin, optionally pinned to a version as name@version, returns the package name */
export async function handlePluginInstall(pluginName: string) {
	const { name, version } = parsePackageSpec(pluginName);
	await installPackage(await checkRegistry(name, version));
	return name;
}

const registryTimeoutMs = 10e3;
const latestVersionCacheMs = 5 * 60e3;
const latestVersionCacheMaxSize = 1000;
const latestVersionConcurrency = 8;

/** Latest version of each package by name, as found on npm, with when it was looked up */
export type LatestVersionCache = Map<string, { version?: string, fetchedAt: number }>;

/**
 * Look up the latest published version of each package on npm, packages that can't be
 * found are left out. Lookups are kept in the given cache for a few minutes.
 */
export async function fetchLatestVersions(packages: string[], cache: LatestVersionCache) {
	if (packages.length > 500) {
		throw new RequestError("Too many packages");
	}
	const names = [...new Set(packages.map(packageName => {
		const { name, version: pinned } = parsePackageSpec(packageName);
		if (pinned !== undefined) {
			throw new RequestError(`Invalid plugin name: ${packageName}`);
		}
		return name;
	}))];

	const now = Date.now();
	for (const [name, cached] of cache) {
		if (now - cached.fetchedAt > latestVersionCacheMs) {
			cache.delete(name);
		}
	}

	const versions: Record<string, string> = {};
	const queue = [...names];
	async function lookUp(name: string) {
		let cached = cache.get(name);
		if (!cached) {
			let response;
			try {
				response = await fetch(`https://registry.npmjs.com/${name}/latest`, {
					signal: AbortSignal.timeout(registryTimeoutMs),
				});
			} catch (err: any) {
				logger.warn(`Failed to look up latest version of ${name}: ${err.message}`);
				return;
			}
			if (!response.ok && response.status !== 404) {
				// Rate limits and outages are retried on the next lookup instead of cached
				logger.warn(`Failed to look up latest version of ${name}: ${response.status}`);
				return;
			}
			const version = response.ok ? (await response.json() as { version?: string }).version : undefined;
			cached = { version, fetchedAt: now };
			for (const oldest of cache.keys()) {
				if (cache.size < latestVersionCacheMaxSize) {
					break;
				}
				cache.delete(oldest);
			}
			cache.set(name, cached);
		}
		if (cached.version) {
			versions[name] = cached.version;
		}
	}
	await Promise.all(Array.from({ length: latestVersionConcurrency }, async () => {
		for (let name = queue.shift(); name !== undefined; name = queue.shift()) {
			await lookUp(name);
		}
	}));
	return versions;
}

const npmSearchMaxSize = 250; // Limit imposed by the registry

export async function searchPlugins(query: string, page: number, pageSize: number) {
	if (query.length > 214) {
		throw new RequestError("Search query too long");
	}
	if (page < 1 || pageSize < 1 || pageSize > npmSearchMaxSize) {
		throw new RequestError("Invalid page or page size");
	}

	const url = new URL("https://registry.npmjs.com/-/v1/search");
	url.searchParams.set("text", `keywords:clusterio-plugin ${query}`.trim());
	url.searchParams.set("size", String(pageSize));
	url.searchParams.set("from", String((page - 1) * pageSize));

	const response = await fetch(url, { signal: AbortSignal.timeout(registryTimeoutMs) });
	if (!response.ok) {
		throw new RequestError(`npm registry search failed: ${response.status} ${response.statusText}`);
	}

	const json = await response.json() as {
		total: number,
		objects: {
			package: {
				name: string,
				version: string,
				description?: string | null,
				date?: string | null,
				publisher?: { username?: string | null } | null,
				links?: { npm?: string | null, homepage?: string | null, repository?: string | null } | null,
			},
		}[],
	};

	return new PluginSearchRequest.Response(
		json.total,
		json.objects.map(({ package: pkg }) => new PluginSearchResult(
			// The registry sends null for some missing fields
			pkg.name, pkg.version, pkg.description ?? undefined, pkg.publisher?.username ?? undefined,
			pkg.date ?? undefined, pkg.links?.homepage ?? undefined, pkg.links?.repository ?? undefined,
			pkg.links?.npm ?? undefined,
		)),
	);
}
