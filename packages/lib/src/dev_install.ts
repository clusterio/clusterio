import path from "path";

/** True when lib runs from a source checkout rather than an install of the published package */
export function isDevInstall() {
	// Published copies are always under node_modules, the workspace symlink resolves to packages/lib
	return !import.meta.dirname.split(path.sep).includes("node_modules");
}
