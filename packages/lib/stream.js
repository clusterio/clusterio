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
 * @memberof module:lib/stream
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

module.exports = {
	LineSplitter,
};
