# Clusterio Minimap Plugin

A Clusterio plugin that provides interactive minimaps of Factorio instances with real-time tile and entity data visualization.

## Features
- Live updating map in web UI
- Map per instance, force and surface - also available when instance is offline

## Implementation

The flow is roughly:
- Factorio sends rgb565 of a 32x32 chunk
- The controller adds the chunk to the chunk saving queue for its tile
- The chunk is broadcast to all web clients viewing the map to allow live updates

Tile saving has a separate flow:
- The tile is opened and processed to the current time
- For each chunk in saving queue:
  - Calculate changed pixels. If there are any, append a pixel change with tick information to the tile file
- If any changes are made, save tile

When a user opens the map:
- All visible tiles are requested from the server with either a specific tick or latest
- The server sends the last tile file saved before the specified tick
- The web client parses each tile file and replays changes up to the specified tick
- Broadcasted chunks are overlayed on top of the tile files in memory directly when in live mode

### File formats

Map colors in factorio are stored as rgb565 internally in the engine. That is 5 bits for red, 6 bits for green, 5 bits for blue.

From factorio we are sending 32x32x2 byte pixels encoded with encode_string() which applies deflate and base64.

From the controller we are sending either chunks with live updates or larger tiles with 8x8 chunks.

The tile format is as follows:
- 1 byte: Type identifier
  - 1 = chunk
  - 2 = pixels

For chunk:
- 4 byte: math.floor(tick / 60)
- 4 bits: chunk relative X coordinate
- 4 bits: chunk relative Y coordinate
- 2 byte: length, number of data bytes
- n bytes of 32x32 rgb565, with deflate compression

Type 1 chunks are assumed to only occur upon first exploration - further changes usually happen as individual pixels. For that reason, there is no rewind information tied to chunks, and they revert to black when rewinded.

For pixels:
- 4 byte: math.floor(tick / 60)
- 2 byte: length, number of pixels
- Each pixel:
  - 1 byte X coordinate
  - 1 byte Y coordinate
  - 2 bytes for new rgb565 value
  - 2 bytes for previous rgb565 value (used for fast rewinding in timeline)

Multiple subsequent chunk/pixel blocks can appear with the same tick, although they should be merged to save space if possible.

Tiles are compressed with deflate and base64 encoded to fit in json payloads.
