import React, { useState, useEffect, useContext, useRef, useCallback } from "react";
import { Row, Col, Button, Card, Space, Select, Switch, Slider, Typography } from "antd";
import { ControlContext, useInstances, useItemMetadata } from "@clusterio/web_ui";
import { GetRawTileRequest, GetChartTagsRequest, GetRawRecipeTileRequest, TileDataEvent, ChartTagData, ChartTagDataEvent, SignalID, RecipeDataEvent } from "../messages";
import * as zlib from "zlib";
import {
	renderTileToPixels,
	pixelsToImageData,
	rgb565ToRgb888,
	extractAvailableTicks,
	parseTileData,
	renderTileIncremental,
	ParsedTileData
} from "../tile-utils";

const { Text } = Typography;

interface ChartTagDataWithInstance extends ChartTagData {
	instance_id: number;
}

interface MergedChartTag {
	tag_number: number;
	start_tick: number | undefined;
	end_tick: number | undefined;
	force: string;
	surface: string;
	position: [number, number];
	text: string;
	icon?: SignalID;
	last_user?: string;
	instance_id: number;
}

interface SurfaceForceData {
	surfaces: string[];
	forces: string[];
}

interface ViewState {
	centerX: number;
	centerY: number;
	zoomLevel: number;
}

interface TileState {
	currentTick: number;
	pixels: Uint16Array;
	parsedData: ParsedTileData;
	imageData: ImageData;
}

const CHUNK_SIZE = 32; // 32x32 pixels per chunk
const TILE_SIZE = 256; // 256x256 pixels per tile (8x8 chunks)
const CHUNKS_PER_TILE = 8;



// Convert raw chart data to ImageData
async function chartDataToImageData(chartData: string): Promise<ImageData> {
	// Decode base64 and decompress
	const compressedData = Buffer.from(chartData, "base64");
	const decompressed = zlib.inflateSync(compressedData);

	// Create RGBA image data (32x32 pixels)
	const imageData = new Uint8ClampedArray(32 * 32 * 4);

	// Ensure we don't read beyond available data
	const maxPixels = Math.min(decompressed.length / 2, 32 * 32);

	for (let i = 0; i < maxPixels * 2; i += 2) {
		const rgb565Value = decompressed.readUInt16LE(i);
		const [r, g, b] = rgb565ToRgb888(rgb565Value);
		const pixelIndex = i / 2;
		const bufferIndex = pixelIndex * 4;

		imageData[bufferIndex] = r;
		imageData[bufferIndex + 1] = g;
		imageData[bufferIndex + 2] = b;
		imageData[bufferIndex + 3] = 255; // Alpha
	}

	// Fill remaining pixels with black if we have less data than expected
	for (let pixelIndex = maxPixels; pixelIndex < 32 * 32; pixelIndex++) {
		const bufferIndex = pixelIndex * 4;
		imageData[bufferIndex] = 0;     // R
		imageData[bufferIndex + 1] = 0; // G
		imageData[bufferIndex + 2] = 0; // B
		imageData[bufferIndex + 3] = 255; // A
	}

	return new ImageData(imageData, 32, 32);
}

export default function CanvasMinimapPage() {
	// UI-related states (these need React re-renders)
	const [instances] = useInstances();
	const [selectedInstance, setSelectedInstance] = useState<number | null>(null);
	const [selectedSurface, setSelectedSurface] = useState<string>("nauvis");
	const [selectedForce, setSelectedForce] = useState<string>("player");
	const [surfaceForceData, setSurfaceForceData] = useState<SurfaceForceData>({ surfaces: [], forces: [] });
	const [loading, setLoading] = useState(false);

	// Timelapse UI states (these need React re-renders for UI)
	const [isTimelapseMode, setIsTimelapseMode] = useState(false);
	const [availableTicks, setAvailableTicks] = useState<number[]>([]);
	const [currentTick, setCurrentTick] = useState<number | null>(null);
	const [isPlaying, setIsPlaying] = useState(false);
	const [playbackSpeed, setPlaybackSpeed] = useState(1);
	const [chartTagTimestamps, setChartTagTimestamps] = useState(0);

	// Chart tag states
	const [showChartTags, setShowChartTags] = useState(true);
	const [showRecipes, setShowRecipes] = useState(true);
	const [rawChartTags, setRawChartTags] = useState<ChartTagDataWithInstance[]>([]);
	const [mergedChartTags, setMergedChartTags] = useState<MergedChartTag[]>([]);

	// Display state for zoom level (throttled updates to avoid excessive re-renders)
	const [displayZoom, setDisplayZoom] = useState(1);

	// Canvas refs
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const containerRef = useRef<HTMLDivElement>(null);

	// View state as ref (no React re-renders needed)
	const viewStateRef = useRef<ViewState>({
		centerX: 0,
		centerY: 0,
		zoomLevel: 1,
	});

	// Mouse drag state refs (no React re-renders needed)
	const isDraggingRef = useRef<boolean>(false);
	const lastMousePosRef = useRef<{ x: number; y: number } | null>(null);

	// Movement keys ref (no React re-renders needed)
	const keysPressed = useRef<Set<string>>(new Set());

	// Cache refs
	const virtualTiles = useRef<Map<string, HTMLCanvasElement>>(new Map());
	const tileStateCache = useRef<Map<string, TileState>>(new Map());
	const chunkCache = useRef<Map<string, ImageData>>(new Map());
	const loadingTiles = useRef<Map<string, Promise<ImageData | null>>>(new Map());

	// Cache for recipes currently active
	const recipeCache = useRef<Map<string, string>>(new Map());

	// Animation frame ref
	const animationFrameRef = useRef<number>();

	// Timelapse playback timer ref
	const playbackTimerRef = useRef<NodeJS.Timeout>();

	// Refs for current state access in event handlers
	const currentStateRef = useRef({
		selectedInstance: null as number | null,
		selectedSurface: "nauvis",
		selectedForce: "player",
		isTimelapseMode: false,
		currentTick: null as number | null,
		availableTicks: [] as number[],
		showChartTags: true,
		showRecipes: true,
		mergedChartTags: [] as MergedChartTag[],
		chartTagTimestamps: 0,
	});

	const control = useContext(ControlContext);
	const itemMetadata = useItemMetadata();

	// Keep latest metadata in a ref so long-living callbacks (render loop) can access fresh data
	const itemMetadataRef = useRef(itemMetadata);
	useEffect(() => {
		itemMetadataRef.current = itemMetadata;
	}, [itemMetadata]);

	// Spritesheet image ref (shared) derived from CSS
	const spriteImgRef = useRef<HTMLImageElement | null>(null);

	// Detect spritesheet URL by inspecting CSS once metadata available
	useEffect(() => {
		if (spriteImgRef.current || itemMetadata.size === undefined || itemMetadata.size === null) return;
		// pick first metadata entry
		const firstEntry = itemMetadata.entries().next();
		if (firstEntry.done) return;
		const testName = firstEntry.value[0];
		const span = document.createElement('span');
		span.className = `factorio-icon item-${testName}`;
		span.style.position = 'absolute'; span.style.visibility = 'hidden';
		document.body.appendChild(span);
		const bg = getComputedStyle(span).backgroundImage;
		document.body.removeChild(span);
		const match = bg.match(/url\("?([^"\)]+)"?\)/);
		if (!match) return;
		const url = match[1];
		const img = new Image();
		img.src = url;
		spriteImgRef.current = img;
		img.onload = () => {
			for (const [name, canvas] of iconCanvasCache.current) {
				const meta = itemMetadata.get(name);
				if (meta) {
					const ctx = canvas.getContext('2d')!;
					ctx.clearRect(0, 0, canvas.width, canvas.height);
					ctx.drawImage(img, meta.x, meta.y, meta.size, meta.size, 0, 0, meta.size, meta.size);
				}
			}
		};
	}, [itemMetadata]);

	// Cache icons canvases
	const iconCanvasCache = useRef<Map<string, HTMLCanvasElement>>(new Map());

	const getIconCanvas = (name: string): HTMLCanvasElement | null => {
		// Wait until metadata is ready
		if (!itemMetadataRef.current.size) return null;

		// Re-use cached canvas if we already built one for this name
		if (iconCanvasCache.current.has(name)) return iconCanvasCache.current.get(name)!;

		// Helper that tries to find metadata for a given key
		const resolveMeta = (key: string) => itemMetadataRef.current.get(key);

		// Try direct lookup first
		let meta = resolveMeta(name);

		// Fallback: strip common type prefixes ("item-", "fluid-", "signal-")
		if (!meta) {
			const dashIndex = name.indexOf("-");
			if (dashIndex !== -1) {
				const stripped = name.substring(dashIndex + 1);
				meta = resolveMeta(stripped);
			}
		}

		// If still not found, give up
		if (!meta) return null;

		// Build off-screen canvas containing the icon
		const canvas = document.createElement("canvas");
		canvas.width = meta.size;
		canvas.height = meta.size;
		const ctx = canvas.getContext("2d")!;

		const sprite = spriteImgRef.current;
		if (sprite && sprite.complete) {
			ctx.drawImage(
				sprite,
				meta.x,
				meta.y,
				meta.size,
				meta.size,
				0,
				0,
				meta.size,
				meta.size
			);
		} else if (sprite) {
			// Draw once the spritesheet finishes loading to avoid blank icons
			sprite.onload = () => {
				ctx.clearRect(0, 0, canvas.width, canvas.height);
				ctx.drawImage(
					sprite,
					meta.x,
					meta.y,
					meta.size,
					meta.size,
					0,
					0,
					meta.size,
					meta.size
				);
			};
		}

		// Cache under the original key so we don't rebuild each frame
		iconCanvasCache.current.set(name, canvas);
		return canvas;
	};

	// After getIconCanvas
	const signalToKey = (sig: any): string | null => {
		if (!sig || !sig.name) return null;
		const t = sig.type || 'item';
		return `${t}-${sig.name}`;
	};

	// Merge raw chart tag data into timeline-friendly format
	const mergeChartTags = useCallback((rawTags: ChartTagDataWithInstance[]): MergedChartTag[] => {
		const tagMap = new Map<string, MergedChartTag>();

		for (const rawTag of rawTags) {
			// Create a unique key for each tag (tag_number + surface + force + instance)
			const key = `${rawTag.tag_number}_${rawTag.surface}_${rawTag.force}_${rawTag.instance_id}`;

			if (!tagMap.has(key)) {
				// Create new merged tag entry
				tagMap.set(key, {
					tag_number: rawTag.tag_number,
					start_tick: rawTag.start_tick,
					end_tick: rawTag.end_tick,
					force: rawTag.force,
					surface: rawTag.surface,
					position: rawTag.position,
					text: rawTag.text,
					icon: rawTag.icon,
					last_user: rawTag.last_user,
					instance_id: rawTag.instance_id,
				});
			} else {
				// Merge with existing entry
				const existing = tagMap.get(key)!;

				// If this entry has a start_tick, use it
				if (rawTag.start_tick !== undefined) {
					existing.start_tick = rawTag.start_tick;
					// Also update other properties from the start entry
					existing.position = rawTag.position;
					existing.text = rawTag.text;
					existing.icon = rawTag.icon;
					existing.last_user = rawTag.last_user;
				}

				// If this entry has an end_tick, use it
				if (rawTag.end_tick !== undefined) {
					existing.end_tick = rawTag.end_tick;
					// Use the properties from the end entry as they might have been modified
					existing.position = rawTag.position;
					existing.text = rawTag.text;
					existing.icon = rawTag.icon;
					existing.last_user = rawTag.last_user;
				}
			}
		}

		return Array.from(tagMap.values());
	}, []);

	// Update merged chart tags when raw tags change
	useEffect(() => {
		setMergedChartTags(mergeChartTags(rawChartTags));
	}, [rawChartTags, mergeChartTags]);

	// Update current state ref when state changes
	useEffect(() => {
		currentStateRef.current = {
			selectedInstance,
			selectedSurface,
			selectedForce,
			isTimelapseMode,
			currentTick,
			availableTicks,
			showChartTags,
			showRecipes,
			mergedChartTags,
			chartTagTimestamps,
		};
	}, [selectedInstance, selectedSurface, selectedForce, isTimelapseMode, currentTick, availableTicks, showChartTags, mergedChartTags, chartTagTimestamps, showRecipes]);

	// Define pixel-perfect zoom levels to eliminate seaming issues
	const ZOOM_LEVELS = [0.125, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];

	const getClosestZoomLevel = (targetZoom: number): number => {
		return ZOOM_LEVELS.reduce((prev, curr) =>
			Math.abs(curr - targetZoom) < Math.abs(prev - targetZoom) ? curr : prev
		);
	};

	const getNextZoomLevel = (currentZoom: number, direction: 'up' | 'down'): number => {
		const currentIndex = ZOOM_LEVELS.findIndex(zoom => Math.abs(zoom - currentZoom) < 0.001);
		if (direction === 'up') {
			return ZOOM_LEVELS[Math.min(currentIndex + 1, ZOOM_LEVELS.length - 1)];
		} else {
			return ZOOM_LEVELS[Math.max(currentIndex - 1, 0)];
		}
	};

	// Throttled zoom display update to avoid excessive re-renders
	const throttledZoomUpdate = useRef<NodeJS.Timeout>();

	// Helper to update view state without React re-render
	const updateViewState = (updates: Partial<ViewState>) => {
		Object.assign(viewStateRef.current, updates);

		// Update display zoom if zoom changed (throttled)
		if (updates.zoomLevel !== undefined) {
			if (throttledZoomUpdate.current) {
				clearTimeout(throttledZoomUpdate.current);
			}
			throttledZoomUpdate.current = setTimeout(() => {
				setDisplayZoom(viewStateRef.current.zoomLevel);
			}, 100); // Update display every 100ms max
		}
	};

	// Helper to update cursor style directly
	const updateCursor = (isDragging: boolean) => {
		if (canvasRef.current) {
			canvasRef.current.style.cursor = isDragging ? "grabbing" : "grab";
		}
	};

	// Calculate which tiles are visible based on current view state
	const calculateVisibleTiles = () => {
		const canvas = canvasRef.current;
		if (!canvas) return null;

		const viewState = viewStateRef.current;
		const scale = viewState.zoomLevel;
		const width = canvas.width;
		const height = canvas.height;

		// Calculate visible world area
		const worldWidth = width / scale;
		const worldHeight = height / scale;
		const worldLeft = viewState.centerX - worldWidth / 2;
		const worldTop = viewState.centerY - worldHeight / 2;
		const worldRight = worldLeft + worldWidth;
		const worldBottom = worldTop + worldHeight;

		// Calculate which tiles are visible (with extra margin to ensure full coverage)
		const leftTile = Math.floor(worldLeft / TILE_SIZE) - 1;
		const topTile = Math.floor(worldTop / TILE_SIZE) - 1;
		const rightTile = Math.ceil(worldRight / TILE_SIZE) + 1;
		const bottomTile = Math.ceil(worldBottom / TILE_SIZE) + 1;

		return {
			leftTile,
			topTile,
			rightTile,
			bottomTile,
			scale,
			worldLeft,
			worldTop,
			worldRight,
			worldBottom
		};
	};

	// Timelapse functions
	const loadAvailableTicks = async () => {
		if (!selectedInstance) {
			return;
		}

		const visibleTiles = calculateVisibleTiles();
		if (!visibleTiles) {
			console.warn("Canvas not available for tile culling calculation");
			return;
		}

		try {
			const { leftTile, topTile, rightTile, bottomTile } = visibleTiles;

			const allTicks = new Set<number>();
			let tilesChecked = 0;
			let tilesWithData = 0;

			// Check all visible tiles
			for (let tileY = topTile; tileY <= bottomTile; tileY++) {
				for (let tileX = leftTile; tileX <= rightTile; tileX++) {
					try {
						const response = await control.send(new GetRawTileRequest(
							selectedInstance,
							selectedSurface,
							selectedForce,
							tileX,
							tileY
						));

						tilesChecked++;

						if (response.tile_data) {
							const binaryString = atob(response.tile_data);
							const tileData = new Uint8Array(binaryString.length);
							for (let i = 0; i < binaryString.length; i++) {
								tileData[i] = binaryString.charCodeAt(i);
							}

							const ticks = extractAvailableTicks(tileData);

							if (ticks.length > 0) {
								tilesWithData++;
								ticks.forEach(tick => allTicks.add(tick));
							}
						}
					} catch (err) {
						console.warn(`Failed to load tile ${tileX},${tileY}:`, err);
					}
				}
			}

			// Also include chart tag timestamps
			const currentState = currentStateRef.current;
			let tagsWithTicks = 0;

			if (currentState.mergedChartTags.length > 0) {
				for (const tag of currentState.mergedChartTags) {
					// Add start_tick if it exists (tag creation)
					if (tag.start_tick !== undefined) {
						allTicks.add(tag.start_tick);
						tagsWithTicks++;
					}

					// Add end_tick if it exists (tag deletion)
					if (tag.end_tick !== undefined) {
						allTicks.add(tag.end_tick);
						tagsWithTicks++;
					}
				}

				console.log(`Added ${tagsWithTicks} chart tag timestamps to timeline`);
			}

			setChartTagTimestamps(tagsWithTicks);

			// Collect recipe timestamps across visible recipe tiles
			let recipeTicksAdded = 0;
			for (let tileY = topTile; tileY <= bottomTile; tileY++) {
				for (let tileX = leftTile; tileX <= rightTile; tileX++) {
					try {
						const recipeResp = await control.send(new GetRawRecipeTileRequest(
							selectedInstance,
							selectedSurface,
							selectedForce,
							tileX,
							tileY
						));
						if (recipeResp.recipe_tile) {
							const text = atob(recipeResp.recipe_tile);
							const lines = text.trim().split('\n').filter(l => l.trim());
							for (const line of lines) {
								try {
									const rec = JSON.parse(line);
									if (rec.start_tick !== undefined) { allTicks.add(rec.start_tick); recipeTicksAdded++; }
									if (rec.end_tick !== undefined) { allTicks.add(rec.end_tick); recipeTicksAdded++; }
								} catch { /* ignore parse errors */ }
							}
						}
					} catch (e) {
						console.warn(`Failed to load recipe tile ${tileX},${tileY}:`, e);
					}
				}
			}

			const sortedTicks = Array.from(allTicks).sort((a, b) => a - b);
			setAvailableTicks(sortedTicks);

			// Set current tick to latest if not set
			if (sortedTicks.length > 0 && currentTick === null) {
				setCurrentTick(sortedTicks[sortedTicks.length - 1]);
			}
		} catch (err) {
			console.error("Failed to load available ticks:", err);
		}
	};

	const toggleTimelapseMode = async (enabled: boolean) => {
		setIsTimelapseMode(enabled);
		setIsPlaying(false);

		if (enabled) {
			// Ensure chart tags are loaded before getting available ticks
			if (selectedInstance && selectedSurface && selectedForce) {
				await loadExistingChartTags();
			}
			await loadAvailableTicks();
		} else {
			setCurrentTick(null);
			setChartTagTimestamps(0);
		}

		// Clear caches when switching modes
		virtualTiles.current.clear();
		tileStateCache.current.clear();
		chunkCache.current.clear();
		loadingTiles.current.clear();
		recipeCache.current.clear();
	};

	const stepToTick = async (tickIndex: number) => {
		const currentState = currentStateRef.current;
		if (tickIndex >= 0 && tickIndex < currentState.availableTicks.length) {
			const newTick = currentState.availableTicks[tickIndex];
			const oldTick = currentState.currentTick;

			if (oldTick === newTick) {
				return; // No change needed
			}

			// Clear recipe cache; will be repopulated for this tick
			recipeCache.current.clear();

			// Use incremental updates for loaded tiles instead of clearing cache
			const updatePromises: Promise<void>[] = [];

			for (const [tileKey, tileState] of tileStateCache.current) {
				updatePromises.push((async () => {
					try {
						// Apply incremental changes from current tick to new tick
						await renderTileIncremental(
							tileState.parsedData,
							tileState.pixels,
							tileState.currentTick,
							newTick
						);

						// Update tile state
						tileState.currentTick = newTick;

						// Convert to ImageData and update virtual tile
						const newImageData = pixelsToImageData(tileState.pixels);
						tileState.imageData = newImageData;

						// Update virtual tile canvas if it exists
						const virtualTile = virtualTiles.current.get(tileKey);
						if (virtualTile) {
							const ctx = virtualTile.getContext('2d')!;
							ctx.putImageData(newImageData, 0, 0);
						}

						// Update chunk cache for this tile
						const [tileX, tileY] = tileKey.split(',').map(Number);
						for (let cy = 0; cy < CHUNKS_PER_TILE; cy++) {
							for (let cx = 0; cx < CHUNKS_PER_TILE; cx++) {
								const actualChunkX = tileX * CHUNKS_PER_TILE + cx;
								const actualChunkY = tileY * CHUNKS_PER_TILE + cy;
								const actualChunkKey = `${actualChunkX},${actualChunkY}`;

								// Extract chunk area from the full tile ImageData
								const chunkData = new Uint8ClampedArray(CHUNK_SIZE * CHUNK_SIZE * 4);
								for (let y = 0; y < CHUNK_SIZE; y++) {
									for (let x = 0; x < CHUNK_SIZE; x++) {
										const tilePixelIndex = ((cy * CHUNK_SIZE + y) * TILE_SIZE + (cx * CHUNK_SIZE + x)) * 4;
										const chunkPixelIndex = (y * CHUNK_SIZE + x) * 4;

										chunkData[chunkPixelIndex] = newImageData.data[tilePixelIndex];         // R
										chunkData[chunkPixelIndex + 1] = newImageData.data[tilePixelIndex + 1]; // G
										chunkData[chunkPixelIndex + 2] = newImageData.data[tilePixelIndex + 2]; // B
										chunkData[chunkPixelIndex + 3] = newImageData.data[tilePixelIndex + 3]; // A
									}
								}

								const chunkImageData = new ImageData(chunkData, CHUNK_SIZE, CHUNK_SIZE);
								chunkCache.current.set(actualChunkKey, chunkImageData);
							}
						}
					} catch (err) {
						console.error(`Failed to update tile ${tileKey} incrementally:`, err);
						// If incremental update fails, remove from cache to force full reload
						tileStateCache.current.delete(tileKey);
						virtualTiles.current.delete(tileKey);
					}
				})());
			}

			// Wait for all tile updates to complete
			await Promise.all(updatePromises);

			setCurrentTick(newTick);
		}
	};

	const stepForward = async () => {
		const currentState = currentStateRef.current;
		const currentIndex = currentState.availableTicks.findIndex(tick => tick === currentState.currentTick);
		if (currentIndex >= 0 && currentIndex < currentState.availableTicks.length - 1) {
			await stepToTick(currentIndex + 1);
		}
	};

	const stepBackward = async () => {
		const currentState = currentStateRef.current;
		const currentIndex = currentState.availableTicks.findIndex(tick => tick === currentState.currentTick);
		if (currentIndex > 0) {
			await stepToTick(currentIndex - 1);
		}
	};

	const togglePlayback = () => {
		setIsPlaying(!isPlaying);
	};

	// Handle playback timer
	useEffect(() => {
		if (isPlaying && isTimelapseMode && availableTicks.length > 0) {
			playbackTimerRef.current = setInterval(async () => {
				const currentState = currentStateRef.current;
				const currentIndex = currentState.availableTicks.findIndex(tick => tick === currentState.currentTick);
				if (currentIndex >= 0 && currentIndex < currentState.availableTicks.length - 1) {
					await stepToTick(currentIndex + 1);
				} else {
					// Reached the end, stop playing
					setIsPlaying(false);
				}
			}, 1000 / playbackSpeed);
		} else {
			if (playbackTimerRef.current) {
				clearInterval(playbackTimerRef.current);
				playbackTimerRef.current = undefined;
			}
		}

		return () => {
			if (playbackTimerRef.current) {
				clearInterval(playbackTimerRef.current);
			}
		};
	}, [isPlaying, isTimelapseMode, currentTick, playbackSpeed, availableTicks]);

	// Format tick as time
	const formatTickTime = (tick: number): string => {
		const seconds = Math.floor(tick / 60);
		const minutes = Math.floor(seconds / 60);
		const hours = Math.floor(minutes / 60);

		if (hours > 0) {
			return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
		} else if (minutes > 0) {
			return `${minutes}m ${seconds % 60}s`;
		} else {
			return `${seconds}s`;
		}
	};

	// Set default instance when instances become available
	useEffect(() => {
		if (instances.size > 0 && !selectedInstance) {
			const firstInstance = instances.values().next().value;
			if (firstInstance) {
				setSelectedInstance(firstInstance.id);
			}
		}
	}, [instances, selectedInstance]);

	// Load surface and force data on component mount
	useEffect(() => {
		loadSurfaceForceData();
	}, []);

	// Set up keyboard and mouse event listeners (one-time setup)
	useEffect(() => {
		const handleKeyDown = (e: KeyboardEvent) => {
			const key = e.key.toLowerCase();

			// Track movement keys for smooth animation
			if (['w', 'a', 's', 'd'].includes(key)) {
				keysPressed.current.add(key);
				return;
			}

			// Handle zoom keys immediately (not animated)
			switch (key) {
				case '+':
				case '=': // Handle both + and = key (since + requires shift)
					updateViewState({
						zoomLevel: getNextZoomLevel(viewStateRef.current.zoomLevel, 'up')
					});
					e.preventDefault(); // Prevent browser zoom
					break;
				case '-':
				case '_': // Handle both - and _ key (since _ requires shift)
					updateViewState({
						zoomLevel: getNextZoomLevel(viewStateRef.current.zoomLevel, 'down')
					});
					e.preventDefault(); // Prevent browser zoom
					break;
				case 'f':
					// Step backward in timeline (only in timelapse mode)
					if (currentStateRef.current.isTimelapseMode && currentStateRef.current.availableTicks.length > 0) {
						stepBackward();
						e.preventDefault();
					}
					break;
				case 'g':
					// Step forward in timeline (only in timelapse mode)
					if (currentStateRef.current.isTimelapseMode && currentStateRef.current.availableTicks.length > 0) {
						stepForward();
						e.preventDefault();
					}
					break;
			}
		};

		const handleKeyUp = (e: KeyboardEvent) => {
			const key = e.key.toLowerCase();

			// Remove movement keys when released
			if (['w', 'a', 's', 'd'].includes(key)) {
				keysPressed.current.delete(key);
			}
		};

		const handleBlur = () => {
			// Clear all pressed keys when window loses focus to prevent stuck keys
			keysPressed.current.clear();
		};

		const handleWheel = (e: WheelEvent) => {
			e.preventDefault();
			const direction = e.deltaY > 0 ? 'down' : 'up';
			const newZoom = getNextZoomLevel(viewStateRef.current.zoomLevel, direction);

			updateViewState({ zoomLevel: newZoom });
		};

		document.addEventListener('keydown', handleKeyDown);
		document.addEventListener('keyup', handleKeyUp);
		window.addEventListener('blur', handleBlur);
		const canvasElement = canvasRef.current;
		if (canvasElement) {
			canvasElement.addEventListener('wheel', handleWheel, { passive: false });
		}

		return () => {
			document.removeEventListener('keydown', handleKeyDown);
			document.removeEventListener('keyup', handleKeyUp);
			window.removeEventListener('blur', handleBlur);
			if (canvasElement) {
				canvasElement.removeEventListener('wheel', handleWheel);
			}
		};
	}, []); // No dependencies - use refs for current state

	// Mouse event handlers for click and drag panning (one-time setup)
	useEffect(() => {
		const canvasElement = canvasRef.current;

		if (!canvasElement) {
			return;
		}

		const handleMouseDown = (e: MouseEvent) => {
			if (e.button === 0) { // Left mouse button
				isDraggingRef.current = true;
				lastMousePosRef.current = { x: e.clientX, y: e.clientY };
				updateCursor(true); // Update state for cursor change
				e.preventDefault();
			}
		};

		const handleMouseMove = (e: MouseEvent) => {
			if (isDraggingRef.current && lastMousePosRef.current) {
				const deltaX = e.clientX - lastMousePosRef.current.x;
				const deltaY = e.clientY - lastMousePosRef.current.y;

				// Convert screen delta to world delta (invert because dragging right should move view left)
				const worldDeltaX = -deltaX / viewStateRef.current.zoomLevel;
				const worldDeltaY = -deltaY / viewStateRef.current.zoomLevel;

				updateViewState({
					centerX: viewStateRef.current.centerX + worldDeltaX,
					centerY: viewStateRef.current.centerY + worldDeltaY
				});

				lastMousePosRef.current = { x: e.clientX, y: e.clientY };
			}
		};

		const handleMouseUp = (e: MouseEvent) => {
			if (e.button === 0) { // Left mouse button
				isDraggingRef.current = false;
				lastMousePosRef.current = null;
				updateCursor(false); // Update state for cursor change
			}
		};

		const handleMouseLeave = () => {
			// Stop dragging if mouse leaves canvas
			isDraggingRef.current = false;
			lastMousePosRef.current = null;
			updateCursor(false); // Update state for cursor change
		};

		canvasElement.addEventListener('mousedown', handleMouseDown);
		canvasElement.addEventListener('mousemove', handleMouseMove);
		canvasElement.addEventListener('mouseup', handleMouseUp);
		canvasElement.addEventListener('mouseleave', handleMouseLeave);

		// Also listen to document for mouse events to handle dragging outside canvas
		document.addEventListener('mousemove', handleMouseMove);
		document.addEventListener('mouseup', handleMouseUp);

		return () => {
			canvasElement.removeEventListener('mousedown', handleMouseDown);
			canvasElement.removeEventListener('mousemove', handleMouseMove);
			canvasElement.removeEventListener('mouseup', handleMouseUp);
			canvasElement.removeEventListener('mouseleave', handleMouseLeave);
			document.removeEventListener('mousemove', handleMouseMove);
			document.removeEventListener('mouseup', handleMouseUp);
		};
	}, [selectedInstance]); // Only need to re-setup when canvas becomes available

	// Render loop (one-time setup)
	useEffect(() => {
		const render = () => {
			if (canvasRef.current) {
				renderCanvas();
			}
			animationFrameRef.current = requestAnimationFrame(render);
		};

		animationFrameRef.current = requestAnimationFrame(render);

		return () => {
			if (animationFrameRef.current) {
				cancelAnimationFrame(animationFrameRef.current);
			}
		};
	}, []); // No dependencies - render loop accesses current state via refs



	const loadSurfaceForceData = async () => {
		try {
			const response = await fetch(`${window.location.origin}/api/minimap/surfaces`);
			const data = await response.json();
			setSurfaceForceData(data);

			if (data.surfaces.length > 0 && !selectedSurface) {
				setSelectedSurface(data.surfaces.includes("nauvis") ? "nauvis" : data.surfaces[0]);
			}
			if (data.forces.length > 0 && !selectedForce) {
				setSelectedForce(data.forces.includes("player") ? "player" : data.forces[0]);
			}
		} catch (err) {
			console.error("Failed to load surface/force data:", err);
		}
	};

	// Load existing chart tags from disk
	const loadExistingChartTags = async () => {
		if (!selectedInstance || !selectedSurface || !selectedForce) {
			return;
		}

		try {
			const response = await control.send(new GetChartTagsRequest(
				selectedInstance,
				selectedSurface,
				selectedForce
			));

			if (response.chart_tags && response.chart_tags.length > 0) {
				// Convert to ChartTagDataWithInstance format
				const existingTags: ChartTagDataWithInstance[] = response.chart_tags.map((tag: ChartTagData) => ({
					...tag,
					instance_id: selectedInstance,
				}));

				// Replace existing tags with loaded ones
				setRawChartTags(existingTags);
				console.log(`Loaded ${existingTags.length} existing chart tags`);
			} else {
				// Clear tags if no existing data
				setRawChartTags([]);
			}
		} catch (err) {
			console.error("Failed to load existing chart tags:", err);
			// Don't clear tags on error, keep what we have
		}
	};

	// Load a tile from the server using raw tile data
	const loadTile = async (tileX: number, tileY: number): Promise<ImageData | null> => {
		// Get current state from ref
		const currentState = currentStateRef.current;

		// Early return if no instance is selected
		if (!currentState.selectedInstance) {
			return null;
		}

		const tileKey = `${tileX},${tileY}`;

		// Check tile state cache first
		if (tileStateCache.current.has(tileKey)) {
			const tileState = tileStateCache.current.get(tileKey)!;

			// Check if we need to update to current tick
			const targetTick = isTimelapseMode ? currentTick || 0 : tileState.parsedData.allTicks[tileState.parsedData.allTicks.length - 1] || 0;
			if (tileState.currentTick !== targetTick) {
				try {
					await renderTileIncremental(
						tileState.parsedData,
						tileState.pixels,
						tileState.currentTick,
						targetTick
					);
					tileState.currentTick = targetTick;
					tileState.imageData = pixelsToImageData(tileState.pixels);
				} catch (err) {
					console.error(`Failed to update tile ${tileKey} to tick ${targetTick}:`, err);
				}
			}

			return tileState.imageData;
		}

		// Check if we're already loading this tile
		if (loadingTiles.current.has(tileKey)) {
			return loadingTiles.current.get(tileKey)!;
		}

		// Start loading the tile
		const loadPromise = (async () => {
			try {
				// Load the raw tile data from server
				const response = await control.send(new GetRawTileRequest(
					currentState.selectedInstance!, // We already checked for null above
					currentState.selectedSurface,
					currentState.selectedForce,
					tileX,
					tileY,
					currentState.isTimelapseMode ? currentState.currentTick || undefined : undefined
				));

				if (!response.tile_data) {
					return null;
				}

				// Decode base64 tile data
				const binaryString = atob(response.tile_data);
				const tileData = new Uint8Array(binaryString.length);
				for (let i = 0; i < binaryString.length; i++) {
					tileData[i] = binaryString.charCodeAt(i);
				}

				// Parse the tile data into structured change records
				const parsedData = parseTileData(tileData);

				// Determine target tick
				const targetTick = isTimelapseMode ?
					(currentTick || 0) :
					(parsedData.allTicks[parsedData.allTicks.length - 1] || 0);

				// Render to target tick (undefined means latest for non-timelapse mode)
				const renderTick = isTimelapseMode ? targetTick : undefined;
				const pixels = await renderTileToPixels(tileData, renderTick);

				// Convert to ImageData
				const tileImageData = pixelsToImageData(pixels);

				// Create and cache the tile state
				const tileState: TileState = {
					currentTick: targetTick,
					pixels: pixels,
					parsedData: parsedData,
					imageData: tileImageData
				};
				tileStateCache.current.set(tileKey, tileState);

				// Extract and cache all chunks from this tile
				for (let cy = 0; cy < CHUNKS_PER_TILE; cy++) {
					for (let cx = 0; cx < CHUNKS_PER_TILE; cx++) {
						const actualChunkX = tileX * CHUNKS_PER_TILE + cx;
						const actualChunkY = tileY * CHUNKS_PER_TILE + cy;
						const actualChunkKey = `${actualChunkX},${actualChunkY}`;

						// Extract chunk area from the full tile ImageData
						const chunkData = new Uint8ClampedArray(CHUNK_SIZE * CHUNK_SIZE * 4);
						for (let y = 0; y < CHUNK_SIZE; y++) {
							for (let x = 0; x < CHUNK_SIZE; x++) {
								const tilePixelIndex = ((cy * CHUNK_SIZE + y) * TILE_SIZE + (cx * CHUNK_SIZE + x)) * 4;
								const chunkPixelIndex = (y * CHUNK_SIZE + x) * 4;

								chunkData[chunkPixelIndex] = tileImageData.data[tilePixelIndex];         // R
								chunkData[chunkPixelIndex + 1] = tileImageData.data[tilePixelIndex + 1]; // G
								chunkData[chunkPixelIndex + 2] = tileImageData.data[tilePixelIndex + 2]; // B
								chunkData[chunkPixelIndex + 3] = tileImageData.data[tilePixelIndex + 3]; // A
							}
						}

						const chunkImageData = new ImageData(chunkData, CHUNK_SIZE, CHUNK_SIZE);
						chunkCache.current.set(actualChunkKey, chunkImageData);
					}
				}

				return tileImageData;
			} catch (err) {
				console.error(`Failed to load tile ${tileX},${tileY}:`, err);
				return null;
			} finally {
				// Remove from loading cache when done
				loadingTiles.current.delete(tileKey);
			}
		})();

		// Cache the loading promise
		loadingTiles.current.set(tileKey, loadPromise);

		return loadPromise;
	};

	// Update a single chunk (for live updates) - directly modify the virtual tile in memory
	const updateChunk = useCallback((chunkX: number, chunkY: number, imageData: ImageData) => {
		const chunkKey = `${chunkX},${chunkY}`;
		chunkCache.current.set(chunkKey, imageData);

		// Calculate which tile contains this chunk
		const tileX = Math.floor(chunkX / CHUNKS_PER_TILE);
		const tileY = Math.floor(chunkY / CHUNKS_PER_TILE);
		const tileKey = `${tileX},${tileY}`;

		// Calculate position within the tile
		const localChunkX = ((chunkX % CHUNKS_PER_TILE) + CHUNKS_PER_TILE) % CHUNKS_PER_TILE;
		const localChunkY = ((chunkY % CHUNKS_PER_TILE) + CHUNKS_PER_TILE) % CHUNKS_PER_TILE;
		const pixelX = localChunkX * CHUNK_SIZE;
		const pixelY = localChunkY * CHUNK_SIZE;

		// Update the virtual tile directly if it exists
		const virtualTile = virtualTiles.current.get(tileKey);
		if (virtualTile) {
			const ctx = virtualTile.getContext('2d')!;
			ctx.putImageData(imageData, pixelX, pixelY);
		}

		// Update the tile state if it exists
		const tileState = tileStateCache.current.get(tileKey);
		if (tileState) {
			// Update the tile ImageData directly
			const tileData = tileState.imageData.data;
			const chunkData = imageData.data;

			for (let y = 0; y < CHUNK_SIZE; y++) {
				for (let x = 0; x < CHUNK_SIZE; x++) {
					const chunkIndex = (y * CHUNK_SIZE + x) * 4;
					const tileIndex = ((pixelY + y) * TILE_SIZE + (pixelX + x)) * 4;

					tileData[tileIndex] = chunkData[chunkIndex];         // R
					tileData[tileIndex + 1] = chunkData[chunkIndex + 1]; // G
					tileData[tileIndex + 2] = chunkData[chunkIndex + 2]; // B
					tileData[tileIndex + 3] = chunkData[chunkIndex + 3]; // A
				}
			}
		}
	}, []);

	// Get or create a virtual tile
	const getVirtualTile = async (tileX: number, tileY: number): Promise<HTMLCanvasElement> => {
		// Get current state from ref
		const currentState = currentStateRef.current;

		// Don't create virtual tiles if no instance is selected
		if (!currentState.selectedInstance) {
			throw new Error("Cannot create virtual tile: no instance selected");
		}

		const tileKey = `${tileX},${tileY}`;

		if (virtualTiles.current.has(tileKey)) {
			return virtualTiles.current.get(tileKey)!;
		}

		// Create new virtual tile
		const virtualCanvas = document.createElement('canvas');
		virtualCanvas.width = TILE_SIZE;
		virtualCanvas.height = TILE_SIZE;
		const ctx = virtualCanvas.getContext('2d')!;

		// Always start with black background
		ctx.fillStyle = '#000000';
		ctx.fillRect(0, 0, TILE_SIZE, TILE_SIZE);

		// Load the entire tile at once (much more efficient than loading chunks individually)
		const [tileImageData, recipeImageData] = await Promise.all([
			loadTile(tileX, tileY),
			loadRecipeTile(tileX, tileY)
		]);

		if (tileImageData) {
			// Draw the entire tile directly to the virtual canvas
			ctx.putImageData(tileImageData, 0, 0);
		}

		virtualTiles.current.set(tileKey, virtualCanvas);
		return virtualCanvas;
	};

	// Render the canvas
	const renderCanvas = () => {
		const canvas = canvasRef.current;
		if (!canvas) return;

		// Get current state from ref to ensure consistency
		const currentState = currentStateRef.current;

		// Early return if no instance selected
		if (!currentState.selectedInstance) {
			// Draw dark background and return
			const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
			ctx.fillStyle = '#1a1a1a';
			ctx.fillRect(0, 0, canvas.width, canvas.height);
			return;
		}

		// Apply smooth WASD movement
		if (keysPressed.current.size > 0) {
			// Adjust base speed for 60fps
			const moveSpeed = 20 / viewStateRef.current.zoomLevel;
			let deltaX = 0;
			let deltaY = 0;

			// Calculate movement delta based on currently pressed keys
			if (keysPressed.current.has('w')) deltaY -= moveSpeed;
			if (keysPressed.current.has('s')) deltaY += moveSpeed;
			if (keysPressed.current.has('a')) deltaX -= moveSpeed;
			if (keysPressed.current.has('d')) deltaX += moveSpeed;

			// Reduce speed if moving diagonally
			if (deltaX !== 0 && deltaY !== 0) {
				deltaX *= 0.7071; // sqrt(2) / 2
				deltaY *= 0.7071;
			}

			// Apply movement if any keys are pressed
			if (deltaX !== 0 || deltaY !== 0) {
				updateViewState({
					centerX: viewStateRef.current.centerX + deltaX,
					centerY: viewStateRef.current.centerY + deltaY
				});
			}
		}

		const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
		ctx.imageSmoothingEnabled = false;

		// Get canvas dimensions
		const width = canvas.width;
		const height = canvas.height;

		// Clear canvas completely
		ctx.fillStyle = '#1a1a1a';
		ctx.fillRect(0, 0, width, height);

		// Calculate visible tiles using shared function
		const visibleTiles = calculateVisibleTiles();
		if (!visibleTiles) return;

		const { leftTile, topTile, rightTile, bottomTile, scale, worldLeft, worldTop } = visibleTiles;

		const scaledTileSize = TILE_SIZE * scale;
		const firstTileScreenX = Math.round((leftTile * TILE_SIZE - worldLeft) * scale);
		const firstTileScreenY = Math.round((topTile * TILE_SIZE - worldTop) * scale);

		// Pre-calculate all tile edge positions using exact integer steps
		const tileEdgesX: number[] = [];
		const tileEdgesY: number[] = [];

		// Build tile edges using clean integer arithmetic from the first tile position
		for (let i = 0; i <= (rightTile - leftTile + 1); i++) {
			tileEdgesX.push(firstTileScreenX + Math.round(i * scaledTileSize));
		}

		for (let i = 0; i <= (bottomTile - topTile + 1); i++) {
			tileEdgesY.push(firstTileScreenY + Math.round(i * scaledTileSize));
		}

		// Render visible tiles using the pre-calculated edge grid
		for (let tileY = topTile; tileY <= bottomTile; tileY++) {
			for (let tileX = leftTile; tileX <= rightTile; tileX++) {
				const tileKey = `${tileX},${tileY}`;
				const virtualTile = virtualTiles.current.get(tileKey);

				// Get tile position from pre-calculated edges
				const tileIndexX = tileX - leftTile;
				const tileIndexY = tileY - topTile;
				const screenX = tileEdgesX[tileIndexX];
				const screenY = tileEdgesY[tileIndexY];
				const screenWidth = tileEdgesX[tileIndexX + 1] - screenX;
				const screenHeight = tileEdgesY[tileIndexY + 1] - screenY;

				// Calculate clipping bounds to ensure we don't draw outside canvas
				const clippedX = Math.max(0, screenX);
				const clippedY = Math.max(0, screenY);
				const clippedWidth = Math.min(screenWidth, width - clippedX);
				const clippedHeight = Math.min(screenHeight, height - clippedY);

				// Skip if tile is completely outside canvas
				if (clippedWidth <= 0 || clippedHeight <= 0) {
					continue;
				}

				if (virtualTile) {
					// Tile is loaded, draw it with clipping
					ctx.imageSmoothingEnabled = false;

					// Round source coordinates to prevent subpixel sampling
					const rawSourceX = clippedX > screenX ? (clippedX - screenX) / scale : 0;
					const rawSourceY = clippedY > screenY ? (clippedY - screenY) / scale : 0;
					const rawSourceWidth = clippedWidth / scale;
					const rawSourceHeight = clippedHeight / scale;

					// Use clipped coordinates directly since screen coordinates are already rounded
					const destX = clippedX;
					const destY = clippedY;
					const destWidth = clippedWidth;
					const destHeight = clippedHeight;

					ctx.drawImage(
						virtualTile,
						rawSourceX, rawSourceY, rawSourceWidth, rawSourceHeight,
						destX, destY, destWidth, destHeight
					);
				} else {
					// Tile not loaded yet, draw black
					ctx.fillStyle = '#000000';
					ctx.fillRect(clippedX, clippedY, clippedWidth, clippedHeight);

					// Start loading the tile in the background (but don't wait for it)
					// Only attempt to load if we have all required parameters
					if (currentState.selectedInstance && currentState.selectedSurface && currentState.selectedForce) {
						getVirtualTile(tileX, tileY).then(() => {
							// When tile loads, trigger a re-render
							// But only if we're still looking at the same area
							const latestState = currentStateRef.current;
							if (latestState.selectedInstance && latestState.selectedSurface && latestState.selectedForce) {
								// Use a small delay to batch multiple tile loads
								setTimeout(() => {
									if (animationFrameRef.current) {
										// Render will happen on next animation frame anyway
									}
								}, 16);
							}
						}).catch(err => {
							console.error(`Failed to load tile ${tileX},${tileY}:`, err);
						});
					}
				}
			}
		}

		// Render chart tags if enabled
		if (currentState.showChartTags) {
			const visibleTags = getVisibleChartTags();

			ctx.save();
			ctx.textAlign = 'center';
			ctx.textBaseline = 'middle';
			ctx.font = `${Math.max(10, 12 / scale)}px Arial`;

			for (const tag of visibleTags) {
				// Convert world coordinates to screen coordinates
				const screenX = Math.round((tag.position[0] - worldLeft) * scale);
				const screenY = Math.round((tag.position[1] - worldTop) * scale);

				// Skip if tag is outside visible area
				if (screenX < -50 || screenX > width + 50 || screenY < -50 || screenY > height + 50) {
					continue;
				}

				// Constant tag size regardless of zoom level
				const tagSize = 16;
				const halfSize = tagSize / 2;

				const iconKey = signalToKey(tag.icon) || tag.text;
				if (iconKey) {
					drawIcon(ctx, screenX, screenY, iconKey, "screen");
				} else {
					ctx.fillStyle = tag.icon ? '#4CAF50' : '#2196F3';
					ctx.fillRect(screenX - halfSize, screenY - halfSize, tagSize, tagSize);
					ctx.strokeStyle = '#FFFFFF';
					ctx.lineWidth = 2;
					ctx.strokeRect(screenX - halfSize, screenY - halfSize, tagSize, tagSize);
				}

				// Draw tag text if zoom level is high enough
				if (scale > 0.5 && tag.text) {
					const fontSize = 12;
					ctx.font = `${fontSize}px Arial`;

					// Position text to the right of the square
					const textX = screenX + halfSize + 4; // 4px padding from square edge
					const textY = screenY; // Vertically centered with square

					// Draw text background
					const textMetrics = ctx.measureText(tag.text);
					const textWidth = textMetrics.width;
					const textHeight = fontSize;
					const textPadding = 2;

					ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
					ctx.fillRect(
						textX - textPadding,
						textY - textHeight / 2 - textPadding,
						textWidth + textPadding * 2,
						textHeight + textPadding * 2
					);

					// Draw text
					ctx.fillStyle = '#FFFFFF';
					ctx.textAlign = 'left'; // Align text to start from the left edge
					ctx.fillText(tag.text, textX, textY);
					ctx.textAlign = 'center'; // Reset for next iteration
				}
			}

			ctx.restore();
		}

		// Render recipe icons
		if (currentState.showRecipes) {
			ctx.save();
			for (const [coord, recName] of recipeCache.current) {
				const [rx, ry] = coord.split(',').map(Number);
				const screenX = Math.round((rx - worldLeft) * scale);
				const screenY = Math.round((ry - worldTop) * scale);
				if (screenX < -30 || screenX > width + 30 || screenY < -30 || screenY > height + 30) continue;
				const iconKey = recName.startsWith('item-') || recName.startsWith('fluid-') ? recName : signalToKey({ type: 'item', name: recName });
				drawIcon(ctx, screenX, screenY, iconKey || recName, "world");
			}
			ctx.restore();
		}
	};

	// Handle canvas resize (one-time setup)
	useEffect(() => {
		const handleResize = () => {
			const canvas = canvasRef.current;
			const container = containerRef.current;
			if (!canvas || !container) return;

			// Use ResizeObserver for more accurate container size tracking
			const rect = container.getBoundingClientRect();

			// Set canvas size to match container (simple 1:1 ratio)
			canvas.width = rect.width;
			canvas.height = rect.height;
		};

		// Defer initial resize to ensure layout is complete
		const timeoutId = setTimeout(handleResize, 0);

		// Set up ResizeObserver for container size changes
		const container = containerRef.current;
		if (container && 'ResizeObserver' in window) {
			const resizeObserver = new ResizeObserver(handleResize);
			resizeObserver.observe(container);

			// Also listen to window resize as fallback
			window.addEventListener('resize', handleResize);

			return () => {
				clearTimeout(timeoutId);
				resizeObserver.disconnect();
				window.removeEventListener('resize', handleResize);
			};
		} else {
			// Fallback for browsers without ResizeObserver
			window.addEventListener('resize', handleResize);
			return () => {
				clearTimeout(timeoutId);
				window.removeEventListener('resize', handleResize);
			};
		}
	}, []);

	// Ensure proper canvas sizing when instance selection changes
	useEffect(() => {
		if (selectedInstance) {
			// Force a resize check when instance becomes available
			const canvas = canvasRef.current;
			const container = containerRef.current;
			if (canvas && container) {
				const rect = container.getBoundingClientRect();
				canvas.width = rect.width;
				canvas.height = rect.height;
			}
		}
	}, [selectedInstance]);

	// Reset view when instance changes and snap to pixel-perfect zoom
	useEffect(() => {
		if (selectedInstance) {
			// Reset to center view with default zoom when switching instances
			updateViewState({
				centerX: 0,
				centerY: 0,
				zoomLevel: getClosestZoomLevel(1), // Snap to nearest pixel-perfect zoom
			});

			// Clear caches when switching instances
			virtualTiles.current.clear();
			tileStateCache.current.clear();
			chunkCache.current.clear();
			loadingTiles.current.clear();
			recipeCache.current.clear();
		}
	}, [selectedInstance]);

	// Reload ticks when instance, surface, force changes or timelapse mode toggles
	useEffect(() => {
		if (isTimelapseMode && selectedInstance && selectedSurface && selectedForce) {
			// Debounce the reload to avoid too many requests during navigation
			const timeoutId = setTimeout(async () => {
				// Ensure chart tags are loaded before getting available ticks
				await loadExistingChartTags();
				await loadAvailableTicks();
			}, 500);

			return () => clearTimeout(timeoutId);
		}
	}, [selectedInstance, selectedSurface, selectedForce, isTimelapseMode]);

	// Load existing chart tags when instance/surface/force selection changes
	useEffect(() => {
		if (selectedInstance && selectedSurface && selectedForce) {
			loadExistingChartTags();
		} else {
			// Clear chart tags if no valid selection
			setRawChartTags([]);
		}
	}, [selectedInstance, selectedSurface, selectedForce]);

	// Snap current zoom level to nearest pixel-perfect level on mount
	useEffect(() => {
		updateViewState({
			zoomLevel: getClosestZoomLevel(viewStateRef.current.zoomLevel)
		});

		// Cleanup throttled zoom update on unmount
		return () => {
			if (throttledZoomUpdate.current) {
				clearTimeout(throttledZoomUpdate.current);
			}
		};
	}, []);

	// Get visible chart tags based on current state
	const getVisibleChartTags = useCallback(() => {
		// Use the same ref state that the render function uses for consistency
		const currentState = currentStateRef.current;

		if (!currentState.selectedInstance || !currentState.showChartTags) {
			return [];
		}

		return currentState.mergedChartTags.filter((tag: MergedChartTag) => {
			// Filter by instance, surface, and force
			if (tag.instance_id !== currentState.selectedInstance ||
				tag.surface !== currentState.selectedSurface ||
				tag.force !== currentState.selectedForce) {
				return false;
			}

			// Filter by tick range (both in timelapse and live mode)
			if (currentState.isTimelapseMode && currentState.currentTick !== null) {
				// In timelapse mode, filter by current tick
				// Tag is visible if it started before or at current tick and hasn't ended yet
				if (tag.start_tick !== undefined && tag.start_tick > currentState.currentTick) {
					return false;
				}
				if (tag.end_tick !== undefined && tag.end_tick <= currentState.currentTick) {
					return false;
				}
			} else {
				// In live mode, only hide tags that have been deleted (have an end_tick)
				if (tag.end_tick !== undefined) {
					return false;
				}
			}

			return true;
		});
	}, []);

	// Set up live chunk update listener (only in live mode)
	useEffect(() => {
		const plugin = control.plugins.get("minimap") as import("./index").WebPlugin;
		if (!plugin) {
			console.error("Minimap plugin not found");
			return;
		}

		const handleChunkUpdate = (event: TileDataEvent) => {
			const currentState = currentStateRef.current;
			// Only process updates for the currently selected instance/surface/force
			if (event.instance_id === currentState.selectedInstance &&
				event.surface === currentState.selectedSurface &&
				event.force === currentState.selectedForce &&
				!currentState.isTimelapseMode) {

				try {
					// Calculate chunk coordinates from world coordinates
					const chunkX = Math.floor(event.x / 32);
					const chunkY = Math.floor(event.y / 32);

					// Convert raw chart data to ImageData
					chartDataToImageData(event.chunk.chart_data).then(imageData => {
						// Update the chunk in our cache
						updateChunk(chunkX, chunkY, imageData);
					}).catch(err => {
						console.error("Failed to convert chart data to ImageData:", err);
					});
				} catch (err) {
					console.error("Failed to process live chunk update:", err);
				}
			}
		};

		const handleChartTagUpdate = (event: ChartTagDataEvent) => {
			const currentState = currentStateRef.current;
			// Only process updates for the currently selected instance/surface/force
			if (event.instance_id === currentState.selectedInstance &&
				event.tag_data.surface === currentState.selectedSurface &&
				event.tag_data.force === currentState.selectedForce) {

				// Add the new chart tag data to our collection
				const newTagData: ChartTagDataWithInstance = {
					...event.tag_data,
					instance_id: event.instance_id,
				};

				setRawChartTags(prevTags => {
					// Check if we already have this tag (by tag_number and instance)
					const existingIndex = prevTags.findIndex(tag =>
						tag.tag_number === newTagData.tag_number &&
						tag.instance_id === newTagData.instance_id &&
						tag.surface === newTagData.surface &&
						tag.force === newTagData.force
					);

					if (existingIndex >= 0) {
						// Update existing tag
						const newTags = [...prevTags];
						newTags[existingIndex] = newTagData;
						return newTags;
					} else {
						// Add new tag
						return [...prevTags, newTagData];
					}
				});
			}
		};

		// Subscribe to update events through the plugin
		plugin.onTileUpdate(handleChunkUpdate);
		plugin.onChartTagUpdate(handleChartTagUpdate);

		return () => {
			plugin.offTileUpdate(handleChunkUpdate);
			plugin.offChartTagUpdate(handleChartTagUpdate);
		};
	}, [updateChunk, control]);

	// Helper to draw recipe icon (placeholder)
	type IconSpace = "screen" | "world"; // screen = constant pixel size, world = scales with zoom

	const drawIcon = (
		ctx: CanvasRenderingContext2D,
		x: number,
		y: number,
		iconName: string,
		space: IconSpace = "screen",
	) => {
		const zoom = viewStateRef.current.zoomLevel;

		// Size calculation depending on desired behaviour
		let size: number;
		if (space === "screen") {
			// Keep a readable size regardless of zoom (chart tags)
			size = 16;
		} else {
			// Keep size constant relative to the world – grows/shrinks with zoom (recipe icons)
			// 6 world-pixels wide at zoom 1 feels about right with some overdraw to make it more visible
			size = 6 * zoom;
			// Clamp so icons don't disappear completely at extreme zoom-outs
			if (size < 4) size = 4;
		}

		const half = size / 2;

		const canvas = getIconCanvas(iconName);
		if (canvas) {
			ctx.drawImage(canvas, x - half, y - half, size, size);
			return;
		}

		// Fallback placeholder if icon missing
		ctx.fillStyle = "#FFD700";
		ctx.fillRect(x - half, y - half, size, size);
	};

	// Function to load recipe tile
	const loadRecipeTile = async (tileX: number, tileY: number) => {
		const cs = currentStateRef.current;
		if (!cs.selectedInstance) return;
		try {
			const resp = await control.send(new GetRawRecipeTileRequest(
				cs.selectedInstance, cs.selectedSurface, cs.selectedForce, tileX, tileY
			));
			if (!resp.recipe_tile) return;
			const text = atob(resp.recipe_tile);
			const lines = text.trim().split('\n').filter(l => l.trim());
			for (const line of lines) {
				try {
					const rec = JSON.parse(line);
					const key = `${rec.position[0]},${rec.position[1]}`;
					// Timelapse filter
					if (cs.isTimelapseMode && cs.currentTick !== null) {
						const t = cs.currentTick;
						if (rec.start_tick !== undefined && rec.start_tick > t) continue;
						if (rec.end_tick !== undefined && rec.end_tick <= t) { recipeCache.current.delete(key); continue; }
					} else {
						if (rec.end_tick !== undefined) { recipeCache.current.delete(key); continue; }
					}
					if (rec.recipe) { recipeCache.current.set(key, rec.recipe); }
				} catch { }
			}
		} catch (e) { console.warn('loadRecipeTile', e); }
	};

	// Live recipe update handler
	const handleRecipeUpdate = (event: RecipeDataEvent) => {
		const cs = currentStateRef.current;
		if (event.instance_id !== cs.selectedInstance || event.recipe_data.surface !== cs.selectedSurface || event.recipe_data.force !== cs.selectedForce) return;
		// Handle recipe end events: remove icon if recipe interval finished
		if (event.recipe_data.end_tick !== undefined) {
			const endKey = `${event.recipe_data.position[0]},${event.recipe_data.position[1]}`;
			recipeCache.current.delete(endKey);
			return;
		}
		const key = `${event.recipe_data.position[0]},${event.recipe_data.position[1]}`;
		let iconKey: string;
		if ((event.recipe_data as any).icon) {
			const sigKey = signalToKey((event.recipe_data as any).icon);
			iconKey = sigKey ?? `item-${event.recipe_data.recipe ?? "unknown"}`;
		} else {
			iconKey = `item-${event.recipe_data.recipe ?? "unknown"}`;
		}
		recipeCache.current.set(key, iconKey);
	};

	// Subscribe to updates (tile, tag, recipe) once plugin is available
	useEffect(() => {
		const plugin = control.plugins.get("minimap") as import("./index").WebPlugin;
		if (!plugin) return;

		plugin.onRecipeUpdate(handleRecipeUpdate);
		return () => { plugin.offRecipeUpdate(handleRecipeUpdate); };
	}, [control]);

	// Reload recipe overlay when timeline tick changes
	useEffect(() => {
		if (isTimelapseMode && currentTick !== null && showRecipes) {
			// Clear existing icons
			recipeCache.current.clear();

			const visible = calculateVisibleTiles();
			if (!visible) return;

			const { leftTile, topTile, rightTile, bottomTile } = visible;
			for (let ty = topTile; ty <= bottomTile; ty++) {
				for (let tx = leftTile; tx <= rightTile; tx++) {
					loadRecipeTile(tx, ty);
				}
			}
		}
	}, [currentTick, isTimelapseMode, showRecipes]);

	return (
		<div style={{ padding: "20px" }}>
			<Row gutter={[16, 16]}>
				<Col span={24}>
					<Card
						title="Factorio Instance Minimap"
						extra={
							<Space wrap>
								<Select
									style={{ width: 200 }}
									placeholder="Select instance"
									value={selectedInstance}
									onChange={setSelectedInstance}
									loading={loading}
									options={[...instances.values()].map(instance => ({
										value: instance.id,
										label: instance.name
									}))}
								/>
								<Select
									style={{ width: 150 }}
									placeholder="Select surface"
									value={selectedSurface}
									onChange={setSelectedSurface}
								>
									{surfaceForceData.surfaces.map(surface => (
										<Select.Option key={surface} value={surface}>
											{surface}
										</Select.Option>
									))}
								</Select>
								<Select
									style={{ width: 150 }}
									placeholder="Select force"
									value={selectedForce}
									onChange={setSelectedForce}
								>
									{surfaceForceData.forces.map(force => (
										<Select.Option key={force} value={force}>
											{force}
										</Select.Option>
									))}
								</Select>
								<Space direction="vertical" size="small">
									<Space>
										<Text strong>Timelapse:</Text>
										<Switch
											checked={isTimelapseMode}
											onChange={toggleTimelapseMode}
											loading={loading}
										/>
										{isTimelapseMode && (
											<Text type="secondary">
												{availableTicks.length} snapshots
											</Text>
										)}
									</Space>
									<Space>
										<Text strong>Chart Tags:</Text>
										<Switch
											checked={showChartTags}
											onChange={setShowChartTags}
										/>
										{showChartTags && (
											<Text type="secondary">
												{getVisibleChartTags().length} visible
											</Text>
										)}
									</Space>
									<Space>
										<Text strong>Recipes:</Text>
										<Switch checked={showRecipes} onChange={setShowRecipes} />
										{showRecipes && (
											<Text type="secondary">{recipeCache.current.size} active</Text>
										)}
									</Space>
								</Space>
							</Space>
						}
					>
						{selectedInstance ? (
							<div>
								{isTimelapseMode && availableTicks.length > 0 && (
									<div style={{ marginBottom: "16px", padding: "12px", border: "1px solid rgba(255, 255, 255, 0.15)", borderRadius: "6px" }}>
										<Space direction="vertical" style={{ width: "100%" }}>
											<Space wrap>
												<Button
													onClick={stepBackward}
													disabled={availableTicks.findIndex(tick => tick === currentTick) <= 0}
													size="small"
												>
													◀◀ Step Back
												</Button>
												<Button
													onClick={togglePlayback}
													type={isPlaying ? "primary" : "default"}
													size="small"
												>
													{isPlaying ? "⏸ Pause" : "▶ Play"}
												</Button>
												<Button
													onClick={stepForward}
													disabled={availableTicks.findIndex(tick => tick === currentTick) >= availableTicks.length - 1}
													size="small"
												>
													Step Forward ▶▶
												</Button>
												<Space>
													<Text strong>Speed:</Text>
													<Select
														value={playbackSpeed}
														onChange={setPlaybackSpeed}
														size="small"
														style={{ width: 80 }}
													>
														<Select.Option value={0.25}>0.25x</Select.Option>
														<Select.Option value={0.5}>0.5x</Select.Option>
														<Select.Option value={1}>1x</Select.Option>
														<Select.Option value={2}>2x</Select.Option>
														<Select.Option value={4}>4x</Select.Option>
													</Select>
												</Space>
											</Space>
											<div>
												<Text strong>Timeline: </Text>
												<Text>
													{currentTick ? formatTickTime(currentTick) : "No data"}
												</Text>
												<div style={{ marginTop: "4px", fontSize: "12px", color: "#666" }}>
													<Text type="secondary">
														{availableTicks.length} total timestamps
													</Text>
												</div>
												<Slider
													min={0}
													max={availableTicks.length - 1}
													value={availableTicks.findIndex(tick => tick === currentTick)}
													onChange={async (value) => await stepToTick(value)}
													style={{ marginTop: "8px" }}
													tooltip={{
														formatter: (value) => {
															if (value !== undefined && availableTicks[value]) {
																return formatTickTime(availableTicks[value]);
															}
															return "";
														}
													}}
												/>
											</div>
										</Space>
									</div>
								)}
								<div style={{ marginBottom: "10px", fontSize: "14px", color: "#666" }}>
									Use WASD to move, click and drag to pan, +/- or scroll wheel to zoom. Current zoom: {displayZoom}x
									{isTimelapseMode && (
										<span style={{ marginLeft: "16px", color: "#1890ff" }}>
											📹 Timelapse Mode {currentTick ? `- ${formatTickTime(currentTick)}` : ""} (F/G to step through timeline)
										</span>
									)}
								</div>
								<div
									ref={containerRef}
									style={{
										height: "calc(100vh - 300px)", // Dynamic height based on viewport
										minHeight: "500px",
										width: "100%",
										border: "1px solid #d9d9d9",
										borderRadius: "6px",
										overflow: "hidden",
										position: "relative",
									}}
								>
									<canvas
										ref={canvasRef}
										style={{
											display: "block",
											cursor: "grab", // Initial cursor, updated by updateCursor helper
											width: "100%",
											height: "100%",
										}}
										tabIndex={0}
									/>
								</div>
							</div>
						) : (
							<div
								style={{
									height: "400px",
									display: "flex",
									alignItems: "center",
									justifyContent: "center",
									backgroundColor: "#f5f5f5",
									border: "1px dashed #d9d9d9",
									borderRadius: "6px",
								}}
							>
								<div style={{ textAlign: "center" }}>
									<h3>No Instance Selected</h3>
									<p>Select a running instance to view its minimap</p>
								</div>
							</div>
						)}
					</Card>
				</Col>
			</Row>
		</div>
	);
}
