import { BinaryData, sliceData, readUInt8, readUInt16LE, readUInt16BE, readUInt32BE, isNode } from "./parsing-utils";
import * as zlib from "zlib";

// Cross-platform decompression
async function inflateData(data: BinaryData): Promise<Buffer | Uint8Array> {
	if (isNode) {
		// Node.js environment - use promisified inflate
		const { promisify } = await import("util");
		const inflateAsync = promisify(zlib.inflate);
		return inflateAsync(data as Buffer);
	}
	// Browser environment - use promisified inflate
	return new Promise((resolve, reject) => {
		try {
			const buffer = data instanceof Buffer ? data : Buffer.from(data);
			zlib.inflate(buffer, (err, result) => {
				if (err) {
					reject(err);
				} else {
					resolve(result);
				}
			});
		} catch (err) {
			reject(err);
		}
	});
}

/**
 * Convert RGB565 to RGB888 values using Factorio's exact method
 * @param rgb565Value The RGB565 color value to convert
 * @returns Tuple of RGB values [r, g, b]
 */
export function rgb565ToRgb888(rgb565Value: number): [number, number, number] {
	// This matches ByteColor(uint16_t rgb5) constructor in Factorio source
	const r = ((rgb565Value >> 11) & 0x1F) << 3; // 5 bits -> 8 bits
	const g = ((rgb565Value >> 5) & 0x3F) << 2; // 6 bits -> 8 bits
	const b = (rgb565Value & 0x1F) << 3; // 5 bits -> 8 bits
	return [r, g, b];
}

/**
 * Render chunk data to get RGB565 pixel array
 * @param chunkData The compressed chunk data to render
 * @returns RGB565 pixel array for 32x32 chunk
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
		// Return black pixels on error
		return new Uint16Array(32 * 32);
	}
}

/**
 * Extract a 32x32 chunk area from a 256x256 tile
 * @param tilePixels The full tile pixel data
 * @param chunkX Chunk X coordinate within tile
 * @param chunkY Chunk Y coordinate within tile
 * @returns RGB565 pixel array for 32x32 chunk
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
 * @param tileData The binary tile data to render
 * @param maxTick Optional maximum tick to render up to
 * @returns RGB565 pixel array for 256x256 tile
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
			const chunkResult = await processChunkData(
				tileData, offset, currentPixels, maxTick
			);
			if (!chunkResult.success) {
				break;
			}
			offset = chunkResult.newOffset;
		} else if (type === 2) { // Pixels
			const pixelResult = processPixelData(tileData, offset, currentPixels, maxTick);
			if (!pixelResult.success) {
				break;
			}
			offset = pixelResult.newOffset;
		} else {
			break;
		}
	}

	return currentPixels;
}

/**
 * Process chunk data during tile rendering
 * @param tileData The binary tile data being processed
 * @param offset Current offset in the tile data
 * @param currentPixels The pixel array to update
 * @param maxTick Optional maximum tick to render up to
 * @returns Processing result with success status and new offset
 */
async function processChunkData(
	tileData: BinaryData,
	offset: number,
	currentPixels: Uint16Array,
	maxTick?: number
): Promise<{ success: boolean; newOffset: number }> {
	if (offset + 7 > tileData.length) {
		return { success: false, newOffset: offset };
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
		return { success: true, newOffset: offset };
	}

	const chunkCoordsByte = readUInt8(tileData, offset);
	offset += 1;
	const length = readUInt16BE(tileData, offset);
	offset += 2;

	if (offset + length > tileData.length) {
		return { success: false, newOffset: offset };
	}

	const chunkX = chunkCoordsByte >> 4;
	const chunkY = chunkCoordsByte & 0x0F;
	const chunkData = sliceData(tileData, offset, offset + length);

	try {
		const chunkPixels = await renderChunkToPixels(chunkData);

		// Update current pixel state
		updateTilePixelsWithChunk(currentPixels, chunkPixels, chunkX, chunkY);
	} catch (decompressError) {
		// Continue processing other chunks on error
	}

	return { success: true, newOffset: offset + length };
}

/**
 * Process pixel data during tile rendering
 * @param tileData The binary tile data being processed
 * @param offset Current offset in the tile data
 * @param currentPixels The pixel array to update
 * @param maxTick Optional maximum tick to render up to
 * @returns Processing result with success status and new offset
 */
function processPixelData(
	tileData: BinaryData,
	offset: number,
	currentPixels: Uint16Array,
	maxTick?: number
): { success: boolean; newOffset: number } {
	if (offset + 10 > tileData.length) {
		return { success: false, newOffset: offset };
	}

	const tick = readUInt32BE(tileData, offset) * 60; // Convert back to actual tick
	offset += 4;
	const pixelCount = readUInt16BE(tileData, offset);
	offset += 2;
	const newColor = readUInt16BE(tileData, offset);
	offset += 2;
	const oldColor = readUInt16BE(tileData, offset);
	offset += 2;

	const expectedDataLength = pixelCount * 2; // x,y per pixel
	if (offset + expectedDataLength > tileData.length) {
		return { success: false, newOffset: offset };
	}

	// Skip if beyond target tick
	if (maxTick !== undefined && tick > maxTick) {
		return { success: true, newOffset: offset + expectedDataLength };
	}

	for (let i = 0; i < pixelCount; i++) {
		const pixelOffset = offset + i * 2;
		const x = readUInt8(tileData, pixelOffset);
		const y = readUInt8(tileData, pixelOffset + 1);
		if (x < 256 && y < 256) {
			currentPixels[y * 256 + x] = newColor;
		}
	}

	return { success: true, newOffset: offset + expectedDataLength };
}

/**
 * Update tile pixels with chunk data
 * @param currentPixels The tile pixel array to update
 * @param chunkPixels The chunk pixel data to apply
 * @param chunkX Chunk X coordinate within tile
 * @param chunkY Chunk Y coordinate within tile
 */
function updateTilePixelsWithChunk(
	currentPixels: Uint16Array,
	chunkPixels: Uint16Array,
	chunkX: number,
	chunkY: number
): void {
	for (let y = 0; y < 32; y++) {
		for (let x = 0; x < 32; x++) {
			const chunkIndex = y * 32 + x;
			const tileX = chunkX * 32 + x;
			const tileY = chunkY * 32 + y;
			const tileIndex = tileY * 256 + tileX;
			currentPixels[tileIndex] = chunkPixels[chunkIndex];
		}
	}
}

/**
 * Convert RGB565 pixel array to RGBA pixel data for canvas rendering
 * Returns Uint8ClampedArray that can be used to create ImageData in browser
 * @param pixels The RGB565 pixel array to convert
 * @returns RGBA pixel data as Uint8ClampedArray
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
 * @param pixels The RGB565 pixel array to convert
 * @returns ImageData object for canvas rendering
 */
export function pixelsToImageData(pixels: Uint16Array): any {
	if (typeof (globalThis as any).ImageData === "undefined") {
		throw new Error("ImageData is not available in this environment. Use pixelsToRGBA() instead.");
	}
	const rgbaData = pixelsToRGBA(pixels);
	return new (globalThis as any).ImageData(rgbaData, 256, 256);
}

/**
 * Parse tile data and extract all available ticks for timelapse functionality
 * @param tileData The binary tile data to parse
 * @returns Array of available ticks sorted in ascending order
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
			if (offset + 10 > tileData.length) {
				break;
			}

			const tick = readUInt32BE(tileData, offset) * 60; // Convert back to actual tick
			ticks.add(tick);
			offset += 4;

			const pixelCount = readUInt16BE(tileData, offset);
			offset += 2 + 2 + 2; // skip newColor oldColor too
			const expectedDataLength = pixelCount * 2;
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
 * @param tileData The binary tile data to parse
 * @returns Parsed tile data with chunks, pixel changes, and all ticks
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
			const result = parseChunkRecord(tileData, offset, chunks, ticks);
			if (!result.success) {
				break;
			}
			offset = result.newOffset;
		} else if (type === 2) { // Pixels
			const result = parsePixelChangeRecord(tileData, offset, pixelChanges, ticks);
			if (!result.success) {
				break;
			}
			offset = result.newOffset;
		} else {
			break;
		}
	}

	return {
		chunks,
		pixelChanges,
		allTicks: Array.from(ticks).sort((a, b) => a - b),
	};
}

/**
 * Parse chunk record from tile data
 * @param tileData The binary tile data being processed
 * @param offset Current offset in the tile data
 * @param chunks Array to add the parsed chunk to
 * @param ticks Set to add the chunk tick to
 * @returns Processing result with success status and new offset
 */
function parseChunkRecord(
	tileData: BinaryData,
	offset: number,
	chunks: ChunkRecord[],
	ticks: Set<number>
): { success: boolean; newOffset: number } {
	if (offset + 7 > tileData.length) {
		return { success: false, newOffset: offset };
	}

	const tick = readUInt32BE(tileData, offset) * 60; // Convert back to actual tick
	ticks.add(tick);
	offset += 4;

	const chunkCoordsByte = readUInt8(tileData, offset);
	offset += 1;
	const length = readUInt16BE(tileData, offset);
	offset += 2;

	if (offset + length > tileData.length) {
		return { success: false, newOffset: offset };
	}

	const chunkX = chunkCoordsByte >> 4;
	const chunkY = chunkCoordsByte & 0x0F;
	const data = sliceData(tileData, offset, offset + length);

	chunks.push({
		tick,
		chunkX,
		chunkY,
		data,
	});

	return { success: true, newOffset: offset + length };
}

/**
 * Parse pixel change record from tile data
 * @param tileData The binary tile data being processed
 * @param offset Current offset in the tile data
 * @param pixelChanges Array to add the parsed pixel changes to
 * @param ticks Set to add the pixel change tick to
 * @returns Processing result with success status and new offset
 */
function parsePixelChangeRecord(
	tileData: BinaryData,
	offset: number,
	pixelChanges: PixelChangeRecord[],
	ticks: Set<number>
): { success: boolean; newOffset: number } {
	if (offset + 10 > tileData.length) {
		return { success: false, newOffset: offset };
	}

	const tick = readUInt32BE(tileData, offset) * 60; // Convert back to actual tick
	ticks.add(tick);
	offset += 4;
	const pixelCount = readUInt16BE(tileData, offset);
	offset += 2;
	const newColor = readUInt16BE(tileData, offset);
	offset += 2;
	const oldColor = readUInt16BE(tileData, offset);
	offset += 2;

	const expectedDataLength = pixelCount * 2;
	if (offset + expectedDataLength > tileData.length) {
		return { success: false, newOffset: offset };
	}

	const changes: PixelChange[] = [];
	for (let i = 0; i < pixelCount; i++) {
		const pixelOffset = offset + i * 2;
		const x = readUInt8(tileData, pixelOffset);
		const y = readUInt8(tileData, pixelOffset + 1);
		changes.push({ x, y, newColor, oldColor });
	}

	pixelChanges.push({ tick, changes });
	return { success: true, newOffset: offset + expectedDataLength };
}

/**
 * Apply chunk data to RGB565 pixel array
 * @param pixels The tile pixel array to update
 * @param chunkRecord The chunk record to apply
 */
export async function applyChunkToPixels(pixels: Uint16Array, chunkRecord: ChunkRecord): Promise<void> {
	try {
		const chunkPixels = await renderChunkToPixels(chunkRecord.data);
		updateTilePixelsWithChunk(pixels, chunkPixels, chunkRecord.chunkX, chunkRecord.chunkY);
	} catch (err) {
		// Error applying chunk - continue without this chunk
	}
}

/**
 * Clear chunk area to black (for rewinding past chunk creation)
 * @param pixels The tile pixel array to update
 * @param chunkRecord The chunk record to clear
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
 * @param pixels The tile pixel array to update
 * @param changes Array of pixel changes to apply
 */
export function applyPixelChanges(pixels: Uint16Array, changes: PixelChange[]): void {
	for (const change of changes) {
		const tileIndex = change.y * 256 + change.x;
		pixels[tileIndex] = change.newColor;
	}
}

/**
 * Revert pixel changes from RGB565 pixel array (backward direction)
 * @param pixels The tile pixel array to update
 * @param changes Array of pixel changes to revert
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
 * @param parsedData The parsed tile data
 * @param currentPixels The current pixel state
 * @param fromTick The starting tick
 * @param toTick The target tick
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
		await applyChangesForward(chunks, pixelChanges, currentPixels, fromTick, toTick);
	} else {
		await applyChangesBackward(chunks, pixelChanges, currentPixels, fromTick, toTick);
	}
}

/**
 * Apply changes in forward direction
 * @param chunks Array of chunk records to process
 * @param pixelChanges Array of pixel change records to process
 * @param currentPixels The pixel array to update
 * @param fromTick The starting tick
 * @param toTick The target tick
 */
async function applyChangesForward(
	chunks: ChunkRecord[],
	pixelChanges: PixelChangeRecord[],
	currentPixels: Uint16Array,
	fromTick: number,
	toTick: number
): Promise<void> {
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
}

/**
 * Apply changes in backward direction
 * @param chunks Array of chunk records to process
 * @param pixelChanges Array of pixel change records to process
 * @param currentPixels The pixel array to update
 * @param fromTick The starting tick
 * @param toTick The target tick
 */
async function applyChangesBackward(
	chunks: ChunkRecord[],
	pixelChanges: PixelChangeRecord[],
	currentPixels: Uint16Array,
	fromTick: number,
	toTick: number
): Promise<void> {
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
export function parseRecipeTileBinary(
	tileX: number,
	tileY: number,
	buf: BinaryData,
	targetTick: number | null
): ParsedRecipeTile {
	const ticks: number[] = [];
	const dict = new Map<number, string>();
	const active = new Map<string, string>();
	const targetSec = targetTick !== null ? Math.floor(targetTick / 60) : Infinity;

	let offset = 0;
	while (offset < buf.length) {
		const type = readUInt8(buf, offset);
		offset += 1;

		if (type === 0) { // Dictionary entry
			const result = parseDictionaryEntry(buf, offset, dict);
			offset = result.newOffset;
		} else if (type === 1 || type === 2) { // Set recipe (1) or Clear recipe (2)
			const result = parseRecipeEntry(
				buf, offset, type, tileX, tileY, ticks, active, targetSec, dict
			);
			offset = result.newOffset;
		} else {
			// Unknown recipe record type - stop parsing
			break;
		}
	}

	return { ticks, activeRecipes: active, dictionary: dict };
}

/**
 * Parse dictionary entry from recipe tile
 * @param buf The binary recipe tile data
 * @param offset Current offset in the data
 * @param dict Dictionary map to add the entry to
 * @returns Processing result with new offset
 */
function parseDictionaryEntry(
	buf: BinaryData,
	offset: number,
	dict: Map<number, string>
): { newOffset: number } {
	const idx = readUInt16BE(buf, offset);
	offset += 2;
	const len = readUInt8(buf, offset);
	offset += 1;
	const nameBytes = sliceData(buf, offset, offset + len);
	offset += len;

	// Convert to string using cross-platform method
	let recipeName: string;
	if (isNode && nameBytes instanceof Buffer) {
		recipeName = nameBytes.toString("utf-8");
	} else {
		recipeName = new TextDecoder().decode(nameBytes as Uint8Array);
	}

	dict.set(idx, recipeName);
	return { newOffset: offset };
}

/**
 * Parse recipe entry from recipe tile
 * @param buf The binary recipe tile data
 * @param offset Current offset in the data
 * @param type Entry type (1 = set recipe, 2 = clear recipe)
 * @param tileX Tile X coordinate for world position calculation
 * @param tileY Tile Y coordinate for world position calculation
 * @param ticks Array to add the entry tick to
 * @param active Map of active recipes to update
 * @param targetSec Target second for filtering
 * @param dict Dictionary map for recipe name lookup
 * @returns Processing result with new offset
 */
function parseRecipeEntry(
	buf: BinaryData,
	offset: number,
	type: number,
	tileX: number,
	tileY: number,
	ticks: number[],
	active: Map<string, string>,
	targetSec: number,
	dict: Map<number, string>
): { newOffset: number } {
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
		// Future to target time – skip without applying
		return { newOffset: offset };
	}

	const worldX = tileX * 256 + px;
	const worldY = tileY * 256 + py;
	const posKey = `${worldX},${worldY}`;

	if (type === 1 && idx !== undefined) {
		const name = dict.get(idx);
		if (name) {
			active.set(posKey, name);
		}
	} else if (type === 2) {
		active.delete(posKey);
	}

	return { newOffset: offset };
}
