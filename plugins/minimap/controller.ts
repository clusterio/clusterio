import * as lib from "@clusterio/lib";
import { BaseControllerPlugin, type InstanceInfo } from "@clusterio/controller";
import {
	TileDataEvent,
	GetRawTileRequest,
	GetChartTagsRequest,
	type ChartData,
	ChartTagDataEvent,
	type ChartTagData,
	RecipeDataEvent,
	GetRawRecipeTileRequest,
	PlayerPositionEvent,
	PlayerSessionEndEvent,
	type PlayerData,
	GetPlayerPathRequest,
	ClearMinimapSurfaceDataRequest,
	ClearMinimapDataRequest,
} from "./messages";
import * as fs from "fs-extra";
import * as path from "path";
import * as zlib from "zlib";
import { promisify } from "util";
import sharp from "sharp";
import {
	renderChunkToPixels,
	extractChunkFromTile,
	renderTileToPixels,
	pixelsToRGBA,
	parseRecipeTileBinary,
	type ParsedRecipeTile,
} from "./utils/tile-utils";
import { parsePlayerPositionsBinary } from "./utils/player-utils";

function resolveFileInDir(baseDir: string, fileName: string): string | null {
	if (fileName.includes("\0") || /[\\/]/.test(fileName)) {
		return null;
	}

	const resolvedBaseDir = path.resolve(baseDir);
	const resolvedPath = path.resolve(resolvedBaseDir, fileName);
	const relative = path.relative(resolvedBaseDir, resolvedPath);
	if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) {
		return resolvedPath;
	}

	return null;
}

function isENOENT(err: any): boolean {
	return err && err.code === "ENOENT";
}

interface TileMetadata {
	instanceId: number;
	surface: string;
	force: string;
}

interface ChartTagMetadata {
	instanceId: number;
	surface: string;
	force: string;
}

interface PixelChange {
	x: number;
	y: number;
	newColor: number;
	oldColor: number;
}

interface EnrichedPlayerData extends PlayerData {
	_playerId: number;
	_tMs: number;
}

interface QueuedPlayerSessionStart {
	playerId: number;
	playerName: string;
	tMs: number;
}

interface QueuedPlayerSessionEnd {
	playerId: number;
	tMs: number;
}

export class ControllerPlugin extends BaseControllerPlugin {
	private tilesPath: string = "";
	private chartTagsPath: string = "";
	private recipeTilesPath: string = "";
	private playerPositionsPath: string = "";
	private chunkSavingQueue = new Map<string, Map<string, { data: ChartData, tick: number }>>();
	private chartTagQueues = new Map<string, ChartTagData[]>();
	private recipeSavingQueue = new Map<string, Buffer[]>();
	private playerPositionQueues = new Map<string, EnrichedPlayerData[]>();
	private playerSessionStartQueues = new Map<string, QueuedPlayerSessionStart[]>();
	private playerSessionEndQueues = new Map<string, QueuedPlayerSessionEnd[]>();
	// Player session tracking per surface file
	// fileKey -> playerName -> playerId
	private playerSessions = new Map<string, Map<string, number>>();
	// fileKey -> nextId
	private nextPlayerIds = new Map<string, number>();
	// fileKey -> Set of active player names
	private activePlayerSessions = new Map<string, Set<string>>();
	// Keep per-tile dictionary of recipe -> uint16 index as well as next free index
	private recipeDictionaries = new Map<string, Map<string, number>>();
	private nextRecipeIndex = new Map<string, number>();
	private lastSeenTagContent = new Map<string, Map<number, {
		position: [number, number];
		text: string;
		icon?: any;
		last_user?: string;
	}>>();

	// tileKey -> posKey -> recipe
	private lastSeenRecipeContent = new Map<string, Map<string, string | undefined>>();
	private savingTiles: boolean = false;
	private savingChartTags = new Set<string>();
	private saveInterval: NodeJS.Timeout | null = null;
	private saveRecipeTilesInProgress: boolean = false;
	private savePlayerPositionsInProgress: boolean = false;

	async init() {
		this.tilesPath = path.resolve(
			this.controller.config.get("controller.database_directory"),
			"minimap_tiles"
		);
		this.chartTagsPath = path.resolve(
			this.controller.config.get("controller.database_directory"),
			"minimap_chart_tags"
		);
		this.recipeTilesPath = path.resolve(
			this.controller.config.get("controller.database_directory"),
			"minimap_recipe_tiles"
		);
		this.playerPositionsPath = path.resolve(
			this.controller.config.get("controller.database_directory"),
			"minimap_player_positions"
		);
		await fs.ensureDir(this.tilesPath);
		await fs.ensureDir(this.chartTagsPath);
		await fs.ensureDir(this.recipeTilesPath);
		await fs.ensureDir(this.playerPositionsPath);

		// Handle incoming events from instances
		this.controller.handle(TileDataEvent, this.handleTileDataEvent.bind(this));
		this.controller.handle(ChartTagDataEvent, this.handleChartTagDataEvent.bind(this));
		this.controller.handle(GetRawTileRequest, this.handleGetRawTileRequest.bind(this));
		this.controller.handle(GetChartTagsRequest, this.handleGetChartTagsRequest.bind(this));
		this.controller.handle(RecipeDataEvent, this.handleRecipeDataEvent.bind(this));
		this.controller.handle(GetRawRecipeTileRequest, this.handleGetRawRecipeTileRequest.bind(this));
		this.controller.handle(PlayerPositionEvent, this.handlePlayerPositionEvent.bind(this));
		this.controller.handle(PlayerSessionEndEvent, this.handlePlayerSessionEndEvent.bind(this));
		this.controller.handle(GetPlayerPathRequest, this.handleGetPlayerPathRequest.bind(this));
		this.controller.handle(
			ClearMinimapSurfaceDataRequest,
			this.handleClearMinimapSurfaceDataRequest.bind(this)
		);
		this.controller.handle(
			ClearMinimapDataRequest,
			this.handleClearAllMinimapDataRequest.bind(this)
		);

		// Register events as subscribable for web clients
		this.controller.subscriptions.handle(TileDataEvent);
		this.controller.subscriptions.handle(ChartTagDataEvent);
		this.controller.subscriptions.handle(RecipeDataEvent);
		this.controller.subscriptions.handle(PlayerPositionEvent);

		// Set up HTTP routes for serving tiles
		this.setupTileRoutes();

		// Load existing tag numbers for deduplication
		await this.loadExistingTagContent();
		// Load existing recipe data for deduplication
		await this.loadExistingRecipeContent();
		// Load existing player sessions from disk to maintain ID consistency
		await this.loadExistingPlayerSessions();

		this.saveInterval = setInterval(() => {
			this.saveTiles().catch(err => this.logger.error(`Error saving tiles: ${err}`));
			this.saveChartTags().catch(err => this.logger.error(`Error saving chart tags: ${err}`));
			this.saveRecipeTiles().catch(err => this.logger.error(`Error saving recipe tiles: ${err}`));
			this.savePlayerPositions().catch(err => this.logger.error(`Error saving player positions: ${err}`));
		}, 5000);
	}

	private parseTileKey(name: string): TileMetadata | null {
		const trimmed = name.replace(/(\.bin|\.recipes)$/, "");
		const parts = trimmed.split("_");
		if (parts.length < 5) {
			return null;
		}

		parts.pop(); // tileY
		parts.pop(); // tileX
		const force = parts.pop()!;
		const instancePart = parts.shift();
		if (!instancePart) {
			return null;
		}

		const surface = parts.join("_");
		const instanceId = Number.parseInt(instancePart, 10);
		if (!Number.isFinite(instanceId)) {
			return null;
		}

		return { instanceId, surface, force };
	}

	private parseChartTagMetadata(name: string): ChartTagMetadata | null {
		const suffix = "_chart_tags.json";
		if (!name.endsWith(suffix)) {
			return null;
		}

		const trimmed = name.slice(0, -suffix.length);
		const parts = trimmed.split("_");
		if (parts.length < 3) {
			return null;
		}

		const force = parts.pop()!;
		const instancePart = parts.shift();
		if (!instancePart) {
			return null;
		}

		const surface = parts.join("_");
		const instanceId = Number.parseInt(instancePart, 10);
		if (!Number.isFinite(instanceId)) {
			return null;
		}

		return { instanceId, surface, force };
	}

	private matchesSurfaceForce(
		meta: TileMetadata | null,
		instanceId: number,
		surface: string,
		force?: string
	): meta is TileMetadata {
		if (!meta) {
			return false;
		}

		if (meta.instanceId !== instanceId || meta.surface !== surface) {
			return false;
		}
		if (force && meta.force !== force) {
			return false;
		}

		return true;
	}

	private matchesChartTag(
		meta: ChartTagMetadata | null,
		instanceId: number,
		surface: string,
		force?: string
	): meta is ChartTagMetadata {
		if (!meta) {
			return false;
		}
		if (meta.instanceId !== instanceId || meta.surface !== surface) {
			return false;
		}
		if (force && meta.force !== force) {
			return false;
		}
		return true;
	}

	private async deleteFilesMatching(dir: string, predicate: (file: string) => boolean) {
		const files = await fs.readdir(dir);
		for (const file of files) {
			if (predicate(file)) {
				await fs.remove(path.join(dir, file));
			}
		}
	}

	private removeSurfaceQueueEntries(instanceId: number, surface: string, force?: string) {
		for (const tileName of Array.from(this.chunkSavingQueue.keys())) {
			if (this.matchesSurfaceForce(this.parseTileKey(tileName), instanceId, surface, force)) {
				this.chunkSavingQueue.delete(tileName);
			}
		}
		for (const tileName of Array.from(this.recipeSavingQueue.keys())) {
			if (this.matchesSurfaceForce(this.parseTileKey(tileName), instanceId, surface, force)) {
				this.recipeSavingQueue.delete(tileName);
			}
		}
		for (const key of Array.from(this.chartTagQueues.keys())) {
			if (this.matchesChartTag(this.parseChartTagMetadata(key), instanceId, surface, force)) {
				this.chartTagQueues.delete(key);
			}
		}
		for (const key of Array.from(this.playerPositionQueues.keys())) {
			if (key === `${instanceId}_${surface}`) {
				this.playerPositionQueues.delete(key);
			}
		}
		for (const key of Array.from(this.playerSessionStartQueues.keys())) {
			if (key === `${instanceId}_${surface}`) {
				this.playerSessionStartQueues.delete(key);
			}
		}
		for (const key of Array.from(this.playerSessionEndQueues.keys())) {
			if (key === `${instanceId}_${surface}`) {
				this.playerSessionEndQueues.delete(key);
			}
		}
	}

	private removeSurfaceCaches(instanceId: number, surface: string, force?: string) {
		for (const key of Array.from(this.lastSeenTagContent.keys())) {
			if (this.matchesChartTag(this.parseChartTagMetadata(key), instanceId, surface, force)) {
				this.lastSeenTagContent.delete(key);
			}
		}
		for (const key of Array.from(this.lastSeenRecipeContent.keys())) {
			if (this.matchesSurfaceForce(this.parseTileKey(key), instanceId, surface, force)) {
				this.lastSeenRecipeContent.delete(key);
				this.recipeDictionaries.delete(key);
				this.nextRecipeIndex.delete(key);
			}
		}

		const playerKey = `${instanceId}_${surface}`;
		this.playerSessions.delete(playerKey);
		this.nextPlayerIds.delete(playerKey);
		this.activePlayerSessions.delete(playerKey);
	}

	private async clearSurfaceData(instanceId: number, surface: string, force?: string) {
		const matchesTile = (file: string) => this.matchesSurfaceForce(
			this.parseTileKey(file),
			instanceId,
			surface,
			force
		);

		await this.deleteFilesMatching(this.tilesPath, matchesTile);
		await this.deleteFilesMatching(this.recipeTilesPath, matchesTile);

		await this.deleteFilesMatching(this.chartTagsPath, (file) => (
			this.matchesChartTag(this.parseChartTagMetadata(file), instanceId, surface, force)
		));

		if (!force) {
			const positionsFile = `${instanceId}_${surface}.positions`;
			const positionsPath = resolveFileInDir(this.playerPositionsPath, positionsFile);
			if (positionsPath) {
				await fs.remove(positionsPath);
			} else {
				this.logger.warn(`Refusing to clear player positions with invalid path: ${positionsFile}`);
			}
		}

		this.removeSurfaceQueueEntries(instanceId, surface, force);
		this.removeSurfaceCaches(instanceId, surface, force);

		this.logger.info(`Cleared minimap data: ${instanceId}, surface ${surface}${force ? `, force ${force}` : ""}`);
	}

	private async clearAllMinimapData() {
		await Promise.all([
			fs.emptyDir(this.tilesPath),
			fs.emptyDir(this.chartTagsPath),
			fs.emptyDir(this.recipeTilesPath),
			fs.emptyDir(this.playerPositionsPath),
		]);

		this.chunkSavingQueue.clear();
		this.chartTagQueues.clear();
		this.recipeSavingQueue.clear();
		this.playerPositionQueues.clear();
		this.playerSessionStartQueues.clear();
		this.playerSessionEndQueues.clear();

		this.lastSeenTagContent.clear();
		this.lastSeenRecipeContent.clear();
		this.recipeDictionaries.clear();
		this.nextRecipeIndex.clear();

		this.playerSessions.clear();
		this.nextPlayerIds.clear();
		this.activePlayerSessions.clear();

		this.logger.info("Cleared all minimap data");
	}

	async onInstanceStatusChanged(instance: InstanceInfo) {
		if (instance.status === "running") {
			return;
		}

		const now = Date.now();
		let queued = false;

		for (const [fileKey, activeSessions] of this.activePlayerSessions) {
			if (!fileKey.startsWith(`${instance.id}_`)) {
				continue;
			}

			if (activeSessions.size === 0) {
				continue;
			}

			const sessions = this.playerSessions.get(fileKey);
			if (!sessions) {
				activeSessions.clear();
				continue;
			}

			for (const playerName of activeSessions) {
				const playerId = sessions.get(playerName);
				if (playerId === undefined) {
					continue;
				}
				this.queuePlayerSessionEnd(fileKey, playerId, now);
				queued = true;
			}

			activeSessions.clear();
		}

		if (queued) {
			this.savePlayerPositions().catch(err => this.logger.error(`Error saving player positions: ${err}`));
		}
	}

	async onShutdown() {
		if (this.saveInterval) {
			clearInterval(this.saveInterval);
			this.saveInterval = null;
		}

		// Perform final save before shutdown
		await this.saveTiles();
		await this.saveChartTags();
		await this.saveRecipeTiles();
		await this.savePlayerPositions();
	}

	// Compare two pixel arrays and return changes
	private comparePixels(
		oldPixels: Uint16Array,
		newPixels: Uint16Array,
		chunkX: number,
		chunkY: number
	): PixelChange[] {
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

		// Group changes by identical new/old color pair for better compression
		const groups = new Map<string, PixelChange[]>();
		for (const ch of changes) {
			const key = `${ch.newColor}_${ch.oldColor}`;
			if (!groups.has(key)) { groups.set(key, []); }
			groups.get(key)!.push(ch);
		}

		// Build buffers for each group and concatenate
		const groupBuffers: Buffer[] = [];
		for (const [key, group] of groups) {
			const sample = group[0];
			const count = group.length;

			// New format: Type(1) + Tick(4) + Count(2) + NewColor(2) + OldColor(2) + (x,y)*count
			const headerSize = 1 + 4 + 2 + 2 + 2;
			const pixelDataSize = count * 2; // 1 byte x + 1 byte y per pixel
			const buf = Buffer.alloc(headerSize + pixelDataSize);
			let offset = 0;
			buf.writeUInt8(2, offset); offset += 1;
			buf.writeUInt32BE(Math.floor(tick / 60), offset); offset += 4;
			buf.writeUInt16BE(count, offset); offset += 2;
			buf.writeUInt16BE(sample.newColor, offset); offset += 2;
			buf.writeUInt16BE(sample.oldColor, offset); offset += 2;

			for (const c of group) {
				buf.writeUInt8(c.x, offset); offset += 1;
				buf.writeUInt8(c.y, offset); offset += 1;
			}

			groupBuffers.push(buf);
		}

		return Buffer.concat(groupBuffers);
	}

	private setupTileRoutes() {
		const app = this.controller.app;

		app.get("/api/minimap/tile/:instanceId/:surface/:force/:z/:x/:y.png", async (req, res) => {
			try {
				const { instanceId, surface, force, x, y } = req.params;
				const tileX = Number.parseInt(x, 10);
				const tileY = Number.parseInt(y, 10);
				if (!Number.isFinite(tileX) || !Number.isFinite(tileY)) {
					res.status(400).send("Invalid tile coordinates");
					return;
				}

				const tileName = `${instanceId}_${surface}_${force}_${tileX}_${tileY}.bin`;
				const tilePath = resolveFileInDir(this.tilesPath, tileName);
				if (!tilePath) {
					res.status(400).send("Invalid tile path");
					return;
				}

				let tileData: Buffer;
				try {
					tileData = await fs.readFile(tilePath);
				} catch (err) {
					if (isENOENT(err)) {
						res.status(404).send("Tile not found");
						return;
					}
					throw err;
				}
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
					if (!file.endsWith(".bin")) {
						continue;
					}

					const meta = this.parseTileKey(file);
					if (!meta) {
						continue;
					}

					surfaces.add(meta.surface);
					forces.add(meta.force);
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
		const currentPixels = await renderTileToPixels(tileData);

		// Convert RGB565 pixel data to RGBA buffer for Sharp
		const rgbaData = pixelsToRGBA(currentPixels);
		const raw = Buffer.from(rgbaData);

		// Create and return the image directly
		return sharp(raw, {
			raw: { width: 256, height: 256, channels: 4 },
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
					const tilePath = resolveFileInDir(this.tilesPath, tileName);
					if (!tilePath) {
						this.logger.error(`Refusing to save tile with invalid path: ${tileName}`);
						return;
					}

					let existingTile = Buffer.alloc(0);
					try {
						existingTile = await fs.readFile(tilePath);
					} catch (err) {
						if (!isENOENT(err)) {
							throw err;
						}
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

	async updateTile(
		existingTile: Buffer,
		newChunks: Map<string, { data: ChartData, tick: number }>
	): Promise<Buffer | undefined> {
		const existingChunks = new Map<string, { tick: number, data: Buffer }>();

		// Parse existing tile data to find existing chunks
		let offset = 0;
		while (offset < existingTile.length) {
			if (offset + 1 > existingTile.length) {
				this.logger.error(`Invalid tile data: cannot read type at offset ${offset}`);
				break;
			}

			// type (1 byte): 1 = Chunk, 2 = Pixels
			const type = existingTile.readUInt8(offset);
			offset += 1;

			if (type === 1) { // Chunk
				const parseResult = this.parseChunkData(existingTile, offset, existingChunks);
				if (!parseResult.success) {
					break;
				}
				offset = parseResult.newOffset;
			} else if (type === 2) { // Pixels
				const parseResult = this.parsePixelData(existingTile, offset);
				if (!parseResult.success) {
					break;
				}
				offset = parseResult.newOffset;
			} else {
				this.logger.error(`Unknown tile data type: ${type} at offset ${offset}`);
				break;
			}
		}

		// Render the current state of the entire tile if we have existing data
		let currentTilePixels: Uint16Array | null = null;
		if (existingTile.length > 0) {
			currentTilePixels = await renderTileToPixels(existingTile);
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
				const newPixels = await renderChunkToPixels(newChunkData);

				let oldPixels: Uint16Array;
				if (currentTilePixels) {
					// Extract current chunk area from the rendered tile
					oldPixels = extractChunkFromTile(currentTilePixels, chunkX, chunkY);
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
			return undefined;
		}

		// Append new data to existing tile (never modify existing data)
		return Buffer.concat([existingTile, ...appendBuffers]);
	}

	private parseChunkData(
		existingTile: Buffer,
		offset: number,
		existingChunks: Map<string, { tick: number, data: Buffer }>
	): { success: boolean, newOffset: number } {
		if (offset + 7 > existingTile.length) {
			this.logger.error(`Invalid tile data: insufficient chunk header data at offset ${offset}`);
			return { success: false, newOffset: offset };
		}

		// tick_sec (4 bytes): game second (uint32)
		const tick = existingTile.readUInt32BE(offset);
		offset += 4;
		// chunk_coords (1 byte): packed nibble coords (x<<4 | y)
		const chunkCoordsByte = existingTile.readUInt8(offset);
		offset += 1;
		// length (2 bytes): number of chunk bytes that follow (uint16)
		const length = existingTile.readUInt16BE(offset);
		offset += 2;

		if (offset + length > existingTile.length) {
			this.logger.error(`Invalid tile data: insufficient chunk data at offset ${offset}`);
			return { success: false, newOffset: offset };
		}

		const chunkX = chunkCoordsByte >> 4;
		const chunkY = chunkCoordsByte & 0x0F;
		const chunkName = `${chunkX}_${chunkY}`;
		// data (length bytes): compressed chunk bytes
		const data = existingTile.slice(offset, offset + length);
		offset += length;
		existingChunks.set(chunkName, { tick, data });

		return { success: true, newOffset: offset };
	}

	private parsePixelData(
		existingTile: Buffer,
		offset: number
	): { success: boolean, newOffset: number } {
		if (offset + 10 > existingTile.length) {
			this.logger.error(`Invalid tile data: insufficient pixel header data at offset ${offset}`);
			return { success: false, newOffset: offset };
		}

		// tick_sec (4 bytes): game second (uint32)
		const tick = existingTile.readUInt32BE(offset);
		offset += 4;
		// pixel_count (2 bytes): number of pixel coords that follow (uint16)
		const pixelCount = existingTile.readUInt16BE(offset);
		offset += 2;
		// new_color (2 bytes): RGB565 (uint16)
		// old_color (2 bytes): RGB565 (uint16)
		offset += 2 + 2;
		void tick; // parsed for validation/advancing offset; not needed here
		const pixelDataLength = pixelCount * 2;

		if (offset + pixelDataLength > existingTile.length) {
			this.logger.error(`Invalid tile data: insufficient pixel data at offset ${offset}`);
			return { success: false, newOffset: offset };
		}

		// pixel_data (pixelCount * 2 bytes): x (1 byte), y (1 byte) pairs
		// Skip payload since we only need offsets for chunk discovery.
		offset += pixelDataLength;

		return { success: true, newOffset: offset };
	}

	async loadExistingTagContent() {
		try {
			if (!await fs.pathExists(this.chartTagsPath)) {
				return;
			}

			const files = await fs.readdir(this.chartTagsPath);
			const tagFiles = files.filter(file => file.endsWith("_chart_tags.json"));

			for (const file of tagFiles) {
				await this.loadTagContentFromFile(file);
			}
		} catch (err) {
			this.logger.error(`Error loading existing tag content: ${err}`);
		}
	}

	private async loadTagContentFromFile(file: string) {
		const fileKey = file.replace("_chart_tags.json", "");
		const filePath = path.join(this.chartTagsPath, file);

		if (!this.lastSeenTagContent.has(fileKey)) {
			this.lastSeenTagContent.set(fileKey, new Map());
		}
		const seenTags = this.lastSeenTagContent.get(fileKey)!;

		try {
			const content = await fs.readFile(filePath, "utf-8");
			const lines = content.trim().split("\n").filter(line => line.trim());

			for (const line of lines) {
				this.processTagLine(line, seenTags);
			}

			this.logger.info(`Loaded ${seenTags.size} existing tag contents from ${file}`);
		} catch (readErr) {
			this.logger.warn(`Failed to read chart tag file ${file}: ${readErr}`);
		}
	}

	private processTagLine(line: string, seenTags: Map<number, any>) {
		try {
			const tagData = JSON.parse(line);
			const isNumberTag = typeof tagData.tag_number === "number";
			const notDeleted = !tagData.end_tick;

			if (isNumberTag && notDeleted) {
				// Only store the latest content for tags that haven't been deleted
				seenTags.set(tagData.tag_number, {
					position: tagData.position,
					text: tagData.text,
					icon: tagData.icon,
					last_user: tagData.last_user,
				});
			}
		} catch (parseErr) {
			this.logger.warn(`Failed to parse chart tag line: ${parseErr}`);
		}
	}

	/**
	 * Parses existing recipe jsonl files and builds an in-memory map that tracks
	 * the latest active (non-ended) recipe for every position. This allows incoming
	 * RecipeDataEvents to be deduplicated so we do not append identical recipe lines
	 * to disk multiple times.
	 */
	async loadExistingRecipeContent() {
		try {
			if (!await fs.pathExists(this.recipeTilesPath)) {
				return;
			}

			const files = await fs.readdir(this.recipeTilesPath);
			const recipeFiles = files.filter(file => file.endsWith(".recipes"));

			for (const file of recipeFiles) {
				const tileKey = file.replace(".recipes", "");
				const filePath = path.join(this.recipeTilesPath, file);

				// Initialise structures
				this.lastSeenRecipeContent.set(tileKey, new Map());
				this.recipeDictionaries.set(tileKey, new Map());
				this.nextRecipeIndex.set(tileKey, 0);

				try {
					const data = await fs.readFile(filePath);
					await this.parseRecipeTileForState(tileKey, data);
					this.logger.info(`Loaded recipe state for ${tileKey}`);
				} catch (readErr) {
					this.logger.warn(`Failed to read recipe file ${file}: ${readErr}`);
				}
			}
		} catch (err) {
			this.logger.error(`Error loading existing recipe content: ${err}`);
		}
	}

	// Parse binary recipe tile and populate lastSeenRecipeContent & recipeDictionaries
	private async parseRecipeTileForState(tileKey: string, buffer: Buffer) {
		// Derive tile coordinates from key (last two underscore-separated parts)
		const parts = tileKey.split("_");
		const tileY = parseInt(parts.pop()!, 10); // last
		const tileX = parseInt(parts.pop()!, 10); // second last
		const parsed: ParsedRecipeTile = parseRecipeTileBinary(tileX, tileY, buffer, null);

		// Populate dictionary mapping (name -> index)
		const dict = this.recipeDictionaries.get(tileKey)!;
		for (const [id, name] of parsed.dictionary) {
			dict.set(name, id);
			const currentNext = this.nextRecipeIndex.get(tileKey) ?? 0;
			if (id + 1 > currentNext) { this.nextRecipeIndex.set(tileKey, id + 1); }
		}

		// Populate active recipe cache
		const seen = this.lastSeenRecipeContent.get(tileKey)!;
		for (const [posKey, recipe] of parsed.activeRecipes) {
			seen.set(posKey, recipe);
		}
	}

	// Encode helpers
	private getOrCreateRecipeIndex(tileKey: string, recipe: string): { index: number, dictEntry?: Buffer } {
		if (!this.recipeDictionaries.has(tileKey)) {
			this.recipeDictionaries.set(tileKey, new Map());
			this.nextRecipeIndex.set(tileKey, 0);
		}
		const dict = this.recipeDictionaries.get(tileKey)!;
		if (dict.has(recipe)) {
			return { index: dict.get(recipe)! };
		}
		const nextIdx = this.nextRecipeIndex.get(tileKey)!;
		dict.set(recipe, nextIdx);
		this.nextRecipeIndex.set(tileKey, nextIdx + 1);
		const nameBuf = Buffer.from(recipe, "utf-8");
		const dictEntry = Buffer.alloc(1 + 2 + 1 + nameBuf.length);
		dictEntry.writeUInt8(0, 0);
		dictEntry.writeUInt16BE(nextIdx, 1);
		dictEntry.writeUInt8(nameBuf.length, 3);
		nameBuf.copy(dictEntry, 4);
		return { index: nextIdx, dictEntry };
	}

	private encodeSet(tileKey: string, tick: number, px: number, py: number, recipe: string): Buffer[] {
		const { index, dictEntry } = this.getOrCreateRecipeIndex(tileKey, recipe);
		const buf = Buffer.alloc(1 + 4 + 1 + 1 + 2);
		let o = 0;
		buf.writeUInt8(1, o); o += 1;
		buf.writeUInt32BE(Math.floor(tick / 60), o); o += 4;
		buf.writeUInt8(px, o); o += 1;
		buf.writeUInt8(py, o); o += 1;
		buf.writeUInt16BE(index, o);
		return dictEntry ? [dictEntry, buf] : [buf];
	}

	private encodeClear(tick: number, px: number, py: number): Buffer {
		const buf = Buffer.alloc(1 + 4 + 1 + 1);
		let o = 0;
		buf.writeUInt8(2, o); o += 1;
		buf.writeUInt32BE(Math.floor(tick / 60), o); o += 4;
		buf.writeUInt8(px, o); o += 1;
		buf.writeUInt8(py, o);
		return buf;
	}

	async saveChartTags() {
		if (this.chartTagQueues.size === 0) {
			return;
		}

		const savePromises = [];
		for (const [fileKey, tags] of this.chartTagQueues) {
			if (tags.length === 0 || this.savingChartTags.has(fileKey)) {
				// Remove empty queues to prevent repeated processing
				if (tags.length === 0 && !this.savingChartTags.has(fileKey)) {
					this.chartTagQueues.delete(fileKey);
				}
				continue;
			}

			const promise = (async () => {
				this.savingChartTags.add(fileKey);
				const tagsToSave = [...tags];
				tags.length = 0; // Clear the queue

				try {
					const fileName = `${fileKey}_chart_tags.json`;
					const filePath = resolveFileInDir(this.chartTagsPath, fileName);
					if (!filePath) {
						this.logger.error(`Refusing to save chart tags with invalid path: ${fileName}`);
						return;
					}

					// Convert chart tags to newline-delimited JSON format
					const jsonLines = tagsToSave.map(tag => JSON.stringify(tag)).join("\n");

					await fs.appendFile(filePath, `${jsonLines}\n`);

					// Mark tags as successfully saved
					if (!this.lastSeenTagContent.has(fileKey)) {
						this.lastSeenTagContent.set(fileKey, new Map());
					}
					const seenTags = this.lastSeenTagContent.get(fileKey)!;
					for (const tag of tagsToSave) {
						seenTags.set(tag.tag_number, {
							position: tag.position,
							text: tag.text,
							icon: tag.icon,
							last_user: tag.last_user,
						});
					}

					this.logger.info(`Saved ${tagsToSave.length} chart tag entries to ${fileKey}`);
				} catch (err) {
					this.logger.error(`Error saving chart tags for ${fileKey}: ${err}`);
					// Re-queue the failed tags
					tags.unshift(...tagsToSave);
				} finally {
					this.savingChartTags.delete(fileKey);
				}
			})();
			savePromises.push(promise);
		}

		await Promise.all(savePromises);
	}

	async handleChartTagDataEvent(event: ChartTagDataEvent) {
		try {
			const { instance_id, tag_data } = event;

			// Create file key based on instance, surface, and force
			const fileKey = `${instance_id}_${tag_data.surface}_${tag_data.force}`;

			// Initialize seen tags map if it doesn't exist
			if (!this.lastSeenTagContent.has(fileKey)) {
				this.lastSeenTagContent.set(fileKey, new Map());
			}

			// Check for duplicate content, but allow deletion events (end_tick set) even if we've seen the tag before
			const seenTags = this.lastSeenTagContent.get(fileKey)!;
			const lastSeenContent = seenTags.get(tag_data.tag_number);

			// For deletion events (end_tick set), always allow through
			if (tag_data.end_tick !== undefined) {
				// Don't skip deletion events
			} else if (lastSeenContent) {
				// For creation/modification events, check if content has actually changed
				const contentUnchanged =
					lastSeenContent.position[0] === tag_data.position[0]
					&& lastSeenContent.position[1] === tag_data.position[1]
					&& lastSeenContent.text === tag_data.text
					&& JSON.stringify(lastSeenContent.icon) === JSON.stringify(tag_data.icon)
					&& lastSeenContent.last_user === tag_data.last_user;

				if (contentUnchanged) {
					return; // Skip if content hasn't changed
				}
			}

			// Add instance_id to the tag data for storage
			const enrichedTagData = {
				...tag_data,
				instance_id,
			};

			// Immediately update last seen content to improve deduplication before save completes
			if (tag_data.end_tick !== undefined) {
				seenTags.delete(tag_data.tag_number);
			} else {
				seenTags.set(tag_data.tag_number, {
					position: tag_data.position,
					text: tag_data.text,
					icon: tag_data.icon,
					last_user: tag_data.last_user,
				});
			}

			// Initialize queue if it doesn't exist
			if (!this.chartTagQueues.has(fileKey)) {
				this.chartTagQueues.set(fileKey, []);
			}

			// Queue for batch saving
			this.chartTagQueues.get(fileKey)!.push(enrichedTagData);

			const updateEvent = new ChartTagDataEvent(instance_id, tag_data);

			// Broadcast to subscribed web clients only with instance/surface filter
			this.controller.subscriptions.broadcast(updateEvent, `${instance_id}:${tag_data.surface}`);

		} catch (err) {
			this.logger.error(`Error processing chart tag data: ${err}`);
		}
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

			const updateEvent = new TileDataEvent(
				instance_id,
				surface,
				force,
				x,
				y,
				tick,
				chunk
			);

			// Broadcast to subscribed web clients only with instance/surface filter
			this.controller.subscriptions.broadcast(updateEvent, `${instance_id}:${surface}`);

		} catch (err) {
			this.logger.error(`Error processing tile data: ${err}`);
		}
	}

	async handleGetRawTileRequest(request: GetRawTileRequest) {
		const { instance_id, surface, force, tile_x, tile_y, tick } = request;

		const tileName = `${instance_id}_${surface}_${force}_${tile_x}_${tile_y}.bin`;
		const tilePath = resolveFileInDir(this.tilesPath, tileName);
		if (!tilePath) {
			this.logger.warn(`Refusing to read tile with invalid path: ${tileName}`);
			return { tile_data: null, tick: tick || 0 };
		}

		try {
			const tileData = await fs.readFile(tilePath);

			const base64Data = tileData.toString("base64");

			return {
				tile_data: base64Data,
			};
		} catch (err) {
			if (isENOENT(err)) {
				return { tile_data: null, tick: tick || 0 };
			}
			this.logger.error(`Error reading tile file: ${err}`);
			return { tile_data: null };
		}
	}

	async handleGetChartTagsRequest(request: GetChartTagsRequest) {
		const { instance_id, surface, force } = request;

		const fileKey = `${instance_id}_${surface}_${force}`;
		const fileName = `${fileKey}_chart_tags.json`;
		const filePath = resolveFileInDir(this.chartTagsPath, fileName);
		if (!filePath) {
			this.logger.warn(`Refusing to read chart tags with invalid path: ${fileName}`);
			return { chart_tags: [] };
		}

		try {
			const content = await fs.readFile(filePath, "utf-8");
			const lines = content.trim().split("\n").filter(line => line.trim());

			const chartTags: ChartTagData[] = [];
			for (const line of lines) {
				try {
					const tagData = JSON.parse(line);
					chartTags.push(tagData);
				} catch (parseErr) {
					this.logger.warn(`Failed to parse chart tag line: ${parseErr}`);
				}
			}

			return { chart_tags: chartTags };
		} catch (err) {
			if (isENOENT(err)) {
				return { chart_tags: [] };
			}
			this.logger.error(`Error reading chart tag file: ${err}`);
			return { chart_tags: [] };
		}
	}

	async saveRecipeTiles() {
		if (this.saveRecipeTilesInProgress) {
			return;
		}

		if (this.recipeSavingQueue.size === 0) {
			return;
		}

		this.saveRecipeTilesInProgress = true;
		const queue = this.recipeSavingQueue;
		this.recipeSavingQueue = new Map();

		try {
			const promises: Promise<void>[] = [];
			for (const [tileName, buffers] of queue) {
				const promise = (async () => {
					const fileName = `${tileName}.recipes`;
					const tilePath = resolveFileInDir(this.recipeTilesPath, fileName);
					if (!tilePath) {
						this.logger.error(`Refusing to save recipe tile with invalid path: ${fileName}`);
						return;
					}
					const concat = Buffer.concat(buffers);
					await fs.appendFile(tilePath, concat);
				})();
				promises.push(promise);
			}
			await Promise.all(promises);
		} catch (err) {
			this.logger.error(`Error saving recipe tiles: ${err}`);
		} finally {
			this.saveRecipeTilesInProgress = false;
		}
	}

	private queuePlayerSessionStart(fileKey: string, playerId: number, playerName: string, tMs: number) {
		if (!this.playerSessionStartQueues.has(fileKey)) {
			this.playerSessionStartQueues.set(fileKey, []);
		}
		this.playerSessionStartQueues.get(fileKey)!.push({
			playerId,
			playerName,
			tMs,
		});
	}

	private queuePlayerSessionEnd(fileKey: string, playerId: number, tMs: number) {
		if (!this.playerSessionEndQueues.has(fileKey)) {
			this.playerSessionEndQueues.set(fileKey, []);
		}
		this.playerSessionEndQueues.get(fileKey)!.push({
			playerId,
			tMs,
		});
	}

	async savePlayerPositions() {
		if (this.savePlayerPositionsInProgress) {
			return;
		}

		if (
			this.playerPositionQueues.size === 0
			&& this.playerSessionStartQueues.size === 0
			&& this.playerSessionEndQueues.size === 0
		) {
			return;
		}

		this.savePlayerPositionsInProgress = true;
		const queue = this.playerPositionQueues;
		this.playerPositionQueues = new Map();
		const sessionStartQueue = this.playerSessionStartQueues;
		this.playerSessionStartQueues = new Map();
		const sessionEndQueue = this.playerSessionEndQueues;
		this.playerSessionEndQueues = new Map();

		try {
			const promises: Promise<void>[] = [];
			const fileKeys = new Set([
				...queue.keys(),
				...sessionStartQueue.keys(),
				...sessionEndQueue.keys(),
			]);
			for (const fileKey of fileKeys) {
				const positions = queue.get(fileKey) ?? [];
				const sessionStarts = sessionStartQueue.get(fileKey) ?? [];
				const sessionEnds = sessionEndQueue.get(fileKey) ?? [];
				const promise = (async () => {
					const fileName = `${fileKey}.positions`;
					const filePath = resolveFileInDir(this.playerPositionsPath, fileName);
					if (!filePath) {
						this.logger.error(`Refusing to save player positions with invalid path: ${fileName}`);
						return;
					}

					// Convert queued data to binary format.
					//
					// Session events and positions can be queued in the same save interval
					// (e.g. host drop + reconnect).
					// Emit records in receive-time order so SessionEnd can't be written after a new SessionStart.
					type QueuedRecord =
						| { kind: "sessionStart"; tMs: number; playerId: number; playerName: string }
						| { kind: "position"; tMs: number; position: EnrichedPlayerData }
						| { kind: "sessionEnd"; tMs: number; playerId: number };

					const kindOrder: Record<QueuedRecord["kind"], number> = {
						sessionEnd: 0,
						sessionStart: 1,
						position: 2,
					};

					const records: QueuedRecord[] = [];
					for (const sessionStart of sessionStarts) {
						records.push({
							kind: "sessionStart",
							tMs: sessionStart.tMs,
							playerId: sessionStart.playerId,
							playerName: sessionStart.playerName,
						});
					}
					for (const position of positions) {
						records.push({ kind: "position", tMs: position._tMs, position });
					}
					for (const sessionEnd of sessionEnds) {
						records.push({ kind: "sessionEnd", tMs: sessionEnd.tMs, playerId: sessionEnd.playerId });
					}

					records.sort((a, b) => (
						a.tMs - b.tMs
						|| kindOrder[a.kind] - kindOrder[b.kind]
					));

					const buffers: Buffer[] = [];
					for (const record of records) {
						if (record.kind === "sessionStart") {
							const nameBytes = Buffer.from(record.playerName, "utf8");
							// SessionStart record (type 1): 1 + 4 + 2 + 1 + nameLen bytes
							const buffer = Buffer.alloc(1 + 4 + 2 + 1 + nameBytes.length);
							let offset = 0;

							// Type (1 byte): 1 = SessionStart
							buffer.writeUInt8(1, offset);
							offset += 1;

							// t_ms (4 bytes): Current timestamp in milliseconds (uint32 wrap)
							buffer.writeUInt32BE(Math.floor(record.tMs) >>> 0, offset);
							offset += 4;

							// player_id (2 bytes)
							buffer.writeUInt16BE(record.playerId & 0xFFFF, offset);
							offset += 2;

							// name_len (1 byte) + name bytes
							buffer.writeUInt8(nameBytes.length & 0xFF, offset);
							offset += 1;
							nameBytes.copy(buffer, offset);
							buffers.push(buffer);
							continue;
						}

						if (record.kind === "position") {
							const position = record.position;
							// Position record (type 0): 1 + 4 + 4 + 3 + 3 + 2 = 17 bytes
							const buffer = Buffer.alloc(17);
							let offset = 0;

							// Type (1 byte): 0 = Position
							buffer.writeUInt8(0, offset);
							offset += 1;

							// t_sec (4 bytes): Current timestamp in seconds since epoch
							buffer.writeUInt32BE(Math.floor(record.tMs / 1000) >>> 0, offset);
							offset += 4;

							// sec (4 bytes): Game seconds (already calculated in Lua)
							buffer.writeUInt32BE(position.sec, offset);
							offset += 4;

							// x_tiles (3 bytes): X coordinate as 24-bit signed integer
							const x_int24 = Math.round(position.x) & 0xFFFFFF;
							buffer.writeUInt8((x_int24 >> 16) & 0xFF, offset);
							buffer.writeUInt8((x_int24 >> 8) & 0xFF, offset + 1);
							buffer.writeUInt8(x_int24 & 0xFF, offset + 2);
							offset += 3;

							// y_tiles (3 bytes): Y coordinate as 24-bit signed integer
							const y_int24 = Math.round(position.y) & 0xFFFFFF;
							buffer.writeUInt8((y_int24 >> 16) & 0xFF, offset);
							buffer.writeUInt8((y_int24 >> 8) & 0xFF, offset + 1);
							buffer.writeUInt8(y_int24 & 0xFF, offset + 2);
							offset += 3;

							// player_id (2 bytes): Use the assigned player ID
							buffer.writeUInt16BE((position._playerId ?? 0) & 0xFFFF, offset);
							buffers.push(buffer);
							continue;
						}

						// record.kind === "sessionEnd"
						// SessionEnd record (type 2): 1 + 4 + 2 bytes
						const buffer = Buffer.alloc(1 + 4 + 2);
						let offset = 0;

						// Type (1 byte): 2 = SessionEnd
						buffer.writeUInt8(2, offset);
						offset += 1;

						// t_ms (4 bytes): Current timestamp in milliseconds (uint32 wrap)
						buffer.writeUInt32BE(Math.floor(record.tMs) >>> 0, offset);
						offset += 4;

						// player_id (2 bytes)
						buffer.writeUInt16BE(record.playerId & 0xFFFF, offset);
						buffers.push(buffer);
					}

					if (buffers.length > 0) {
						const concatenated = Buffer.concat(buffers);
						await fs.appendFile(filePath, concatenated);
					}
				})();
				promises.push(promise);
			}
			await Promise.all(promises);
		} catch (err) {
			this.logger.error(`Error saving player positions: ${err}`);
		} finally {
			this.savePlayerPositionsInProgress = false;
		}
	}

	async handleRecipeDataEvent(event: RecipeDataEvent) {
		try {
			const { instance_id, recipe_data } = event;
			const x = recipe_data.position[0];
			const y = recipe_data.position[1];
			const tileX = Math.floor(x / 256);
			const tileY = Math.floor(y / 256);
			const tileKey = `${instance_id}_${recipe_data.surface}_${recipe_data.force}_${tileX}_${tileY}`;
			const posKey = `${x}_${y}`;

			// Initialise dedup map
			if (!this.lastSeenRecipeContent.has(tileKey)) {
				this.lastSeenRecipeContent.set(tileKey, new Map());
			}
			const seenRecipes = this.lastSeenRecipeContent.get(tileKey)!;

			let buffersToWrite: Buffer[] = [];

			// Translate world pos to local px/py
			const px = Math.round(x - tileX * 256);
			const py = Math.round(y - tileY * 256);

			if (recipe_data.end_tick !== undefined) {
				// Clear recipe
				if (seenRecipes.has(posKey)) {
					seenRecipes.delete(posKey);
					buffersToWrite.push(this.encodeClear(recipe_data.end_tick, px, py));
				} else {
					return; // nothing changed
				}
			} else {
				if (!recipe_data.recipe) {
					return; // nothing to set
				}
				const existing = seenRecipes.get(posKey);
				if (existing === recipe_data.recipe) {
					return; // duplicate
				}
				seenRecipes.set(posKey, recipe_data.recipe);
				buffersToWrite = this.encodeSet(tileKey, recipe_data.start_tick ?? 0, px, py, recipe_data.recipe);
			}

			if (buffersToWrite.length === 0) { return; }

			if (!this.recipeSavingQueue.has(tileKey)) {
				this.recipeSavingQueue.set(tileKey, []);
			}
			this.recipeSavingQueue.get(tileKey)!.push(...buffersToWrite);

			// Broadcast live update to subscribed web clients only with instance/surface filter
			this.controller.subscriptions.broadcast(event, `${instance_id}:${event.recipe_data.surface}`);

		} catch (err) {
			this.logger.error(`Error processing recipe data: ${err}`);
		}
	}

	async handleGetRawRecipeTileRequest(request: GetRawRecipeTileRequest) {
		const { instance_id, surface, force, tile_x, tile_y } = request;
		const tileKey = `${instance_id}_${surface}_${force}_${tile_x}_${tile_y}`;
		const fileName = `${tileKey}.recipes`;
		const filePath = resolveFileInDir(this.recipeTilesPath, fileName);
		if (!filePath) {
			this.logger.warn(`Refusing to read recipe tile with invalid path: ${fileName}`);
			return { recipe_tile: null };
		}

		try {
			const data = await fs.readFile(filePath);
			const base64 = data.toString("base64");
			return { recipe_tile: base64 };
		} catch (err) {
			if (isENOENT(err)) {
				return { recipe_tile: null };
			}
			this.logger.error(`Error reading recipe tile: ${err}`);
			return { recipe_tile: null };
		}
	}

	async handlePlayerPositionEvent(event: PlayerPositionEvent) {
		try {
			const { instance_id, player_data } = event;

			// Create file key based on instance and surface
			const fileKey = `${instance_id}_${player_data.surface}`;

			// Initialize player session tracking for this file key if needed
			if (!this.playerSessions.has(fileKey)) {
				this.playerSessions.set(fileKey, new Map());
				this.nextPlayerIds.set(fileKey, 1); // Start from 1, reserve 0 for unknown
				this.activePlayerSessions.set(fileKey, new Set());
			}

			const sessions = this.playerSessions.get(fileKey)!;
			const activeSessions = this.activePlayerSessions.get(fileKey)!;

			// Assign player ID if this player doesn't have one yet, or reopen their session
			let playerId: number;
			let shouldWriteSessionStart = false;
			if (!sessions.has(player_data.player_name)) {
				playerId = this.nextPlayerIds.get(fileKey)!;
				sessions.set(player_data.player_name, playerId);
				this.nextPlayerIds.set(fileKey, playerId + 1);
				this.logger.verbose(`Assigned new player ID ${playerId} to ${player_data.player_name} on ${fileKey}`);
				shouldWriteSessionStart = true;
			} else {
				playerId = sessions.get(player_data.player_name)!;
			}

			// Reopen/track active player session (handles session reopening after controller restart)
			if (!activeSessions.has(player_data.player_name)) {
				shouldWriteSessionStart = true;
			}
			activeSessions.add(player_data.player_name);

			if (shouldWriteSessionStart) {
				this.queuePlayerSessionStart(fileKey, playerId, player_data.player_name, Date.now());
			}

			// Add the player ID to the data for saving (without modifying the original schema)
			const enrichedPlayerData = { ...player_data, _playerId: playerId, _tMs: Date.now() };

			// Initialize queue if it doesn't exist
			if (!this.playerPositionQueues.has(fileKey)) {
				this.playerPositionQueues.set(fileKey, []);
			}

			// Queue for batch saving
			this.playerPositionQueues.get(fileKey)!.push(enrichedPlayerData);

			const updateEvent = new PlayerPositionEvent(instance_id, player_data);

			// Broadcast to subscribed web clients only with instance/surface filter
			this.controller.subscriptions.broadcast(updateEvent, `${instance_id}:${player_data.surface}`);

		} catch (err) {
			this.logger.error(`Error processing player position data: ${err}`);
		}
	}

	async handlePlayerSessionEndEvent(event: PlayerSessionEndEvent) {
		try {
			const { instance_id, session_data } = event;
			const fileKey = `${instance_id}_${session_data.surface}`;

			if (!this.playerSessions.has(fileKey)) {
				this.playerSessions.set(fileKey, new Map());
				this.nextPlayerIds.set(fileKey, 1); // Start from 1, reserve 0 for unknown
				this.activePlayerSessions.set(fileKey, new Set());
			}

			const sessions = this.playerSessions.get(fileKey)!;
			const activeSessions = this.activePlayerSessions.get(fileKey)!;

			let playerId = sessions.get(session_data.player_name);
			let shouldWriteSessionStart = false;
			if (playerId === undefined) {
				playerId = this.nextPlayerIds.get(fileKey)!;
				sessions.set(session_data.player_name, playerId);
				this.nextPlayerIds.set(fileKey, playerId + 1);
				shouldWriteSessionStart = true;
			}

			if (!activeSessions.has(session_data.player_name)) {
				shouldWriteSessionStart = true;
			}

			const now = Date.now();

			if (shouldWriteSessionStart) {
				this.queuePlayerSessionStart(fileKey, playerId, session_data.player_name, now);
			}

			this.queuePlayerSessionEnd(fileKey, playerId, now);
			activeSessions.delete(session_data.player_name);
		} catch (err) {
			this.logger.error(`Error processing player session end data: ${err}`);
		}
	}

	async handleGetPlayerPathRequest(request: GetPlayerPathRequest) {
		const { instance_id, surface } = request;

		const fileName = `${instance_id}_${surface}.positions`;
		const filePath = resolveFileInDir(this.playerPositionsPath, fileName);
		if (!filePath) {
			this.logger.warn(`Refusing to read player positions with invalid path: ${fileName}`);
			return { positions: null };
		}

		try {
			const data = await fs.readFile(filePath);
			const base64Data = data.toString("base64");
			return { positions: base64Data };
		} catch (err) {
			if (isENOENT(err)) {
				return { positions: null };
			}
			this.logger.error(`Error reading player positions file: ${err}`);
			return { positions: null };
		}
	}

	async handleClearMinimapSurfaceDataRequest(request: ClearMinimapSurfaceDataRequest) {
		await this.clearSurfaceData(request.instance_id, request.surface, request.force);
		return { success: true };
	}

	async handleClearAllMinimapDataRequest(_request: ClearMinimapDataRequest) {
		await this.clearAllMinimapData();
		return { success: true };
	}

	private async loadExistingPlayerSessions() {
		try {
			if (!await fs.pathExists(this.playerPositionsPath)) {
				return;
			}

			const files = await fs.readdir(this.playerPositionsPath);
			const positionFiles = files.filter(file => file.endsWith(".positions"));

			for (const file of positionFiles) {
				const fileKey = file.replace(".positions", "");
				const filePath = path.join(this.playerPositionsPath, file);

				if (!this.playerSessions.has(fileKey)) {
					this.playerSessions.set(fileKey, new Map());
					this.nextPlayerIds.set(fileKey, 1); // Start from 1, reserve 0 for unknown
					// Start with no active sessions - they will be reopened when players send new positions
					this.activePlayerSessions.set(fileKey, new Set());
				}

				const sessions = this.playerSessions.get(fileKey)!;

				try {
					const data = await fs.readFile(filePath);

					// Use shared parsing function
					const parsed = parsePlayerPositionsBinary(data);

					// Restore the player name -> ID mappings from SessionStart records
					for (const [playerName, playerId] of parsed.playerSessions) {
						sessions.set(playerName, playerId);
					}

					// Set next player ID to be higher than any existing ID
					if (parsed.maxPlayerId > 0) {
						this.nextPlayerIds.set(fileKey, parsed.maxPlayerId + 1);
					}

					// eslint-disable-next-line max-len
					this.logger.info(`Loaded ${sessions.size} player sessions for ${fileKey}, next ID will be ${this.nextPlayerIds.get(fileKey)}`);
				} catch (readErr) {
					this.logger.error(`Failed to read player positions file ${file}: ${readErr}`);
				}
			}
		} catch (err) {
			this.logger.error(`Error loading existing player sessions: ${err}`);
		}
	}
}
