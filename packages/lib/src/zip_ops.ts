import type JSZip from "jszip";

/**
 * Returns the root folder in the zip file
 *
 * Returns the name of the folder that all files in the zip file is
 * contained in.  Throws an error if there are multiple such folders.
 *
 * @param zip - Zip to search through.
 * @returns name of the root folder.
 */
export function findRoot(zip: JSZip) {
	let root: undefined | string;
	zip.forEach((relativePath, file) => {
		let index = relativePath.indexOf("/");
		if (index === -1) {
			throw new Error(`Zip contains file '${relativePath}' in root dir`);
		}

		let pathRoot = relativePath.slice(0, index);
		if (root === undefined) {
			root = pathRoot;
		} else if (root !== pathRoot) {
			throw new Error("Zip contains multiple root folders");
		}
	});

	if (root === undefined) {
		throw new Error("Empty zip file");
	}

	return root;
}
