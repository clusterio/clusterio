// Environment detection
export const isNode = typeof Buffer !== "undefined" && typeof process !== "undefined" && process.versions?.node;

// Cross-platform type for binary data
export type BinaryData = Buffer | Uint8Array;

// Cross-platform helper functions for reading integers
export function readUInt8(data: BinaryData, offset: number): number {
	if (isNode && data instanceof Buffer) {
		return data.readUInt8(offset);
	}
	return (data as Uint8Array)[offset];
}

export function readUInt16LE(data: BinaryData, offset: number): number {
	if (isNode && data instanceof Buffer) {
		return data.readUInt16LE(offset);
	}
	const bytes = data as Uint8Array;
	return bytes[offset] | (bytes[offset + 1] << 8);
}

export function readUInt16BE(data: BinaryData, offset: number): number {
	if (isNode && data instanceof Buffer) {
		return data.readUInt16BE(offset);
	}
	const bytes = data as Uint8Array;
	return (bytes[offset] << 8) | bytes[offset + 1];
}

export function readUInt32BE(data: BinaryData, offset: number): number {
	if (isNode && data instanceof Buffer) {
		return data.readUInt32BE(offset);
	}
	const bytes = data as Uint8Array;
	return (bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3];
}

export function sliceData(data: BinaryData, start: number, end: number): BinaryData {
	return data.slice(start, end);
}
