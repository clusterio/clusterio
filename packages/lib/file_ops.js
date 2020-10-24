/**
 * @module lib/file_ops
 */
"use strict";
const fs = require("fs-extra");
const path = require("path");

/**
 * Returns the newest file in a directory
 *
 * @param {string} directory - The directory to look for the newest file in.
 * @param {function(string): boolean} filter -
 *     Optional function to filter out files to ignore.  Should return true
 *     if the file is to be considered.
 * @returns {?string}
 *     Name of the file with the newest timestamp or null if the
 *     directory contains no files.
 */
async function getNewestFile(directory, filter = (name) => true) {
	let newestTime = new Date(0);
	let newestFile = null;
	for (let entry of await fs.readdir(directory, { withFileTypes: true })) {
		if (entry.isFile()) {
			let stat = await fs.stat(path.join(directory, entry.name));
			if (filter(entry.name) && stat.mtime > newestTime) {
				newestTime = stat.mtime;
				newestFile = entry.name;
			}
		}
	}

	return newestFile;
}

module.exports = {
	getNewestFile,
};
