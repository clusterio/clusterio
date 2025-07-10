import * as lib from "@clusterio/lib";
import { BaseControllerPlugin } from "@clusterio/controller";
import {
	TileDataEvent,
	RefreshTileDataRequest,
	GetTileDataRequest,
	GetInstanceBoundsRequest,
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
		this.controller.handle(RefreshTileDataRequest, this.handleRefreshTileDataRequest.bind(this));
		this.controller.handle(GetInstanceBoundsRequest, this.handleGetInstanceBoundsRequest.bind(this));

		// Set up HTTP routes for serving tiles
		this.setupTileRoutes();
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

		// Serve terrain tiles
		app.get("/api/minimap/tiles/:z/:x/:y.png", async (req, res) => {
			try {
				const { z, x, y } = req.params;
				const filename = `tiles_z${z}x${x}y${y}.png`;
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
				this.logger.error(`Error serving tile: ${err}`);
				const blackImage = await createBlackImage();
				res.setHeader("Content-Type", "image/png");
				res.send(blackImage);
			}
		});

		// Serve entity tiles
		app.get("/api/minimap/entities/:z/:x/:y.png", async (req, res) => {
			try {
				const { z, x, y } = req.params;
				const filename = `entities_z${z}x${x}y${y}.png`;
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
				this.logger.error(`Error serving entity tile: ${err}`);
				const blackImage = await createBlackImage();
				res.setHeader("Content-Type", "image/png");
				res.send(blackImage);
			}
		});
	}

	async handleTileDataEvent(event: TileDataEvent) {
		try {
			const { type, data, position, size, instanceId, layer } = event;

			if (type === "pixels") {
				await this.processPixelData(data, instanceId, layer);
			} else if (type === "tiles" && position && size) {
				await this.processTileData(data, position, size, instanceId, layer);
			}
		} catch (err) {
			this.logger.error(`Error processing tile data: ${err}`);
		}
	}

	private async processPixelData(data: string[], instanceId: number, layer: string) {
		if (data.length % 3 !== 0) {
			this.logger.error(`Invalid pixel data length: ${data.length}`);
			return;
		}

		const updates = new Map<string, Set<PixelUpdate>>();

		for (let i = 0; i < data.length; i += 3) {
			const x = Math.floor(Number(data[i]));
			const y = Math.floor(Number(data[i + 1]));
			const colorHex = data[i + 2];

			if (colorHex.length !== 8) {
				continue; // Skip invalid color data
			}

			const rgba: [number, number, number, number] = [
				parseInt(colorHex.slice(0, 2), 16),
				parseInt(colorHex.slice(2, 4), 16),
				parseInt(colorHex.slice(4, 6), 16),
				parseInt(colorHex.slice(6, 8), 16),
			];

			// Calculate which tile this pixel belongs to
			const tileX = Math.floor(x / TILE_SIZE) + (x < 0 ? -1 : 0);
			const tileY = Math.floor(y / TILE_SIZE) + (y < 0 ? -1 : 0);
			const filename = `${layer}z10x${tileX}y${tileY}.png`;

			if (!updates.has(filename)) {
				updates.set(filename, new Set());
			}

			updates.get(filename)!.add({
				x: ((x % TILE_SIZE) + TILE_SIZE) % TILE_SIZE,
				y: ((y % TILE_SIZE) + TILE_SIZE) % TILE_SIZE,
				rgba,
			});
		}

		// Apply updates to tiles
		for (const [filename, pixels] of updates) {
			await this.updateTileImage(filename, pixels);
		}
	}

	private async processTileData(data: string[], position: [number, number], size: number, instanceId: number, layer: string) {
		const [originX, originY] = position;
		const updates = new Map<string, Set<PixelUpdate>>();

		for (let i = 0; i < data.length; i++) {
			const x = i % size;
			const y = Math.floor(i / size);
			const colorHex = data[i];

			if (colorHex.length !== 6) {
				continue; // Skip invalid color data
			}

			const rgba: [number, number, number, number] = [
				parseInt(colorHex.slice(0, 2), 16),
				parseInt(colorHex.slice(2, 4), 16),
				parseInt(colorHex.slice(4, 6), 16),
				255, // Full alpha for tile data
			];

			const worldX = originX + x;
			const worldY = originY + y;

			// Calculate which tile this pixel belongs to
			const tileX = Math.floor(worldX / TILE_SIZE) + (worldX < 0 ? -1 : 0);
			const tileY = Math.floor(worldY / TILE_SIZE) + (worldY < 0 ? -1 : 0);
			const filename = `${layer}z10x${tileX}y${tileY}.png`;

			if (!updates.has(filename)) {
				updates.set(filename, new Set());
			}

			updates.get(filename)!.add({
				x: ((worldX % TILE_SIZE) + TILE_SIZE) % TILE_SIZE,
				y: ((worldY % TILE_SIZE) + TILE_SIZE) % TILE_SIZE,
				rgba,
			});
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

	async handleRefreshTileDataRequest(request: RefreshTileDataRequest): Promise<{ success: boolean; message?: string }> {
		try {
			const { instanceId, area } = request;
			const instance = this.controller.instances.get(instanceId);
			
			if (!instance) {
				return { success: false, message: "Instance not found" };
			}

			if (instance.status !== "running") {
				return { success: false, message: "Instance is not running" };
			}

			// Send request to instance to get tile data
			const defaultArea = { x1: -512, y1: -512, x2: 512, y2: 512 };
			const tileArea = area || defaultArea;

			await this.controller.sendTo(
				{ instanceId },
				new GetTileDataRequest(tileArea)
			);

			return { success: true, message: "Tile refresh initiated" };
		} catch (err) {
			this.logger.error(`Error refreshing tile data: ${err}`);
			return { success: false, message: `Error: ${err}` };
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
