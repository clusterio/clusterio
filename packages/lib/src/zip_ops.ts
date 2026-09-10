/**
 * Zip file helpers
 * @module lib/zip_ops
 */
import events from "events";
import { PassThrough, type Readable } from "stream";
import util from "util";
import zlib from "zlib";
import yauzl from "yauzl";
import type yazl from "yazl";

const deflateRaw = util.promisify(zlib.deflateRaw);


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

const zip64Limit = 0xffffffff;

function dosDateTime(date: Date) {
	if (date.getFullYear() < 1980) {
		return { date: 0x21, time: 0 };
	}
	const year = Math.min(date.getFullYear(), 2107);
	return {
		date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
		time: (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1),
	};
}

interface WriterEntry {
	fileName: Buffer;
	fileComment: Buffer;
	versionMadeBy: number;
	generalPurposeBitFlag: number;
	compressionMethod: number;
	lastModFileTime: number;
	lastModFileDate: number;
	crc32: number;
	compressedSize: number;
	uncompressedSize: number;
	externalFileAttributes: number;
	offset: number;
}

export interface ZipWriterOptions {
	/** Use ZIP64 structures even when the archive does not need them. */
	forceZip64?: boolean;
}

export interface ZipWriterBufferOptions {
	/** Modification time to record for the file, defaults to now. */
	mtime?: Date;
}

/**
 * Streaming zip file writer
 *
 * Writes entries to outputStream as they are added.  Entries from an
 * existing archive are copied without decompressing them.  Sizes and
 * offsets past 4 GiB and more than 65535 entries use ZIP64 structures.
 */
export class ZipWriter {
	/** Content of the zip file, ends when end() has been called. */
	outputStream = new PassThrough();
	private offset = 0;
	private entries: WriterEntry[] = [];
	private forceZip64: boolean;

	constructor(options: ZipWriterOptions = {}) {
		this.forceZip64 = options.forceZip64 ?? false;
	}

	/**
	 * Copy an entry from an archive
	 *
	 * The compressed content is copied as is along with the metadata
	 * Factorio writes.  Extra fields are dropped.
	 *
	 * @param zip - Archive to copy from.
	 * @param entry - Entry to copy, must belong to zip.
	 */
	async addEntry(zip: ZipArchive, entry: yauzl.Entry) {
		const writerEntry: WriterEntry = {
			fileName: Buffer.from(entry.fileName, "utf8"),
			fileComment: Buffer.from(entry.fileComment, "utf8"),
			versionMadeBy: entry.versionMadeBy,
			// Sizes are written in the local header so no data descriptor is
			// needed, and names are re-encoded as UTF-8.
			generalPurposeBitFlag: (entry.generalPurposeBitFlag & ~0x8) | 0x800,
			compressionMethod: entry.compressionMethod,
			lastModFileTime: entry.lastModFileTime,
			lastModFileDate: entry.lastModFileDate,
			crc32: entry.crc32,
			compressedSize: entry.compressedSize,
			uncompressedSize: entry.uncompressedSize,
			externalFileAttributes: entry.externalFileAttributes,
			offset: this.offset,
		};
		await this.write(this.localFileHeader(writerEntry));
		const stream = await zip.zipfile.openReadStreamPromise(entry, { decodeFileData: false });
		for await (const chunk of stream) {
			await this.write(chunk);
		}
		this.entries.push(writerEntry);
	}

	/**
	 * Add a file with the given content
	 *
	 * @param buffer - Content of the file.
	 * @param fileName - Path of the file in the archive.
	 * @param options - Options for the entry.
	 */
	async addBuffer(buffer: Buffer, fileName: string, options: ZipWriterBufferOptions = {}) {
		const deflated = await deflateRaw(buffer);
		const { date, time } = dosDateTime(options.mtime ?? new Date());
		const writerEntry: WriterEntry = {
			fileName: Buffer.from(fileName, "utf8"),
			fileComment: Buffer.alloc(0),
			versionMadeBy: 20,
			generalPurposeBitFlag: 0x800,
			compressionMethod: 8,
			lastModFileTime: time,
			lastModFileDate: date,
			crc32: zlib.crc32(buffer),
			compressedSize: deflated.length,
			uncompressedSize: buffer.length,
			externalFileAttributes: 0,
			offset: this.offset,
		};
		await this.write(this.localFileHeader(writerEntry));
		await this.write(deflated);
		this.entries.push(writerEntry);
	}

	/**
	 * Write the central directory and end the output stream
	 */
	async end() {
		const start = this.offset;
		for (const entry of this.entries) {
			await this.write(this.centralDirectoryHeader(entry));
		}
		const size = this.offset - start;
		const zip64 = this.forceZip64 || this.entries.length >= 0xffff || start >= zip64Limit || size >= zip64Limit;
		if (zip64) {
			const record = Buffer.alloc(56);
			record.writeUInt32LE(0x06064b50, 0);
			record.writeBigUInt64LE(44n, 4);
			record.writeUInt16LE(45, 12); // version made by
			record.writeUInt16LE(45, 14); // version needed to extract
			record.writeUInt32LE(0, 16); // number of this disk
			record.writeUInt32LE(0, 20); // disk with the central directory
			record.writeBigUInt64LE(BigInt(this.entries.length), 24);
			record.writeBigUInt64LE(BigInt(this.entries.length), 32);
			record.writeBigUInt64LE(BigInt(size), 40);
			record.writeBigUInt64LE(BigInt(start), 48);
			const locator = Buffer.alloc(20);
			locator.writeUInt32LE(0x07064b50, 0);
			locator.writeUInt32LE(0, 4); // disk with the zip64 end of central directory
			locator.writeBigUInt64LE(BigInt(this.offset), 8);
			locator.writeUInt32LE(1, 16); // total number of disks
			await this.write(record);
			await this.write(locator);
		}
		const eocd = Buffer.alloc(22);
		eocd.writeUInt32LE(0x06054b50, 0);
		eocd.writeUInt16LE(0, 4); // number of this disk
		eocd.writeUInt16LE(0, 6); // disk with the central directory
		eocd.writeUInt16LE(zip64 ? 0xffff : this.entries.length, 8);
		eocd.writeUInt16LE(zip64 ? 0xffff : this.entries.length, 10);
		eocd.writeUInt32LE(zip64 ? zip64Limit : size, 12);
		eocd.writeUInt32LE(zip64 ? zip64Limit : start, 16);
		eocd.writeUInt16LE(0, 20); // comment length
		await this.write(eocd);
		this.outputStream.end();
	}

	private localFileHeader(entry: WriterEntry) {
		const zip64 = this.forceZip64
			|| entry.compressedSize >= zip64Limit
			|| entry.uncompressedSize >= zip64Limit;
		const extra = zip64 ? Buffer.alloc(20) : Buffer.alloc(0);
		if (zip64) {
			extra.writeUInt16LE(0x0001, 0);
			extra.writeUInt16LE(16, 2);
			extra.writeBigUInt64LE(BigInt(entry.uncompressedSize), 4);
			extra.writeBigUInt64LE(BigInt(entry.compressedSize), 12);
		}
		const header = Buffer.alloc(30);
		header.writeUInt32LE(0x04034b50, 0);
		header.writeUInt16LE(zip64 ? 45 : 20, 4); // version needed to extract
		header.writeUInt16LE(entry.generalPurposeBitFlag, 6);
		header.writeUInt16LE(entry.compressionMethod, 8);
		header.writeUInt16LE(entry.lastModFileTime, 10);
		header.writeUInt16LE(entry.lastModFileDate, 12);
		header.writeUInt32LE(entry.crc32, 14);
		header.writeUInt32LE(zip64 ? zip64Limit : entry.compressedSize, 18);
		header.writeUInt32LE(zip64 ? zip64Limit : entry.uncompressedSize, 22);
		header.writeUInt16LE(entry.fileName.length, 26);
		header.writeUInt16LE(extra.length, 28);
		return Buffer.concat([header, entry.fileName, extra]);
	}

	private centralDirectoryHeader(entry: WriterEntry) {
		const zip64 = this.forceZip64
			|| entry.compressedSize >= zip64Limit
			|| entry.uncompressedSize >= zip64Limit
			|| entry.offset >= zip64Limit;
		const extra = zip64 ? Buffer.alloc(28) : Buffer.alloc(0);
		if (zip64) {
			extra.writeUInt16LE(0x0001, 0);
			extra.writeUInt16LE(24, 2);
			extra.writeBigUInt64LE(BigInt(entry.uncompressedSize), 4);
			extra.writeBigUInt64LE(BigInt(entry.compressedSize), 12);
			extra.writeBigUInt64LE(BigInt(entry.offset), 20);
		}
		const header = Buffer.alloc(46);
		header.writeUInt32LE(0x02014b50, 0);
		header.writeUInt16LE(entry.versionMadeBy, 4);
		header.writeUInt16LE(zip64 ? 45 : 20, 6); // version needed to extract
		header.writeUInt16LE(entry.generalPurposeBitFlag, 8);
		header.writeUInt16LE(entry.compressionMethod, 10);
		header.writeUInt16LE(entry.lastModFileTime, 12);
		header.writeUInt16LE(entry.lastModFileDate, 14);
		header.writeUInt32LE(entry.crc32, 16);
		header.writeUInt32LE(zip64 ? zip64Limit : entry.compressedSize, 20);
		header.writeUInt32LE(zip64 ? zip64Limit : entry.uncompressedSize, 24);
		header.writeUInt16LE(entry.fileName.length, 28);
		header.writeUInt16LE(extra.length, 30);
		header.writeUInt16LE(entry.fileComment.length, 32);
		header.writeUInt16LE(0, 34); // disk number start
		header.writeUInt16LE(0, 36); // internal file attributes
		header.writeUInt32LE(entry.externalFileAttributes, 38);
		header.writeUInt32LE(zip64 ? zip64Limit : entry.offset, 42);
		return Buffer.concat([header, entry.fileName, extra, entry.fileComment]);
	}

	private async write(buffer: Buffer) {
		if (this.outputStream.destroyed) {
			throw this.outputStream.errored ?? new Error("Zip output stream was closed");
		}
		if (!this.outputStream.write(buffer)) {
			// once() rejects if the stream errors, close covers a plain destroy.
			const controller = new AbortController();
			const { signal } = controller;
			try {
				await Promise.race([
					events.once(this.outputStream, "drain", { signal }),
					events.once(this.outputStream, "close", { signal }).then(() => {
						throw this.outputStream.errored ?? new Error("Zip output stream was closed");
					}),
				]);
			} finally {
				controller.abort();
			}
		}
		this.offset += buffer.length;
	}
}
