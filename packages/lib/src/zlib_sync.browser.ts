/* eslint-disable node/no-sync */
import { strToU8, unzlibSync, zlibSync } from "fflate";

function adler32(data: Uint8Array) {
	let a = 1;
	let b = 0;
	for (let i = 0; i < data.length;) {
		// Largest run before b can overflow 2^53, see zlib's NMAX
		const end = Math.min(i + 5552, data.length);
		for (; i < end; i++) {
			a += data[i];
			b += a;
		}
		a %= 65521;
		b %= 65521;
	}
	return ((b << 16) | a) >>> 0;
}

function zlibError(message: string, code: string) {
	return Object.assign(new Error(message), { code });
}

// Throws with the same error codes as node:zlib. Unlike node:zlib, data after
// the end of the stream is rejected, as the checksum is read from the end.
export function inflateSync(data: Uint8Array): Uint8Array {
	let result: Uint8Array;
	try {
		result = unzlibSync(data);
	} catch (err: any) {
		if (err.code === 0 || data.length < 2) {
			throw zlibError(err.message, "Z_BUF_ERROR");
		}
		if (err.message.endsWith("need dictionary")) {
			throw zlibError(err.message, "Z_NEED_DICT");
		}
		throw zlibError(err.message, "Z_DATA_ERROR");
	}
	if (data.length < 6) {
		throw zlibError("unexpected end of file", "Z_BUF_ERROR");
	}
	const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
	if (view.getUint32(data.length - 4) !== adler32(result)) {
		throw zlibError("incorrect data check", "Z_DATA_ERROR");
	}
	return result;
}

export function deflateSync(data: Uint8Array | string): Uint8Array {
	return zlibSync(typeof data === "string" ? strToU8(data) : data);
}
