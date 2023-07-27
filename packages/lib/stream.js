"use strict";
const assert = require("assert");
const fs = require("fs-extra");
const stream = require("stream");


/**
 * Transform splitting a stream into lines
 *
 * Splits up a stream of chunks by newlines and passes on the lines one by
 * one removing the line feed and optional carriage return from the lines.
 *
 * @example
 * let lineStream = new libStream.LineSplitter({ readableObjectMode: true });
 * lineStream.on("data", line => { console.log(line.toString("utf8")); });
 * let fileStream = fs.createReadStream(path);
 * fileStream.pipe(lineStream);
 *
 * @memberof module:lib
 */
class LineSplitter extends stream.Transform {
	constructor(options) {
		super(options);
		this._partial = null;
	}

	_transform(chunk, encoding, callback) {
		if (this._partial) {
			chunk = Buffer.concat([this._partial, chunk]);
			this._partial = null;
		}

		while (chunk.length) {
			let end = chunk.indexOf("\n");
			if (end === -1) {
				this._partial = chunk;
				break;
			}

			let next = end + 1;
			// Eat carriage return as well if present
			if (end >= 1 && chunk[end-1] === "\r".charCodeAt(0)) {
				end -= 1;
			}

			let line = chunk.slice(0, end);
			chunk = chunk.slice(next);
			this.push(line);
		}
		callback();
	}

	_flush(callback) {
		if (this._partial) {
			this.push(this._partial);
			this._partial = null;
		}
		callback();
	}
}

/**
 * Transform splitting a reverse stream into lines
 *
 * Splits up a reverse stream of chunks created by {@link
 * module:lib.createReverseReadStream} by newlines and passes on the
 * lines one by one in reverse order removing the line feed and optional
 * carriage return from the lines.
 *
 * @example
 * let revLineStream = new libStream.ReverseLineSplitter({ readableObjectMode: true });
 * revLineStream.on("data", line => { console.log(line.toString("utf8")); });
 * let revFileStream = await libStream.createReverseReadStream(path);
 * revFileStream.pipe(revLineStream);
 *
 * @memberof module:lib
 */
class ReverseLineSplitter extends stream.Transform {
	constructor(options) {
		super(options);
		this._partial = null;
	}

	_transform(chunk, encoding, callback) {
		if (this._partial) {
			chunk = Buffer.concat([chunk, this._partial]);
			this._partial = null;
		}

		while (chunk.length) {
			let next = chunk.lastIndexOf("\n", -2);
			if (next === -1) {
				this._partial = chunk;
				break;
			}

			let end = chunk.length - 1;
			if (chunk[end] === "\n".charCodeAt(0)) {
				end -= 1;
				// Eat carriage return as well if present
				if (end - next > 0 && chunk[end] === "\r".charCodeAt(0)) {
					end -= 1;
				}
			}

			let line = chunk.slice(next + 1, end + 1);
			chunk = chunk.slice(0, next + 1);
			this.push(line);
		}
		callback();
	}

	_flush(callback) {
		if (this._partial) {
			let end = this._partial.length - 1;
			if (this._partial[end] === "\n".charCodeAt(0)) {
				end -= 1;
				// Eat carriage return as well if present
				if (end > 0 && this._partial[end] === "\r".charCodeAt(0)) {
					end -= 1;
				}
			}
			this.push(this._partial.slice(0, end + 1));
			this._partial = null;
		}
		callback();
	}
}


/**
 * Create a file read stream running in reverse
 *
 * Like fs.createReadStream but provides data chunks starting from the end
 * of the file and progressing towards the start of the file.  The chunks
 * are not reversed, thus the file content can be recreated by concatenating
 * the chunks together in the reverse order they are read.
 *
 * @param {string} path -
 *     Path to file to open. May be anything accepted by fs.open.
 * @param {object} options -
 *     Options to pass to fs.createReadStream.  Values passed for `fd` and
 *     `fs` will be ignored.
 * @memberof module:lib
 */
async function createReverseReadStream(path, options) {
	const fileFd = await fs.open(path, "r");
	const fileSize = (await fs.fstat(fileFd)).size;
	let filePosition = fileSize;
	const reverseFs = {
		read(fd, buffer, offset, length, position, callback) {
			assert(fd === fileFd);
			assert(position === undefined);
			length = Math.min(length, filePosition);
			filePosition -= length;
			return fs.read(fd, buffer, offset, length, filePosition, callback);
		},
		open() { assert(false); },
		close(fd, callback) { return fs.close(fd, callback); },
	};
	return fs.createReadStream("", { ...options, fd: fileFd, fs: reverseFs });
}

module.exports = {
	LineSplitter,
	ReverseLineSplitter,
	createReverseReadStream,
};
