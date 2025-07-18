import React, { useState, useEffect, useContext, useRef, useCallback } from "react";
import { Row, Col, Button, Card, Space, Select, Switch, Slider, Typography, Tooltip } from "antd";
import { ControlContext } from "@clusterio/web_ui";
import { GetInstanceBoundsRequest, GetRawTileRequest, TileDataEvent } from "../messages";
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

interface Instance {
	instanceId: number;
	name: string;
	bounds: {
		x1: number;
		y1: number;
		x2: number;
		y2: number;
	};
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
	const [instances, setInstances] = useState<Instance[]>([]);
	const [selectedInstance, setSelectedInstance] = useState<number | null>(null);
	const [selectedSurface, setSelectedSurface] = useState<string>("nauvis");
	const [selectedForce, setSelectedForce] = useState<string>("player");
	const [surfaceForceData, setSurfaceForceData] = useState<SurfaceForceData>({ surfaces: [], forces: [] });
	const [loading, setLoading] = useState(false);
	const [viewState, setViewState] = useState<ViewState>({
		centerX: 0,
		centerY: 0,
		zoomLevel: 1,
	});
	const [resizeCounter, setResizeCounter] = useState(0);

	// Mouse drag state for panning (for cursor display only)
	const [isDragging, setIsDragging] = useState(false);

	// Timelapse state
	const [isTimelapseMode, setIsTimelapseMode] = useState(false);
	const [availableTicks, setAvailableTicks] = useState<number[]>([]);
	const [currentTick, setCurrentTick] = useState<number | null>(null);
	const [isPlaying, setIsPlaying] = useState(false);
	const [playbackSpeed, setPlaybackSpeed] = useState(1);

	// Canvas refs
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const containerRef = useRef<HTMLDivElement>(null);

	// Virtual tile storage - maps "tileX,tileY" to canvas element
	const virtualTiles = useRef<Map<string, HTMLCanvasElement>>(new Map());

	// Tile state cache - maps "tileX,tileY" to TileState for efficient timelapse navigation
	const tileStateCache = useRef<Map<string, TileState>>(new Map());

	// Chunk cache - maps "chunkX,chunkY" to ImageData
	const chunkCache = useRef<Map<string, ImageData>>(new Map());

	// Loading state cache - prevents duplicate API calls for the same tile
	const loadingTiles = useRef<Map<string, Promise<ImageData | null>>>(new Map());

	// Animation frame for smooth rendering
	const animationFrameRef = useRef<number>();

	// Refs for drag state to avoid re-attaching event listeners
	const isDraggingRef = useRef<boolean>(false);
	const lastMousePosRef = useRef<{ x: number; y: number } | null>(null);

	// Refs for tracking pressed movement keys for smooth movement at 60fps
	const keysPressed = useRef<Set<string>>(new Set());

	// Timelapse playback timer ref
	const playbackTimerRef = useRef<NodeJS.Timeout>();

	const control = useContext(ControlContext);

	// Calculate which tiles are visible based on current view state
	const calculateVisibleTiles = () => {
		const canvas = canvasRef.current;
		if (!canvas) return null;

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
		if (!selectedInstance) return;

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
							console.log(`Tile ${tileX},${tileY}: Found ${ticks.length} ticks:`, ticks);
							
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
			await loadAvailableTicks();
		} else {
			setCurrentTick(null);
		}
		
		// Clear caches when switching modes
		virtualTiles.current.clear();
		tileStateCache.current.clear();
		chunkCache.current.clear();
		loadingTiles.current.clear();
	};

	const stepToTick = async (tickIndex: number) => {
		if (tickIndex >= 0 && tickIndex < availableTicks.length) {
			const newTick = availableTicks[tickIndex];
			const oldTick = currentTick;
			
			if (oldTick === newTick) {
				return; // No change needed
			}
			
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
		const currentIndex = availableTicks.findIndex(tick => tick === currentTick);
		if (currentIndex >= 0 && currentIndex < availableTicks.length - 1) {
			await stepToTick(currentIndex + 1);
		}
	};

	const stepBackward = async () => {
		const currentIndex = availableTicks.findIndex(tick => tick === currentTick);
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
				const currentIndex = availableTicks.findIndex(tick => tick === currentTick);
				if (currentIndex >= 0 && currentIndex < availableTicks.length - 1) {
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

	// Load instance bounds on component mount
	useEffect(() => {
		loadInstances();
		loadSurfaceForceData();
	}, []);

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

	// Set up keyboard and mouse event listeners
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
					setViewState(prev => ({
						...prev,
						zoomLevel: getNextZoomLevel(prev.zoomLevel, 'up')
					}));
					e.preventDefault(); // Prevent browser zoom
					break;
				case '-':
				case '_': // Handle both - and _ key (since _ requires shift)
					setViewState(prev => ({
						...prev,
						zoomLevel: getNextZoomLevel(prev.zoomLevel, 'down')
					}));
					e.preventDefault(); // Prevent browser zoom
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
			const newZoom = getNextZoomLevel(viewState.zoomLevel, direction);

			setViewState(prev => ({ ...prev, zoomLevel: newZoom }));
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
	}, [viewState.zoomLevel]);

	// Mouse event handlers for click and drag panning
	useEffect(() => {
		const canvasElement = canvasRef.current;
		
		if (!canvasElement) {
			return;
		}

		const handleMouseDown = (e: MouseEvent) => {
			if (e.button === 0) { // Left mouse button
				isDraggingRef.current = true;
				lastMousePosRef.current = { x: e.clientX, y: e.clientY };
				setIsDragging(true); // Update state for cursor change
				e.preventDefault();
			}
		};

		const handleMouseMove = (e: MouseEvent) => {
			if (isDraggingRef.current && lastMousePosRef.current) {
				const deltaX = e.clientX - lastMousePosRef.current.x;
				const deltaY = e.clientY - lastMousePosRef.current.y;

				// Convert screen delta to world delta (invert because dragging right should move view left)
				const worldDeltaX = -deltaX / viewState.zoomLevel;
				const worldDeltaY = -deltaY / viewState.zoomLevel;

				setViewState(prev => ({
					...prev,
					centerX: prev.centerX + worldDeltaX,
					centerY: prev.centerY + worldDeltaY
				}));

				lastMousePosRef.current = { x: e.clientX, y: e.clientY };
			}
		};

		const handleMouseUp = (e: MouseEvent) => {
			if (e.button === 0) { // Left mouse button
				isDraggingRef.current = false;
				lastMousePosRef.current = null;
				setIsDragging(false); // Update state for cursor change
			}
		};

		const handleMouseLeave = () => {
			// Stop dragging if mouse leaves canvas
			isDraggingRef.current = false;
			lastMousePosRef.current = null;
			setIsDragging(false); // Update state for cursor change
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
	}, [viewState.zoomLevel, selectedInstance]); // Add selectedInstance to trigger setup when canvas becomes available

	// Render loop
	useEffect(() => {
		const render = () => {
			if (canvasRef.current && selectedInstance) {
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
	}, [selectedInstance, selectedSurface, selectedForce, viewState, resizeCounter, currentTick, isTimelapseMode]);

	const loadInstances = async () => {
		try {
			setLoading(true);
			const response = await control.send(new GetInstanceBoundsRequest());
			setInstances(response.instances);

			if (response.instances.length > 0 && !selectedInstance) {
				setSelectedInstance(response.instances[0].instanceId);
			}
		} catch (err) {
			console.error("Failed to load instances:", err);
		} finally {
			setLoading(false);
		}
	};

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

	// Load a tile from the server using raw tile data
	const loadTile = async (tileX: number, tileY: number): Promise<ImageData | null> => {
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
					selectedInstance!,
					selectedSurface,
					selectedForce,
					tileX,
					tileY,
					isTimelapseMode ? currentTick || undefined : undefined
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
		const tileImageData = await loadTile(tileX, tileY);

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

		// Apply smooth WASD movement
		if (keysPressed.current.size > 0) {
			// Adjust base speed for 60fps
			const moveSpeed = 20 / viewState.zoomLevel;
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
				setViewState(prev => ({
					...prev,
					centerX: prev.centerX + deltaX,
					centerY: prev.centerY + deltaY
				}));
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
					getVirtualTile(tileX, tileY).then(() => {
						// When tile loads, trigger a re-render
						// But only if we're still looking at the same area
						if (selectedInstance && selectedSurface && selectedForce) {
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
	};

	// Handle canvas resize
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

			// Trigger re-render
			setResizeCounter(prev => prev + 1);
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
				setResizeCounter(prev => prev + 1);
			}
		}
	}, [selectedInstance]);

	// Reset view when instance changes and snap to pixel-perfect zoom
	useEffect(() => {
		if (selectedInstance) {
			const instanceData = instances.find(inst => inst.instanceId === selectedInstance);
			if (instanceData) {
				setViewState({
					centerX: (instanceData.bounds.x1 + instanceData.bounds.x2) / 2,
					centerY: (instanceData.bounds.y1 + instanceData.bounds.y2) / 2,
					zoomLevel: getClosestZoomLevel(1), // Snap to nearest pixel-perfect zoom
				});
			}

			// Clear caches when switching instances
			virtualTiles.current.clear();
			tileStateCache.current.clear();
			chunkCache.current.clear();
			loadingTiles.current.clear();
		}
	}, [selectedInstance, instances]);

	// Reload ticks when instance, surface, force, or view changes
	useEffect(() => {
		if (isTimelapseMode && selectedInstance && selectedSurface && selectedForce) {
			// Debounce the reload to avoid too many requests during navigation
			const timeoutId = setTimeout(() => {
				loadAvailableTicks();
			}, 500);
			
			return () => clearTimeout(timeoutId);
		}
	}, [selectedInstance, selectedSurface, selectedForce, isTimelapseMode, viewState.centerX, viewState.centerY, viewState.zoomLevel]);

	// Snap current zoom level to nearest pixel-perfect level on mount
	useEffect(() => {
		setViewState(prev => ({
			...prev,
			zoomLevel: getClosestZoomLevel(prev.zoomLevel)
		}));
	}, []);

	// Set up live chunk update listener (only in live mode)
	useEffect(() => {
		if (!selectedInstance || !selectedSurface || !selectedForce || isTimelapseMode) {
			return;
		}

		const plugin = control.plugins.get("minimap") as import("./index").WebPlugin;
		if (!plugin) {
			console.error("Minimap plugin not found");
			return;
		}

		const handleChunkUpdate = (event: TileDataEvent) => {
			// Only process updates for the currently selected instance/surface/force
			if (event.instance_id === selectedInstance &&
				event.surface === selectedSurface &&
				event.force === selectedForce) {

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

		// Subscribe to chunk update events through the plugin
		plugin.onTileUpdate(handleChunkUpdate);

		return () => {
			plugin.offTileUpdate(handleChunkUpdate);
		};
	}, [selectedInstance, selectedSurface, selectedForce, updateChunk, control, isTimelapseMode]);

	return (
		<div style={{ padding: "20px" }}>
			<Row gutter={[16, 16]}>
				<Col span={24}>
					<Card
						title="Factorio Instance Minimap (Canvas)"
						extra={
							<Space wrap>
								<Select
									style={{ width: 200 }}
									placeholder="Select instance"
									value={selectedInstance}
									onChange={setSelectedInstance}
									loading={loading}
								>
									{instances.map(instance => (
										<Select.Option key={instance.instanceId} value={instance.instanceId}>
											{instance.name}
										</Select.Option>
									))}
								</Select>
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
								<Button onClick={loadInstances} loading={loading}>
									Reload Instances
								</Button>
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
									Use WASD to move, click and drag to pan, +/- or scroll wheel to zoom. Current zoom: {viewState.zoomLevel}x
									{isTimelapseMode && (
										<span style={{ marginLeft: "16px", color: "#1890ff" }}>
											📹 Timelapse Mode {currentTick ? `- ${formatTickTime(currentTick)}` : ""}
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
											cursor: isDragging ? "grabbing" : "grab",
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
