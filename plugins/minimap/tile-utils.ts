import * as zlib from "zlib";

// Environment detection
const isNode = typeof Buffer !== 'undefined' && typeof process !== 'undefined' && process.versions?.node;

// Cross-platform type for binary data
type BinaryData = Buffer | Uint8Array;

// Cross-platform helper functions for reading integers
function readUInt8(data: BinaryData, offset: number): number {
	if (isNode && data instanceof Buffer) {
		return data.readUInt8(offset);
	}
	return (data as Uint8Array)[offset];
}

function readUInt16LE(data: BinaryData, offset: number): number {
	if (isNode && data instanceof Buffer) {
		return data.readUInt16LE(offset);
	}
	const bytes = data as Uint8Array;
	return bytes[offset] | (bytes[offset + 1] << 8);
}

function readUInt16BE(data: BinaryData, offset: number): number {
	if (isNode && data instanceof Buffer) {
		return data.readUInt16BE(offset);
	}
	const bytes = data as Uint8Array;
	return (bytes[offset] << 8) | bytes[offset + 1];
}

function readUInt32BE(data: BinaryData, offset: number): number {
	if (isNode && data instanceof Buffer) {
		return data.readUInt32BE(offset);
	}
	const bytes = data as Uint8Array;
	return (bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3];
}

function sliceData(data: BinaryData, start: number, end: number): BinaryData {
	return data.slice(start, end);
}

// Cross-platform decompression
async function inflateData(data: BinaryData): Promise<Buffer | Uint8Array> {
	if (isNode) {
		// Node.js environment - use promisified inflate
		const { promisify } = await import("util");
		const inflateAsync = promisify(zlib.inflate);
		return inflateAsync(data as Buffer);
	} else {
		// Browser environment - use sync version (it's actually async-friendly due to polyfill)
		const buffer = data instanceof Buffer ? data : Buffer.from(data);
		return zlib.inflateSync(buffer);
	}
}

/**
 * Convert RGB565 to RGB888 values using Factorio's exact method
 */
export function rgb565ToRgb888(rgb565Value: number): [number, number, number] {
	// This matches ByteColor(uint16_t rgb5) constructor in Factorio source
	const r = ((rgb565Value >> 11) & 0x1F) << 3;  // 5 bits -> 8 bits
	const g = ((rgb565Value >> 5) & 0x3F) << 2;   // 6 bits -> 8 bits  
	const b = (rgb565Value & 0x1F) << 3;          // 5 bits -> 8 bits
	return [r, g, b];
}

/**
 * Render chunk data to get RGB565 pixel array
 */
export async function renderChunkToPixels(chunkData: BinaryData): Promise<Uint16Array> {
	try {
		const decompressed = await inflateData(chunkData);
		const pixels = new Uint16Array(32 * 32);

		// Ensure we don't read beyond available data
		const maxPixels = Math.min(decompressed.length / 2, 32 * 32);

		for (let i = 0; i < maxPixels; i++) {
			pixels[i] = readUInt16LE(decompressed, i * 2);
		}

		// Fill remaining pixels with black (0) if we have less data than expected
		for (let i = maxPixels; i < 32 * 32; i++) {
			pixels[i] = 0;
		}

		return pixels;
	} catch (decompressError) {
		console.error(`Failed to decompress chunk data: ${decompressError}`);
		// Return black pixels on error
		return new Uint16Array(32 * 32);
	}
}

/**
 * Extract a 32x32 chunk area from a 256x256 tile
 */
export function extractChunkFromTile(tilePixels: Uint16Array, chunkX: number, chunkY: number): Uint16Array {
	const chunkPixels = new Uint16Array(32 * 32);

	for (let y = 0; y < 32; y++) {
		for (let x = 0; x < 32; x++) {
			const tileX = chunkX * 32 + x;
			const tileY = chunkY * 32 + y;
			const tileIndex = tileY * 256 + tileX;
			const chunkIndex = y * 32 + x;
			chunkPixels[chunkIndex] = tilePixels[tileIndex];
		}
	}

	return chunkPixels;
}

/**
 * Render tile data to RGB565 pixel array (256x256)
 * Supports rendering up to a specific tick for timelapse functionality
 */
export async function renderTileToPixels(tileData: BinaryData, maxTick?: number): Promise<Uint16Array> {
	const currentPixels = new Uint16Array(256 * 256); // 256x256 tile

	let offset = 0;
	while (offset < tileData.length) {
		if (offset + 1 > tileData.length) {
			break;
		}

		const type = readUInt8(tileData, offset);
		offset += 1;

		if (type === 1) { // Chunk
			if (offset + 7 > tileData.length) {
				break;
			}

			const tick = readUInt32BE(tileData, offset) * 60; // Convert back to actual tick
			offset += 4;

			// Skip this chunk if it's beyond our target tick
			if (maxTick !== undefined && tick > maxTick) {
				const chunkCoordsByte = readUInt8(tileData, offset);
				offset += 1;
				const length = readUInt16BE(tileData, offset);
				offset += 2;
				offset += length; // Skip chunk data
				continue;
			}

			const chunkCoordsByte = readUInt8(tileData, offset);
			offset += 1;
			const length = readUInt16BE(tileData, offset);
			offset += 2;

			if (offset + length > tileData.length) {
				break;
			}

			const chunkX = chunkCoordsByte >> 4;
			const chunkY = chunkCoordsByte & 0x0F;
			const chunkData = sliceData(tileData, offset, offset + length);

			try {
				const chunkPixels = await renderChunkToPixels(chunkData);

				// Update current pixel state
				for (let y = 0; y < 32; y++) {
					for (let x = 0; x < 32; x++) {
						const chunkIndex = y * 32 + x;
						const tileX = chunkX * 32 + x;
						const tileY = chunkY * 32 + y;
						const tileIndex = tileY * 256 + tileX;
						currentPixels[tileIndex] = chunkPixels[chunkIndex];
					}
				}
			} catch (decompressError) {
				console.error(`Failed to decompress chunk data: ${decompressError}`);
			}

			offset += length;
		} else if (type === 2) { // Pixels
			if (offset + 6 > tileData.length) {
				break;
			}

			const tick = readUInt32BE(tileData, offset) * 60; // Convert back to actual tick
			offset += 4;
			const pixelCount = readUInt16BE(tileData, offset);
			offset += 2;

			const expectedDataLength = pixelCount * 6;
			if (offset + expectedDataLength > tileData.length) {
				break;
			}

			// Skip this pixel changeset if it's beyond our target tick
			if (maxTick !== undefined && tick > maxTick) {
				offset += expectedDataLength;
				continue;
			}

			// Apply pixel changes to current state
			for (let i = 0; i < pixelCount; i++) {
				const pixelOffset = offset + i * 6;
				const x = readUInt8(tileData, pixelOffset);
				const y = readUInt8(tileData, pixelOffset + 1);
				const newColor = readUInt16BE(tileData, pixelOffset + 2);
				// oldColor at pixelOffset + 4 is not needed for rendering

				// Update current pixel state
				if (x < 256 && y < 256) {
					const tileIndex = y * 256 + x;
					currentPixels[tileIndex] = newColor;
				}
			}

			offset += expectedDataLength;
		} else {
			break;
		}
	}

	return currentPixels;
}

/**
 * Convert RGB565 pixel array to RGBA pixel data for canvas rendering
 * Returns Uint8ClampedArray that can be used to create ImageData in browser
 */
export function pixelsToRGBA(pixels: Uint16Array): Uint8ClampedArray {
	const imageData = new Uint8ClampedArray(256 * 256 * 4);

	for (let i = 0; i < 256 * 256; i++) {
		const rgb565Value = pixels[i];
		const [r, g, b] = rgb565ToRgb888(rgb565Value);
		const bufferIndex = i * 4;

		imageData[bufferIndex] = r;
		imageData[bufferIndex + 1] = g;
		imageData[bufferIndex + 2] = b;
		imageData[bufferIndex + 3] = 255; // Alpha
	}

	return imageData;
}

/**
 * Convert RGB565 pixel array to ImageData for canvas rendering (browser only)
 */
export function pixelsToImageData(pixels: Uint16Array): any {
	if (typeof (globalThis as any).ImageData === 'undefined') {
		throw new Error('ImageData is not available in this environment. Use pixelsToRGBA() instead.');
	}
	const rgbaData = pixelsToRGBA(pixels);
	return new (globalThis as any).ImageData(rgbaData, 256, 256);
}

/**
 * Parse tile data and extract all available ticks for timelapse functionality
 */
export function extractAvailableTicks(tileData: BinaryData): number[] {
	const ticks = new Set<number>();

	let offset = 0;
	while (offset < tileData.length) {
		if (offset + 1 > tileData.length) {
			break;
		}

		const type = readUInt8(tileData, offset);
		offset += 1;

		if (type === 1) { // Chunk
			if (offset + 7 > tileData.length) {
				break;
			}

			const tick = readUInt32BE(tileData, offset) * 60; // Convert back to actual tick
			ticks.add(tick);
			offset += 4;

			const chunkCoordsByte = readUInt8(tileData, offset);
			offset += 1;
			const length = readUInt16BE(tileData, offset);
			offset += 2;
			offset += length; // Skip chunk data
		} else if (type === 2) { // Pixels
			if (offset + 6 > tileData.length) {
				break;
			}

			const tick = readUInt32BE(tileData, offset) * 60; // Convert back to actual tick
			ticks.add(tick);
			offset += 4;

			const pixelCount = readUInt16BE(tileData, offset);
			offset += 2;

			const expectedDataLength = pixelCount * 6;
			if (offset + expectedDataLength > tileData.length) {
				break;
			}

			offset += expectedDataLength;
		} else {
			break;
		}
	}

	return Array.from(ticks).sort((a, b) => a - b);
}

/**
 * Interface for tracking pixel changes in timelapse data
 */
export interface PixelChange {
	x: number;
	y: number;
	newColor: number;
	oldColor: number;
}

/**
 * Interface for chunk records in timelapse data
 */
export interface ChunkRecord {
	tick: number;
	chunkX: number;
	chunkY: number;
	data: BinaryData;
}

/**
 * Interface for pixel change records in timelapse data
 */
export interface PixelChangeRecord {
	tick: number;
	changes: PixelChange[];
}

/**
 * Interface for parsed tile data with all change records
 */
export interface ParsedTileData {
	chunks: ChunkRecord[];
	pixelChanges: PixelChangeRecord[];
	allTicks: number[];
}

/**
 * Parse tile data into structured change records for efficient timelapse navigation
 */
export function parseTileData(tileData: BinaryData): ParsedTileData {
	const chunks: ChunkRecord[] = [];
	const pixelChanges: PixelChangeRecord[] = [];
	const ticks = new Set<number>();

	let offset = 0;
	while (offset < tileData.length) {
		if (offset + 1 > tileData.length) {
			break;
		}

		const type = readUInt8(tileData, offset);
		offset += 1;

		if (type === 1) { // Chunk
			if (offset + 7 > tileData.length) {
				break;
			}

			const tick = readUInt32BE(tileData, offset) * 60; // Convert back to actual tick
			ticks.add(tick);
			offset += 4;

			const chunkCoordsByte = readUInt8(tileData, offset);
			offset += 1;
			const length = readUInt16BE(tileData, offset);
			offset += 2;

			if (offset + length > tileData.length) {
				break;
			}

			const chunkX = chunkCoordsByte >> 4;
			const chunkY = chunkCoordsByte & 0x0F;
			const data = sliceData(tileData, offset, offset + length);

			chunks.push({
				tick,
				chunkX,
				chunkY,
				data
			});

			offset += length;
		} else if (type === 2) { // Pixels
			if (offset + 6 > tileData.length) {
				break;
			}

			const tick = readUInt32BE(tileData, offset) * 60; // Convert back to actual tick
			ticks.add(tick);
			offset += 4;
			const pixelCount = readUInt16BE(tileData, offset);
			offset += 2;

			const expectedDataLength = pixelCount * 6;
			if (offset + expectedDataLength > tileData.length) {
				break;
			}

			const changes: PixelChange[] = [];
			for (let i = 0; i < pixelCount; i++) {
				const pixelOffset = offset + i * 6;
				const x = readUInt8(tileData, pixelOffset);
				const y = readUInt8(tileData, pixelOffset + 1);
				const newColor = readUInt16BE(tileData, pixelOffset + 2);
				const oldColor = readUInt16BE(tileData, pixelOffset + 4);

				if (x < 256 && y < 256) {
					changes.push({ x, y, newColor, oldColor });
				}
			}

			if (changes.length > 0) {
				pixelChanges.push({
					tick,
					changes
				});
			}

			offset += expectedDataLength;
		} else {
			break;
		}
	}

	return {
		chunks,
		pixelChanges,
		allTicks: Array.from(ticks).sort((a, b) => a - b)
	};
}

/**
 * Apply chunk data to RGB565 pixel array
 */
export async function applyChunkToPixels(pixels: Uint16Array, chunkRecord: ChunkRecord): Promise<void> {
	try {
		const chunkPixels = await renderChunkToPixels(chunkRecord.data);

		// Update tile pixels with chunk data
		for (let y = 0; y < 32; y++) {
			for (let x = 0; x < 32; x++) {
				const chunkIndex = y * 32 + x;
				const tileX = chunkRecord.chunkX * 32 + x;
				const tileY = chunkRecord.chunkY * 32 + y;
				const tileIndex = tileY * 256 + tileX;
				pixels[tileIndex] = chunkPixels[chunkIndex];
			}
		}
	} catch (err) {
		console.error(`Failed to apply chunk ${chunkRecord.chunkX},${chunkRecord.chunkY}:`, err);
	}
}

/**
 * Clear chunk area to black (for rewinding past chunk creation)
 */
export function clearChunkInPixels(pixels: Uint16Array, chunkRecord: ChunkRecord): void {
	for (let y = 0; y < 32; y++) {
		for (let x = 0; x < 32; x++) {
			const tileX = chunkRecord.chunkX * 32 + x;
			const tileY = chunkRecord.chunkY * 32 + y;
			const tileIndex = tileY * 256 + tileX;
			pixels[tileIndex] = 0; // Black
		}
	}
}

/**
 * Apply pixel changes to RGB565 pixel array (forward direction)
 */
export function applyPixelChanges(pixels: Uint16Array, changes: PixelChange[]): void {
	for (const change of changes) {
		const tileIndex = change.y * 256 + change.x;
		pixels[tileIndex] = change.newColor;
	}
}

/**
 * Revert pixel changes from RGB565 pixel array (backward direction)
 */
export function revertPixelChanges(pixels: Uint16Array, changes: PixelChange[]): void {
	for (const change of changes) {
		const tileIndex = change.y * 256 + change.x;
		pixels[tileIndex] = change.oldColor;
	}
}

/**
 * Render tile data incrementally from one tick to another
 * Much more efficient than re-rendering from scratch
 */
export async function renderTileIncremental(
	parsedData: ParsedTileData,
	currentPixels: Uint16Array,
	fromTick: number,
	toTick: number
): Promise<void> {
	const { chunks, pixelChanges } = parsedData;

	if (fromTick === toTick) {
		return; // No changes needed
	}

	const forward = toTick > fromTick;

	if (forward) {
		// Apply changes forward from fromTick to toTick

		// Apply chunks that occur in this range
		for (const chunk of chunks) {
			if (chunk.tick > fromTick && chunk.tick <= toTick) {
				await applyChunkToPixels(currentPixels, chunk);
			}
		}

		// Apply pixel changes that occur in this range
		for (const record of pixelChanges) {
			if (record.tick > fromTick && record.tick <= toTick) {
				applyPixelChanges(currentPixels, record.changes);
			}
		}
	} else {
		// Revert changes backward from fromTick to toTick

		// Revert pixel changes in reverse order
		for (let i = pixelChanges.length - 1; i >= 0; i--) {
			const record = pixelChanges[i];
			if (record.tick <= fromTick && record.tick > toTick) {
				revertPixelChanges(currentPixels, record.changes);
			}
		}

		// Revert chunks (clear to black if we're going before their creation time)
		for (let i = chunks.length - 1; i >= 0; i--) {
			const chunk = chunks[i];
			if (chunk.tick <= fromTick && chunk.tick > toTick) {
				clearChunkInPixels(currentPixels, chunk);
			}
		}
	}
}

/**
 * Interface for parsed recipe tile data
 */
export interface ParsedRecipeTile {
	ticks: number[]; // ticks present in this tile
	activeRecipes: Map<string, string>; // posKey -> recipeName
	dictionary: Map<number, string>; // id -> recipeName
}

/**
 * Parse binary recipe tile data and return timeline ticks and active recipes at target tick
 * @param tileX Tile X coordinate for world position calculation
 * @param tileY Tile Y coordinate for world position calculation  
 * @param buf Binary recipe tile data
 * @param targetTick Target tick for filtering (null = latest state)
 * @returns Parsed recipe data with ticks and active recipes
 */
export function parseRecipeTileBinary(tileX: number, tileY: number, buf: BinaryData, targetTick: number | null): ParsedRecipeTile {
	const ticks: number[] = [];
	const dict = new Map<number, string>();
	const active = new Map<string, string>();
	const targetSec = targetTick !== null ? Math.floor(targetTick / 60) : Infinity;

	let offset = 0;
	while (offset < buf.length) {
		const type = readUInt8(buf, offset);
		offset += 1;

		if (type === 0) { // Dictionary entry
			const idx = readUInt16BE(buf, offset);
			offset += 2;
			const len = readUInt8(buf, offset);
			offset += 1;
			const nameBytes = sliceData(buf, offset, offset + len);
			offset += len;

			// Convert to string using cross-platform method
			let recipeName: string;
			if (isNode && nameBytes instanceof Buffer) {
				recipeName = nameBytes.toString('utf-8');
			} else {
				recipeName = new TextDecoder().decode(nameBytes as Uint8Array);
			}

			dict.set(idx, recipeName);
		} else if (type === 1 || type === 2) { // Set recipe (1) or Clear recipe (2)
			const sec = readUInt32BE(buf, offset);
			offset += 4;
			const px = readUInt8(buf, offset);
			offset += 1;
			const py = readUInt8(buf, offset);
			offset += 1;

			let idx: number | undefined;
			if (type === 1) {
				idx = readUInt16BE(buf, offset);
				offset += 2;
			}

			const tickVal = sec * 60;
			ticks.push(tickVal);

			if (sec > targetSec) {
				// Future to target time – we can skip rest if file is chronological
				// but to be safe just continue without applying
				continue;
			}

			const worldX = tileX * 256 + px;
			const worldY = tileY * 256 + py;
			const posKey = `${worldX},${worldY}`;

			if (type === 1 && idx !== undefined) {
				const name = dict.get(idx);
				if (name) active.set(posKey, name);
			} else if (type === 2) {
				active.delete(posKey);
			}
		} else {
			console.warn("Unknown recipe record type", type);
			break;
		}
	}

	return { ticks, activeRecipes: active, dictionary: dict };
} 
