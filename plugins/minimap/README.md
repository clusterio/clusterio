# Clusterio Minimap Plugin

A Clusterio plugin that provides interactive minimaps of Factorio instances with real-time tile and entity data visualization.

## Features
- Live updating terrain map in web UI
- Recipe overlay showing active crafting machines
- Timelapse mode for viewing historical changes
- Chart tag visualization and management
- Per instance, force and surface support
- Works when instances are offline

## Documentation

- **[Tile Data Storage](./docs/tile_data_storage.md)** - Binary format for terrain visualization data
- **[Recipe Overlay](./docs/minimap_recipe_overlay.md)** - Compact storage for crafting machine recipes

## Architecture Overview

The plugin consists of three main data streams:

### Terrain Data
- Factorio sends RGB565 data for 32×32 chunks  
- Controller queues chunks and generates incremental pixel changes
- Data stored in append-only `.bin` files for efficient timelapse replay
- Web UI renders live updates and historical data

### Recipe Data  
- Tracks which recipe each crafting machine is running
- Compact binary format with per-tile dictionaries (~8x smaller than JSON)
- Live streaming of recipe changes with timeline support

### Chart Tags
- User-created map markers with text and icons
- JSONL storage format for simplicity
- Real-time synchronization across all connected clients

## Usage

Access the minimap through the Clusterio web interface. Select an instance to view its terrain, toggle recipe overlays, enable chart tags, or switch to timelapse mode to review historical changes.
