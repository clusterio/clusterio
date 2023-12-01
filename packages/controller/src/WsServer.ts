import type { IncomingMessage } from "http";
import type { Duplex } from "stream";
import type Controller from "./Controller";

import jwt from "jsonwebtoken";
import WebSocket, { WebSocketServer } from "ws";

import * as lib from "@clusterio/lib";
const { logger } = lib;

import ControlConnection from "./ControlConnection";
import HostConnection, { HostInfo } from "./HostConnection";
import WsServerConnector from "./WsServerConnector";

import { version as packageVersion } from "../package.json";

const wsMessageCounter = new lib.Counter(
	"clusterio_controller_websocket_message_total",
	"How many messages have been received over WebSocket on the controller",
	{ labels: ["direction"] }
);

const wsConnectionsCounter = new lib.Counter(
	"clusterio_controller_websocket_connections_total",
	"How many WebSocket connections have been initiated on the controller"
);

const wsRejectedConnectionsCounter = new lib.Counter(
	"clusterio_controller_websocket_rejected_connections_total",
	"How many WebSocket connections have been rejected during the handshake on the controller"
);

/**
 * WebSocket server
 * @alias module:controller/src/WsServer
 */
export default class WsServer {
	controller: Controller;
	stopAcceptingNewSessions: boolean = false;
	controlConnections: Map<number, ControlConnection> = new Map();
	hostConnections: Map<number, HostConnection> = new Map();
	activeConnectors: Map<number, WsServerConnector> = new Map();
	pendingSockets: Set<WebSocket> = new Set();
	// Unique string for the session token audience
	sessionAud: string = `session-${Date.now()}`;
	nextSessionId: number = 1;
	nextControlId: number = 1;
	wss: WebSocket.Server;

	constructor(controller: Controller) {
		this.controller = controller;

		this.wss = new WebSocket.Server({
			noServer: true,
			path: "/api/socket",
		});
		this.wss.on("connection",
			(socket: lib.WebSocketClusterio, req: IncomingMessage) => this.handleConnection(socket, req),
		);
	}

	async stop(): Promise<void> {
		this.stopAcceptingNewSessions = true;

		let disconnectTasks = [];
		for (let controlConnection of this.controlConnections.values()) {
			disconnectTasks.push(controlConnection.disconnect(1001, "Server Quit"));
		}

		for (let hostConnection of this.hostConnections.values()) {
			disconnectTasks.push(hostConnection.disconnect(1001, "Server Quit"));
		}

		logger.info(`WsServer | Waiting for ${disconnectTasks.length} connectors to close`);
		for (let task of disconnectTasks) {
			try {
				await task;
			} catch (err: any) {
				if (!(err instanceof lib.SessionLost)) {
					logger.warn(`Unexpected error disconnecting connector:\n${err.stack}`);
				}
			}
		}

		for (let socket of this.pendingSockets) {
			socket.close(1001, "Server Quit");
		}
	}

	handleUpgrade(
		req: IncomingMessage,
		socket: Duplex,
		head: Buffer
	) {
		// For reasons that defy common sense, the connection event has
		// to be emitted explictly when using noServer.
		this.wss.handleUpgrade(req, socket, head, (ws) => {
			this.wss.emit("connection", ws, req);
		});
	}

	handleConnection(socket: lib.WebSocketClusterio, req: IncomingMessage) {
		logger.verbose(`WsServer | new connection from ${req.socket.remoteAddress}`);

		// Track statistics
		wsConnectionsCounter.inc();
		socket.on("message", (message: WebSocket.RawData) => {
			wsMessageCounter.labels("in").inc();
			if (!socket.clusterio_ignore_dump) {
				this.controller.debugEvents.emit("message", { direction: "in", content: message });
			}
		});
		let originalSend = socket.send;
		socket.send = (...args: [string, any]) => {
			wsMessageCounter.labels("out").inc();
			if (typeof args[0] === "string" && !socket.clusterio_ignore_dump) {
				this.controller.debugEvents.emit("message", { direction: "out", content: args[0] });
			}
			return originalSend.call(socket, ...args);
		};

		// Start connection handshake.
		let loadedPlugins: {[key:string]: string} = {};
		for (let [name, plugin] of this.controller.plugins) {
			loadedPlugins[name] = plugin.info.version;
		}

		socket.send(JSON.stringify(new lib.MessageHello(new lib.HelloData(packageVersion, loadedPlugins))));
		this.attachHandler(socket, req);
	}

	attachHandler(
		socket: WebSocket,
		req: IncomingMessage
	) {
		this.pendingSockets.add(socket);

		let timeoutId = setTimeout(() => {
			logger.verbose(`WsServer | closing ${req.socket.remoteAddress} after timing out on handshake`);
			wsRejectedConnectionsCounter.inc();
			socket.terminate();
			this.pendingSockets.delete(socket);
		}, 30*1000);

		socket.once("message", (message: string) => {
			clearTimeout(timeoutId);
			this.pendingSockets.delete(socket);
			this.handleHandshake(
				message, socket, req
			).catch(err => {
				logger.error(`
+------------------------------------------------------------+
| Unexpected error occured in WebSocket handshake, please    |
| report it to https://github.com/clusterio/clusterio/issues |
+------------------------------------------------------------+
${err.stack}`
				);
				wsRejectedConnectionsCounter.inc();
				socket.close(1011, "Unexpected error");
			});
		});
	}

	async handleHandshake(rawMessage: string, socket: WebSocket, req: IncomingMessage) {
		let message;
		try {
			const json = JSON.parse(rawMessage);
			lib.Message.validate(json);
			message = lib.Message.fromJSON(json);
		} catch (err: any) {
			logger.verbose(`WsServer | closing ${req.socket.remoteAddress} after receiving invalid message`);
			wsRejectedConnectionsCounter.inc();
			socket.close(1002, `Invalid message: ${err.message}`);
			return;
		}

		if (message.type === "resume") {
			this.resumeSession((message as lib.MessageResume).data, socket, req);
			return;
		}

		if (message.type !== "registerHost" && message.type !== "registerControl") {
			logger.verbose(`WsServer | closing ${req.socket.remoteAddress} after receiving invalid handshake`);
			wsRejectedConnectionsCounter.inc();
			socket.close(1002, "Bad handshake");
			return;
		}

		if (this.stopAcceptingNewSessions) {
			logger.verbose(`WsServer | closing ${req.socket.remoteAddress}, server is shutting down`);
			wsRejectedConnectionsCounter.inc();
			socket.close(1001, "Shutting down");
			return;
		}

		if (message.type === "registerHost") {
			await this.registerHost((message as lib.MessageRegisterHost).data, socket, req);
			return;
		}

		if (message.type === "registerControl") {
			await this.registerControl((message as lib.MessageRegisterControl).data, socket, req);
			return;
		}

		throw new Error("This should be unreachable");
	}

	createSession(dst: lib.Address): [ WsServerConnector, string ] {
		let sessionId = this.nextSessionId;
		this.nextSessionId += 1;
		let sessionToken = jwt.sign(
			{ aud: this.sessionAud, sid: sessionId },
			Buffer.from(this.controller.config.get("controller.auth_secret"), "base64"),
		);
		let sessionTimeout = this.controller.config.get("controller.session_timeout");
		let heartbeatInterval = this.controller.config.get("controller.heartbeat_interval");
		let connector = new WsServerConnector(dst, sessionId, sessionTimeout, heartbeatInterval);
		this.activeConnectors.set(sessionId, connector);
		connector.on("close", () => {
			this.activeConnectors.delete(sessionId);
		});

		return [connector, sessionToken];
	}

	async registerHost(data: lib.RegisterHostData, socket: WebSocket, req: IncomingMessage) {
		try {
			let tokenPayload = jwt.verify(
				data.token,
				Buffer.from(this.controller.config.get("controller.auth_secret"), "base64"),
				// migrate: allow pre-rename tokens issued to hosts before alpha-14
				{ audience: ["host", "slave"] }
			);

			if (typeof tokenPayload === "string") {
				throw new Error("unexpected JsonWebToken type");
			}

			// migrate: allow pre-rename tokens issued to hosts before alpha-14
			if ((tokenPayload.host !== undefined ? tokenPayload.host : tokenPayload.slave) !== data.id) {
				throw new Error("missmatched host id");
			}

			let host = this.controller.hosts.get(data.id);
			if (!tokenPayload.iat || tokenPayload.iat < (host?.token_valid_after??0)) {
				throw new Error("invalid token");
			}
		} catch (err: any) {
			logger.verbose(`WsServer | authentication failed for ${req.socket.remoteAddress}`);
			wsRejectedConnectionsCounter.inc();
			socket.close(4003, `Authentication failed: ${err.message}`);
			return;
		}

		let [connector, sessionToken] = this.createSession(new lib.Address(lib.Address.host, data.id));
		let connection = this.hostConnections.get(data.id);
		if (connection) {
			logger.verbose(`WsServer | disconnecting existing connection for host ${data.id}`);
			await connection.disconnect(1008, "Registered from another connection");
		}

		logger.info(
			`WsServer | registered host ${data.name} (${data.id}) using agent ${data.agent} ${data.version}`
		);
		if (data.agent === "Clusterio Host" && data.version !== packageVersion) {
			logger.warn(
				`Host ${data.name} (${data.id}) connected using version ${data.version} which does not match the ` +
				`version of the controller is currently running (${packageVersion}). It may not work as expected.`
			);
		}

		connection = new HostConnection(data, connector, this.controller);
		connector.on("close", () => {
			if (this.hostConnections.get(data.id) === connection) {
				this.hostConnections.delete(data.id);
				this.controller.hostUpdated(this.controller.hosts.get(data.id) as HostInfo);
			} else {
				logger.warn("Unlisted HostConnection closed");
			}
		});
		this.hostConnections.set(data.id, connection);
		this.controller.hostUpdated(this.controller.hosts.get(data.id) as HostInfo);
		let src = new lib.Address(lib.Address.host, data.id);
		connector.ready(socket, src, sessionToken, undefined);
	}

	async registerControl(data: lib.RegisterControlData, socket: WebSocket, req: IncomingMessage) {
		let user;
		try {
			let tokenPayload = jwt.verify(
				data.token,
				Buffer.from(this.controller.config.get("controller.auth_secret"), "base64"),
				{ audience: "user" }
			);

			if (typeof tokenPayload === "string") {
				throw new Error("unexpected JsonWebToken type");
			}

			user = this.controller.userManager.users.get(tokenPayload.user);
			if (!user) {
				throw new Error("invalid user");
			}
			if ((tokenPayload.iat || 0) < user.tokenValidAfter) {
				throw new Error("invalid token");
			}
			user.checkPermission("core.control.connect");

		} catch (err: any) {
			logger.verbose(`WsServer | authentication failed for ${req.socket.remoteAddress}`);
			wsRejectedConnectionsCounter.inc();
			socket.close(4003, `Authentication failed: ${err.message}`);
			return;
		}

		let id = this.nextControlId;
		this.nextControlId += 1;
		let [connector, sessionToken] = this.createSession(new lib.Address(lib.Address.control, id));

		logger.verbose(`WsServer | registered control ${id} from ${req.socket.remoteAddress}`);
		let connection = new ControlConnection(data, connector, this.controller, user, id);
		connector.on("close", () => {
			this.controlConnections.delete(id);
		});
		this.controlConnections.set(id, connection);
		let account = new lib.AccountDetails(
			user.name,
			[...user.roles].map(r => ({
				name: r.name,
				id: r.id,
				permissions: [...r.permissions],
			}))
		);

		let src = new lib.Address(lib.Address.control, id);
		connector.ready(socket, src, sessionToken, account);
	}

	resumeSession(data: lib.ResumeData, socket: WebSocket, req: IncomingMessage) {
		let connector;
		try {
			let payload = jwt.verify(
				data.sessionToken,
				Buffer.from(this.controller.config.get("controller.auth_secret"), "base64"),
				{ audience: this.sessionAud }
			);

			if (typeof payload === "string") {
				throw new Error("unexpected JsonWebToken type");
			}

			connector = this.activeConnectors.get(payload.sid);
			if (!connector) {
				throw new Error();
			}

		} catch (err) {
			socket.send(JSON.stringify(new lib.MessageInvalidate()));
			this.attachHandler(socket, req);
			return;
		}

		connector.continue(socket, data.lastSeq as number);
	}
}
