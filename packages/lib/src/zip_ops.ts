/**
 * Zip file helpers
 * @module lib/zip_ops
 */
import type { Readable } from "stream";
import yauzl from "yauzl";
import type yazl from "yazl";


/**
 * Zip archive opened for random access reading
 *
 * Only the central directory is read up front, the content of entries is
 * streamed from the archive on demand.  Archives opened from a file hold
 * the file open until close() is called.
 */
export class ZipArchive {
	private constructor(
		/** Underlying yauzl zip file. */
		public zipfile: yauzl.ZipFile,
		/** Entries by file name in the order they appear in the central directory. */
		public entries: Map<string, yauzl.Entry>,
	) { }

	/**
	 * Open a zip archive from the file system
	 *
	 * @param zipPath - Path to the zip file to open.
	 */
	static async fromFile(zipPath: string) {
		return this.load(await yauzl.openPromise(zipPath, { autoClose: false }));
	}

	/**
	 * Open a zip archive held in memory
	 *
	 * @param buffer - Content of the zip file.
	 */
	static async fromBuffer(buffer: Buffer) {
		return this.load(await yauzl.fromBufferPromise(buffer));
	}

	private static async load(zipfile: yauzl.ZipFile) {
		const entries = new Map<string, yauzl.Entry>();
		try {
			for await (const entry of zipfile.eachEntry()) {
				entries.set(entry.fileName, entry);
			}
		} catch (err) {
			zipfile.close();
			throw err;
		}
		return new this(zipfile, entries);
	}

	/**
	 * Look up a file in the archive
	 *
	 * @param filePath - Path of the file in the archive.
	 * @returns entry for the file, or null if it does not exist.
	 */
	file(filePath: string) {
		const entry = this.entries.get(filePath);
		if (!entry || entry.fileName.endsWith("/")) {
			return null;
		}
		return entry;
	}

	/**
	 * Open a stream of the decompressed content of an entry
	 *
	 * @param entry - Entry to read, must belong to this archive.
	 */
	openStream(entry: yauzl.Entry): Promise<Readable> {
		return this.zipfile.openReadStreamPromise(entry);
	}

	/**
	 * Read the decompressed content of an entry
	 *
	 * @param entry - Entry to read, must belong to this archive.
	 */
	async readEntry(entry: yauzl.Entry) {
		const chunks: Buffer[] = [];
		for await (const chunk of await this.openStream(entry)) {
			chunks.push(chunk);
		}
		return Buffer.concat(chunks);
	}

	/**
	 * Read the content of a file in the archive
	 *
	 * @param filePath - Path of the file in the archive.
	 * @returns content of the file, or null if it does not exist.
	 */
	async readFile(filePath: string) {
		const entry = this.file(filePath);
		if (!entry) {
			return null;
		}
		return await this.readEntry(entry);
	}

	/**
	 * Close the archive
	 *
	 * Streams already opened are still readable until they end.
	 */
	close() {
		this.zipfile.close();
	}
}

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
export function findRoot(zip: ZipArchive) {
	const relativePath = zip.entries.keys().next().value;
	if (relativePath === undefined) {
		throw new Error("Empty zip file");
	}

	let index = relativePath.indexOf("/");
	if (index === -1) {
		throw new Error(`Zip contains file '${relativePath}' in root dir`);
	}

	return relativePath.slice(0, index);
}

/**
 * Returns the output stream of a zip file being written
 *
 * yazl reports errors on the ZipFile object and leaves the output stream
 * hanging.  The stream returned here is destroyed with the error instead so
 * that consumers like stream.pipeline see it.
 *
 * @param zipFile - zip file being written.
 */
export function zipOutputStream(zipFile: yazl.ZipFile) {
	const output = zipFile.outputStream as Readable;
	zipFile.on("error", err => output.destroy(err));
	return output;
}
