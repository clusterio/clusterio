import events from "node:events";
import * as lib from "@clusterio/lib";

export const addr = lib.Address.fromShorthand;

/**
 * Link on one end of a VirtualConnector pair with nothing but a recorder on
 * the other end.
 *
 * @param src - Address of the link.
 * @param dst - Address of the other end.
 * @returns the link, its connector, the peer connector and the messages
 *     that arrived at the peer.
 */
export function recordedLink(src: lib.Address, dst: lib.Address) {
	const [connector, peer] = lib.VirtualConnector.makePair(src, dst);
	const link = new lib.Link(connector);
	const sent: any[] = [];
	peer.on("message", message => { sent.push(message); });
	return { link, connector, peer, sent };
}

/** VirtualConnector which sends messages through JSON like a WebSocket would */
export class JsonVirtualConnector extends lib.VirtualConnector {
	send(message: lib.Message) {
		this.other.emit("message", lib.Message.fromJSON(JSON.parse(JSON.stringify(message))));
	}
}

/**
 * Two links joined by a JsonVirtualConnector pair.
 *
 * @param src - Address of the first link.
 * @param dst - Address of the second link.
 * @returns both links.
 */
export function linkPair(src: lib.Address, dst: lib.Address) {
	const [connector, peerConnector] = JsonVirtualConnector.makePair(src, dst);
	return { link: new lib.Link(connector), peer: new lib.Link(peerConnector) };
}

/**
 * WebSocket connector with the socket replaced by an array of sent text.
 * Starts out closed, set `_state` to "connected" to give it a session.
 */
export class TestWebSocketConnector extends lib.WebSocketBaseConnector {
	sentText: string[] = [];

	constructor(src: lib.Address, dst: lib.Address) {
		super(src, dst);
		this._socket = { send: (text: string) => { this.sentText.push(text); } } as any;
	}

	setClosing() {
		this._closing = true;
	}

	async close() {
		this._state = "closed";
	}
}

/** Resolves with the next message to arrive at a connector */
export async function nextMessage(connector: lib.BaseConnector): Promise<any> {
	const [message] = await events.once(connector as events.EventEmitter, "message");
	return message;
}

/** Resolves once pending promise callbacks and I/O callbacks have run */
export function settle() {
	return new Promise(resolve => { setImmediate(resolve); });
}
