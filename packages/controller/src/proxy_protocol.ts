/**
 * Encoding and decoding of the parts of the Factorio network protocol the
 * player proxy needs to look at: the message header and the connection
 * handshake messages.
 *
 * Based on the Factorio 2.x wire format. Every multi-byte value is little
 * endian, "space optimized" values are a single byte unless that byte is 0xff,
 * in which case the full width value follows it.
 *
 * @module
 */

export const MessageType = {
	Ping: 0,
	PingReply: 1,
	ConnectionRequest: 2,
	ConnectionRequestReply: 3,
	ConnectionRequestReplyConfirm: 4,
	ConnectionAcceptOrDeny: 5,
} as const;

const TYPE_MASK = 0x1f;
const FRAGMENTED_FLAG = 0x40;
const LAST_FRAGMENT_FLAG = 0x80;
const CONFIRM_FLAG = 0x8000;
const MESSAGE_ID_MASK = 0x7fff;

/** Message types that carry a message id even when not fragmented */
const RELIABLE_TYPES: ReadonlySet<number> = new Set([
	MessageType.ConnectionRequest,
	MessageType.ConnectionRequestReplyConfirm,
]);

/**
 * Max packet size Factorio servers tell clients to use, this is the largest
 * datagram every host on the Internet is required to be able to receive.
 */
export const DEFAULT_MAX_PACKET_SIZE = 508;

export interface ApplicationVersion {
	major: number;
	minor: number;
	sub: number;
	build: number;
}

export function formatVersion(version: ApplicationVersion) {
	return `${version.major}.${version.minor}.${version.sub}`;
}

export function versionsEqual(a: ApplicationVersion, b: ApplicationVersion) {
	return a.major === b.major && a.minor === b.minor && a.sub === b.sub && a.build === b.build;
}

export interface MessageHeader {
	type: number;
	fragmented: boolean;
	lastFragment: boolean;
	messageId?: number;
	fragmentNumber?: number;
	confirms: number[];
	/** Offset of the payload of the message */
	payloadOffset: number;
}

export interface ConnectionRequest {
	header: MessageHeader;
	version: ApplicationVersion;
	clientRequestId: number;
}

export interface ConnectionRequestReply {
	version: ApplicationVersion;
	clientRequestId: number;
	serverRequestId: number;
	maxPacketSize: number;
}

export interface ConnectionRequestReplyConfirm {
	clientRequestId: number;
	serverRequestId: number;
	/** Offset of serverRequestId in the packet */
	serverRequestIdOffset: number;
	username: string;
}

export class BufferReader {
	constructor(
		private _buffer: Buffer,
		public offset = 0,
	) { }

	private _take(length: number) {
		const start = this.offset;
		if (start + length > this._buffer.length) {
			throw new Error("Unexpected end of message");
		}
		this.offset += length;
		return start;
	}

	readUInt8() {
		return this._buffer.readUInt8(this._take(1));
	}

	readUInt16LE() {
		return this._buffer.readUInt16LE(this._take(2));
	}

	readUInt32LE() {
		return this._buffer.readUInt32LE(this._take(4));
	}

	/** Read a value stored as one byte or 0xff followed by a uint16 */
	readSpaceOptimizedUInt16() {
		const value = this.readUInt8();
		return value === 0xff ? this.readUInt16LE() : value;
	}

	/** Read a value stored as one byte or 0xff followed by a uint32 */
	readSpaceOptimizedUInt32() {
		const value = this.readUInt8();
		return value === 0xff ? this.readUInt32LE() : value;
	}

	readString() {
		const length = this.readSpaceOptimizedUInt32();
		const start = this._take(length);
		return this._buffer.toString("utf8", start, start + length);
	}

	readVersion(): ApplicationVersion {
		return {
			major: this.readSpaceOptimizedUInt16(),
			minor: this.readSpaceOptimizedUInt16(),
			sub: this.readSpaceOptimizedUInt16(),
			build: this.readUInt32LE(),
		};
	}
}

export class BufferWriter {
	private _parts: number[] = [];

	writeUInt8(value: number) {
		this._parts.push(value & 0xff);
	}

	writeUInt16LE(value: number) {
		this.writeUInt8(value);
		this.writeUInt8(value >>> 8);
	}

	writeUInt32LE(value: number) {
		this.writeUInt16LE(value);
		this.writeUInt16LE(value >>> 16);
	}

	writeSpaceOptimizedUInt16(value: number) {
		if (value >= 0xff) {
			this.writeUInt8(0xff);
			this.writeUInt16LE(value);
		} else {
			this.writeUInt8(value);
		}
	}

	writeVersion(version: ApplicationVersion) {
		this.writeSpaceOptimizedUInt16(version.major);
		this.writeSpaceOptimizedUInt16(version.minor);
		this.writeSpaceOptimizedUInt16(version.sub);
		this.writeUInt32LE(version.build);
	}

	toBuffer() {
		return Buffer.from(this._parts);
	}
}

export function messageType(buffer: Buffer) {
	if (!buffer.length) {
		return undefined;
	}
	return buffer[0] & TYPE_MASK;
}

export function parseHeader(buffer: Buffer): MessageHeader {
	const reader = new BufferReader(buffer);
	const typeAndFlags = reader.readUInt8();
	const type = typeAndFlags & TYPE_MASK;
	const fragmented = (typeAndFlags & FRAGMENTED_FLAG) !== 0;
	const lastFragment = (typeAndFlags & LAST_FRAGMENT_FLAG) !== 0;

	let messageId: number | undefined;
	let hasConfirm = false;
	if (RELIABLE_TYPES.has(type) || fragmented) {
		const messageIdAndFlags = reader.readUInt16LE();
		messageId = messageIdAndFlags & MESSAGE_ID_MASK;
		hasConfirm = (messageIdAndFlags & CONFIRM_FLAG) !== 0;
	}

	let fragmentNumber: number | undefined;
	if (fragmented) {
		fragmentNumber = reader.readSpaceOptimizedUInt16();
	}

	const confirms: number[] = [];
	if (hasConfirm) {
		const count = reader.readUInt8();
		for (let i = 0; i < count; i++) {
			confirms.push(reader.readUInt32LE());
		}
	}

	return { type, fragmented, lastFragment, messageId, fragmentNumber, confirms, payloadOffset: reader.offset };
}

export function parseConnectionRequest(buffer: Buffer): ConnectionRequest {
	const header = parseHeader(buffer);
	if (header.type !== MessageType.ConnectionRequest) {
		throw new Error(`Expected ConnectionRequest, got message type ${header.type}`);
	}
	const reader = new BufferReader(buffer, header.payloadOffset);
	const version = reader.readVersion();
	const clientRequestId = reader.readUInt32LE();
	return { header, version, clientRequestId };
}

export function parseConnectionRequestReply(buffer: Buffer): ConnectionRequestReply {
	const header = parseHeader(buffer);
	if (header.type !== MessageType.ConnectionRequestReply) {
		throw new Error(`Expected ConnectionRequestReply, got message type ${header.type}`);
	}
	const reader = new BufferReader(buffer, header.payloadOffset);
	return {
		version: reader.readVersion(),
		clientRequestId: reader.readUInt32LE(),
		serverRequestId: reader.readUInt32LE(),
		maxPacketSize: reader.readUInt16LE(),
	};
}

/**
 * Parse the start of a ConnectionRequestReplyConfirm
 *
 * The message contains the mod list and startup settings of the client and
 * is usually fragmented, but the fields read here are always in the first
 * fragment.
 *
 * @param buffer - Unfragmented message or first fragment of it.
 * @returns the parsed fields.
 */
export function parseConnectionRequestReplyConfirm(buffer: Buffer): ConnectionRequestReplyConfirm {
	const header = parseHeader(buffer);
	if (header.type !== MessageType.ConnectionRequestReplyConfirm) {
		throw new Error(`Expected ConnectionRequestReplyConfirm, got message type ${header.type}`);
	}
	if (header.fragmented && header.fragmentNumber !== 0) {
		throw new Error(`Expected first fragment, got fragment ${header.fragmentNumber}`);
	}
	const reader = new BufferReader(buffer, header.payloadOffset);
	const clientRequestId = reader.readUInt32LE();
	const serverRequestIdOffset = reader.offset;
	const serverRequestId = reader.readUInt32LE();
	reader.readUInt32LE(); // instanceID
	const username = reader.readString();
	return { clientRequestId, serverRequestId, serverRequestIdOffset, username };
}

export function encodeConnectionRequest(version: ApplicationVersion, clientRequestId: number, messageId = 0) {
	const writer = new BufferWriter();
	writer.writeUInt8(MessageType.ConnectionRequest);
	writer.writeUInt16LE(messageId & MESSAGE_ID_MASK);
	writer.writeVersion(version);
	writer.writeUInt32LE(clientRequestId);
	return writer.toBuffer();
}

export function encodeConnectionRequestReply(reply: ConnectionRequestReply) {
	const writer = new BufferWriter();
	writer.writeUInt8(MessageType.ConnectionRequestReply);
	writer.writeVersion(reply.version);
	writer.writeUInt32LE(reply.clientRequestId);
	writer.writeUInt32LE(reply.serverRequestId);
	writer.writeUInt16LE(reply.maxPacketSize);
	return writer.toBuffer();
}

/**
 * Turn a Ping into the PingReply a server would send back
 *
 * @param ping - Ping message received.
 * @returns PingReply message, or undefined if ping was malformed.
 */
export function pingReplyFor(ping: Buffer) {
	if (ping.length < 3) {
		return undefined;
	}
	const reply = Buffer.from(ping.subarray(0, 3));
	reply[0] = MessageType.PingReply;
	return reply;
}
