/**
 * @module lib/file_ops
 */
import crypto from "crypto";
import events from "events";
import fs from "node:fs/promises";
import path from "path";
import stream from "stream";


/**
 * Returns the newest file in a directory
 *
 * @param directory - The directory to look for the newest file in.
 * @param filter -
 *     Optional function to filter out files to ignore.  Should return true
 *     if the file is to be considered.
 * @returns
 *     Name of the file with the newest timestamp or null if the
 *     directory contains no files.
 */
export async function getNewestFile(directory: string, filter = (_name: string) => true) {
	let newestTime = new Date(0);
	let newestFile: string | undefined;
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
 * Returns the total size of all files in a directory
 *
 * Sums up the file size of all files in the given directory if it exists.
 * Error reading the size of files are ignored, and error reading the
 * directory will result in 0 being returned.
 *
 * @param directory - The directory to sum files in.
 * @returns The size in bytes of all files in the directory.
 */
export async function directorySize(directory: string) {
	let dirEntries;
	try {
		dirEntries = await fs.readdir(directory, { withFileTypes: true });
	} catch (err: any) {
		if (err.code === "ENOENT") {
			return 0;
		}
		throw err;
	}
	let statTasks: Promise<number>[] = [];
	for (let entry of dirEntries) {
		if (entry.isFile()) {
			statTasks.push(fs
				.stat(path.join(directory, entry.name))
				.then(stat => stat.size, _ => 0)
			);
		}
	}
	return (await Promise.all(statTasks)).reduce((a, v) => a + v, 0);
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
 * @param directory - directory to check in.
 * @param name - file name to check for, may have extension.
 * @param extension - dot extension used for the file name.
 * @returns modified name with extension that likely does
 *     not exist in the folder
 */
export async function findUnusedName(directory: string, name: string, extension = "") {
	if (extension && name.endsWith(extension)) {
		name = name.slice(0, -extension.length);
	}

	while (true) {
		try {
			await fs.access(path.join(directory, `${name}${extension}`));
		} catch (err: any) {
			if (err.code === "ENOENT") {
				return `${name}${extension}`;
			}
		}

		let match = /^(.*?)(-(\d+))?$/.exec(name)!;
		if (!match[2]) {
			name = `${match[1]}-2`;
		} else {
			name = `${match[1]}-${Number.parseInt(match[3], 10) + 1}`;
		}
	}
}

/**
 * Generate collision resistante temporary file name
 *
 * Warning: this function should not be relied upon to be accurate for
 * security sensitive applications.  The selection process is inherently
 * racy and a file or folder may have been created in the folder by the time
 * this function returns.
 *
 * @param prefix - Prefix for file
 * @param suffix - Suffix for file
 * @param tmpdir - Directory for temp file
 * @returns Temporary file name
 */
export async function getTempFile(prefix = "tmp.", suffix = "", tmpdir = "./") {
	let fileName = path.join(prefix + crypto.randomBytes(16).toString("hex") + suffix);
	let freeFile = await findUnusedName(tmpdir, fileName);
	let fullPath = path.join(tmpdir, freeFile);
	return fullPath;
}

/**
 * Safely overwrite file data
 *
 * Writes the passed data to a temporary file and rename it over the target
 * file.  If the operation fails because the parent directory does not exist, it
 * attempts to create the directory, including any ancestors and then retries
 * the operation.  The name of the temporary file is the same as the target file
 * with the suffix `.tmp` added before the extension.
 *
 * If the operation fails it may leave behind the temporary file.  This
 * should not be too much of an issue as the next time the same file is
 * written the temporary will be overwritten and renamed to the target file.
 *
 * @param file - Path to file to write.
 * @param data - Content to write.
 * @param options - see fs.writeFile, `flag` and `flush` may not be used.
 */
export async function safeOutputFile(
	file: string,
	data: string | Buffer,
	options?: Omit<
		Extract<Parameters<typeof fs.writeFile>[2], { flush?: boolean }>,
		"flag" | "flush"
	>,
) {
	let { dir, name, ext } = path.parse(file);
	let temporary = path.join(dir, `${name}.tmp${ext}`);
	try {
		await fs.writeFile(temporary, data, { ...options, flush: true });
	} catch (err: any) {
		if (err.code === "ENOENT") {
			// Try creating the folder and then retry the operation.
			await fs.mkdir(dir, { recursive: true });
			await fs.writeFile(temporary, data, { ...options, flush: true });
		} else {
			throw err;
		}
	}
	await fs.rename(temporary, file);
}

// Reserved names by almost all filesystems
const badNames = [".", ".."];

// Reserved namespaces in Windows
const oneToNine = [1, 2, 3, 4, 5, 6, 7, 8, 9];
const badWinNamespaces = [
	"CON", "PRN", "AUX", "NUL",
	...oneToNine.map(n => `COM${n}`),
	...oneToNine.map(n => `LPT${n}`),
];

/**
 * Check if a string is a valid file name
 *
 * @param name - Name to check
 * @throws Error if the name is unsuitable.
 */
export function checkFilename(name: string) {
	// All of these are bad in Windows only, except for /, . and ..
	// See: https://docs.microsoft.com/en-us/windows/win32/fileio/naming-a-file
	const badChars = /[<>:"\/\\|?*\x00-\x1f]/g;
	const badEnd = /[. ]$/;

	if (typeof name !== "string") {
		throw new Error("must be a string");
	}

	if (name === "") {
		throw new Error("cannot be empty");
	}

	if (badChars.test(name)) {
		throw new Error('cannot contain <>:"\\/|=* or control characters');
	}

	if (badNames.includes(name)) {
		throw new Error(
			`cannot be named ${name}`
		);
	}

	if (badWinNamespaces.includes(name.toUpperCase().split(".")[0])) {
		throw new Error(
			"cannot be named any of CON PRN AUX NUL COM1-9 and LPT1-9"
		);
	}

	if (badEnd.test(name)) {
		throw new Error("cannot end with . or space");
	}
}

/**
 * Clean up string to be suitable for use as filename
 *
 * @param name - Arbitrary name string
 * @returns Filename suitable to use in the filesystem
 */
export function cleanFilename(name: string) {
	// copied from checkFilename due to RegExp with global flag containing state.
	const badChars = /[<>:"\/\\|?*\x00-\x1f]/g;
	const badEnd = /[. ]$/;

	if (typeof name !== "string") {
		throw new Error("name must be a string");
	}

	if (name === "" || badNames.includes(name.toUpperCase())) {
		name += "_";
	}

	if (badWinNamespaces.includes(name.toUpperCase().split(".")[0])) {
		name = [`${name.split(".")[0]}_`, ...name.split(".").slice(1)].join(".");
	}

	name = name.replace(badChars, "_");
	name = name.replace(badEnd, "_");

	return name;
}

/**
 * Creates a write stream to a guaranteed newly created temporary file in the
 * same folder as the target `filePath`.
 *
 * @param filePath - The target file to create a temporary stream for.
 * @returns The path to the temporary file that was opened and the write stream to it.
 */
export async function createTempWriteStream(filePath: string) {
	const { dir, name: fileName, ext } = path.parse(filePath);
	let increment = 1;
	let writeStream;
	let tempFilePath = path.format({ dir, name: `${fileName}.tmp`, ext });
	while (true) {
		try {
			writeStream = (await fs.open(tempFilePath, "wx")).createWriteStream({ flush: true });
			break;
		} catch (err: any) {
			if (err.code === "EEXIST") {
				increment += 1;
				tempFilePath = path.format({ dir, name: `${fileName}-${increment}.tmp`, ext });
			} else {
				throw err;
			}
		}
	}

	return [tempFilePath, writeStream] as [typeof tempFilePath, typeof writeStream];
}

/**
 * Download a file by fetching the given url and streaming the body content to it.
 *
 * @param url - The resource to download
 * @param filePath - Path to the file store the resource data in.
 * @param overwriteMode - What to do if the target filePath already exists. Use
 *     overwrite to clobber it, use rename to write to a differently named file,
 *     and error to throw an EEXIST error.
 * @returns file path that was written to. May be different from `filePath` if
 * overwriteMode is set to rename.
 */
export async function downloadFile(
	url: URL | string,
	filePath: string,
	overwriteMode: "overwrite" | "rename" | "error",
) {
	// Prepare file to stream content to.
	let writeStream;
	let tempFilePath;
	if (overwriteMode === "error") {
		tempFilePath = filePath;
		writeStream = (await fs.open(tempFilePath, "wx")).createWriteStream({ flush: true });
	} else {
		[tempFilePath, writeStream] = await createTempWriteStream(filePath);
	}

	// Fetch stream bytes
	const response = await fetch(url);
	if (!response.ok || !response.body) {
		writeStream.end();
		await events.once(writeStream, "close");
		await fs.unlink(tempFilePath);
		throw new Error(`Failed to download ${url}: ${response.status} ${response.statusText}`);
	}
	const writer = stream.Writable.toWeb(writeStream);
	await response.body.pipeTo(writer);

	let targetFilePath = filePath;
	if (overwriteMode === "overwrite") {
		await fs.rename(tempFilePath, targetFilePath);
	} else if (overwriteMode === "rename") {
		let increment = 1;
		let { dir, name, ext } = path.parse(targetFilePath);
		while (true) {
			try {
				await fs.writeFile(targetFilePath, Buffer.alloc(0), { flag: "wx" });
				break;
			} catch (err: any) {
				if (err.code === "EEXIST") {
					increment += 1;
					targetFilePath = path.format({ dir, name: `${name}-${increment}`, ext });
				} else {
					throw err;
				}
			}
		}
		await fs.rename(tempFilePath, targetFilePath);
	}
	return targetFilePath;
}
