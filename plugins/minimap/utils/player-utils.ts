import { BinaryData, sliceData, readUInt8, readUInt16BE, readUInt32BE, isNode } from "./parsing-utils";

/**
 * Parsed player position file data
 */
export interface ParsedPlayerPositions {
    /** Player name -> player ID mappings from SessionStart records */
    playerSessions: Map<string, number>;
    /** Maximum player ID found in the file */
    maxPlayerId: number;
    /** All position records in the file */
    positions: PlayerPositionRecord[];
}

export interface PlayerPositionRecord {
    type: number;
    playerId: number;
    // Position record fields
    tSec?: number;
    sec?: number;
    xTiles?: number;
    yTiles?: number;
    // Session record fields
    tMs?: number;
    playerName?: string;
}

export interface ParsedPlayerPos {
    name: string;
    x: number;
    y: number;
    sec: number;
}

/**
 * Parse binary player position file data
 * @param buf Binary player position data
 * @returns Parsed player position data with sessions and records
 */
export function parsePlayerPositionsBinary(buf: BinaryData): ParsedPlayerPositions {
	const playerSessions = new Map<string, number>();
	const positions: PlayerPositionRecord[] = [];
	let maxPlayerId = 0;
	let offset = 0;

	while (offset < buf.length) {
		if (offset + 1 > buf.length) { break; }

		const type = readUInt8(buf, offset);
		offset += 1;

		if (type === 0) {
			// Position record
			const result = parsePositionRecord(buf, offset);
			if (!result.success) { break; }

			const record: PlayerPositionRecord = {
				type: 0,
				playerId: result.playerId,
				tSec: result.tSec,
				sec: result.sec,
				xTiles: result.xTiles,
				yTiles: result.yTiles,
			};

			positions.push(record);
			if (result.playerId > maxPlayerId) {
				maxPlayerId = result.playerId;
			}
			offset = result.newOffset;

		} else if (type === 1) {
			// SessionStart record
			const result = parseSessionStartRecord(buf, offset);
			if (!result.success) { break; }

			const record: PlayerPositionRecord = {
				type: 1,
				playerId: result.playerId,
				tMs: result.tMs,
				playerName: result.playerName,
			};

			positions.push(record);
			playerSessions.set(result.playerName, result.playerId);
			if (result.playerId > maxPlayerId) {
				maxPlayerId = result.playerId;
			}
			offset = result.newOffset;

		} else if (type === 2) {
			// SessionEnd record
			const result = parseSessionEndRecord(buf, offset);
			if (!result.success) { break; }

			const record: PlayerPositionRecord = {
				type: 2,
				playerId: result.playerId,
				tMs: result.tMs,
			};

			positions.push(record);
			if (result.playerId > maxPlayerId) {
				maxPlayerId = result.playerId;
			}
			offset = result.newOffset;

		} else {
			// Unknown record type, can't continue parsing safely
			break;
		}
	}

	return { playerSessions, maxPlayerId, positions };
}

/**
 * Parse position record from player position file
 * @param buf The binary player position data
 * @param offset Current offset in the data
 * @returns Processing result with position data and new offset
 */
function parsePositionRecord(buf: BinaryData, offset: number): {
    success: boolean;
    newOffset: number;
    playerId: number;
    tSec: number;
    sec: number;
    xTiles: number;
    yTiles: number;
} {
	// Position record: 4 + 4 + 3 + 3 + 2 = 16 bytes
	if (offset + 16 > buf.length) {
		return { success: false, newOffset: offset, playerId: 0, tSec: 0, sec: 0, xTiles: 0, yTiles: 0 };
	}

	const tSec = readUInt32BE(buf, offset);
	offset += 4;
	const sec = readUInt32BE(buf, offset);
	offset += 4;

	// Read x_tiles (3 bytes, signed 24-bit)
	const xBytes = (readUInt8(buf, offset) << 16) | (readUInt8(buf, offset + 1) << 8) | readUInt8(buf, offset + 2);
	const xTiles = xBytes > 0x7FFFFF ? xBytes - 0x1000000 : xBytes; // Convert to signed
	offset += 3;

	// Read y_tiles (3 bytes, signed 24-bit)
	const yBytes = (readUInt8(buf, offset) << 16) | (readUInt8(buf, offset + 1) << 8) | readUInt8(buf, offset + 2);
	const yTiles = yBytes > 0x7FFFFF ? yBytes - 0x1000000 : yBytes; // Convert to signed
	offset += 3;

	const playerId = readUInt16BE(buf, offset);
	offset += 2;

	return { success: true, newOffset: offset, playerId, tSec, sec, xTiles, yTiles };
}

/**
 * Parse SessionStart record from player position file
 * @param buf The binary player position data
 * @param offset Current offset in the data
 * @returns Processing result with session data and new offset
 */
function parseSessionStartRecord(
	buf: BinaryData,
	offset: number
): { success: boolean; newOffset: number; playerId: number; tMs: number; playerName: string } {
	// SessionStart record: 4 + 2 + 1 + n = 7 + n bytes minimum
	if (offset + 7 > buf.length) {
		return { success: false, newOffset: offset, playerId: 0, tMs: 0, playerName: "" };
	}

	const tMs = readUInt32BE(buf, offset);
	offset += 4;
	const playerId = readUInt16BE(buf, offset);
	offset += 2;
	const nameLen = readUInt8(buf, offset);
	offset += 1;

	if (offset + nameLen > buf.length) {
		return { success: false, newOffset: offset, playerId, tMs, playerName: "" };
	}

	const nameBytes = sliceData(buf, offset, offset + nameLen);
	offset += nameLen;

	// Convert to string using cross-platform method
	let playerName: string;
	if (isNode && nameBytes instanceof Buffer) {
		playerName = nameBytes.toString("utf-8");
	} else {
		playerName = new TextDecoder().decode(nameBytes as Uint8Array);
	}

	return { success: true, newOffset: offset, playerId, tMs, playerName };
}

/**
 * Parse SessionEnd record from player position file
 * @param buf The binary player position data
 * @param offset Current offset in the data
 * @returns Processing result with session data and new offset
 */
function parseSessionEndRecord(
	buf: BinaryData,
	offset: number
): { success: boolean; newOffset: number; playerId: number; tMs: number } {
	// SessionEnd record: 4 + 2 = 6 bytes
	if (offset + 6 > buf.length) {
		return { success: false, newOffset: offset, playerId: 0, tMs: 0 };
	}

	const tMs = readUInt32BE(buf, offset);
	offset += 4;
	const playerId = readUInt16BE(buf, offset);
	offset += 2;

	return { success: true, newOffset: offset, playerId, tMs };
}

/**
 * Parse and deduplicate player positions from binary data
 * @param buf Binary player position data
 * @returns Map of player ID to deduplicated position timeline
 */
export function parseAndDeduplicatePlayerPositions(buf: BinaryData): Map<number, ParsedPlayerPos[]> {
	// Use the utility function to parse the binary data
	const parsed: ParsedPlayerPositions = parsePlayerPositionsBinary(buf);

	// Build player timelines from the parsed data
	const playerTimelines = new Map<number, ParsedPlayerPos[]>();

	// Process all records in order
	for (const record of parsed.positions) {
		if (record.type === 0
            && record.sec !== undefined
            && record.xTiles !== undefined
            && record.yTiles !== undefined
		) {
			// Position record - convert tile coordinates to world coordinates
			const name = [...parsed.playerSessions.entries()].find(([, id]) => id === record.playerId)?.[0];
			if (name) {
				if (!playerTimelines.has(record.playerId)) {
					playerTimelines.set(record.playerId, []);
				}

				// Convert from tiles to world coordinates (tiles are 32x32 world coordinates)
				const x = record.xTiles * 32;
				const y = record.yTiles * 32;

                playerTimelines.get(record.playerId)!.push({
                	name,
                	x,
                	y,
                	sec: record.sec,
                });
			}
		}
	}

	// Deduplicate consecutive identical positions for each player
	const deduplicatedTimelines = new Map<number, ParsedPlayerPos[]>();

	for (const [playerId, timeline] of playerTimelines) {
		if (timeline.length === 0) { continue; }

		const deduplicated: ParsedPlayerPos[] = [];
		let lastPos = timeline[0];
		deduplicated.push(lastPos);

		for (let i = 1; i < timeline.length; i++) {
			const currentPos = timeline[i];

			// Check if position changed (with small tolerance for floating point)
			const deltaX = Math.abs(currentPos.x - lastPos.x);
			const deltaY = Math.abs(currentPos.y - lastPos.y);

			if (deltaX > 4 || deltaY > 4) {
				// Position changed significantly, keep this point
				deduplicated.push(currentPos);
				lastPos = currentPos;
			}
			// If position is the same, skip this point (deduplication)
		}

		// Always keep the last position to ensure timeline ends correctly
		if (timeline.length > 1 && deduplicated[deduplicated.length - 1] !== timeline[timeline.length - 1]) {
			deduplicated.push(timeline[timeline.length - 1]);
		}

		deduplicatedTimelines.set(playerId, deduplicated);
	}

	return deduplicatedTimelines;
}
