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

/** True if the lock file content names a process that is still running, or may still be written to */
async function lockIsLive(lockPath: string, content: string) {
	const pid = Number(content);
	if (!Number.isInteger(pid) || pid <= 0) {
		const stat = await fs.stat(lockPath).catch(() => undefined);
		return stat !== undefined && Date.now() - stat.mtimeMs < lockWriteGraceMs;
	}
	if (pid === process.pid) {
		return false; // Left by an earlier process with the same pid, this process holds no lock while acquiring
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
 * Remove a stale lock file with the given content. The lock is moved aside before it is deleted
 * so that two processes clearing the same stale lock can't delete a lock the other just took.
 */
async function removeStaleLock(lockPath: string, staleContent: string) {
	const asidePath = `${lockPath}.${process.pid}.stale`;
	try {
		await fs.rename(lockPath, asidePath);
	} catch (err: any) {
		if (err.code === "ENOENT") {
			return; // Already cleared by another process
		}
		throw err;
	}
	try {
		if (await fs.readFile(asidePath, "utf8") !== staleContent) {
			// Moved a lock another process took after the stale check, put it back without overwriting
			await fs.link(asidePath, lockPath).catch(() => {});
		}
	} finally {
		await fs.unlink(asidePath).catch(() => {});
	}
}

/**
 * Take the lock file guarding npm operations in a directory, rejects if another process holds it.
 * Locks left behind by processes that are no longer running are cleared.
 */
async function acquireNpmLock(lockPath: string) {
	const content = `${process.pid}\n`;
	for (let attempt = 0; attempt < 2; attempt++) {
		try {
			await fs.writeFile(lockPath, content, { flag: "wx" });
			return;
		} catch (err: any) {
			if (err.code !== "EEXIST") {
				throw err;
			}
		}
		const existing = await fs.readFile(lockPath, "utf8").catch(() => undefined);
		if (existing !== undefined) {
			if (await lockIsLive(lockPath, existing)) {
				break;
			}
			await removeStaleLock(lockPath, existing);
		}
	}
	throw new RequestError(operationInProgressMessage);
}

async function releaseNpmLock(lockPath: string) {
	// Only remove the lock if it is still ours
	const existing = await fs.readFile(lockPath, "utf8").catch(() => undefined);
	if (existing === `${process.pid}\n`) {
		await fs.unlink(lockPath).catch(() => {});
	}
}

let operationInProgress = false;

/**
 * Run an npm command, at most one at a time per installation. npm runs in the working directory,
 * which a standalone controller and host share, so a lock file there guards against operations
 * from other processes, and an in-memory flag guards against concurrent calls in this process.
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

/**
 * Split a package spec into its name and optional version, as in name@version. The name itself
 * may start with @ for scoped packages.
 */
function parsePackageSpec(spec: string) {
	if (spec.length > 214 || /[^a-zA-Z0-9\-_.+@\/]/.test(spec)) {
		// https://docs.npmjs.com/cli/v11/configuring-npm/package-json#name
		// https://www.npmjs.com/package/validate-npm-package-name
		throw new RequestError(`Invalid plugin name: ${spec}`);
	}

	const versionSeparator = spec.lastIndexOf("@");
	const [name, version] = versionSeparator > 0
		? [spec.slice(0, versionSeparator), spec.slice(versionSeparator + 1)]
		: [spec, undefined];
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

export async function handlePluginInstall(pluginName: string) {
	// Optionally pinned to a version as name@version
	const { name, version } = parsePackageSpec(pluginName);
	return await installPackage(await checkRegistry(name, version));
}

const latestVersionCacheMs = 5 * 60e3;
const latestVersionCache = new Map<string, { version?: string, fetchedAt: number }>();

/**
 * Look up the latest published version of each package on npm, packages that can't be
 * found are left out. Results are cached for a few minutes.
 */
export async function fetchLatestVersions(packages: string[]) {
	if (packages.length > 500) {
		throw new RequestError("Too many packages");
	}
	const now = Date.now();
	const versions: Record<string, string> = {};
	await Promise.all(packages.map(async packageName => {
		const { name, version: pinned } = parsePackageSpec(packageName);
		if (pinned !== undefined) {
			throw new RequestError(`Invalid plugin name: ${packageName}`);
		}
		let cached = latestVersionCache.get(name);
		if (!cached || now - cached.fetchedAt > latestVersionCacheMs) {
			let version: string | undefined;
			try {
				const response = await fetch(`https://registry.npmjs.com/${encodeURI(name)}/latest`);
				if (response.ok) {
					version = (await response.json() as { version?: string }).version;
				}
			} catch (err: any) {
				// Left out until the registry can be reached again
				logger.warn(`Failed to look up latest version of ${name}: ${err.message}`);
				return;
			}
			cached = { version, fetchedAt: now };
			latestVersionCache.set(name, cached);
		}
		if (cached.version) {
			versions[name] = cached.version;
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

	const response = await fetch(url);
	if (!response.ok) {
		throw new RequestError(`npm registry search failed: ${response.status} ${response.statusText}`);
	}

	const json = await response.json() as {
		total: number,
		objects: {
			package: {
				name: string,
				version: string,
				description?: string,
				date?: string,
				publisher?: { username?: string },
				links?: { npm?: string, homepage?: string, repository?: string },
			},
		}[],
	};

	return new PluginSearchRequest.Response(
		json.total,
		json.objects.map(({ package: pkg }) => new PluginSearchResult(
			pkg.name, pkg.version, pkg.description, pkg.publisher?.username,
			pkg.date, pkg.links?.homepage, pkg.links?.repository, pkg.links?.npm,
		)),
	);
}
