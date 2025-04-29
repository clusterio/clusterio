import util from "util";
import path from "path";
import { exec } from "child_process";
import { logger } from "./logging";
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
