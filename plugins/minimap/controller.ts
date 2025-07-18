import * as lib from "@clusterio/lib";
import { BaseControllerPlugin } from "@clusterio/controller";
import {
	TileDataEvent,
	GetInstanceBoundsRequest,
	ChartData,
} from "./messages";
import * as fs from "fs-extra";
import * as path from "path";
import * as zlib from "zlib";
import { promisify } from "util";
import sharp from "sharp";

const CHUNK_SIZE = 32;
const inflateAsync = promisify(zlib.inflate);

interface PixelChange {
	x: number;
	y: number;
	newColor: number;
	oldColor: number;
}

export class ControllerPlugin extends BaseControllerPlugin {
	private tilesPath: string = "";
	private chunkSavingQueue = new Map<string, Map<string, { data: ChartData, tick: number }>>();
	private savingTiles: boolean = false;
	// Set to true if colors appear inverted - this will try big-endian byte order
	private useBigEndian: boolean = false;

	async init() {
		this.tilesPath = path.resolve(
			this.controller.config.get("controller.database_directory"),
			"minimap_tiles"
		);
		await fs.ensureDir(this.tilesPath);

		this.controller.handle(TileDataEvent, this.handleTileDataEvent.bind(this));
		this.controller.handle(GetInstanceBoundsRequest, this.handleGetInstanceBoundsRequest.bind(this));

		// Set up HTTP routes for serving tiles
		this.setupTileRoutes();

		setInterval(() => {
			this.saveTiles().catch(err => this.logger.error(`Error saving tiles: ${err}`));
		}, 5000);
	}

	// Convert RGB565 to RGB888 values using Factorio's exact method
	private rgb565ToRgb888(rgb565Value: number): [number, number, number] {
		// This matches ByteColor(uint16_t rgb5) constructor in Factorio source
		const r = ((rgb565Value >> 11) & 0x1F) << 3;  // 5 bits -> 8 bits
		const g = ((rgb565Value >> 5) & 0x3F) << 2;   // 6 bits -> 8 bits  
		const b = (rgb565Value & 0x1F) << 3;          // 5 bits -> 8 bits
		return [r, g, b];
	}

	// Render chunk data to get RGB565 pixel array for comparison
	private async renderChunkToPixels(chunkData: Buffer): Promise<Uint16Array> {
		try {
			const decompressed = await inflateAsync(chunkData);
			const pixels = new Uint16Array(32 * 32);
			
			// Ensure we don't read beyond available data
			const maxPixels = Math.min(decompressed.length / 2, 32 * 32);
			
			for (let i = 0; i < maxPixels; i++) {
				pixels[i] = decompressed.readUInt16LE(i * 2);
			}
			
			// Fill remaining pixels with black (0) if we have less data than expected
			for (let i = maxPixels; i < 32 * 32; i++) {
				pixels[i] = 0;
			}
			
			return pixels;
		} catch (decompressError) {
			this.logger.error(`Failed to decompress chunk data: ${decompressError}`);
			// Return black pixels on error
			return new Uint16Array(32 * 32);
		}
	}

	// Compare two pixel arrays and return changes
	private comparePixels(oldPixels: Uint16Array, newPixels: Uint16Array, chunkX: number, chunkY: number): PixelChange[] {
		const changes: PixelChange[] = [];
		
		for (let y = 0; y < 32; y++) {
			for (let x = 0; x < 32; x++) {
				const index = y * 32 + x;
				const oldColor = oldPixels[index];
				const newColor = newPixels[index];
				
				if (oldColor !== newColor) {
					// Calculate absolute position within the 256x256 tile
					const absoluteX = chunkX * 32 + x;
					const absoluteY = chunkY * 32 + y;
					
					changes.push({
						x: absoluteX,
						y: absoluteY,
						newColor,
						oldColor,
					});
				}
			}
		}
		
		return changes;
	}

	// Create pixel changeset data buffer
	private createPixelChangeset(changes: PixelChange[], tick: number): Buffer {
		if (changes.length === 0) {
			return Buffer.alloc(0);
		}
		
		// Type (1) + Tick (4) + Length (2) + Pixel data (6 bytes per pixel)
		const headerSize = 7;
		const pixelDataSize = changes.length * 6; // 6 bytes per pixel change
		const totalSize = headerSize + pixelDataSize;
		const buffer = Buffer.alloc(totalSize);
		
		let offset = 0;
		
		// Type 2 for pixels
		buffer.writeUInt8(2, offset);
		offset += 1;
		
		// Tick (converted to seconds)
		buffer.writeUInt32BE(Math.floor(tick / 60), offset);
		offset += 4;
		
		// Length (number of pixel changes, not bytes)
		buffer.writeUInt16BE(changes.length, offset);
		offset += 2;
		
		// Write pixel changes
		for (const change of changes) {
			buffer.writeUInt8(change.x, offset);
			offset += 1;
			buffer.writeUInt8(change.y, offset);
			offset += 1;
			buffer.writeUInt16BE(change.newColor, offset);
			offset += 2;
			buffer.writeUInt16BE(change.oldColor, offset);
			offset += 2;
		}
		
		return buffer;
	}

	private setupTileRoutes() {
		const app = this.controller.app;

		app.get("/api/minimap/tile/:instanceId/:surface/:force/:z/:x/:y.png", async (req, res) => {
			try {
				const { instanceId, surface, force, z, x, y } = req.params;
				const tileX = parseInt(x);
				const tileY = parseInt(y);

				const tileName = `${instanceId}_${surface}_${force}_${tileX}_${tileY}.bin`;
				const tilePath = path.join(this.tilesPath, tileName);

				if (!await fs.pathExists(tilePath)) {
					res.status(404).send("Tile not found");
					return;
				}

				const tileData = await fs.readFile(tilePath);
				const image = await this.renderTile(tileData);
				res.setHeader("Content-Type", "image/png");
				res.send(image);

			} catch (err) {
				this.logger.error(`Error serving tile: ${err}`);
				res.status(500).send("Error serving tile");
			}
		});

		app.get("/api/minimap/surfaces", async (req, res) => {
			try {
				const files = await fs.readdir(this.tilesPath);
				const surfaces = new Set<string>();
				const forces = new Set<string>();

				for (const file of files) {
					if (file.endsWith(".bin")) {
						const parts = file.split("_");
						if (parts.length === 5) {
							surfaces.add(parts[1]);
							forces.add(parts[2]);
						}
					}
				}

				res.json({
					surfaces: Array.from(surfaces),
					forces: Array.from(forces),
				});
			} catch (err) {
				this.logger.error(`Error listing surfaces and forces: ${err}`);
				res.status(500).json({ error: "Failed to list surfaces and forces" });
			}
		});
	}

	async renderTile(tileData: Buffer): Promise<Buffer> {
		// Use renderTileToPixels to get the current state, then convert to image
		const currentPixels = await this.renderTileToPixels(tileData);
		
		// Convert RGB565 pixel data to RGBA buffer for Sharp
		const raw = Buffer.alloc(256 * 256 * 4);
		for (let i = 0; i < 256 * 256; i++) {
			const rgb565Value = currentPixels[i];
			const [r, g, b] = this.rgb565ToRgb888(rgb565Value);
			const bufferIndex = i * 4;
			raw[bufferIndex] = r;
			raw[bufferIndex + 1] = g;
			raw[bufferIndex + 2] = b;
			raw[bufferIndex + 3] = 255; // Alpha
		}

		// Create and return the image directly
		return sharp(raw, { 
			raw: { width: 256, height: 256, channels: 4 } 
		}).png().toBuffer();
	}

	async saveTiles() {
		if (this.savingTiles) {
			return;
		}

		const queue = this.chunkSavingQueue;
		if (queue.size === 0) {
			return;
		}
		this.logger.info(`Starting save for ${queue.size} tiles.`);

		this.savingTiles = true;
		this.chunkSavingQueue = new Map();

		try {
			const savePromises = [];
			for (const [tileName, chunks] of queue) {
				const promise = (async () => {
					const tilePath = path.join(this.tilesPath, tileName);
					let existingTile = Buffer.alloc(0);
					if (await fs.pathExists(tilePath)) {
						existingTile = await fs.readFile(tilePath);
					}
					const newTile = await this.updateTile(existingTile, chunks);
					if (newTile && newTile.length > 0) {
						await fs.writeFile(tilePath, newTile);
					}
				})();
				savePromises.push(promise);
			}
			await Promise.all(savePromises);
		} catch (err) {
			this.logger.error(`Error saving tiles: ${err}`);
		} finally {
			this.savingTiles = false;
		}
	}

	async updateTile(existingTile: Buffer, newChunks: Map<string, { data: ChartData, tick: number }>): Promise<Buffer | undefined> {
		const existingChunks = new Map<string, { tick: number, data: Buffer }>();
		
		// Parse existing tile data to find existing chunks
		let offset = 0;
		while (offset < existingTile.length) {
			if (offset + 1 > existingTile.length) {
				this.logger.error(`Invalid tile data: cannot read type at offset ${offset}`);
				break;
			}
			
			const type = existingTile.readUInt8(offset);
			offset += 1;
			
			if (type === 1) { // Chunk
				if (offset + 7 > existingTile.length) {
					this.logger.error(`Invalid tile data: insufficient chunk header data at offset ${offset}`);
					break;
				}
				
				const tick = existingTile.readUInt32BE(offset);
				offset += 4;
				const chunkCoordsByte = existingTile.readUInt8(offset);
				offset += 1;
				const length = existingTile.readUInt16BE(offset);
				offset += 2;
				
				if (offset + length > existingTile.length) {
					this.logger.error(`Invalid tile data: insufficient chunk data at offset ${offset}`);
					break;
				}
				
				const chunkX = chunkCoordsByte >> 4;
				const chunkY = chunkCoordsByte & 0x0F;
				const chunkName = `${chunkX}_${chunkY}`;
				const data = existingTile.slice(offset, offset + length);
				offset += length;
				existingChunks.set(chunkName, { tick, data });

			} else if (type === 2) { // Pixels
				if (offset + 6 > existingTile.length) {
					this.logger.error(`Invalid tile data: insufficient pixel header data at offset ${offset}`);
					break;
				}
				
				const tick = existingTile.readUInt32BE(offset);
				offset += 4;
				const pixelCount = existingTile.readUInt16BE(offset);
				offset += 2;
				const pixelDataLength = pixelCount * 6;
				
				if (offset + pixelDataLength > existingTile.length) {
					this.logger.error(`Invalid tile data: insufficient pixel data at offset ${offset}`);
					break;
				}
				
				// Skip pixel data since we're not rebuilding the file
				offset += pixelDataLength;
			} else {
				this.logger.error(`Unknown tile data type: ${type} at offset ${offset}`);
				break;
			}
		}

		// Render the current state of the entire tile if we have existing data
		let currentTilePixels: Uint16Array | null = null;
		if (existingTile.length > 0) {
			currentTilePixels = await this.renderTileToPixels(existingTile);
		}

		// Process new chunks and determine what to append
		const appendBuffers: Buffer[] = [];
		let hasChanges = false;
		
		for (const [chunkName, newChunk] of newChunks) {
			const newChunkData = Buffer.from(newChunk.data.chart_data, "base64");
			const [chunkX, chunkY] = chunkName.split("_").map(Number);
			
			if (!existingChunks.has(chunkName)) {
				// New chunk - append as chunk data (type 1)
				this.logger.info(`Adding new chunk ${chunkName} to tile`);
				const header = Buffer.alloc(8);
				header.writeUInt8(1, 0); // Type 1 (chunk)
				header.writeUInt32BE(Math.floor(newChunk.tick / 60), 1); // Tick
				header.writeUInt8((chunkX << 4) | chunkY, 5); // Coords
				header.writeUInt16BE(newChunkData.length, 6); // Length
				appendBuffers.push(header, newChunkData);
				hasChanges = true;
			} else {
				// Existing chunk - compare current tile state with new chunk data
				const newPixels = await this.renderChunkToPixels(newChunkData);
				
				let oldPixels: Uint16Array;
				if (currentTilePixels) {
					// Extract current chunk area from the rendered tile
					oldPixels = this.extractChunkFromTile(currentTilePixels, chunkX, chunkY);
				} else {
					// Fallback to black pixels if tile couldn't be rendered
					oldPixels = new Uint16Array(32 * 32);
				}
				
				const changes = this.comparePixels(oldPixels, newPixels, chunkX, chunkY);
				if (changes.length > 0) {
					this.logger.info(`Adding ${changes.length} pixel changes for chunk ${chunkName} to tile`);
					const changeset = this.createPixelChangeset(changes, newChunk.tick);
					if (changeset.length > 0) {
						appendBuffers.push(changeset);
						hasChanges = true;
					}
				}
			}
		}

		if (!hasChanges) {
			return;
		}

		// Append new data to existing tile (never modify existing data)
		return Buffer.concat([existingTile, ...appendBuffers]);
	}

	// Render tile data to pixels
	private async renderTileToPixels(tileData: Buffer): Promise<Uint16Array> {
		const currentPixels = new Uint16Array(256 * 256); // 256x256 tile
		
		let offset = 0;
		while (offset < tileData.length) {
			if (offset + 1 > tileData.length) {
				break;
			}
			
			const type = tileData.readUInt8(offset);
			offset += 1;

			if (type === 1) { // Chunk
				if (offset + 7 > tileData.length) {
					break;
				}
				
				const tick = tileData.readUInt32BE(offset);
				offset += 4;
				const chunkCoordsByte = tileData.readUInt8(offset);
				offset += 1;
				const length = tileData.readUInt16BE(offset);
				offset += 2;

				if (offset + length > tileData.length) {
					break;
				}

				const chunkX = chunkCoordsByte >> 4;
				const chunkY = chunkCoordsByte & 0x0F;
				const chunkData = tileData.slice(offset, offset + length);

				try {
					const chunkPixels = await this.renderChunkToPixels(chunkData);
					
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
					this.logger.error(`Failed to decompress chunk data: ${decompressError}`);
				}
				
				offset += length;
			} else if (type === 2) { // Pixels
				if (offset + 6 > tileData.length) {
					break;
				}
				
				const tick = tileData.readUInt32BE(offset);
				offset += 4;
				const pixelCount = tileData.readUInt16BE(offset);
				offset += 2;
				
				const expectedDataLength = pixelCount * 6;
				if (offset + expectedDataLength > tileData.length) {
					break;
				}
				
				// Apply pixel changes to current state
				for (let i = 0; i < pixelCount; i++) {
					const pixelOffset = offset + i * 6;
					const x = tileData.readUInt8(pixelOffset);
					const y = tileData.readUInt8(pixelOffset + 1);
					const newColor = tileData.readUInt16BE(pixelOffset + 2);
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

	// Extract a 32x32 chunk area from a 256x256 tile
	private extractChunkFromTile(tilePixels: Uint16Array, chunkX: number, chunkY: number): Uint16Array {
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

	async handleTileDataEvent(event: TileDataEvent) {
		try {
			const { instance_id, surface, force, x, y, tick, chunk } = event;

			// Calculate tile coordinates for 8x8 chunks per tile (256x256 pixels)
			const tileX = Math.floor(x / 32 / 8);
			const tileY = Math.floor(y / 32 / 8);
			const tileName = `${instance_id}_${surface}_${force}_${tileX}_${tileY}.bin`;

			// Fix negative modulo results by using proper modulo operation (0-7 range for 8x8)
			const chunkX = ((Math.floor(x / 32) % 8) + 8) % 8;
			const chunkY = ((Math.floor(y / 32) % 8) + 8) % 8;
			const chunkName = `${chunkX}_${chunkY}`;

			if (!this.chunkSavingQueue.has(tileName)) {
				this.chunkSavingQueue.set(tileName, new Map());
			}
			this.chunkSavingQueue.get(tileName)!.set(chunkName, { data: chunk, tick });

			// Send live update to connected web clients
			const updateEvent = new TileDataEvent(
				instance_id,
				surface,
				force,
				x,
				y,
				tick,
				chunk
			);
			
			// Broadcast to web clients (overriding the formal src/dst routing)
			this.controller.sendTo(new lib.Address(lib.Address.broadcast, lib.Address.control), updateEvent);

		} catch (err) {
			this.logger.error(`Error processing tile data: ${err}`);
		}
	}

	async handleGetInstanceBoundsRequest(request: GetInstanceBoundsRequest) {
		const instances = Array.from(this.controller.instances.values())
			.filter(instance => instance.status === "running")
			.map(instance => ({
				instanceId: instance.config.get("instance.id"),
				name: instance.config.get("instance.name"),
				bounds: {
					x1: -512, // Default bounds, could be made configurable
					y1: -512,
					x2: 512,
					y2: 512,
				},
			}));

		return { instances };
	}
} 
