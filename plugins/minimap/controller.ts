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
	// Set to true if colors appear inverted - this will try big-endian byte order
	private useBigEndian: boolean = false;

	async init() {
		this.tilesPath = path.resolve(
			this.controller.config.get("controller.database_directory"),
			"minimap_chunks"
		);
		await fs.ensureDir(this.tilesPath);

		this.controller.handle(TileDataEvent, this.handleTileDataEvent.bind(this));

		this.controller.handle(GetInstanceBoundsRequest, this.handleGetInstanceBoundsRequest.bind(this));

		// Set up HTTP routes for serving tiles
		this.setupTileRoutes();
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

		// Create black placeholder image for 512x512 tiles
		const createBlackTile = async () => {
			return await sharp({
				create: {
					width: 512,
					height: 512,
					channels: 4,
					background: { r: 0, g: 0, b: 0, alpha: 0 },
				},
			}).png().toBuffer();
		};

		// Serve chart tiles with surface and force support - now serving 512x512 tiles
		app.get("/api/minimap/chart/:instanceId/:surface/:force/:z/:x/:y.png", async (req, res) => {
			try {
				const { instanceId, surface, force, z, x, y } = req.params;
				const tileX = parseInt(x);
				const tileY = parseInt(y);
				
				// Each 512x512 tile contains 16x16 chunks of 32x32 pixels
				const chunksPerTile = 16;
				const tileSize = 512;
				
				// Calculate the range of chunk coordinates that make up this 512x512 tile
				const startChunkX = tileX * chunksPerTile;
				const startChunkY = tileY * chunksPerTile;
				const endChunkX = startChunkX + chunksPerTile;
				const endChunkY = startChunkY + chunksPerTile;
				
				// Create a 512x512 canvas
				const canvas = sharp({
					create: {
						width: tileSize,
						height: tileSize,
						channels: 4,
						background: { r: 0, g: 0, b: 0, alpha: 0 },
					},
				});
				
				// Load all the 32x32 chunks and composite them
				const compositeImages = [];
				let chunksFound = 0;
				
				for (let chunkY = startChunkY; chunkY < endChunkY; chunkY++) {
					for (let chunkX = startChunkX; chunkX < endChunkX; chunkX++) {
						const filename = `${instanceId}/${surface}/${force}/${chunkX}_${chunkY}.png`;
						const filePath = path.resolve(this.tilesPath, filename);
						
						if (await fs.pathExists(filePath)) {
							const relativeX = (chunkX - startChunkX) * CHUNK_SIZE;
							const relativeY = (chunkY - startChunkY) * CHUNK_SIZE;
							
							compositeImages.push({
								input: filePath,
								left: relativeX,
								top: relativeY,
							});
							chunksFound++;
						}
					}
				}
				
				if(chunksFound > 0) {
					this.logger.info(`Tile ${tileX},${tileY}: Found ${chunksFound} chunks, chunk range: ${startChunkX}-${endChunkX-1}, ${startChunkY}-${endChunkY-1}`);
				}
				
				// If we have any chunks to composite, create the merged image
				if (compositeImages.length > 0) {
					const mergedImage = await canvas.composite(compositeImages).png().toBuffer();
					res.setHeader("Content-Type", "image/png");
					res.send(mergedImage);
				} else {
					// No chunks found, return black tile
					res.setHeader("Content-Type", "image/png");
					res.send(await createBlackTile());
				}
			} catch (err) {
				this.logger.error(`Error serving chart tile: ${err}`);
				
				// Return black tile on error
				res.setHeader("Content-Type", "image/png");
				res.send(await createBlackTile());
			}
		});

		// List available surfaces and forces
		app.get("/api/minimap/surfaces", async (req, res) => {
			try {
				const instances = new Set<string>();
				const surfaces = new Set<string>();
				const forces = new Set<string>();
				
				// Traverse the hierarchical directory structure: instanceId/surface/force/
				const instanceDirs = await fs.readdir(this.tilesPath, { withFileTypes: true });
				
				for (const instanceDir of instanceDirs) {
					if (instanceDir.isDirectory()) {
						instances.add(instanceDir.name);
						
						const instancePath = path.join(this.tilesPath, instanceDir.name);
						const surfaceDirs = await fs.readdir(instancePath, { withFileTypes: true });
						
						for (const surfaceDir of surfaceDirs) {
							if (surfaceDir.isDirectory()) {
								surfaces.add(surfaceDir.name);
								
								const surfacePath = path.join(instancePath, surfaceDir.name);
								const forceDirs = await fs.readdir(surfacePath, { withFileTypes: true });
								
								for (const forceDir of forceDirs) {
									if (forceDir.isDirectory()) {
										forces.add(forceDir.name);
									}
								}
							}
						}
					}
				}
				
				res.json({
					instances: Array.from(instances),
					surfaces: Array.from(surfaces),
					forces: Array.from(forces),
				});
			} catch (err) {
				this.logger.error(`Error listing surfaces: ${err}`);
				res.status(500).json({ error: "Failed to list surfaces" });
			}
		});
	}

	async handleTileDataEvent(event: TileDataEvent) {
		try {
			const { type, data, position, instanceId } = event;

			if (type === "chart") {
				await this.processChartData(data as ChartData[], position, instanceId);
			}
		} catch (err) {
			this.logger.error(`Error processing tile data: ${err}`);
		}
	}

	private async processChartData(chartData: ChartData[], position: [number, number], instanceId: number) {
		if (!position || !instanceId) {
			this.logger.error("Chart data requires position and instanceId");
			return;
		}

		const [worldX, worldY] = position;
		
		// Convert world coordinates to chunk coordinates
		const chunkX = Math.floor(worldX / 32);
		const chunkY = Math.floor(worldY / 32);

		// Process each surface/force combination
		for (const chart of chartData) {
			const { surface, force, chart_data } = chart;
			
			// Create filename using chunk coordinates
			const filename = `${instanceId}/${surface}/${force}/${chunkX}_${chunkY}.png`;
			
			// Process the 32x32 chunk directly
			await this.saveChunkImage(filename, chart_data);
		}
	}

	private async saveChunkImage(filename: string, chartData: string) {
		const imagePath = path.resolve(this.tilesPath, filename);
		
		// Ensure the directory structure exists
		await fs.ensureDir(path.dirname(imagePath));
		
		// Create raw image buffer for 32x32 RGBA
		const raw = Buffer.alloc(CHUNK_SIZE * CHUNK_SIZE * 4);
		
		try {
			// Decode base64 to get the deflate-compressed data
			const compressedBuffer = Buffer.from(chartData, 'base64');
			
			// Decompress the deflate data to get the original binary chart data
			const binaryBuffer = await inflateAsync(compressedBuffer);
			const dataLength = Math.min(binaryBuffer.length, CHUNK_SIZE * CHUNK_SIZE * 2);
			
			for (let i = 0; i < dataLength; i += 2) {
				// Read bytes properly from binary buffer
				const byte1 = binaryBuffer[i];
				const byte2 = binaryBuffer[i + 1];
				
				if (byte1 === undefined || byte2 === undefined) {
					continue;
				}

				// Choose endianness based on flag
				const rgb565Value = this.useBigEndian ? 
					(byte1 << 8) + byte2 :  // Big-endian: byte1 is high byte
					byte1 + (byte2 << 8);   // Little-endian: byte1 is low byte
				
				const [r, g, b] = this.rgb565ToRgb888(rgb565Value);

				// Calculate pixel position within the chunk
				const pixelIndex = i / 2;
				const x = pixelIndex % CHUNK_SIZE;
				const y = Math.floor(pixelIndex / CHUNK_SIZE);

				// Set pixel in raw buffer (RGBA order - Sharp expects this)
				const bufferIndex = pixelIndex * 4;
				if (bufferIndex >= 0 && bufferIndex < raw.length - 3) {
					raw[bufferIndex] = r;         // R
					raw[bufferIndex + 1] = g;     // G
					raw[bufferIndex + 2] = b;     // B
					raw[bufferIndex + 3] = 255;   // A (full alpha)
				}
			}

			// Save the chunk image directly
			await sharp(raw, {
				raw: {
					width: CHUNK_SIZE,
					height: CHUNK_SIZE,
					channels: 4,
				},
			}).png().toFile(imagePath);
			
			// Get the final PNG file size for comparison
			const stats = await fs.stat(imagePath);
			const pngSize = stats.size;
			
			this.logger.info(`Chunk ${filename}: raw ${raw.length}, decompressed ${binaryBuffer.length}, compressed ${compressedBuffer.length}, PNG ${pngSize} bytes`);
		} catch (err) {
			this.logger.error(`Error processing chunk image ${filename}: ${err}`);
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
