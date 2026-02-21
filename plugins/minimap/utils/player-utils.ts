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

export type PlayerPositionRecord =
	| PlayerPositionRecordType0
	| PlayerPositionRecordType1
	| PlayerPositionRecordType2;

export interface PlayerPositionRecordType0 {
	type: 0;
	playerId: number;
	tSec: number;
	sec: number;
	xTiles: number;
	yTiles: number;
}

export interface PlayerPositionRecordType1 {
	type: 1;
	playerId: number;
	tMs: number;
	playerName: string;
}

export interface PlayerPositionRecordType2 {
	type: 2;
	playerId: number;
	tMs: number;
}

export interface ParsedPlayerPos {
	name: string;
	x: number;
	y: number;
	sec: number;
}

/**
 * Read a signed 24-bit big-endian integer from binary data
 * @param buf The binary data buffer
 * @param offset Offset in the buffer to read from
 * @returns Signed 24-bit integer value
 */
function readSignedInt24(buf: BinaryData, offset: number): number {
	const unsigned = (readUInt8(buf, offset) << 16) | (readUInt8(buf, offset + 1) << 8) | readUInt8(buf, offset + 2);
	return unsigned > 0x7FFFFF ? unsigned - 0x1000000 : unsigned;
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

			const record: PlayerPositionRecordType0 = {
				type: 0,
				...result.record,
			};

			positions.push(record);
			if (result.record.playerId > maxPlayerId) {
				maxPlayerId = result.record.playerId;
			}
			offset = result.newOffset;

		} else if (type === 1) {
			// SessionStart record
			const result = parseSessionStartRecord(buf, offset);
			if (!result.success) { break; }

			const record: PlayerPositionRecordType1 = {
				type: 1,
				...result.record,
			};

			positions.push(record);
			playerSessions.set(result.record.playerName, result.record.playerId);
			if (result.record.playerId > maxPlayerId) {
				maxPlayerId = result.record.playerId;
			}
			offset = result.newOffset;

		} else if (type === 2) {
			// SessionEnd record
			const result = parseSessionEndRecord(buf, offset);
			if (!result.success) { break; }

			const record: PlayerPositionRecordType2 = {
				type: 2,
				...result.record,
			};

			positions.push(record);
			if (result.record.playerId > maxPlayerId) {
				maxPlayerId = result.record.playerId;
			}
			offset = result.newOffset;

		} else {
			// Unknown record type, can't continue parsing safely
			break;
		}
	}

	return { playerSessions, maxPlayerId, positions };
}

type PositionRecordParseResult =
	| { success: false; newOffset: number }
	| { success: true; newOffset: number; record: Omit<PlayerPositionRecordType0, "type"> };

/**
 * Parse position record from player position file
 * @param buf The binary player position data
 * @param offset Current offset in the data
 * @returns Processing result with position data and new offset
 */
function parsePositionRecord(buf: BinaryData, offset: number): PositionRecordParseResult {
	// Position record: 4 + 4 + 3 + 3 + 2 = 16 bytes
	if (offset + 16 > buf.length) {
		return { success: false, newOffset: offset };
	}

	const tSec = readUInt32BE(buf, offset);
	offset += 4;
	const sec = readUInt32BE(buf, offset);
	offset += 4;

	const xTiles = readSignedInt24(buf, offset);
	offset += 3;

	const yTiles = readSignedInt24(buf, offset);
	offset += 3;

	const playerId = readUInt16BE(buf, offset);
	offset += 2;

	return { success: true, newOffset: offset, record: { playerId, tSec, sec, xTiles, yTiles } };
}

type SessionStartRecordParseResult =
	| { success: false; newOffset: number }
	| { success: true; newOffset: number; record: Omit<PlayerPositionRecordType1, "type"> };

/**
 * Parse SessionStart record from player position file
 * @param buf The binary player position data
 * @param offset Current offset in the data
 * @returns Processing result with session data and new offset
 */
function parseSessionStartRecord(
	buf: BinaryData,
	offset: number
): SessionStartRecordParseResult {
	// SessionStart record: 4 + 2 + 1 + n = 7 + n bytes minimum
	if (offset + 7 > buf.length) {
		return { success: false, newOffset: offset };
	}

	const tMs = readUInt32BE(buf, offset);
	offset += 4;
	const playerId = readUInt16BE(buf, offset);
	offset += 2;
	const nameLen = readUInt8(buf, offset);
	offset += 1;

	if (offset + nameLen > buf.length) {
		return { success: false, newOffset: offset };
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

	return { success: true, newOffset: offset, record: { playerId, tMs, playerName } };
}

type SessionEndRecordParseResult =
	| { success: false; newOffset: number }
	| { success: true; newOffset: number; record: Omit<PlayerPositionRecordType2, "type"> };

/**
 * Parse SessionEnd record from player position file
 * @param buf The binary player position data
 * @param offset Current offset in the data
 * @returns Processing result with session data and new offset
 */
function parseSessionEndRecord(
	buf: BinaryData,
	offset: number
): SessionEndRecordParseResult {
	// SessionEnd record: 4 + 2 = 6 bytes
	if (offset + 6 > buf.length) {
		return { success: false, newOffset: offset };
	}

	const tMs = readUInt32BE(buf, offset);
	offset += 4;
	const playerId = readUInt16BE(buf, offset);
	offset += 2;

	return { success: true, newOffset: offset, record: { playerId, tMs } };
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
	const playerNameById = new Map<number, string>();
	for (const [name, id] of parsed.playerSessions) {
		playerNameById.set(id, name);
	}

	// Process all records in order
	for (const record of parsed.positions) {
		if (record.type === 0) {
			// Position record - convert tile coordinates to world coordinates
			const name = playerNameById.get(record.playerId);
			if (!name) {
				continue;
			}

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
