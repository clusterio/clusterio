"use strict";

/**
 * Returns the root folder in the zip file
 *
 * Returns the name of the folder that all files in the zip file is
 * contained in.  Throws an error if there are multiple such folders.
 *
 * @param {JSZip} zip - Zip to search through.
 * @returns {string} name of the root folder.
 * @memberof module:lib/factorio
 * @private
 * @inner
 */
function findRoot(zip) {
	let root = null;
	zip.forEach((relativePath, file) => {
		let index = relativePath.indexOf("/");
		if (index === -1) {
			throw new Error(`Zip contains file '${relativePath}' in root dir`);
		}

		let pathRoot = relativePath.slice(0, index);
		if (root === null) {
			root = pathRoot;
		} else if (root !== pathRoot) {
			throw new Error("Zip contains multiple root folders");
		}
	});

	if (root === null) {
		throw new Error("Empty zip file");
	}

	return root;
}

module.exports = {
	findRoot,
};
