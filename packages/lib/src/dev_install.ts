import path from "path";

/** True when lib runs from a source checkout rather than an npm install */
export function isDevInstall() {
	//  dev:                 <devRoot>/packages/lib/dist/node/src/dev_install.js
	// prod: <prodRoot>/node_modules/@clusterio/lib/dist/node/src/dev_install.js
	return import.meta.dirname.split(path.sep).at(-5) === "packages"; // opposed to "@clusterio"
}
