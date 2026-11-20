/* eslint-disable node/no-sync */
import { strToU8, unzlibSync, zlibSync } from "fflate";

export function inflateSync(data: Uint8Array): Uint8Array {
	try {
		return unzlibSync(data);
	} catch (err: any) {
		// Match the error code node:zlib gives for invalid data.
		throw Object.assign(new Error(err.message), { code: "Z_DATA_ERROR" });
	}
}

export function deflateSync(data: Uint8Array | string): Uint8Array {
	return zlibSync(typeof data === "string" ? strToU8(data) : data);
}
