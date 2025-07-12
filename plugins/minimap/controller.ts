import * as lib from "@clusterio/lib";
import { BaseControllerPlugin } from "@clusterio/controller";
import {
	TileDataEvent,
	GetInstanceBoundsRequest,
	ChartData,
} from "./messages";
import * as fs from "fs-extra";
import * as path from "path";
import sharp from "sharp";

const TILE_SIZE = 512;

interface PixelUpdate {
	x: number;
	y: number;
	rgba: [number, number, number, number];
}

export class ControllerPlugin extends BaseControllerPlugin {
	private tilesPath: string = "";
	private fileLocks = new Map<string, Promise<void>[]>();
	private pendingUpdates = new Map<string, Set<PixelUpdate>>();

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
	}

	// Convert RGB565 to RGB888 values
	private rgb565ToRgb888(rgb565Value: number): [number, number, number] {
		const r = Math.floor(((rgb565Value >> 11) & 0x1F) * 255 / 31);
		const g = Math.floor(((rgb565Value >> 5) & 0x3F) * 255 / 63);
		const b = Math.floor((rgb565Value & 0x1F) * 255 / 31);
		return [r, g, b];
	}

	private setupTileRoutes() {
		const app = this.controller.app;

		// Create black placeholder image
		const createBlackImage = async () => {
			return await sharp({
				create: {
					width: 256,
					height: 256,
					channels: 4,
					background: { r: 0, g: 0, b: 0, alpha: 0 },
				},
			}).png().toBuffer();
		};

		// Serve chart tiles with surface and force support
		app.get("/api/minimap/chart/:surface/:force/:z/:x/:y.png", async (req, res) => {
			try {
				const { surface, force, z, x, y } = req.params;
				const filename = `${surface}_${force}_z${z}x${x}y${y}.png`;
				const filePath = path.resolve(this.tilesPath, filename);
				
				if (await fs.pathExists(filePath)) {
					const file = await fs.readFile(filePath);
					res.setHeader("Content-Type", "image/png");
					res.send(file);
				} else {
					const blackImage = await createBlackImage();
					res.setHeader("Content-Type", "image/png");
					res.send(blackImage);
				}
			} catch (err) {
				this.logger.error(`Error serving chart tile: ${err}`);
				const blackImage = await createBlackImage();
				res.setHeader("Content-Type", "image/png");
				res.send(blackImage);
			}
		});

		// List available surfaces and forces
		app.get("/api/minimap/surfaces", async (req, res) => {
			try {
				const files = await fs.readdir(this.tilesPath);
				const surfaces = new Set<string>();
				const forces = new Set<string>();
				
				// Parse filenames to extract surface and force information
				for (const file of files) {
					const match = file.match(/^([^_]+)_([^_]+)_.*\.png$/);
					if (match) {
						surfaces.add(match[1]);
						forces.add(match[2]);
					}
				}
				
				res.json({
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

		const size = 32;
		const [originX, originY] = position;
		const updates = new Map<string, Set<PixelUpdate>>();

		// Process each surface/force combination
		for (const chart of chartData) {
			const { surface, force, chart_data } = chart;
			
			// Process each pixel in the 32x32 chunk
			for (let i = 0; i < chart_data.length; i += 2) {
				const byte1 = chart_data.charCodeAt(i);
				const byte2 = chart_data.charCodeAt(i + 1);
				
				if (isNaN(byte1) || isNaN(byte2)) {
					continue;
				}

				const rgb565Value = byte1 + (byte2 << 8);
				const [r, g, b] = this.rgb565ToRgb888(rgb565Value);

				// Calculate pixel position within the chunk
				const pixelIndex = i / 2;
				const x = pixelIndex % size;
				const y = Math.floor(pixelIndex / size);

				const worldX = originX + x;
				const worldY = originY + y;

				// Calculate which tile this pixel belongs to
				const tileX = Math.floor(worldX / TILE_SIZE) + (worldX < 0 ? -1 : 0);
				const tileY = Math.floor(worldY / TILE_SIZE) + (worldY < 0 ? -1 : 0);
				
				// Use surface and force in the filename for differentiation
				const filename = `${surface}_${force}_z10x${tileX}y${tileY}.png`;

				if (!updates.has(filename)) {
					updates.set(filename, new Set());
				}

				updates.get(filename)!.add({
					x: ((worldX % TILE_SIZE) + TILE_SIZE) % TILE_SIZE,
					y: ((worldY % TILE_SIZE) + TILE_SIZE) % TILE_SIZE,
					rgba: [r, g, b, 255], // Full alpha for chart data
				});
			}
		}

		// Apply updates to tiles
		for (const [filename, pixels] of updates) {
			await this.updateTileImage(filename, pixels);
		}
	}

	private async updateTileImage(filename: string, pixels: Set<PixelUpdate>) {
		const imagePath = path.resolve(this.tilesPath, filename);

		// Handle file locking to prevent concurrent writes
		if (!this.fileLocks.has(imagePath)) {
			this.fileLocks.set(imagePath, []);
		}

		const locks = this.fileLocks.get(imagePath)!;
		if (locks.length > 0) {
			await Promise.all(locks);
		}

		const updatePromise = this.performTileUpdate(imagePath, pixels);
		locks.push(updatePromise);

		try {
			await updatePromise;
		} finally {
			const index = locks.indexOf(updatePromise);
			if (index > -1) {
				locks.splice(index, 1);
			}
			if (locks.length === 0) {
				this.fileLocks.delete(imagePath);
			}
		}
	}

	private async performTileUpdate(imagePath: string, pixels: Set<PixelUpdate>) {
		let raw: Buffer;

		try {
			// Load existing image or create new one
			raw = await sharp(imagePath).raw().toBuffer();
		} catch (err) {
			// Create new blank tile
			raw = await sharp({
				create: {
					width: TILE_SIZE,
					height: TILE_SIZE,
					channels: 4,
					background: { r: 20, g: 20, b: 20, alpha: 0 },
				},
			}).raw().toBuffer();
		}

		// Apply pixel updates
		for (const pixel of pixels) {
			const index = (pixel.y * TILE_SIZE + pixel.x) * 4;
			if (index >= 0 && index < raw.length - 3) {
				raw[index] = pixel.rgba[0];     // R
				raw[index + 1] = pixel.rgba[1]; // G
				raw[index + 2] = pixel.rgba[2]; // B
				raw[index + 3] = pixel.rgba[3]; // A
			}
		}

		// Save updated image
		await sharp(raw, {
			raw: {
				width: TILE_SIZE,
				height: TILE_SIZE,
				channels: 4,
			},
		}).png().toFile(imagePath);
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
