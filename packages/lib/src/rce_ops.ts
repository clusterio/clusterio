import util from "util";
import path from "path";
import { exec } from "child_process";
import { logger } from "./logging";
import { RequestError } from "./errors";
import { PluginNodeEnvInfo } from "./plugin";
const execAsync = util.promisify(exec);

async function isDev() {
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
	if (pluginName.length > 214 || /[^a-zA-z0-9\-_.+@\/]/.test(pluginName)) {
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
