/**
 * Hashing functions
 * @module lib/hash
 */
import crypto from "crypto";
import fs from "fs-extra";


/**
 * Returns a promise that resolves to the SHA1 hash of the stream given
 *
 * @param stream - Node stream of the content to hash.
 * @returns hash of the stream.
 */
export function hashStream(stream: NodeJS.ReadableStream): Promise<string> {
	return new Promise((resolve, reject) => {
		let hasher = crypto.createHash("sha1");
		hasher.setEncoding("hex");
		hasher.on("finish", () => {
			resolve(hasher.read());
		});

		stream.on("error", (error) => {
			// the docs doesn't say anything about what's passed on error
			reject(error);
		});

		stream.pipe(hasher);
	});
}

/**
 * Returns a promise that resolves to the SHA1 hash of the file given by path
 *
 * @param path - Path to the file to hash.
 * @returns hash of the file given.
 */
export function hashFile(path: string) {
	return hashStream(fs.createReadStream(path));
}
