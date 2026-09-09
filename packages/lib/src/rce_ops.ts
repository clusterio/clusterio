import util from "util";
import path from "path";
import { exec } from "child_process";
import { logger } from "./logging";
import { RequestError } from "./errors";
import { PluginNodeEnvInfo } from "./plugin";
import { PluginSearchRequest, PluginSearchResult } from "./data/messages_plugin";
const execAsync = util.promisify(exec);

function isDev() {
	//  dev:                 <devRoot>/packages/lib/dist/src/rce_ops.js
	// prod: <prodRoot>/node_modules/@clusterio/lib/dist/src/rce_ops.js
	return __dirname.split(path.sep).at(-5) === "packages"; // opposed to "@clusterio"
}

async function logExec(cmd: string) {
	logger.audit(`RCE | ${cmd}`);
	if (!isDev()) {
		await execAsync(cmd);
	}
}

export async function updatePackage(name: string) {
	return logExec(`npm update --save ${name}`);
}

export async function installPackage(name: string) {
	return logExec(`npm install --save ${name}`);
}

export async function handlePluginUpdate(pluginName: string, pluginInfos: PluginNodeEnvInfo[]) {
	if (!pluginInfos.some(plugin => plugin.npmPackage === pluginName)) {
		throw new RequestError(`Plugin ${pluginName} is not installed on this machine`);
	}

	return await updatePackage(pluginName);
}

export async function handlePluginInstall(pluginName: string) {
	if (pluginName.length > 214 || /[^a-zA-Z0-9\-_.+@\/]/.test(pluginName)) {
		// https://docs.npmjs.com/cli/v11/configuring-npm/package-json#name
		// https://www.npmjs.com/package/validate-npm-package-name
		throw new RequestError(`Invalid plugin name: ${pluginName}`);
	}

	const packageName = encodeURI(pluginName);
	const npmRequest = await fetch(`https://registry.npmjs.com/${packageName}`, {
		method: "HEAD",
	});
	if (!npmRequest.ok) {
		throw new RequestError(`Unknown plugin: ${packageName}`);
	}

	return await installPackage(packageName);
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
