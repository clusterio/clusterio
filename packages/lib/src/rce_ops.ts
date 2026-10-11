import util from "util";
import path from "path";
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

// npm operations on the same installation must not overlap, so only one is allowed at a time.
let npmBusy = false;

async function logExec(cmd: string) {
	if (npmBusy) {
		throw new RequestError("Another package operation is already in progress on this machine");
	}
	npmBusy = true;
	try {
		logger.audit(`RCE | ${cmd}`);
		if (!isDev()) {
			await execAsync(cmd);
		}
	} finally {
		npmBusy = false;
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
