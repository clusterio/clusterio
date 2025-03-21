import type JSZip from "jszip";

/**
 * Returns the root folder in the zip file
 *
 * Returns the name of the folder that the first entry in the zip file is
 * contained in.  Throws an error if this is not in a folder.
 *
 * This matches the logic Factorio uses when determining the folder to look
 * for content in a zip file.
 *
 * @param zip - Zip to search through.
 * @returns name of the root folder.
 */
export function findRoot(zip: JSZip) {
	const relativePath = Object.keys(zip.files)[0];
	if (relativePath === undefined) {
		throw new Error("Empty zip file");
	}

	let index = relativePath.indexOf("/");
	if (index === -1) {
		throw new Error(`Zip contains file '${relativePath}' in root dir`);
	}

	return relativePath.slice(0, index);
}
