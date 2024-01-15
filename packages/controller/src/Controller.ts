import type winston from "winston";
import type { AddressInfo } from "net";
import type { ControllerArgs } from "../controller";
import express, { type Request, type Response, type NextFunction, type Application } from "express";
import type { Static } from "@sinclair/typebox";

import compression from "compression";
import events, { EventEmitter } from "events";
import fs from "fs-extra";
import http from "http";
import https from "https";
import jwt from "jsonwebtoken";
import path from "path";
import stream from "stream";

import * as lib from "@clusterio/lib";
const { logger, Summary, Gauge } = lib;

import HttpCloser from "./HttpCloser";
import InstanceInfo from "./InstanceInfo";
import * as metrics from "./metrics";
import * as routes from "./routes";
import ControllerUser from "./ControllerUser";
import UserManager from "./UserManager";
import WsServer from "./WsServer";
import HostConnection from "./HostConnection";
import HostInfo from "./HostInfo";
import BaseControllerPlugin from "./BaseControllerPlugin";

const endpointDurationSummary = new Summary(
	"clusterio_controller_http_endpoint_duration_seconds",
	"Time it took to respond to a an HTTP request",
	{ labels: ["route"] }
);

const logSizeGauge = new Gauge(
	"clusterio_controller_log_bytes",
	"Size of all log files currently stored on the controller."
);

type InstanceId = { instanceId: number };

/**
 * Manages all controller related operations
 * @alias module:controller/src/Controller
 */
export default class Controller {
	clusterLogger: winston.Logger;
	/** Array of plugin info objects for known plugins */
	pluginInfos: lib.PluginNodeEnvInfo[];
	configPath: string;
	/** Controller config. */
	config: lib.ControllerConfig;
	app: Application;

	/** True if (@link Controller.systemMetrics} has changed since last time it was saved */
	systemMetricsDirty = false;
	/** True if {@link Controller.hosts} has changed since last time it was saved */
	hostsDirty = false;
	/** True if {@link Controller.instances} has changed since last time it was saved */
	instancesDirty = false;
	/** True if {@link Controller.saves} has changed since last time it was saved */
	savesDirty = false;
	/** True if {@link Controller.modPacks} has changed since last time it was saved */
	modPacksDirty = false;

	httpServer: http.Server | null = null;
	httpServerCloser: HttpCloser | null = null;
	httpsServer: https.Server | null = null;
	httpsServerCloser: HttpCloser | null = null;

	/** Mapping of plugin name to loaded plugin */
	plugins: Map<string, BaseControllerPlugin> = new Map();

	/** WebSocket server */
	wsServer: WsServer;
	debugEvents: events.EventEmitter = new events.EventEmitter();
	private _events: events.EventEmitter = new events.EventEmitter();

	/** Event subscription controller */
	subscriptions = new lib.SubscriptionController();

	// Possible states are new, starting, running, stopping, stopped
	private _state: string = "new";
	private _shouldStop: boolean = false;
	_fallbackedRequests: Map<lib.RequestClass<unknown, unknown>, lib.RequestHandler<unknown, unknown>> = new Map();
	_registeredRequests: Map<lib.RequestClass<unknown, unknown>, lib.RequestHandler<unknown, unknown>> = new Map();
	_registeredEvents = new Map();
	_snoopedEvents = new Map();

	devMiddleware: any | null = null;

	autosaveInterval?: ReturnType<typeof setInterval>;
	systemMetricsInterval?: ReturnType<typeof setInterval>;

	logDirectory: string = "";
	clusterLogIndex: lib.LogIndex | null = null;
	clusterLogBuildInterval: ReturnType<typeof setInterval> | null = null;

	static async bootstrap(config: lib.ControllerConfig) {
		let databaseDirectory = config.get("controller.database_directory");
		await fs.ensureDir(databaseDirectory);

		const systemMetrics = await Controller.loadSystemMetrics(path.join(databaseDirectory, "metrics.json"));
		const hosts = await Controller.loadHosts(path.join(databaseDirectory, "hosts.json"));
		const instances = await Controller.loadInstances(path.join(databaseDirectory, "instances.json"));
		const saves = await Controller.loadSaves(path.join(databaseDirectory, "saves.json"));
		const modPacks = await Controller.loadModPacks(path.join(databaseDirectory, "mod-packs.json"));
		const userManager = new UserManager(config);
		await userManager.load(path.join(databaseDirectory, "users.json"));

		let modsDirectory = config.get("controller.mods_directory");
		await fs.ensureDir(modsDirectory);
		const modStore = await lib.ModStore.fromDirectory(modsDirectory);

		return [
			systemMetrics,
			hosts,
			instances,
			saves,
			modPacks,
			modStore,
			userManager,
		] as const;
	}

	constructor(
		clusterLogger: winston.Logger,
		pluginInfos: lib.PluginNodeEnvInfo[],
		configPath: string,
		config: lib.ControllerConfig,

		public systemMetrics = new Map<lib.SystemMetrics["id"], lib.SystemMetrics>(),
		/** Mapping of host id to host info */
		public hosts = new Map<number, HostInfo>(),
		/** Mapping of instance id to instance info */
		public instances = new Map<number, InstanceInfo>(),
		/** Mapping of save id to save details */
		public saves = new Map<string, lib.SaveDetails>(),
		/** Mapping of mod pack id to mod pack */
		public modPacks = new Map<number, lib.ModPack>(),
		/** Mods stored on the controller */
		public modStore = new lib.ModStore(config.get("controller.mods_directory"), new Map()),
		/** User and roles manager for the cluster */
		public userManager = new UserManager(config),
	) {
		this.clusterLogger = clusterLogger;
		this.pluginInfos = pluginInfos;
		this.configPath = configPath;
		this.config = config;

		this.app = express();
		this.app.locals.controller = this;
		this.app.locals.streams = new Map();

		this.wsServer = new WsServer(this);

		this.modStore.on("change", mod => {
			this.modsUpdated([mod]);
		});

		// Handle subscriptions for all internal properties
		this.subscriptions.handle(lib.SystemMetricsUpdateEvent, this.handleSystemMetricsSubscription.bind(this));
		this.subscriptions.handle(lib.HostUpdatesEvent, this.handleHostSubscription.bind(this));
		this.subscriptions.handle(lib.InstanceDetailsUpdatesEvent, this.handleInstanceDetailsSubscription.bind(this));
		this.subscriptions.handle(
			lib.InstanceSaveDetailsUpdatesEvent, this.handleInstanceSaveDetailsSubscription.bind(this)
		);
		this.subscriptions.handle(lib.ModPackUpdatesEvent, this.handleModPackSubscription.bind(this));
		this.subscriptions.handle(lib.ModUpdatesEvent, this.handleModSubscription.bind(this));
		this.subscriptions.handle(lib.UserUpdatesEvent, this.handleUserSubscription.bind(this));
	}

	async start(args: ControllerArgs) {
		if (this._state !== "new") {
			throw new Error(`Cannot start in state ${this._state}`);
		}

		this._state = "starting";
		try {
			await this._startInternal(args);

		} catch (err) {
			await this._stopInternal();
			this._state = "stopped";
			this._events.emit("stop");
			throw err;
		}

		if (this._shouldStop) {
			this.stop();
		}
	}

	/**
	 * Get the total size of the logs stored
	 *
	 * @returns {Promise<number>} size in bytes of stored log files.
	 */
	async logSize() {
		return (await Promise.all([
			lib.directorySize(path.join(this.logDirectory, "cluster")),
			lib.directorySize(path.join(this.logDirectory, "controller")),
			lib.directorySize(path.join(this.logDirectory, "host")),
		])).reduce((a, v) => a + v, 0);
	}

	async _startInternal(args: ControllerArgs) {
		this.logDirectory = args.logDirectory;
		this.clusterLogIndex = await lib.LogIndex.load(path.join(this.logDirectory, "cluster"));

		this.clusterLogBuildInterval = setInterval(() => {
			if (this.clusterLogIndex) {
				this.clusterLogIndex.buildIndex().catch(
					err => logger.error(`Error building cluster log index:\n${err.stack}`)
				);
			}
		}, 600e3);
		logSizeGauge.callback = async () => { logSizeGauge.set(await this.logSize()); };

		// Start webpack development server if enabled
		if (args.dev || args.devPlugin) {
			this._startDevServer(args);
		}

		this.config.on("fieldChanged", (field, curr, prev) => {
			if (field === "controller.autosave_interval") {
				this.onAutosaveIntervalChanged();
			} else if (field === "controller.system_metrics_interval") {
				this.onSystemMetricsIntervalChanged();
			}
			lib.invokeHook(this.plugins, "onControllerConfigFieldChanged", field, curr, prev);
		});
		for (let instance of this.instances.values()) {
			this.addInstanceHooks(instance);
		}

		// Make sure we're actually going to listen on a port
		let httpPort = this.config.get("controller.http_port");
		let httpsPort = this.config.get("controller.https_port");
		let bindAddress = this.config.get("controller.bind_address") || "";
		if (!httpPort && !httpsPort) {
			logger.fatal("Error: at least one of http_port and https_port must be configured");
			process.exitCode = 1;
			return;
		}

		let tls_cert = this.config.get("controller.tls_certificate");
		let tls_key = this.config.get("controller.tls_private_key");

		if (httpsPort && (!tls_cert || !tls_key)) {
			throw new lib.StartupError(
				"tls_certificate and tls_private_key must be configure in order to use https_port"
			);
		}

		Controller.addAppRoutes(this.app, this.pluginInfos);

		if (!args.dev) {
			let manifestPath = path.join(__dirname, "..", "web", "manifest.json");

			let manifest = await Controller.loadJsonObject(manifestPath);
			if (!manifest["main.js"]) {
				logger.error("Missing main.js entry in dist/web/manifest.json");
			}
			this.app.locals.mainBundle = manifest["main.js"] || "no_web_build";
		}

		// Load plugins
		await this.loadPlugins();

		this.wsServer = new WsServer(this);

		// Only start listening for connections after all plugins have loaded
		if (httpPort) {
			this.httpServer = http.createServer(this.app);
			this.httpServerCloser = new HttpCloser(this.httpServer);
			await this.listen(this.httpServer, httpPort, bindAddress);
			logger.info(`Listening for HTTP on port ${(this.httpServer.address() as AddressInfo).port}`);
		}

		if (httpsPort && tls_cert && tls_key) {
			let certificate, privateKey;
			try {
				certificate = await fs.readFile(tls_cert);
				privateKey = await fs.readFile(tls_key);

			} catch (err: any) {
				throw new lib.StartupError(
					`Error loading ssl certificate: ${err.message}`
				);
			}

			this.httpsServer = https.createServer({
				key: privateKey,
				cert: certificate,
			}, this.app);
			this.httpsServerCloser = new HttpCloser(this.httpsServer);
			await this.listen(this.httpsServer, httpsPort, bindAddress);
			logger.info(`Listening for HTTPS on port ${(this.httpsServer.address() as AddressInfo).port}`);
		}

		this.onAutosaveIntervalChanged();
		this.onSystemMetricsIntervalChanged();

		logger.info("Started controller");
		this._state = "running";
	}

	async _startDevServer(args: ControllerArgs) {
		logger.warn("Webpack development mode enabled");
		/* eslint-disable @typescript-eslint/no-var-requires, node/no-unpublished-require */
		const webpack = require("webpack");
		const webpackDevMiddleware = require("webpack-dev-middleware");
		const webpackConfigs = [];

		if (args.dev) {
			// eslint-disable-next-line node/no-missing-require
			webpackConfigs.push(require("../../webpack.config")({})); // Path outside of build
		}
		if (args.devPlugin) {
			let devPlugins = new Map();
			for (let name of args.devPlugin) {
				let info = this.pluginInfos.find(i => i.name === name);
				if (!info) {
					throw new lib.StartupError(`No plugin named ${name}`);
				}
				let config = require(path.posix.join(info.requirePath, "webpack.config"))({});
				devPlugins.set(name, webpackConfigs.length);
				webpackConfigs.push(config);
			}
			this.app.locals.devPlugins = devPlugins;
		}
		/* eslint-enable @typescript-eslint/no-var-requires, node/no-unpublished-require */

		const compiler = webpack(webpackConfigs);
		this.devMiddleware = webpackDevMiddleware(compiler, { serverSideRender: true });
		this.app.use(this.devMiddleware);
	}

	/**
	 * Stops the controller.
	 *
	 * Save data and bring down the active connections.  This is the reverse
	 * of start and is valid at any point in time.
	 */
	async stop() {
		if (this._state === "starting") {
			this._shouldStop = true;
			await events.once(this._events, "stop");
			return;

		} else if (this._state === "running") {
			await this._stopInternal();
		}

		this._state = "stopped";
		this._events.emit("stop");
	}

	async _stopInternal() {
		// This function should never throw.
		this._state = "stopping";
		logger.info("Stopping controller");

		if (this.clusterLogBuildInterval) {
			clearInterval(this.clusterLogBuildInterval);
		}

		if (this.systemMetricsInterval) {
			clearInterval(this.systemMetricsInterval);
			this.systemMetricsInterval = undefined;
		}

		if (this.autosaveInterval) {
			clearInterval(this.autosaveInterval);
			this.autosaveInterval = undefined;
		}

		if (this.clusterLogIndex) {
			await this.clusterLogIndex.save();
		}

		if (this.devMiddleware) {
			await new Promise((resolve, reject) => { this.devMiddleware.close(resolve); });
		}

		await lib.invokeHook(this.plugins, "onShutdown");

		await this.wsServer.stop();

		let stopTasks = [];
		logger.info("Stopping HTTP(S) server");
		if (this.httpServer && this.httpServer.listening && this.httpServerCloser) {
			stopTasks.push(this.httpServerCloser.close());
		}
		if (this.httpsServer && this.httpsServer.listening && this.httpsServerCloser) {
			stopTasks.push(this.httpsServerCloser.close());
		}
		await Promise.all(stopTasks);

		logger.info("Saving data");
		await this.saveData();
		logger.info("Goodbye");
	}

	onSystemMetricsIntervalChanged() {
		if (this.systemMetricsInterval) {
			clearInterval(this.systemMetricsInterval);
			this.systemMetricsInterval = undefined;
		}
		const systemMetricsIntervalSeconds = this.config.get("controller.system_metrics_interval");
		if (systemMetricsIntervalSeconds > 0) {
			this.systemMetricsInterval = setInterval(
				this.updateSystemMetrics.bind(this),
				systemMetricsIntervalSeconds * 1000
			);
		}
	}

	async updateSystemMetrics() {
		try {
			const requests: Promise<lib.SystemMetrics>[] = [];
			for (let hostConnection of this.wsServer.hostConnections.values()) {
				if (!hostConnection.connected) {
					continue;
				}
				requests.push(hostConnection.send(new lib.SystemMetricsRequest()));
			}
			requests.push(lib.gatherSystemMetrics("controller"));
			const newMetrics = await Promise.all(requests);
			for (const metric of newMetrics) {
				this.systemMetrics.set(metric.id, metric);
			}
			this.systemMetricsDirty = true;
			this.subscriptions.broadcast(new lib.SystemMetricsUpdateEvent(newMetrics));
		} catch (err: any) {
			logger.error(`Unexpected error updating system metrics:\n${err.stack ?? err.message}`);
		}
	}

	onAutosaveIntervalChanged() {
		if (this.autosaveInterval) {
			clearInterval(this.autosaveInterval);
			this.autosaveInterval = undefined;
		}
		const autosaveIntervalSeconds = this.config.get("controller.autosave_interval");
		if (autosaveIntervalSeconds > 0) {
			this.autosaveInterval = setInterval(this.saveData.bind(this), autosaveIntervalSeconds * 1000);
		}
	}

	/**
	 * Save all data currently in memory to disk
	 *
	 * Note: If a save is currently in progress this will wait until that
	 * completes and start another save.
	 */
	async saveData() {
		await this._saveDataAsyncSerial.invoke();
	}

	private _saveDataAsyncSerial = new lib.AsyncSerialMergingCallback(async () => {
		try {
			await this._saveDataInternal();
		} catch (err: any) {
			logger.error(`Unexpected error during saveData:\n${err.stack}`);
		}
	});

	private async _saveDataInternal() {
		if (this.config.dirty) {
			this.config.dirty = false;
			await lib.safeOutputFile(this.configPath, JSON.stringify(this.config, null, "\t"));
		}

		let databaseDirectory = this.config.get("controller.database_directory");
		if (this.systemMetricsDirty) {
			this.systemMetricsDirty = false;
			await Controller.saveSystemMetrics(path.join(databaseDirectory, "metrics.json"), this.systemMetrics);
		}

		if (this.hostsDirty) {
			this.hostsDirty = false;
			await Controller.saveHosts(path.join(databaseDirectory, "hosts.json"), this.hosts);
		}

		if (this.instancesDirty) {
			this.instancesDirty = false;
			await Controller.saveInstances(path.join(databaseDirectory, "instances.json"), this.instances);
		}

		if (this.savesDirty) {
			this.savesDirty = false;
			await Controller.saveSaves(path.join(databaseDirectory, "saves.json"), this.saves);
		}

		if (this.modPacksDirty) {
			this.modPacksDirty = false;
			await Controller.saveModPacks(path.join(databaseDirectory, "mod-packs.json"), this.modPacks);
		}

		if (this.userManager.dirty) {
			await this.userManager.save(path.join(databaseDirectory, "users.json"));
		}

		await lib.invokeHook(this.plugins, "onSaveData");
	}

	static async loadSystemMetrics(filePath: string): Promise<Map<lib.SystemMetrics["id"], lib.SystemMetrics>> {
		let json: Static<typeof lib.SystemMetrics.jsonSchema>[];
		try {
			json = JSON.parse(await fs.readFile(filePath, { encoding: "utf8" }));

		} catch (err: any) {
			if (err.code !== "ENOENT") {
				throw err;
			}
			return new Map();
		}

		return new Map(json.map(m => lib.SystemMetrics.fromJSON(m)).map(m => [m.id, m]));
	}

	static async saveSystemMetrics(filePath: string, systemMetrics: Map<lib.SystemMetrics["id"], lib.SystemMetrics>) {
		await lib.safeOutputFile(filePath, JSON.stringify([...systemMetrics.values()], null, "\t"));
	}

	static async loadHosts(filePath: string): Promise<Map<number, HostInfo>> {
		let serialized: [number, Static<typeof HostInfo.jsonSchema>][];
		try {
			serialized = JSON.parse(await fs.readFile(filePath, { encoding: "utf8" }));

		} catch (err: any) {
			if (err.code !== "ENOENT") {
				throw err;
			}
			return new Map();
		}

		// TODO: migrate remove after release.
		if (serialized.length && !(serialized[0] instanceof Array)) {
			return new Map(); // Discard old format.
		}

		const hosts = new Map();
		for (let [id, json] of serialized) {
			const host = HostInfo.fromJSON(json);
			if (host.connected) {
				host.connected = false;
				host.updatedAt = Date.now();
			}
			hosts.set(id, host);
		}
		return hosts;
	}

	static async saveHosts(filePath: string, hosts: Map<number, HostInfo>) {
		await lib.safeOutputFile(filePath, JSON.stringify([...hosts.entries()], null, "\t"));
	}

	static async loadInstances(filePath: string): Promise<Map<number, InstanceInfo>> {
		logger.info(`Loading ${filePath}`);

		let instances = new Map();
		try {
			let serialized = JSON.parse(
				await fs.readFile(filePath, { encoding: "utf8" })
			) as Static<typeof InstanceInfo.jsonSchema>[];
			for (let json of serialized) {
				if (!json.config) { // migrate: from pre Alpha 14 format.
					json = { config: json as any, status: "running" }; // Use running to force updatedAt
				}
				const instance = InstanceInfo.fromJSON(json, "controller");
				const status = instance.config.get("instance.assigned_host") === null ? "unassigned" : "unknown";
				if (instance.status !== status) {
					instance.status = status;
					instance.updatedAt = Date.now();
				}
				instances.set(instance.id, instance);
			}

		} catch (err: any) {
			if (err.code !== "ENOENT") {
				throw err;
			}
			return new Map();
		}

		return instances;
	}

	static async saveInstances(filePath: string, instances: Map<number, InstanceInfo>) {
		let serialized = [...instances.values()];
		await lib.safeOutputFile(filePath, JSON.stringify(serialized, null, "\t"));
	}

	static async loadSaves(filePath: string): Promise<Map<string, lib.SaveDetails>> {
		let json: Static<typeof lib.SaveDetails.jsonSchema>[];
		try {
			json = JSON.parse(await fs.readFile(filePath, { encoding: "utf8" }));
		} catch (err: any) {
			if (err.code !== "ENOENT") {
				throw err;
			}
			return new Map();
		}
		return new Map(json.map(s => lib.SaveDetails.fromJSON(s)).map(s => [s.id, s]));
	}

	static async saveSaves(filePath: string, saves: Map<string, lib.SaveDetails>) {
		await lib.safeOutputFile(filePath, JSON.stringify([...saves.values()], null, "\t"));
	}


	static async loadModPacks(filePath: string): Promise<Map<number, lib.ModPack>> {
		let json;
		try {
			json = JSON.parse(await fs.readFile(filePath, { encoding: "utf8" }));
		} catch (err: any) {
			if (err.code !== "ENOENT") {
				throw err;
			}
			return new Map();
		}
		return new Map(json.map((e: any) => [e.id, lib.ModPack.fromJSON(e)]));
	}

	static async saveModPacks(filePath: string, modPacks: Map<number, lib.ModPack>) {
		await lib.safeOutputFile(filePath, JSON.stringify([...modPacks.values()], null, "\t"));
	}

	static async loadJsonObject(filePath: string, throwOnMissing: boolean = false): Promise<any> {
		let manifest = {};
		try {
			manifest = JSON.parse(await fs.readFile(filePath, { encoding: "utf8" }));
		} catch (err: any) {
			if (!throwOnMissing && err.code !== "ENOENT") {
				throw err;
			}
		}
		return manifest;
	}

	/**
	 * Query controller log
	 *
	 * @param filter -
	 *     Filter to limit entries with. Note that only the controller log can
	 *     be queried from this function.
	 * @returns log entries matching the filter
	 */
	async queryControllerLog(filter: lib.QueryLogFilter): Promise<object[]> {
		return lib.queryLog(
			path.join(this.logDirectory, "controller"), filter, null,
		);
	}

	/**
	 * Query cluster log
	 *
	 * @param filter -
	 *     Filter to limit entries with.
	 * @returns log entries matching the filter
	 */
	async queryClusterLog(filter: lib.QueryLogFilter): Promise<object[]> {
		return await lib.queryLog(
			path.join(this.logDirectory, "cluster"), filter, this.clusterLogIndex,
		);
	}

	static addAppRoutes(app: Application, pluginInfos: any[]) {
		app.use((req: Request, res: Response, next) => {
			let start = process.hrtime.bigint();
			stream.finished(res, () => {
				let routePath = "static";
				if (req.route && req.route.path) {
					routePath = req.route.path;
				}
				let end = process.hrtime.bigint();
				endpointDurationSummary.labels(routePath).observe(Number(end - start) / 1e9);
			});
			next();
		});
		app.use(compression());

		// Set folder to serve static content from (the website)
		const staticOptions = { immutable: true, maxAge: 1000 * 86400 * 365 };
		app.use("/static",
			express.static(path.join(__dirname, "..", "..", "dist", "web", "static"), staticOptions)
		);
		app.use("/static", express.static("static", staticOptions)); // Used for data export files

		// Add API routes
		routes.addRouteHandlers(app);

		// Add routes for the web interface
		for (let route of routes.webRoutes) {
			app.get(route, Controller.serveWeb(route));
		}
		for (let pluginInfo of pluginInfos) {
			for (let route of pluginInfo.routes || []) {
				app.get(route, Controller.serveWeb(route));
			}

			let pluginPackagePath = require.resolve(path.posix.join(pluginInfo.requirePath, "package.json"));
			let webPath = path.join(path.dirname(pluginPackagePath), "dist", "web", "static");
			app.use("/static", express.static(webPath, staticOptions));
		}
	}

	async handleSystemMetricsSubscription(request: lib.SubscriptionRequest) {
		const systemMetrics = [...this.systemMetrics.values()].filter(
			metric => metric.updatedAt > request.lastRequestTime,
		);
		return systemMetrics.length ? new lib.SystemMetricsUpdateEvent(systemMetrics) : null;
	}

	/**
	 * Generate access token for host
	 *
	 * @returns access token for host
	 * @param hostId - ID of host to generate a token for.
	 */
	generateHostToken(hostId: number): string {
		return jwt.sign(
			{ aud: "host", host: hostId },
			Buffer.from(this.config.get("controller.auth_secret"), "base64")
		);
	}

	hostsUpdated(hosts: HostInfo[]) {
		const now = Date.now();
		for (const host of hosts) {
			host.updatedAt = now;
		}
		this.hostsDirty = true;
		let updates = hosts.map(host => host.toHostDetails());
		this.subscriptions.broadcast(new lib.HostUpdatesEvent(updates));
	}

	async handleHostSubscription(request: lib.SubscriptionRequest) {
		const hosts = [...this.hosts.values()].filter(
			host => host.updatedAt > request.lastRequestTime,
		).map(host => host.toHostDetails());
		return hosts.length ? new lib.HostUpdatesEvent(hosts) : null;
	}

	/**
	 * Get instance by ID for a request
	 *
	 * @param instanceId - ID of instance to get.
	 * @returns Info for the given instance if it exists
	 * @throws {module:lib.RequestError} if the instance does not exist.
	 */
	getRequestInstance(instanceId:number): InstanceInfo {
		let instance = this.instances.get(instanceId);
		if (!instance) {
			throw new lib.RequestError(`Instance with ID ${instanceId} does not exist`);
		}
		return instance;
	}

	/**
	 * Create a new instance
	 *
	 * Adds common Factorio settings to the provided instance config then
	 * creates an instance using that config in the cluster.
	 *
	 * @example
	 * let instanceConfig = new lib.InstanceConfig("controller");
	 * instanceConfig.set("instance.name", "My instance");
	 * let instance = await controller.instanceAssign(instanceConfig);
	 * await controller.instanceAssign(instance.id, hostId);
	 *
	 * @param instanceConfig -
	 *     Config to base newly created instance on.
	 * @returns The created instance
	 */
	async instanceCreate(instanceConfig: lib.InstanceConfig): Promise<InstanceInfo> {
		let instanceId = instanceConfig.get("instance.id");
		if (this.instances.has(instanceId)) {
			throw new lib.RequestError(`Instance with ID ${instanceId} already exists`);
		}

		// Add common settings for the Factorio server
		let settings = {
			"name": `${this.config.get("controller.name")} - ${instanceConfig.get("instance.name")}`,
			"description": `Clusterio instance for ${this.config.get("controller.name")}`,
			"tags": ["clusterio"],
			"max_players": 0,
			"visibility": { "public": true, "lan": true },
			"username": "",
			"token": "",
			"game_password": "",
			"require_user_verification": true,
			"max_upload_in_kilobytes_per_second": 0,
			"max_upload_slots": 5,
			"ignore_player_limit_for_returning_players": false,
			"allow_commands": "admins-only",
			"autosave_interval": 10,
			"autosave_slots": 5,
			"afk_autokick_interval": 0,
			"auto_pause": false,
			"only_admins_can_pause_the_game": true,
			"autosave_only_on_server": true,
			"non_blocking_saving": false,

			...instanceConfig.get("factorio.settings"),
		};
		instanceConfig.set("factorio.settings", settings);

		let instance = new InstanceInfo(instanceConfig, "unassigned", undefined, Date.now());
		this.instances.set(instanceId, instance);
		this.instancesDirty = true;
		await lib.invokeHook(this.plugins, "onInstanceStatusChanged", instance);
		this.addInstanceHooks(instance);
		this.instanceDetailsUpdated([instance]);
		return instance;
	}

	/**
	 * Removes all saves currently stored for the given instance, if any
	 * @param instanceId - Id of Instance to clear saves for.
	 * @internal
	 */
	clearSavesOfInstance(instanceId: number) {
		const updates = [];
		for (const [id, save] of this.saves) {
			if (save.instanceId === instanceId) {
				save.isDeleted = true;
				updates.push(save);
				this.saves.delete(id);
			}
		}
		if (updates.length) {
			this.savesUpdated(updates);
		}
	}

	/**
	 * Change assigned host of an instance
	 *
	 * Unassigns instance from existing host if already assigned to one and
	 * then assigns it to the given host.  This is the only supported way of
	 * changing the instance.assigned_host config entry.
	 *
	 * Note: this will not transfer any files or saves stored on the host
	 * the instance was previously assgined to the new one.
	 *
	 * @param instanceId - ID of Instance to assign.
	 * @param hostId - ID of host to assign instance to.
	 */
	async instanceAssign(instanceId: number, hostId?: number) {
		let instance = this.getRequestInstance(instanceId);

		// Check if target host is connected
		let newHostConnection: HostConnection | undefined;
		if (hostId !== undefined) {
			newHostConnection = this.wsServer.hostConnections.get(hostId);
			if (!newHostConnection) {
				// The case of the host not getting the assign instance message
				// still have to be handled, so it's not a requirement that the
				// target host be connected to the controller while doing the
				// assignment, but it is IMHO a better user experience if this
				// is the case.
				throw new lib.RequestError("Target host is not connected to the controller");
			}
		}

		// Unassign from currently assigned host if it is connected.
		let currentAssignedHost = instance.config.get("instance.assigned_host");
		if (currentAssignedHost !== null && hostId !== currentAssignedHost) {
			let oldHostConnection = this.wsServer.hostConnections.get(currentAssignedHost);
			if (oldHostConnection && !oldHostConnection.connector.closing) {
				await oldHostConnection.send(new lib.InstanceUnassignInternalRequest(instanceId));
			}
		}

		// Remove saves recorded from currently assigned host if any
		this.clearSavesOfInstance(instanceId);

		// Assign to target
		instance.config.set("instance.assigned_host", hostId ?? null);
		// "fieldChanged" event handler will set this.instancesDirty
		if (hostId !== undefined && newHostConnection) {
			await newHostConnection.send(
				new lib.InstanceAssignInternalRequest(instanceId, instance.config.toRemote("host"))
			);
		} else {
			instance.status = "unassigned";
			this.instanceDetailsUpdated([instance]);
		}
	}

	/**
	 * Delete an instance
	 *
	 * Permanently deletes the instance from its assigned host (if assigned)
	 * and the controller.  This action cannot be undone.
	 *
	 * @param instanceId - ID of instance to delete.
	 */
	async instanceDelete(instanceId: number) {
		let instance = this.getRequestInstance(instanceId);
		let hostId = instance.config.get("instance.assigned_host");
		if (hostId !== null) {
			await this.sendTo({ hostId }, new lib.InstanceDeleteInternalRequest(instanceId));
		}
		this.instances.delete(instanceId);
		this.instancesDirty = true;

		this.clearSavesOfInstance(instanceId);

		let prev = instance.status;
		instance.status = "deleted";
		instance.updatedAt = Date.now();
		this.instanceDetailsUpdated([instance]);
		await lib.invokeHook(this.plugins, "onInstanceStatusChanged", instance, prev);
	}

	/**
	 * Notify the config of an instance updated
	 *
	 * Used to push config changes to the assigned host when the config of
	 * an instance has changed.
	 *
	 * @param instance -
	 *     Instance to nodify the config updated.
	 */
	async instanceConfigUpdated(instance: InstanceInfo) {
		let hostId = instance.config.get("instance.assigned_host");
		if (hostId !== null) {
			let connection = this.wsServer.hostConnections.get(hostId);
			if (connection) {
				await connection.send(
					new lib.InstanceAssignInternalRequest(instance.id, instance.config.toRemote("host"))
				);
			}
		}
	}

	addInstanceHooks(instance: InstanceInfo) {
		instance.config.on("fieldChanged", (field: string, curr: any, prev: any) => {
			instance.updatedAt = Date.now();
			if (field === "instance.name") {
				this.instanceDetailsUpdated([instance]);
			}

			this.instancesDirty = true;
			lib.invokeHook(this.plugins, "onInstanceConfigFieldChanged", instance, field, curr, prev);
		});
	}

	instanceDetailsUpdated(instances: InstanceInfo[]) {
		const updates = instances.map(instance => instance.toInstanceDetails());
		this.subscriptions.broadcast(new lib.InstanceDetailsUpdatesEvent(updates));
	}

	async handleInstanceDetailsSubscription(request: lib.SubscriptionRequest) {
		const instances = [...this.instances.values()].filter(
			instance => instance.updatedAt > request.lastRequestTime,
		).map(instance => instance.toInstanceDetails());
		return instances.length ? new lib.InstanceDetailsUpdatesEvent(instances) : null;
	}

	savesUpdated(saves: lib.SaveDetails[]) {
		this.savesDirty = true;
		this.subscriptions.broadcast(new lib.InstanceSaveDetailsUpdatesEvent(saves));
	}

	async handleInstanceSaveDetailsSubscription(request: lib.SubscriptionRequest) {
		const saves = [...this.saves.values()].filter(save => save.updatedAt > request.lastRequestTime);
		return saves.length ? new lib.InstanceSaveDetailsUpdatesEvent(saves) : null;
	}


	modPacksUpdated(modPacks: lib.ModPack[]) {
		const now = Date.now();
		for (const modPack of modPacks) {
			modPack.updatedAt = now;
		}
		this.modPacksDirty = true;
		this.subscriptions.broadcast(new lib.ModPackUpdatesEvent(modPacks));
		lib.invokeHook(this.plugins, "onModPacksUpdated", modPacks);
	}

	async handleModPackSubscription(request: lib.SubscriptionRequest) {
		const modPacks = [...this.modPacks.values()].filter(
			modPack => modPack.updatedAt > request.lastRequestTime,
		);
		return modPacks.length ? new lib.ModPackUpdatesEvent(modPacks) : null;
	}

	modsUpdated(mods: lib.ModInfo[]) {
		// ModStore sets updatedAt for mods
		this.subscriptions.broadcast(new lib.ModUpdatesEvent(mods));
		lib.invokeHook(this.plugins, "onModsUpdated", mods);
	}

	async handleModSubscription(request: lib.SubscriptionRequest) {
		const mods = [...this.modStore.files.values()].filter(
			mod => mod.updatedAt > request.lastRequestTime,
		);
		return mods.length ? new lib.ModUpdatesEvent(mods) : null;
	}

	usersUpdated(users: ControllerUser[]) {
		const now = Date.now();
		for (const user of users) {
			user.updatedAt = now;
		}
		this.userManager.dirty = true;
		this.subscriptions.broadcast(new lib.UserUpdatesEvent(users));
	}

	async handleUserSubscription(request: lib.SubscriptionRequest) {
		const users = [...this.userManager.users.values()].filter(
			user => user.updatedAt > request.lastRequestTime,
		);
		return users.length ? new lib.UserUpdatesEvent(users) : null;
	}

	/**
	 * Notify connected control clients under the given user that the
	 * permissions for this user may have changed.
	 * @param user - User permisions updated for.
	 */
	userPermissionsUpdated(user: ControllerUser) {
		for (let controlConnection of this.wsServer.controlConnections.values()) {
			if (controlConnection.user === user) {
				controlConnection.send(
					new lib.AccountUpdateEvent([...user.roles].map(r => ({
						name: r.name,
						id: r.id,
						permissions: [...r.permissions],
					})))
				);
			}
		}
	}

	/**
	 * Notify connected control clients with the given role that the
	 * permissions may have changed.
	 * @param role - Role permisions updated for.
	 */
	rolePermissionsUpdated(role: lib.Role) {
		for (let controlConnection of this.wsServer.controlConnections.values()) {
			if (controlConnection.user.roles.has(role)) {
				controlConnection.send(
					new lib.AccountUpdateEvent(
						[...controlConnection.user.roles].map(r => ({
							name: r.name,
							id: r.id,
							permissions: [...r.permissions],
						}))
					)
				);
			}
		}
	}

	async loadPlugins() {
		for (let pluginInfo of this.pluginInfos) {
			try {
				let manifestPath = path.posix.join(pluginInfo.requirePath, "dist", "web", "manifest.json");
				pluginInfo.manifest = await Controller.loadJsonObject(require.resolve(manifestPath), true);
			} catch (err) {
				logger.warn(`Unable to load dist/web/manifest.json for plugin ${pluginInfo.name}`);
			}

			if (!this.config.get(`${pluginInfo.name}.load_plugin` as keyof lib.ControllerConfigFields)) {
				continue;
			}

			let ControllerPluginClass = BaseControllerPlugin;
			try {
				if (pluginInfo.controllerEntrypoint) {
					ControllerPluginClass = await lib.loadPluginClass(
						pluginInfo.name,
						path.posix.join(pluginInfo.requirePath, pluginInfo.controllerEntrypoint),
						"ControllerPlugin",
						BaseControllerPlugin,
					);
				}

				let controllerPlugin = new ControllerPluginClass(pluginInfo, this, metrics as any, logger);
				await controllerPlugin.init();
				this.plugins.set(pluginInfo.name, controllerPlugin);

			} catch (err: any) {
				throw new lib.PluginError(pluginInfo.name, err);
			}

			logger.info(`Loaded plugin ${pluginInfo.name}`);
		}
	}

	/**
	 * Calls listen on server capturing any errors that occurs
	 * binding to the port.  Also adds handler for WebSocket
	 * upgrade event.
	 *
	 * @param {module:net.Server} server - Server to start the listening on.
	 * @param {*} args - Arguments to the .listen() call on the server.
	 * @returns {Promise} promise that resolves the server is listening.
	 */
	listen(server: http.Server|https.Server, ...args: any[]): Promise<void> {
		return new Promise((resolve, reject) => {
			server.on("upgrade", (req, socket, head) => {
				logger.verbose("handling WebSocket upgrade");
				this.wsServer.handleUpgrade(req, socket, head);
			});

			function wrapError(err: any) {
				reject(new lib.StartupError(
					`Server listening failed: ${err.message}`
				));
			}

			server.once("error", wrapError);
			server.listen(...args, () => {
				server.off("error", wrapError);
				resolve();
			});
		});
	}


	/**
	 * Returns the URL needed to connect to the controller.
	 *
	 * @returns controller URL.
	 */
	getControllerUrl(): string {
		return Controller.calculateControllerUrl(this.config);
	}

	static calculateControllerUrl(config: lib.ControllerConfig) {
		let url = config.get("controller.external_address");
		if (!url) {
			if (config.get("controller.https_port")) {
				url = `https://localhost:${config.get("controller.https_port")}/`;
			} else {
				url = `http://localhost:${config.get("controller.http_port")}/`;
			}
		}
		return url;
	}

	/**
	 * Servers the web interface with the root path set apropriately
	 *
	 * @param route - route the interface is served under.
	 * @returns Experess.js route handler.
	 */
	static serveWeb(route: string) {
		// The depth is is the number of slashes in the route minus one, but due
		// to lenient matching on trailing slashes in the route we need to
		// compensate if the request path contains a slash but not the route,
		// and vice versa.
		let routeDepth = (route.match(/\//g) || []).length - 1 - Number(route.slice(-1) === "/");
		return function(req: Request, res: Response, next: NextFunction) {
			let depth = routeDepth + Number(req.path.slice(-1) === "/");
			let webRoot = "../".repeat(depth) || "./";
			let staticRoot = webRoot;
			let mainBundle: string = "";
			if (res.app.locals.mainBundle) {
				mainBundle = res.app.locals.mainBundle;
			} else {
				let stats = res.locals.webpack.devMiddleware.stats.stats[0];
				mainBundle = stats.toJson().assetsByChunkName["main"];
			}

			fs.readFile(path.join(__dirname, "..", "..", "web", "index.html"), "utf8").then((content) => {
				res.type("text/html");
				res.send(content
					.replace(/__CLUSTER_NAME__/g, res.app.locals.controller.config.get("controller.name"))
					.replace(/__WEB_ROOT__/g, webRoot)
					.replace(/__STATIC_ROOT__/g, staticRoot)
					.replace(/__MAIN_BUNDLE__/g, mainBundle)
				);
			}).catch(err => {
				next(err);
			});
		};
	}

	handle(Class: any, handler: any) {
		if (Class.type === "request") {
			this.handleRequest(Class, handler);
		} else if (Class.type === "event") {
			this.handleEvent(Class, handler);
		} else {
			throw new Error(`Class ${Class.name} has unrecognized type ${Class.type}`);
		}
	}

	handleRequest(Request: any, handler: any) {
		if (!lib.Link._requestsByClass.has(Request)) {
			throw new Error(`Unregistered Request class ${Request.name}`);
		}
		if (this._registeredRequests.has(Request)) {
			throw new Error(`Request ${Request.name} is already registered`);
		}
		this._registeredRequests.set(Request, handler);
	}

	fallbackRequest(Request: any, handler: any) {
		if (!lib.Link._requestsByClass.has(Request)) {
			throw new Error(`Unregistered Request class ${Request.name}`);
		}
		if (this._fallbackedRequests.has(Request)) {
			throw new Error(`Request ${Request.name} is already fallbacked`);
		}
		this._fallbackedRequests.set(Request, handler);
	}

	handleEvent(Event: any, handler: any) {
		if (!lib.Link._eventsByClass.has(Event)) {
			throw new Error(`Unregistered Event class ${Event.name}`);
		}
		if (this._registeredEvents.has(Event)) {
			throw new Error(`Event ${Event.name} is already registered`);
		}
		this._registeredEvents.set(Event, handler);
	}

	snoopEvent(Event: any, handler: any) {
		if (!lib.Link._eventsByClass.has(Event)) {
			throw new Error(`Unregistered Event class ${Event.name}`);
		}
		if (this._snoopedEvents.has(Event)) {
			throw new Error(`Event ${Event.name} is already snooped`);
		}
		this._snoopedEvents.set(Event, handler);
	}

	/**
	 * Send request or event
	 *
	 * Routes the given request or event to the given destination.  The
	 * destination argument supports address shorthands, see {@link
	 * module:lib.Address.fromShorthand}
	 *
	 * @param address - Where to send it.
	 * @param requestOrEvent - The request or event to send.
	 * @returns
	 *     Promise that resolves to the response if a request was sent or
	 *     undefined if it was an event.
	 */
	sendTo(address: lib.AddressShorthand, requestOrEvent: any): Promise<any> | void {
		let dst = lib.Address.fromShorthand(address);
		if (requestOrEvent.constructor.type === "request") {
			return this.sendRequest(requestOrEvent, dst);
		}
		if (requestOrEvent.constructor.type === "event") {
			return this.sendEvent(requestOrEvent, dst);
		}
		throw Error(`Unknown type ${requestOrEvent.constructor.type}.`);
	}

	async sendRequest(request: any, dst: lib.Address) {
		let connection;
		if (dst.type === lib.Address.controller) {
			throw new Error("controller as dst is not supported.");

		} else if (dst.type === lib.Address.control) {
			connection = this.wsServer.controlConnections.get(dst.id);
			if (!connection) {
				throw new lib.RequestError("Target control connection does not exist.");
			}

		} else if (dst.type === lib.Address.instance) {
			let instance = this.getRequestInstance(dst.id);
			let hostId = instance.config.get("instance.assigned_host");
			if (hostId === null) {
				throw new lib.RequestError("Instance is not assigned to a host");
			}
			connection = this.wsServer.hostConnections.get(hostId);
			if (!connection) {
				throw new lib.RequestError("Host containing instance is not connected");
			}

		} else if (dst.type === lib.Address.host) {
			connection = this.wsServer.hostConnections.get(dst.id);
			if (!connection) {
				throw new lib.RequestError("Host is not connected");
			}

		} else {
			throw new Error(`Unknown address type ${dst.type}`);
		}

		return connection.sendRequest(request, dst);
	}

	sendEvent<T>(event: lib.Event<T>, dst: lib.Address) {
		let connection;
		if (dst.type === lib.Address.controller) {
			throw new Error("controller as dst is not supported.");

		} else if (dst.type === lib.Address.control) {
			connection = this.wsServer.controlConnections.get(dst.id);

		} else if (dst.type === lib.Address.instance) {
			let instance = this.instances.get(dst.id);
			if (!instance) {
				return;
			}
			let hostId = instance.config.get("instance.assigned_host");
			if (hostId === null) {
				return;
			}
			connection = this.wsServer.hostConnections.get(hostId);

		} else if (dst.type === lib.Address.host) {
			connection = this.wsServer.hostConnections.get(dst.id);

		} else if (dst.type === lib.Address.broadcast) {
			if (dst.id === lib.Address.control) {
				for (let controlConnection of this.wsServer.controlConnections.values()) {
					controlConnection.sendEvent(event, dst);
				}

			} else if (dst.id === lib.Address.instance || dst.id === lib.Address.host) {
				for (let hostConnection of this.wsServer.hostConnections.values()) {
					hostConnection.sendEvent(event, dst);
				}

			} else {
				throw new Error(`Unexpected broacdast target ${dst.id}`);
			}
			return;

		} else {
			throw new Error(`Unknown address type ${dst.type}`);
		}

		if (connection) {
			connection.sendEvent(event, dst);
		}
	}

	async sendToHostByInstanceId<Req extends InstanceId, Res>(request: Req & lib.Request<Req, Res>): Promise<Res>;
	sendToHostByInstanceId<T extends InstanceId>(event: T & lib.Event<T>): void;
	async sendToHostByInstanceId(requestOrEvent: lib.Request<unknown, unknown> | lib.Event<unknown>) {
		if (requestOrEvent.constructor.type === "request") {
			return this.sendRequestToHostByInstanceId(requestOrEvent as any);
		}
		if (requestOrEvent.constructor.type === "event") {
			return this.sendEventToHostByInstanceId(requestOrEvent as any);
		}
		throw Error(`Unknown type ${(requestOrEvent.constructor as any).type}.`);
	}

	async sendRequestToHostByInstanceId<Req extends InstanceId, Res>(request: Req & lib.Request<Req, Res>) {
		let instance = this.getRequestInstance(request.instanceId);
		let hostId = instance.config.get("instance.assigned_host");
		if (hostId === null) {
			throw new lib.RequestError("Instance is not assigned to a host");
		}
		let connection = this.wsServer.hostConnections.get(hostId);
		if (!connection) {
			throw new lib.RequestError("Host containing instance is not connected");
		}
		return await connection.send(request);
	}

	sendEventToHostByInstanceId<T extends { instanceId: number }>(event: T & lib.Event<T>) {
		let instance = this.getRequestInstance(event.instanceId);
		let hostId = instance.config.get("instance.assigned_host");
		if (hostId === null) {
			return;
		}
		let connection = this.wsServer.hostConnections.get(hostId);
		if (!connection) {
			return;
		}
		connection.send(event);
	}
}
