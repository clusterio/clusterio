import { logger } from "./logging.js";
import { NotFoundError, UnavailableError, ValidationError } from "./errors.js";
import { PluginSearchRequest, PluginSearchResult } from "./data/messages_plugin.js";

const registryTimeoutMs = 10e3;

// One name segment, optionally after an @scope/ segment. Not starting with . or - keeps npm from
// reading the spec as a path, a git repository or a command line option.
// https://docs.npmjs.com/cli/v11/configuring-npm/package-json#name
const packageNamePattern = /^(?:@[a-zA-Z0-9][a-zA-Z0-9\-._~]*\/)?[a-zA-Z0-9][a-zA-Z0-9\-._~]*$/;

/**
 * Split a package spec into its name and optional version, as in name@version. The name itself
 * may start with @ for scoped packages.
 */
export function parsePackageSpec(spec: string) {
	const versionSeparator = spec.lastIndexOf("@");
	const [name, version] = versionSeparator > 0
		? [spec.slice(0, versionSeparator), spec.slice(versionSeparator + 1)]
		: [spec, undefined];
	if (name.length > 214 || !packageNamePattern.test(name)) {
		throw new ValidationError(`Invalid plugin name: ${spec}`);
	}
	if (version !== undefined && !/^[a-zA-Z0-9][a-zA-Z0-9\-.+]*$/.test(version)) {
		throw new ValidationError(`Invalid plugin version: ${version}`);
	}
	return { name, version };
}

/** Throws unless the package, and version if given, is published on npm, returns the spec to install */
export async function checkRegistry(name: string, version?: string) {
	const packageName = encodeURI(name);
	const spec = version !== undefined ? `${packageName}@${version}` : packageName;
	const registryPath = version !== undefined ? `${packageName}/${encodeURIComponent(version)}` : packageName;
	const npmRequest = await fetch(`https://registry.npmjs.com/${registryPath}`, {
		method: "HEAD",
		signal: AbortSignal.timeout(registryTimeoutMs),
	});
	if (!npmRequest.ok) {
		throw new NotFoundError(`Unknown plugin: ${spec}`);
	}
	return spec;
}

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
		throw new ValidationError("Too many packages");
	}
	const names = [...new Set(packages.map(packageName => {
		const { name, version: pinned } = parsePackageSpec(packageName);
		if (pinned !== undefined) {
			throw new ValidationError(`Invalid plugin name: ${packageName}`);
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
		throw new ValidationError("Search query too long");
	}
	if (page < 1 || pageSize < 1 || pageSize > npmSearchMaxSize) {
		throw new ValidationError("Invalid page or page size");
	}

	const url = new URL("https://registry.npmjs.com/-/v1/search");
	url.searchParams.set("text", `keywords:clusterio-plugin ${query}`.trim());
	url.searchParams.set("size", String(pageSize));
	url.searchParams.set("from", String((page - 1) * pageSize));

	const response = await fetch(url, { signal: AbortSignal.timeout(registryTimeoutMs) });
	if (!response.ok) {
		throw new UnavailableError(`npm registry search failed: ${response.status} ${response.statusText}`);
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
