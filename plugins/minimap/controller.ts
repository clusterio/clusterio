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
		const tileSize = 256;
		const canvas = sharp({
			create: {
				width: tileSize,
				height: tileSize,
				channels: 4,
				background: { r: 0, g: 0, b: 0, alpha: 0 },
			},
		});

		const compositeImages: any[] = [];
		let offset = 0;
		while (offset < tileData.length) {
			if (offset + 1 > tileData.length) {
				this.logger.error(`Invalid tile data: cannot read type at offset ${offset}`);
				break;
			}
			
			const type = tileData.readUInt8(offset);
			offset += 1; // After type

			if (type === 1) { // Chunk
				// Check if we have enough bytes for the header
				if (offset + 7 > tileData.length) {
					this.logger.error(`Invalid tile data: insufficient header data at offset ${offset}`);
					break;
				}
				
				const tick = tileData.readUInt32BE(offset); // Read tick
				offset += 4; // After tick
				const chunkCoordsByte = tileData.readUInt8(offset); // Read coords
				offset += 1; // After coords
				const length = tileData.readUInt16BE(offset); // Read length
				offset += 2; // After length

				// Check if we have enough bytes for the data
				if (offset + length > tileData.length) {
					this.logger.error(`Invalid tile data: insufficient chunk data at offset ${offset}, need ${length} bytes but only ${tileData.length - offset} available`);
					break;
				}

				const chunkX = chunkCoordsByte >> 4;
				const chunkY = chunkCoordsByte & 0x0F;
				const chunkData = tileData.slice(offset, offset + length);

				try {
					const decompressed = await inflateAsync(chunkData);
					
					const raw = Buffer.alloc(32 * 32 * 4);
					// Initialize buffer to black (all zeros with alpha=255)
					for (let i = 0; i < 32 * 32; i++) {
						raw[i * 4 + 3] = 255; // Set alpha to 255 for all pixels
					}
					
					// Ensure we don't read beyond available data
					const maxPixels = Math.min(decompressed.length / 2, 32 * 32);
					
					for (let i = 0; i < maxPixels * 2; i += 2) {
						const rgb565Value = decompressed.readUInt16LE(i);
						const [r, g, b] = this.rgb565ToRgb888(rgb565Value);
						const pixelIndex = i / 2;
						const bufferIndex = pixelIndex * 4;
						raw[bufferIndex] = r;
						raw[bufferIndex + 1] = g;
						raw[bufferIndex + 2] = b;
						raw[bufferIndex + 3] = 255;
					}

					compositeImages.push({
						input: await sharp(raw, { raw: { width: 32, height: 32, channels: 4 } }).png().toBuffer(),
						left: chunkX * 32,
						top: chunkY * 32,
					});
				} catch (decompressError) {
					this.logger.error(`Failed to decompress chunk data: ${decompressError}`);
				}
				
				offset += length; // Advance offset by the data block length
			} else if (type === 2) { // Pixels
				// Check if we have enough bytes for the header
				if (offset + 6 > tileData.length) {
					this.logger.error(`Invalid tile data: insufficient pixel header data at offset ${offset}`);
					break;
				}
				
				// Read tick (4 bytes) and length (2 bytes) first
				offset += 4; // Skip tick
				const length = tileData.readUInt16BE(offset); // Read length
				offset += 2; // After length
				
				// Check if we have enough bytes for the data
				if (offset + length > tileData.length) {
					this.logger.error(`Invalid tile data: insufficient pixel data at offset ${offset}, need ${length} bytes but only ${tileData.length - offset} available`);
					break;
				}
				
				offset += length; // Advance offset by the data block length
			} else {
				this.logger.error(`Unknown tile data type: ${type} at offset ${offset}`);
				break;
			}
		}

		return canvas.composite(compositeImages).png().toBuffer();
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
					await fs.writeFile(tilePath, newTile);
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

	async updateTile(existingTile: Buffer, newChunks: Map<string, { data: ChartData, tick: number }>): Promise<Buffer> {
		const existingChunks = new Map<string, { tick: number, data: Buffer }>();
		let offset = 0;
		while (offset < existingTile.length) {
			const type = existingTile.readUInt8(offset);
			offset += 1;
			
			if (type === 1) { // Chunk
				const tick = existingTile.readUInt32BE(offset);
				offset += 4;
				const chunkCoordsByte = existingTile.readUInt8(offset);
				offset += 1;
				const length = existingTile.readUInt16BE(offset);
				offset += 2;
				
				const chunkX = chunkCoordsByte >> 4;
				const chunkY = chunkCoordsByte & 0x0F;
				const chunkName = `${chunkX}_${chunkY}`;
				const data = existingTile.slice(offset, offset + length);
				offset += length;
				existingChunks.set(chunkName, { tick, data });

			} else if (type === 2) { // Pixels
				const tick = existingTile.readUInt32BE(offset);
				offset += 4;
				const length = existingTile.readUInt16BE(offset);
				offset += 2;
				offset += length; // Skip pixel data
			}
		}

		for (const [chunkName, chunk] of newChunks) {
			// chart_data is already compressed by Factorio, just decode base64
			const chunkData = Buffer.from(chunk.data.chart_data, "base64");
			existingChunks.set(chunkName, { tick: chunk.tick, data: chunkData });
		}

		const newTileParts: Buffer[] = [];
		for (const [chunkName, chunk] of existingChunks) {
			const [chunkX, chunkY] = chunkName.split("_").map(Number);
			const header = Buffer.alloc(8); // Type (1) + Tick (4) + Coords (1) + Length (2)
			header.writeUInt8(1, 0); // Type
			header.writeUInt32BE(Math.floor(chunk.tick / 60), 1); // Tick
			header.writeUInt8((chunkX << 4) | chunkY, 5); // Coords
			header.writeUInt16BE(chunk.data.length, 6); // Length of data block only
			newTileParts.push(header, chunk.data);
		}

		return Buffer.concat(newTileParts);
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
