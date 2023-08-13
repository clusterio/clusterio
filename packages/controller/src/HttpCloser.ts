import type { Socket } from "net";

import http from "http";
import https from "https";

/**
 * Gracefully close a Node.js HTTP(S) server
 *
 * Helper class to properly close down a Node.js HTTP(S) server.  This is
 * necessary due to connections being able to linger around forever with the
 * keep-alive logic in HTTP.
 *
 * @example
 * // during server initialization
 * const server = http.createServer();
 * const serverCloser = new HttpCloser(server);
 *
 * // in the shutdown logic
 * await serverCloser.close();
 *
 * @alias module:controller/src/HttpCloser
 */
export default class HttpCloser {
	private _server: http.Server | https.Server;
	private _sockets: Set<Socket>;
	private _responses: Set<http.ServerResponse>;

	/**
	 * Server to attach this closer to.
	 */
	constructor(server: http.Server | https.Server) {
		this._server = server;
		this._sockets = new Set();
		this._responses = new Set();

		if (this._server instanceof https.Server) {
			this._server.on("secureConnection", this._addSocket.bind(this));
		} else if (this._server instanceof http.Server) {
			this._server.on("connection", this._addSocket.bind(this));
		} else {
			throw Error("server must be an instance of either http.Server or https.Server.");
		}
		this._server.on("request", this._addRequest.bind(this));
	}

	_addSocket(socket:Socket) {
		this._sockets.add(socket);
		socket.once("close", () => {
			this._sockets.delete(socket);
		});
	}

	_addRequest(request: http.IncomingMessage, response: http.ServerResponse) {
		this._responses.add(response);
		response.once("close", () => this._responses.delete(response));
		response.once("finish", () => this._responses.delete(response));
	}

	/**
	 * Gracefully close down the attached HTTP(S) server.
	 *
	 * Closes open connections that do not have a request in flight, signals
	 * connections to pending requests should close, and initiates the
	 * close operation on the attached server.
	 *
	 * If there's requests in progress that still haven't been completed
	 * after the timeout value passed they will be aborted.
	 *
	 * @param timeout -
	 *     Time in ms to wait for connections to close.
	 */
	async close(timeout:number = 5000): Promise<void> {
		let activeSockets = new Set();
		for (let response of this._responses) {
			if (!response.headersSent) {
				response.setHeader("Connection", "close");
			} else if (response.socket) {
				let socket = response.socket;
				response.once("finish", () => {
					socket.end();
				});
			}
			activeSockets.add(response.socket);
		}
		for (let socket of this._sockets) {
			if (!activeSockets.has(socket)) {
				socket.end();
			}
		}

		return new Promise((resolve, reject) => {
			let timer = setTimeout(() => {
				for (let socket of this._sockets) {
					// Ideally a RST would be sent here to indicate the the
					// transfer failed, but we can't reliably send that from
					// Node.js, see nodejs/node#27428.
					socket.destroy();
				}
			}, timeout);
			this._server.close(err => {
				clearTimeout(timer);
				if (err) {
					reject(err);
				} else {
					resolve();
				}
			});
		});
	}
};
