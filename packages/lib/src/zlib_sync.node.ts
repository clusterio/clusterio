import zlib from "zlib";

export function inflateSync(data: Uint8Array): Uint8Array {
	// eslint-disable-next-line node/no-sync
	return zlib.inflateSync(data);
}

export function deflateSync(data: Uint8Array | string): Uint8Array {
	// eslint-disable-next-line node/no-sync
	return zlib.deflateSync(data);
}
