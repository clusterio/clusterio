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

/**
 * Modifies name in case it already exisist at the given directory
 *
 * Checks the directory passed if it already contains a file or folder with
 * the given name, if it does not returns name unmodified, otherwise it
 * returns a modified name that does not exist in the directory.
 *
 * Warning: this function should not be relied upon to be accurate for
 * security sensitive applications.  The selection process is inherently
 * racy and a file or folder may have been created in the folder by the time
 * this function returns.
 *
 * @param {string} directory - directory to check in.
 * @param {string} name - file name to check for, may have extension.
 * @param {string} extension - dot extension used for the file name.
 * @returns {string} modified name with extension that likely does not exist
 *     in the folder
 */
async function findUnusedName(directory, name, extension = "") {
	if (extension && name.endsWith(extension)) {
		name = name.slice(0, -extension.length);
	}

	while (true) {
		if (!await fs.pathExists(path.join(directory, `${name}${extension}`))) {
			return `${name}${extension}`;
		}

		let match = /^(.*?)(-(\d+))?$/.exec(name);
		if (!match[2]) {
			name = `${match[1]}-2`;
		} else {
			name = `${match[1]}-${Number.parseInt(match[3], 10) + 1}`;
		}
	}
}

/**
 * Safely write data to a file
 *
 * Same as fs-extra.outputFile except the data is written to a temporary
 * file that's renamed over the target file.  The name of the temporary file
 * is the same as the target file with the suffix `.tmp` added.
 *
 * If the operation fails it may leave behind the temporary file.  This
 * should not be too much of an issue as the next time the same file is
 * written the temporary will be overwritten and renamed to the target file.
 *
 * @param {string} file - Path to file to write.
 * @param {string|Buffer} data - Content to write.
 * @param {object|string} options - see fs.writeFile, `flag` must not be set.
 */
async function safeOutputFile(file, data, options={}) {
	let temporary = `${file}.tmp`;
	await fs.outputFile(temporary, data, options);
	await fs.rename(temporary, file);
}

module.exports = {
	getNewestFile,
	findUnusedName,
	safeOutputFile,
};
