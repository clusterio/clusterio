"use strict";
const jwt = require("jsonwebtoken");
const WebSocket = require("ws");

const libErrors = require("@clusterio/lib/errors");
const { logger } = require("@clusterio/lib/logging");
const libPrometheus = require("@clusterio/lib/prometheus");
const libSchema = require("@clusterio/lib/schema");

const ControlConnection = require("./ControlConnection");
const packageVersion = require("../package").version;
const HostConnection = require("./HostConnection");
const WsServerConnector = require("./WsServerConnector");


const wsMessageCounter = new libPrometheus.Counter(
	"clusterio_controller_websocket_message_total",
	"How many messages have been received over WebSocket on the controller",
	{ labels: ["direction"] }
);

const wsConnectionsCounter = new libPrometheus.Counter(
	"clusterio_controller_websocket_connections_total",
	"How many WebSocket connections have been initiated on the controller"
);

const wsRejectedConnectionsCounter = new libPrometheus.Counter(
	"clusterio_controller_websocket_rejected_connections_total",
	"How many WebSocket connections have been rejected during the handshake on the controller"
);

/**
 * WebSocket server
 * @alias module:controller/src/WsServer
 */
class WsServer {
	constructor(controller) {
		this.controller = controller;

		this.stopAcceptingNewSessions = false;

		/** @type {Array<module:controller/src/ControlConnection>} */
		this.controlConnections = [];
		/** @type {Map<number, module:controller/src/HostConnection>} */
		this.hostConnections = new Map();
		/** @type {Map<number, module:controller/src/WsServerConnector>} */
		this.activeConnectors = new Map();
		/** @type {Set<module:ws>} */
		this.pendingSockets = new Set();

		// Unique string for the session token audience
		this.sessionAud = `session-${Date.now()}`;
		this.nextSessionId = 1;

		/** @type {module:ws.Server} */
		this.wss = new WebSocket.Server({
			noServer: true,
			path: "/api/socket",
		});
		this.wss.on("connection", (socket, req) => this.handleConnection(socket, req));
	}

	async stop() {
		this.stopAcceptingNewSessions = true;

		let disconnectTasks = [];
		for (let controlConnection of this.controlConnections) {
			disconnectTasks.push(controlConnection.disconnect(1001, "Server Quit"));
		}

		for (let hostConnection of this.hostConnections.values()) {
			disconnectTasks.push(hostConnection.disconnect(1001, "Server Quit"));
		}

		logger.info(`WsServer | Waiting for ${disconnectTasks.length} connectors to close`);
		for (let task of disconnectTasks) {
			try {
				await task;
			} catch (err) {
				if (!(err instanceof libErrors.SessionLost)) {
					logger.warn(`Unexpected error disconnecting connector:\n${err.stack}`);
				}
			}
		}

		for (let socket of this.pendingSockets) {
			socket.close(1001, "Server Quit");
		}
	}

	handleUpgrade(req, socket, head) {
		// For reasons that defy common sense, the connection event has
		// to be emitted explictly when using noServer.
		this.wss.handleUpgrade(req, socket, head, (ws) => {
			this.wss.emit("connection", ws, req);
		});
	}

	handleConnection(socket, req) {
		logger.verbose(`WsServer | new connection from ${req.socket.remoteAddress}`);

		// Track statistics
		wsConnectionsCounter.inc();
		socket.on("message", (message) => {
			wsMessageCounter.labels("in").inc();
			if (!socket.clusterio_ignore_dump) {
				this.controller.debugEvents.emit("message", { direction: "in", content: message });
			}
		});
		let originalSend = socket.send;
		socket.send = (...args) => {
			wsMessageCounter.labels("out").inc();
			if (typeof args[0] === "string" && !socket.clusterio_ignore_dump) {
				this.controller.debugEvents.emit("message", { direction: "out", content: args[0] });
			}
			return originalSend.call(socket, ...args);
		};

		// Start connection handshake.
		let loadedPlugins = {};
		for (let [name, plugin] of this.controller.plugins) {
			loadedPlugins[name] = plugin.info.version;
		}

		socket.send(JSON.stringify({ seq: null, type: "hello", data: {
			version: packageVersion,
			plugins: loadedPlugins,
		}}));

		this.attachHandler(socket, req);
	}

	attachHandler(socket, req) {
		this.pendingSockets.add(socket);

		let timeoutId = setTimeout(() => {
			logger.verbose(`WsServer | closing ${req.socket.remoteAddress} after timing out on handshake`);
			wsRejectedConnectionsCounter.inc();
			socket.terminate();
			this.pendingSockets.delete(socket);
		}, 30*1000);

		socket.once("message", (message) => {
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

	async handleHandshake(message, socket, req) {
		try {
			message = JSON.parse(message);
		} catch (err) {
			logger.verbose(`WsServer | closing ${req.socket.remoteAddress} after receiving invalid JSON`);
			wsRejectedConnectionsCounter.inc();
			socket.close(1002, "Invalid JSON");
			return;
		}

		if (!libSchema.clientHandshake(message)) {
			logger.verbose(`WsServer | closing ${req.socket.remoteAddress} after receiving invalid handshake`);
			wsRejectedConnectionsCounter.inc();
			socket.close(1002, "Bad handshake");
			return;
		}

		let { type, data } = message;

		if (type === "resume") {
			let connector;
			try {
				let payload = jwt.verify(
					data.session_token,
					Buffer.from(this.controller.config.get("controller.auth_secret"), "base64"),
					{ audience: this.sessionAud }
				);

				connector = this.activeConnectors.get(payload.sid);
				if (!connector) {
					throw new Error();
				}

			} catch (err) {
				socket.send(JSON.stringify({ seq: null, type: "invalidate", data: {}}));
				this.attachHandler(socket, req);
				return;
			}

			connector.continue(socket, data.last_seq);
			return;
		}

		if (this.stopAcceptingNewSessions) {
			logger.verbose(`WsServer | closing ${req.socket.remoteAddress}, server is shutting down`);
			wsRejectedConnectionsCounter.inc();
			socket.close(1001, "Shutting down");
			return;
		}

		// Validate token
		let user;
		try {
			if (type === "register_host") {
				let tokenPayload = jwt.verify(
					data.token,
					Buffer.from(this.controller.config.get("controller.auth_secret"), "base64"),
					// migrate: allow pre-rename tokens issued to hosts before alpha-14
					{ audience: ["host", "slave"] }
				);

				// migrate: allow pre-rename tokens issued to hosts before alpha-14
				if ((tokenPayload.host !== undefined ? tokenPayload.host : tokenPayload.slave) !== data.id) {
					throw new Error("missmatched host id");
				}

			} else if (type === "register_control") {
				let tokenPayload = jwt.verify(
					data.token,
					Buffer.from(this.controller.config.get("controller.auth_secret"), "base64"),
					{ audience: "user" }
				);

				user = this.controller.userManager.users.get(tokenPayload.user);
				if (!user) {
					throw new Error("invalid user");
				}
				if (tokenPayload.iat < user.tokenValidAfter) {
					throw new Error("invalid token");
				}
				user.checkPermission("core.control.connect");
			}

		} catch (err) {
			logger.verbose(`WsServer | authentication failed for ${req.socket.remoteAddress}`);
			wsRejectedConnectionsCounter.inc();
			socket.close(4003, `Authentication failed: ${err.message}`);
			return;
		}

		let sessionId = this.nextSessionId;
		this.nextSessionId += 1;
		let sessionToken = jwt.sign(
			{ aud: this.sessionAud, sid: sessionId },
			Buffer.from(this.controller.config.get("controller.auth_secret"), "base64"),
		);
		let sessionTimeout = this.controller.config.get("controller.session_timeout");
		let heartbeatInterval = this.controller.config.get("controller.heartbeat_interval");
		let connector = new WsServerConnector(sessionId, sessionTimeout, heartbeatInterval);
		this.activeConnectors.set(sessionId, connector);
		connector.on("close", () => {
			this.activeConnectors.delete(sessionId);
		});

		let additionalReadyData = {};
		if (type === "register_host") {
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
					this.controller.hostUpdated(this.controller.hosts.get(data.id));
				} else {
					logger.warn("Unlisted HostConnection closed");
				}
			});
			this.hostConnections.set(data.id, connection);
			this.controller.hostUpdated(this.controller.hosts.get(data.id));


		} else if (type === "register_control") {
			logger.verbose(`WsServer | registered control from ${req.socket.remoteAddress}`);
			let connection = new ControlConnection(data, connector, this.controller, user);
			connector.on("close", () => {
				let index = this.controlConnections.indexOf(connection);
				if (index !== -1) {
					this.controlConnections.splice(index, 1);
				} else {
					logger.warn("Unlisted ControlConnection closed");
				}
			});
			this.controlConnections.push(connection);
			additionalReadyData["account"] = {
				name: user.name,
				roles: [...user.roles].map(r => ({
					name: r.name,
					id: r.id,
					permissions: [...r.permissions],
				})),
			};
		}

		connector.ready(socket, sessionToken, additionalReadyData);
	}

}

module.exports = WsServer;
