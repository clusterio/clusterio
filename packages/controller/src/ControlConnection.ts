import type WsServerConnector from "./WsServerConnector";

import events from "events";

import * as lib from "@clusterio/lib";
const { logFilter, logger } = lib;

import BaseConnection from "./BaseConnection";
import ControllerUser from "./ControllerUser";
import * as routes from "./routes";
import Controller from "./Controller";

const strcmp = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" }).compare;

const queryLogTime = new lib.Summary(
	"clusterio_controller_query_log_duration_seconds",
	"Time in seconds log queries took to execute."
);

/**
 * Represents the connection to a control link
 *
 * @extends module:controller/src/BaseConnection
 * @alias module:controller/src/ControlConnection
 */
export default class ControlConnection extends BaseConnection {
	private _version: string;
	logTransport: lib.LinkTransport | null = null;
	logSubscriptions = {
		all: false,
		controller: false,
		hostIds: [] as number[],
		instanceIds: [] as number[],
	};

	ws_dumper: ((...args: any[]) => void) | null = null;
	declare connector: WsServerConnector;

	constructor(
		registerData: { version: string },
		connector: WsServerConnector,
		controller: Controller,
		public user: ControllerUser, // The user making this connection.
		public id: number
	) {
		super(connector, controller);

		this._version = registerData.version;

		this.connector.on("connect", () => {
			this.connector._socket!.clusterio_ignore_dump = Boolean(this.ws_dumper);
		});
		this.connector.on("close", () => {
			if (this.logTransport) {
				logger.remove(this.logTransport);
				this.logTransport = null;
			}
			if (this.ws_dumper) {
				this._controller.debugEvents.off("message", this.ws_dumper);
			}
		});

		for (let event of ["connect", "drop", "resume", "close"] as const) {
			this.connector.on(event, () => {
				for (let controllerPlugin of this._controller.plugins.values()) {
					controllerPlugin.onControlConnectionEvent(this, event);
				}
			});
		}

		this.handle(lib.ControllerStopRequest, this.handleControllerStopRequest.bind(this));
		this.handle(lib.ControllerRestartRequest, this.handleControllerRestartRequest.bind(this));
		this.handle(lib.ControllerUpdateRequest, this.handleControllerUpdateRequest.bind(this));
		this.handle(lib.ControllerConfigGetRequest, this.handleControllerConfigGetRequest.bind(this));
		this.handle(lib.ControllerConfigSetFieldRequest, this.handleControllerConfigSetFieldRequest.bind(this));
		this.handle(lib.ControllerConfigSetPropRequest, this.handleControllerConfigSetPropRequest.bind(this));
		this.handle(lib.HostRevokeTokensRequest, this.handleHostRevokeTokensRequest.bind(this));
		this.handle(lib.HostListRequest, this.handleHostListRequest.bind(this));
		this.handle(lib.HostGenerateTokenRequest, this.handleHostGenerateTokenRequest.bind(this));
		this.handle(lib.HostConfigCreateRequest, this.handleHostConfigCreateRequest.bind(this));
		this.handle(lib.InstanceDetailsGetRequest, this.handleInstanceDetailsGetRequest.bind(this));
		this.handle(lib.InstanceDetailsListRequest, this.handleInstanceDetailsListRequest.bind(this));
		this.handle(lib.InstanceCreateRequest, this.handleInstanceCreateRequest.bind(this));
		this.handle(lib.InstanceDeleteRequest, this.handleInstanceDeleteRequest.bind(this));
		this.handle(lib.InstanceConfigGetRequest, this.handleInstanceConfigGetRequest.bind(this));
		this.handle(lib.InstanceConfigSetFieldRequest, this.handleInstanceConfigSetFieldRequest.bind(this));
		this.handle(lib.InstanceConfigSetPropRequest, this.handleInstanceConfigSetPropRequest.bind(this));
		this.handle(lib.InstanceAssignRequest, this.handleInstanceAssignRequest.bind(this));
		this.handle(lib.InstanceSaveDetailsListRequest, this.handleInstanceSaveDetailsListRequest.bind(this));
		this.handle(lib.InstanceRenameSaveRequest, controller.sendRequestToHostByInstanceId.bind(controller));
		this.handle(lib.InstanceCopySaveRequest, controller.sendRequestToHostByInstanceId.bind(controller));
		this.handle(lib.InstanceDeleteSaveRequest, controller.sendRequestToHostByInstanceId.bind(controller));
		this.handle(lib.InstanceDownloadSaveRequest, this.handleInstanceDownloadSaveRequest.bind(this));
		this.handle(lib.InstanceTransferSaveRequest, this.handleInstanceTransferSaveRequest.bind(this));
		this.handle(lib.ModPackListRequest, this.handleModPackListRequest.bind(this));
		this.handle(lib.ModPackCreateRequest, this.handleModPackCreateRequest.bind(this));
		this.handle(lib.ModPackUpdateRequest, this.handleModPackUpdateRequest.bind(this));
		this.handle(lib.ModPackDeleteRequest, this.handleModPackDeleteRequest.bind(this));
		this.handle(lib.ModGetRequest, this.handleModGetRequest.bind(this));
		this.handle(lib.ModListRequest, this.handleModListRequest.bind(this));
		this.handle(lib.ModSearchRequest, this.handleModSearchRequest.bind(this));
		this.handle(lib.ModPortalGetAllRequest, this.handleModPortalGetAllRequest.bind(this));
		this.handle(lib.ModPortalDownloadRequest, this.handleModPortalDownloadRequest.bind(this));
		this.handle(lib.ModDependencyResolveRequest, this.handleModDependencyResolveRequest.bind(this));
		this.handle(lib.ModDeleteRequest, this.handleModDeleteRequest.bind(this));
		this.handle(lib.LogSetSubscriptionsRequest, this.handleLogSetSubscriptionsRequest.bind(this));
		this.handle(lib.LogQueryRequest, this.handleLogQueryRequest.bind(this));
		this.handle(lib.PermissionListRequest, this.handlePermissionListRequest.bind(this));
		this.handle(lib.RoleListRequest, this.handleRoleListRequest.bind(this));
		this.handle(lib.RoleCreateRequest, this.handleRoleCreateRequest.bind(this));
		this.handle(lib.RoleUpdateRequest, this.handleRoleUpdateRequest.bind(this));
		this.handle(lib.RoleGrantDefaultPermissionsRequest, this.handleRoleGrantDefaultPermissionsRequest.bind(this));
		this.handle(lib.RoleDeleteRequest, this.handleRoleDeleteRequest.bind(this));
		this.handle(lib.UserGetRequest, this.handleUserGetRequest.bind(this));
		this.handle(lib.UserListRequest, this.handleUserListRequest.bind(this));
		this.handle(lib.UserCreateRequest, this.handleUserCreateRequest.bind(this));
		this.handle(lib.UserRevokeTokenRequest, this.handleUserRevokeTokenRequest.bind(this));
		this.handle(lib.UserUpdateRolesRequest, this.handleUserUpdateRolesRequest.bind(this));
		this.handle(lib.UserSetAdminRequest, this.handleUserSetAdminRequest.bind(this));
		this.handle(lib.UserSetBannedRequest, this.handleUserSetBannedRequest.bind(this));
		this.handle(lib.UserSetWhitelistedRequest, this.handleUserSetWhitelistedRequest.bind(this));
		this.handle(lib.UserDeleteRequest, this.handleUserDeleteRequest.bind(this));
		this.handle(lib.UserBulkImportRequest, this.handleUserBulkImportRequest.bind(this));
		this.handle(lib.UserBulkExportRequest, this.handleUserBulkExportRequest.bind(this));
		this.handle(lib.PluginListRequest, this.handlePluginListRequest.bind(this));
		this.handle(lib.PluginUpdateRequest, this.handlePluginUpdateRequest.bind(this));
		this.handle(lib.PluginInstallRequest, this.handlePluginInstallRequest.bind(this));
		this.handle(lib.DebugDumpWsRequest, this.handleDebugDumpWsRequest.bind(this));
		this.handle(lib.FactorioVersionsRequest, this.handleFactorioVersionsRequest.bind(this));
	}

	validateIngress(message: lib.MessageRequest | lib.MessageEvent) {
		let origin = this.connector.dst;
		if (origin.type !== message.src.type || origin.id !== message.src.id) {
			throw new lib.InvalidMessage(`Received message with invalid src ${message.src} from ${origin}`);
		}
	}

	validatePermission(
		message: lib.MessageRequest | lib.MessageEvent,
		entry: lib.RequestEntry | lib.EventEntry
	) {
		try {
			this.checkPermission(message, entry);
		} catch (err: any) {
			this.connector.sendResponseError(new lib.ResponseError(err.message, err.code), message.src);
			logger.audit(`Permission denied for ${message.name} by ${this.user.id} from ${this.connector.dst}`);
			throw err;
		}
	}

	checkPermission(
		message: lib.MessageRequest | lib.MessageEvent,
		entry: lib.RequestEntry | lib.EventEntry
	) {
		let permission;
		if (message.type === "request") {
			permission = (entry as lib.RequestEntry).Request.permission;
		} else if (message.type === "event") {
			permission = (entry as lib.EventEntry).Event.permission;
		} else {
			return;
		}

		if (permission === null) {
			return;
		}

		if (typeof permission === "string") {
			this.user.checkPermission(permission);
			return;
		}

		if (typeof permission === "function") {
			permission(this.user, message);
			return;
		}

		throw new Error("Should be unreachable");
	}

	async handleControllerStopRequest() {
		this._controller.stop();
	}

	async handleControllerRestartRequest() {
		if (!this._controller.canRestart) {
			throw new lib.RequestError("Cannot restart, controller does not have a process monitor to restart it.");
		}
		this._controller.shouldRestart = true;
		this._controller.stop();
	}

	async handleControllerConfigGetRequest() {
		return this._controller.config.toRemote("control");
	}

	async handleControllerConfigSetFieldRequest(request: lib.ControllerConfigSetFieldRequest) {
		this._controller.config.set(request.field as keyof lib.ControllerConfigFields, request.value, "control");
	}

	async handleControllerConfigSetPropRequest(request: lib.ControllerConfigSetPropRequest) {
		let { field, prop, value } = request;
		this._controller.config.setProp(field as keyof lib.ControllerConfigFields, prop, value, "control");
	}

	async handleHostRevokeTokensRequest(request: lib.HostRevokeTokensRequest) {
		const host = this._controller.hosts.getMutable(request.hostId);
		if (!host) {
			throw new Error(`Unknown host id (${request.hostId})`);
		}

		host.tokenValidAfter = Math.floor(Date.now() / 1000);

		const hostConnection = this._controller.wsServer.hostConnections.get(request.hostId);
		if (hostConnection) {
			hostConnection.connector.terminate();
		}

		this._controller.hosts.set(host);
	}

	async handleHostListRequest(): Promise<lib.HostDetails[]> {
		return [...this._controller.hosts.values()].map(host => host.toHostDetails());
	}

	async handleHostGenerateTokenRequest(message: lib.HostGenerateTokenRequest) {
		let hostId = message.hostId;
		if (hostId === undefined) {
			hostId = Math.random() * 2**31 | 0;
		}
		return this._controller.generateHostToken(hostId);
	}

	async handleHostConfigCreateRequest(request: lib.HostConfigCreateRequest) {
		const hostConfig = new lib.HostConfig("host");

		hostConfig.set("host.controller_url", this._controller.getControllerUrl());
		if (request.id !== undefined) {
			hostConfig.set("host.id", request.id);
		}
		if (request.name !== undefined) {
			hostConfig.set("host.name", request.name);
		}
		if (request.generateToken) {
			this.user.checkPermission("core.host.generate_token");
			hostConfig.set("host.controller_token", this._controller.generateHostToken(hostConfig.get("host.id")));
		}
		return hostConfig.toJSON();
	}

	async handleInstanceDetailsGetRequest(request: lib.InstanceDetailsGetRequest) {
		return this._controller.getRequestInstance(request.instanceId).toInstanceDetails();
	}

	async handleInstanceDetailsListRequest() {
		return [...this._controller.instances.values()].map(instance => instance.toInstanceDetails());
	}

	async handleInstanceCreateRequest(request: lib.InstanceCreateRequest) {
		const instanceConfig = new lib.InstanceConfig("controller");
		if (request.cloneFromId) {
			const baseInstance = this._controller.instances.get(request.cloneFromId);
			if (!baseInstance) {
				throw new lib.RequestError(`Instance with ID ${request.cloneFromId} does not exist`);
			}
			instanceConfig.update(baseInstance.config.toJSON(), false);
			instanceConfig.set("instance.assigned_host", null); // New instances are unassigned
		}
		instanceConfig.update(request.config, false, "control");
		await this._controller.instanceCreate(instanceConfig);
	}

	async handleInstanceDeleteRequest(request: lib.InstanceDeleteRequest) {
		await this._controller.instanceDelete(request.instanceId);
	}

	async handleInstanceConfigGetRequest(request: lib.InstanceConfigGetRequest) {
		let instance = this._controller.getRequestInstance(request.instanceId);
		return instance.config.toRemote("control");
	}

	async handleInstanceConfigSetFieldRequest(request: lib.InstanceConfigSetFieldRequest) {
		let instance = this._controller.getRequestInstance(request.instanceId);
		if (request.field === "instance.assigned_host") {
			throw new lib.RequestError("instance.assigned_host must be set through the assign-host interface");
		}

		if (request.field === "instance.id") {
			// XXX is this worth implementing?  It's race condition galore.
			throw new lib.RequestError("Setting instance.id is not supported");
		}

		instance.config.set(request.field as keyof lib.InstanceConfigFields, request.value, "control");
		await this._controller.instanceConfigUpdated(instance);
	}

	async handleInstanceConfigSetPropRequest(request: lib.InstanceConfigSetPropRequest) {
		let instance = this._controller.getRequestInstance(request.instanceId);
		let { field, prop, value } = request;
		instance.config.setProp(field as keyof lib.InstanceConfigFields, prop, value, "control");
		await this._controller.instanceConfigUpdated(instance);
	}

	async handleInstanceAssignRequest(request: lib.InstanceAssignRequest) {
		await this._controller.instanceAssign(request.instanceId, request.hostId);
	}

	async handleInstanceSaveDetailsListRequest() {
		return [...this._controller.saves.values()];
	}

	async handleInstanceDownloadSaveRequest(request: lib.InstanceDownloadSaveRequest) {
		let { instanceId, name } = request;
		let stream = await routes.createProxyStream(this._controller.app);
		stream.filename = name;

		let ready = new Promise<void>((resolve, reject) => {
			stream.events.on("source", resolve);
			stream.events.on("timeout", () => reject(
				new lib.RequestError("Timed out establishing stream from host")
			));
		});
		ready.catch(() => {});

		await this._controller.sendToHostByInstanceId(new lib.InstancePushSaveRequest(
			instanceId,
			stream.id,
			name,
		));

		await ready;
		return stream.id;
	}

	async handleInstanceTransferSaveRequest(request: lib.InstanceTransferSaveRequest) {
		if (request.sourceInstanceId === request.targetInstanceId) {
			throw new lib.RequestError("Source and target instance may not be the same");
		}
		let sourceInstance = this._controller.getRequestInstance(request.sourceInstanceId);
		let targetInstance = this._controller.getRequestInstance(request.targetInstanceId);
		let sourceHostId = sourceInstance.config.get("instance.assigned_host");
		let targetHostId = targetInstance.config.get("instance.assigned_host");
		if (sourceHostId === null) {
			throw new lib.RequestError("Source instance is not assigned a host");
		}
		if (targetHostId === null) {
			throw new lib.RequestError("Target instance is not assigned a host");
		}

		// Let host handle request if source and target is on the same host.
		if (sourceHostId === targetHostId) {
			return await this._controller.sendTo({ hostId: sourceHostId }, request);
		}

		// Check connectivity
		let sourceHostConnection = this._controller.wsServer.hostConnections.get(sourceHostId);
		if (!sourceHostConnection || sourceHostConnection.connector.closing) {
			throw new lib.RequestError("Source host is not connected to the controller");
		}

		let targetHostConnection = this._controller.wsServer.hostConnections.get(targetHostId);
		if (!targetHostConnection || targetHostConnection.connector.closing) {
			throw new lib.RequestError("Target host is not connected to the controller");
		}

		// Create stream to proxy from target to source
		let stream = await routes.createProxyStream(this._controller.app);
		stream.events.on("timeout", () => {
			if (stream.source) {
				stream.source.destroy();
			}
			stream.events.emit("error", new lib.RequestError("Timed out establishing transfer stream"));
		});

		// Ignore errors if not listening for them to avoid crash.
		stream.events.on("error", () => { /* ignore */ });

		// Establish push from source host to stream, this is done first to
		// ensure the file size is known prior to the target host pull.
		await Promise.all([
			this._controller.sendTo(
				{ hostId: sourceHostId },
				new lib.InstancePushSaveRequest(request.sourceInstanceId, stream.id, request.sourceName),
			),
			events.once(stream.events, "source"),
		]);

		// Establish pull from target host to stream and wait for completion.
		let storedName = await this._controller.sendTo(
			{ hostId: targetHostId },
			new lib.InstancePullSaveRequest(request.targetInstanceId, stream.id, request.targetName),
		);

		// Delete source save if this is not a copy
		if (!request.copy) {
			await this._controller.sendTo(
				{ hostId: sourceHostId },
				new lib.InstanceDeleteSaveRequest(request.sourceInstanceId, request.sourceName),
			);
		}

		return storedName;
	}

	async handleModPackListRequest() {
		return [...this._controller.modPacks.values()];
	}

	async handleModPackCreateRequest(request: lib.ModPackCreateRequest) {
		let modPack = request.modPack;
		if (modPack.id === undefined) {
			throw new lib.RequestError("Mod pack need an ID to be created");
		}
		if (this._controller.modPacks.has(modPack.id)) {
			throw new lib.RequestError(`Mod pack with ID ${modPack.id} already exist`);
		}
		this._controller.modPacks.set(modPack);
	}

	async handleModPackUpdateRequest(request: lib.ModPackUpdateRequest) {
		let modPack = request.modPack;
		if (modPack.id === undefined || !this._controller.modPacks.has(modPack.id)) {
			throw new lib.RequestError(`Mod pack with ID ${modPack.id} does not exist`);
		}
		this._controller.modPacks.set(modPack);
	}

	async handleModPackDeleteRequest(request: lib.ModPackDeleteRequest) {
		let { id } = request;
		let modPack = this._controller.modPacks.getMutable(id);
		if (!modPack) {
			throw new lib.RequestError(`Mod pack with ID ${id} does not exist`);
		}
		this._controller.modPacks.delete(modPack);
	}

	async handleModGetRequest(request: lib.ModGetRequest) {
		return this.getMod(request);
	}

	async handleModListRequest() {
		return [...this._controller.modStore.mods()];
	}

	static termsMatchesMod(terms: lib.ParsedTerm[], mod: lib.ModInfo) {
		for (let term of terms) {
			if (term.type === "word") {
				if (!lib.wordMatches(term,
					mod.name, mod.version, mod.title, mod.author, mod.contact,
					mod.homepage, mod.description, mod.filename
				)) {
					return false;
				}
			} else if (term.type === "attribute") {
				if (!lib.wordMatches(term.value, mod[term.name as keyof lib.ModInfo] as string)) {
					return false;
				}
			}
		}
		return true;
	}

	async handleModSearchRequest(request: lib.ModSearchRequest) {
		let query = lib.parseSearchString(request.query, {
			name: "word",
			// version
			title: "word",
			author: "word",
			contact: "word",
			homepage: "word",
			description: "word",
			// factorioVersion
			// dependencies
			filename: "word",
			// size
			sha1: "word",
		});
		let factorioVersion = request.factorioVersion;

		type ModVersions = { name: string, versions: lib.ModInfo[] };
		let results: Map<string, ModVersions> = new Map();
		for (let mod of this._controller.modStore.mods()) {
			if (
				mod.factorioVersion !== factorioVersion
				|| !ControlConnection.termsMatchesMod(query.terms, mod)
			) {
				continue;
			}
			let result = results.get(mod.name);
			if (!result) {
				result = {
					name: mod.name,
					versions: [],
				};
				results.set(mod.name, result);
			}
			result.versions.push(mod);
		}
		for (let result of results.values()) {
			result.versions.sort((a, b) => b.integerVersion - a.integerVersion);
			result.versions.map(e => e.toJSON());
		}
		let resultList = [...results.values()];

		const sort = request.sort;
		if (sort) {
			const sorters = {
				name: (a:ModVersions, b:ModVersions) => strcmp(a.versions[0].name, b.versions[0].name),
				title: (a:ModVersions, b:ModVersions) => strcmp(a.versions[0].title, b.versions[0].title),
				author: (a:ModVersions, b:ModVersions) => strcmp(a.versions[0].author, b.versions[0].author),
			};
			if (!Object.prototype.hasOwnProperty.call(sorters, sort)) {
				throw new lib.RequestError(`Invalid value for sort: ${sort}`);
			}
			resultList.sort(sorters[sort as keyof typeof sorters]);
			let order = request.sortOrder;
			if (order === "desc") {
				resultList.reverse();
			}
		}

		const page = request.page;
		const pageSize = request.pageSize || 10;
		resultList = resultList.slice((page - 1) * pageSize, page * pageSize);

		return {
			queryIssues: query.issues,
			pageCount: Math.ceil(results.size / pageSize),
			resultCount: results.size,
			results: resultList,
		};
	}

	/**
	 * Handle request to fetch all mods from the Factorio Mod Portal for a given version.
	 * @param request - The request object containing factorioVersion.
	 */
	async handleModPortalGetAllRequest(request: lib.ModPortalGetAllRequest) {
		const cacheKey = `${request.factorioVersion}-${request.hide_deprecated}`;
		const cachedData = this._controller.modPortalCache.get(cacheKey);

		const cacheDuration = this._controller.config.get("controller.mod_portal_cache_duration_minutes") * 60 * 1000;
		if (cachedData && Date.now() - cachedData.timestamp < cacheDuration) {
			return new lib.ModPortalGetAllRequest.Response(cachedData.data);
		}

		try {
			logger.info(`Fetching mod portal data for ${cacheKey}`);
			const mods = await lib.ModStore.fetchAllModsFromPortal(
				request.factorioVersion,
				this._controller.config.get("controller.mod_portal_page_size"),
				request.hide_deprecated
			);
			this._controller.modPortalCache.set(cacheKey, { timestamp: Date.now(), data: mods });
			// The Response class is defined inline within the Request class
			return new lib.ModPortalGetAllRequest.Response(mods);
		} catch (error: any) {
			logger.error(`Error fetching all mods from portal (${request.factorioVersion}): ${error}`);
			// Propagate a user-friendly error back to the client
			throw new lib.RequestError(`Portal mod fetch failed: ${error}`);
		}
	}

	/**
	 * Handle request to download a mod from the Factorio Mod Portal to the controller.
	 * @param request - Request object with mod name, version, and factorioVersion.
	 */
	async handleModPortalDownloadRequest(request: lib.ModPortalDownloadRequest) {
		const factorioVersion = request.factorioVersion;
		const toDownload = this._controller.modStore.filterInstalled(request.mods, false);

		if (toDownload.length > 0) {
			// Get Factorio credentials from config
			const username = this._controller.config.get("controller.factorio_username");
			const token = this._controller.config.get("controller.factorio_token");

			if (!username || username === "" || !token || token === "") {
				throw new lib.RequestError("Factorio credentials (username, token) not configured on the controller.");
			}

			try {
				logger.info(`Downloading ${toDownload.length} mods for Factorio ${factorioVersion} from portal.`);
				await this._controller.modStore.downloadMods(toDownload, username, token, factorioVersion);

			} catch (error: any) {
				logger.error(`Error downloading mods from portal: ${error.message}`);
				// Improve error message clarity
				let errorMessage = "Mod portal download failed";
				if (error instanceof lib.RequestError) {
					errorMessage += `: ${error.message}`;
				} else if (error.message.includes("401") || error.message.includes("Unauthorized")) {
					errorMessage += ": Authentication failed. Check Factorio username/token in controller config.";
				} else if (error.message.includes("404") || error.message.includes("Not Found")) {
					errorMessage += ": Mod version not found on the portal.";
				} else {
					errorMessage += `: ${error.message}`;
				}
				throw new lib.RequestError(errorMessage);
			}
		}

		// Verify all mods are present
		const modInfos = [];
		const installedMods = [...this._controller.modStore.mods()];
		for (const mod of request.mods) {
			const modInfo = installedMods.find(m => m.name === mod.name && mod.version.testVersion(m.version));
			if (!modInfo) {
				throw new lib.RequestError(`Failed to find mod ${mod.name} in store after download attempt.`);
			}
			modInfos.push(modInfo);
		}

		return modInfos;
	}

	async handleModDependencyResolveRequest(request: lib.ModDependencyResolveRequest) {
		const {factorioVersion, checkForUpdates} = request;
		const searchQueue = [...request.mods];
		const localInfos = [...this._controller.modStore.mods()];

		const _builtInModNames = lib.ModPack.getBuiltinModNames(factorioVersion);
		const builtInModNames = new Set(_builtInModNames);
		const skipSearch = new Set(_builtInModNames);

		type ModPortalModType = InstanceType<typeof lib.ModPortalGetAllRequest.Response>["mods"][number];
		type ModPortalReleaseType = NonNullable<ModPortalModType["releases"]>[number];
		const dependencyRequirements = new Map<string, lib.ModVersionRange>();
		const optionalRequirements = new Map<string, lib.ModVersionRange>();
		const candidateReleases = new Map<string, lib.ModInfo>();
		const incompatible = new Set<string>();
		const invalid = new Set<string>();

		const _modPortalReleases = new Map<string, ModPortalModType | null>();
		async function fetchModReleases(modName: string) {
			let releases = _modPortalReleases.get(modName);
			if (releases === undefined) {
				try {
					releases = await lib.ModStore.fetchModReleases(modName);
				} catch (error: any) {
					if (!error.message.includes("404") && !error.message.includes("Not Found")) {
						logger.error(`Error fetching mod from portal: ${error.message}`);
						throw new lib.RequestError(`Dependency resolution failed: ${error.message}`);
					} else {
						releases = null;
					}
				}
			}
			_modPortalReleases.set(modName, releases);
			return releases;
		}

		while (searchQueue.length > 0) {
			const mod = searchQueue.shift()!;
			if (mod.incompatible) {
				incompatible.add(mod.name);
				continue;
			}

			// Get the current version range (optionals are tracked in case they become required)
			let versionRange = dependencyRequirements.get(mod.name);
			if (!versionRange) {
				versionRange = optionalRequirements.get(mod.name) ?? new lib.ModVersionRange();
				if (mod.required) {
					dependencyRequirements.set(mod.name, versionRange);
					optionalRequirements.delete(mod.name);
				} else {
					optionalRequirements.set(mod.name, versionRange);
				}
			}

			// Update the version range if needed
			if (mod.version) {
				versionRange.combineVersion(mod.version);
				if (!versionRange.valid) {
					candidateReleases.delete(mod.name);
					invalid.add(mod.name);
				}
			}

			// Do not add dependencies for invalids, optionals, skips, or valid candidates
			const existingCandidate = candidateReleases.get(mod.name);
			if (invalid.has(mod.name) || optionalRequirements.has(mod.name) || skipSearch.has(mod.name) || (
				existingCandidate && versionRange.testVersion(existingCandidate.version)
			)) {
				continue;
			}

			// Check if a local version fits the requirements
			let candidate = localInfos
				.filter(info => (info.name === mod.name && versionRange.testVersion(info.version)))
				.reduce<lib.ModInfo | undefined>((max, cur) => (
					max && max.integerVersion > cur.integerVersion ? max : cur
				), undefined);

			// Check if a mod poral version fits the requirements
			if (!candidate || checkForUpdates) {
				const modReleases = await fetchModReleases(mod.name);
				if (modReleases && modReleases.releases) {
					const release = modReleases.releases
						.filter(info => (
							info.info_json.factorio_version === factorioVersion
							&& versionRange.testVersion(info.version)
						))
						.reduce<ModPortalReleaseType | undefined>((max, cur) => (
							max && lib.integerFullVersion(max.version) > lib.integerFullVersion(cur.version) ? max : cur
						), undefined);

					// We only select the mod portal release if it is more recent than the local candidate
					if (release && (!candidate || lib.integerFullVersion(release.version) > candidate.integerVersion)) {
						// eslint-disable-next-line max-depth
						try {
							candidate = lib.ModInfo.fromJSON({
								...release.info_json, // Also includes dependencies
								sha1: release.sha1,
								version: release.version,
								name: modReleases.name,
								author: modReleases.owner,
								title: modReleases.title,
							});
						} catch {
							// Can error with invalid dependencies, in which case we highlight it as invalid
							// We modify the name to expose the error to the user.
							invalid.add(`${modReleases.name} (Has invalid dependency)`);
						}
					}
				}
			}

			// Queue the dependencies of the new candidate
			if (candidate) {
				candidateReleases.set(mod.name, candidate);
				for (const dep of candidate.dependencies) {
					searchQueue.push(dep);
				}
			} else {
				candidateReleases.delete(mod.name);
				skipSearch.add(mod.name);
			}
		}

		return new lib.ModDependencyResolveRequest.Response(
			[...candidateReleases.values()],
			[...invalid.values(), ...[...incompatible.values()].filter(mod => (
				candidateReleases.has(mod) || builtInModNames.has(mod)
			))],
			[...dependencyRequirements.keys()].filter(mod => (
				!candidateReleases.has(mod) && !incompatible.has(mod) && !invalid.has(mod)
			)),
		);
	}

	async handleModDeleteRequest(request: lib.ModDeleteRequest) {
		await this._controller.modStore.deleteMod(request.name, request.version);
	}

	async handleLogSetSubscriptionsRequest(request: lib.LogSetSubscriptionsRequest) {
		this.logSubscriptions = {
			all: request.all || false,
			controller: request.controller || false,
			hostIds: request.hostIds || [],
			instanceIds: request.instanceIds || [],
		};
		this.updateLogSubscriptions();
	}

	updateLogSubscriptions() {
		let { all, controller, hostIds, instanceIds } = this.logSubscriptions;
		if (all || controller || hostIds.length || instanceIds.length) {
			if (!this.logTransport) {
				this.logTransport = new lib.LinkTransport({ link: this });
				this._controller.clusterLogger.add(this.logTransport);
			}
			this.logTransport.filter = logFilter(this.logSubscriptions);

		} else if (this.logTransport) {
			this._controller.clusterLogger.remove(this.logTransport);
			this.logTransport = null;
		}
	}

	async handleLogQueryRequest(request: lib.LogQueryRequest) {
		let _request = {
			limit: request.limit,
			order: request.order,
			maxLevel: request.maxLevel,
			all: request.all,
			controller: request.controller,
			hostIds: request.hostIds,
			instanceIds: request.instanceIds,
		};

		let observeDuration = queryLogTime.startTimer();
		let { all, controller, hostIds, instanceIds } = request;

		let log;
		if (!all && controller && !hostIds.length && !instanceIds.length) {
			log = await this._controller.queryControllerLog(_request);
		} else {
			log = await this._controller.queryClusterLog(_request);
		}

		observeDuration();
		return { log };
	}

	async handlePermissionListRequest() {
		return [...lib.permissions.values()];
	}

	async handleRoleListRequest() {
		return [...this._controller.roles.values()];
	}

	async handleRoleCreateRequest(request: lib.RoleCreateRequest) {
		let lastId = Math.max.apply(null, [...this._controller.roles.keys()]);

		// Start at 5 to leave space for future default roles
		let id = Math.max(5, lastId+1);
		this._controller.roles.set(lib.Role.fromJSON({ id, ...request }));
		return id;
	}

	async handleRoleUpdateRequest(request: lib.RoleUpdateRequest) {
		let { id, name, description, permissions } = request;
		let role = this._controller.roles.getMutable(id);
		if (!role) {
			throw new lib.RequestError(`Role with ID ${id} does not exist`);
		}

		role.name = name;
		role.description = description;
		role.permissions = new Set(permissions);
		this._controller.roles.set(role);
	}

	async handleRoleGrantDefaultPermissionsRequest(request: lib.RoleGrantDefaultPermissionsRequest) {
		let role = this._controller.roles.get(request.id);
		if (!role) {
			throw new lib.RequestError(`Role with ID ${request.id} does not exist`);
		}

		role.grantDefaultPermissions();
		this._controller.roles.set(role);
	}

	async handleRoleDeleteRequest(request: lib.RoleDeleteRequest) {
		let id = request.id;

		const role = this._controller.roles.get(id);
		if (!role) {
			throw new lib.RequestError(`Role with ID ${id} does not exist`);
		}
		this._controller.roles.delete(role);

		this._controller.userManager.dirty = true;
		for (let user of this._controller.userManager.users.values()) {
			if (user.roleIds.delete(id)) {
				this._controller.userPermissionsUpdated(user);
			}
		}
	}

	async handleUserGetRequest(request: lib.UserGetRequest): Promise<lib.User> {
		let name = request.name;
		let user = this._controller.userManager.getByName(name);
		if (!user) {
			throw new lib.RequestError(`User ${name} does not exist`);
		}

		return user;
	}

	async handleUserListRequest(): Promise<lib.User[]> {
		return [...this._controller.userManager.users.values()];
	}

	async handleUserCreateRequest(request: lib.UserCreateRequest) {
		let user = this._controller.userManager.createUser(request.name);
		this._controller.usersUpdated([user]);
	}

	async handleUserRevokeTokenRequest(request: lib.UserRevokeTokenRequest) {
		let user = this._controller.userManager.getByName(request.name);
		if (!user) {
			throw new lib.RequestError(`User '${request.name}' does not exist`);
		}
		if (user.id !== this.user.id) {
			this.user.checkPermission("core.user.revoke_other_token");
		}

		user.invalidateToken();
		for (let controlConnection of this._controller.wsServer.controlConnections.values()) {
			if (controlConnection.user.id === user.id) {
				controlConnection.connector.terminate();
			}
		}
		this._controller.usersUpdated([user]);
	}

	async handleUserUpdateRolesRequest(request: lib.UserUpdateRolesRequest) {
		let user = this._controller.userManager.getByName(request.name);
		if (!user) {
			throw new lib.RequestError(`User '${request.name}' does not exist`);
		}

		for (let roleId of request.roles) {
			if (!this._controller.roles.has(roleId)) {
				throw new lib.RequestError(`Role with ID ${roleId} does not exist`);
			}
		}

		user.roleIds = new Set(request.roles);
		this._controller.userPermissionsUpdated(user);
		this._controller.usersUpdated([user]);
	}

	async handleUserSetAdminRequest(request: lib.UserSetAdminRequest) {
		let { name, create, admin } = request;
		let user = this._controller.userManager.getByName(name);
		if (!user) {
			if (create) {
				this.user.checkPermission("core.user.create");
				user = this._controller.userManager.createUser(name);
			} else {
				throw new lib.RequestError(`User '${name}' does not exist`);
			}
		}

		user.isAdmin = admin;
		this._controller.usersUpdated([user]);
		this._controller.sendTo("allInstances", new lib.InstanceAdminlistUpdateEvent(name, admin));
	}

	async handleUserSetBannedRequest(request: lib.UserSetBannedRequest) {
		let { name, create, banned, reason } = request;
		let user = this._controller.userManager.getByName(name);
		if (!user) {
			if (create) {
				this.user.checkPermission("core.user.create");
				user = this._controller.userManager.createUser(name);
			} else {
				throw new lib.RequestError(`User '${name}' does not exist`);
			}
		}

		user.isBanned = banned;
		user.banReason = reason;
		this._controller.usersUpdated([user]);
		this._controller.sendTo("allInstances", new lib.InstanceBanlistUpdateEvent(name, banned, reason));
	}

	async handleUserSetWhitelistedRequest(request: lib.UserSetWhitelistedRequest) {
		let { name, create, whitelisted } = request;
		let user = this._controller.userManager.getByName(name);
		if (!user) {
			if (create) {
				this.user.checkPermission("core.user.create");
				user = this._controller.userManager.createUser(name);
			} else {
				throw new lib.RequestError(`User '${name}' does not exist`);
			}
		}

		user.isWhitelisted = whitelisted;
		this._controller.usersUpdated([user]);
		this._controller.sendTo("allInstances", new lib.InstanceWhitelistUpdateEvent(name, whitelisted));
	}

	async handleUserDeleteRequest(request: lib.UserDeleteRequest) {
		let name = request.name;
		let user = this._controller.userManager.getByName(name);
		if (!user) {
			throw new lib.RequestError(`User '${name}' does not exist`);
		}

		user.isDeleted = true;
		this._controller.userManager.users.delete(name);
		this._controller.usersUpdated([user]);

		if (user.isAdmin) {
			this._controller.sendTo("allInstances", new lib.InstanceAdminlistUpdateEvent(name, false));
		}
		if (user.isWhitelisted) {
			this._controller.sendTo("allInstances", new lib.InstanceWhitelistUpdateEvent(name, false));
		}
		if (user.isBanned) {
			this._controller.sendTo("allInstances", new lib.InstanceBanlistUpdateEvent(name, false, ""));
		}
	}

	async handleUserBulkRestoreRequest(request: lib.UserBulkImportRequest, updated: Map<string, ControllerUser>) {
		if (request.importType === "users") {
			// Update all fields for all users
			const users = request.users as Extract<typeof request.users, { username: string }[]>;
			const admin = new Set(users.filter(u => u.is_admin).map(u => u.username.toLowerCase()));
			const banned = new Set(users.filter(u => u.is_banned).map(u => u.username.toLowerCase()));
			const whitelist = new Set(users.filter(u => u.is_whitelisted).map(u => u.username.toLowerCase()));
			for (const user of this._controller.userManager.users.values()) {
				if (user.isAdmin && !admin.has(user.name)) {
					user.isAdmin = false;
					updated.set(user.id, user);
				}
				if (user.isBanned && !banned.has(user.name)) {
					user.isBanned = false;
					user.banReason = "";
					updated.set(user.id, user);
				}
				if (user.isWhitelisted && !whitelist.has(user.name)) {
					user.isWhitelisted = false;
					updated.set(user.id, user);
				}
			}
		} else if (request.importType === "bans") {
			// Bans have extra logic to handle ban reason
			const users = request.users as (string | { username: string, reason: string })[];
			const expected = new Set(
				users.map(u => (typeof u === "string" ? u.toLowerCase() : u.username.toLowerCase()))
			);
			for (const user of this._controller.userManager.users.values()) {
				if (user.isBanned && !expected.has(user.name)) {
					user.isBanned = false;
					user.banReason = "";
					updated.set(user.id, user);
				}
			}
		} else {
			// Whitelist and admin have the same logic
			const users = request.users as string[];
			const expected = new Set(users.map(u => u.toLowerCase()));
			const prop = request.importType === "admins" ? "isAdmin" : "isWhitelisted";
			for (const user of this._controller.userManager.users.values()) {
				if (user[prop] && !expected.has(user.name)) {
					user[prop] = false;
					updated.set(user.id, user);
				}
			}
		}
	}

	// A large number of small if statements are unavoidable when reducing the number of updates sent

	async handleUserBulkImportRequest(request: lib.UserBulkImportRequest) {
		let backup: undefined | Awaited<ReturnType<ControlConnection["handleUserBulkExportRequest"]>>;
		const updated = new Map<ControllerUser["id"], ControllerUser>();
		if (request.restore) {
			// Unban / Demote / Unwhitelist players not on the list
			backup = await this.handleUserBulkExportRequest(new lib.UserBulkExportRequest(request.importType));
			await this.handleUserBulkRestoreRequest(request, updated);
		}

		// Will get a user or attempt to create one
		const getUserOrCreate = (username: string) => {
			const user = this._controller.userManager.getByName(username);
			if (user) { return user; }
			this.user.checkPermission("core.user.create");
			return this._controller.userManager.createUser(username);
		};

		// Merge the imported data with existing data, this is strictly additive
		if (request.importType === "users") {
			// Update all fields
			const users = request.users as Extract<typeof request.users, { username: string }[]>;
			for (const user of users) {
				const cUser = getUserOrCreate(user.username);
				if (user.is_admin && !cUser.isAdmin) {
					cUser.isAdmin = true;
					updated.set(cUser.id, cUser);
				}
				if (user.is_banned && !cUser.isBanned) {
					cUser.isBanned = true;
					cUser.banReason = user.ban_reason ?? "";
					updated.set(cUser.id, cUser);
				}
				if (user.is_whitelisted && !cUser.isWhitelisted) {
					cUser.isWhitelisted = true;
					updated.set(cUser.id, cUser);
				}
			}
		} else if (request.importType === "bans") {
			// Bans have extra logic to handle ban reason
			const users = request.users as (string | { username: string, reason: string })[];
			for (const user of users) {
				if (typeof user === "string") {
					const cUser = getUserOrCreate(user);
					if (!cUser.isBanned) {
						cUser.isBanned = true;
						cUser.banReason = "";
						updated.set(cUser.id, cUser);
					}
				} else {
					const cUser = getUserOrCreate(user.username);
					if (!cUser.isBanned) {
						cUser.isBanned = true;
						cUser.banReason = user.reason;
						updated.set(cUser.id, cUser);
					}
				}
			}
		} else {
			// Whitelist and admin have the same logic
			const users = request.users as string[];
			const prop = request.importType === "admins" ? "isAdmin" : "isWhitelisted";
			for (const user of users) {
				const cUser = getUserOrCreate(user);
				if (!cUser[prop]) {
					cUser[prop] = true;
					updated.set(cUser.id, cUser);
				}
			}
		}

		// Send the necessary update events
		const updatedUsers = [...updated.values()];
		this._controller.usersUpdated(updatedUsers);

		// Resync the host user lists
		const adminlist: Set<string> = new Set();
		const banlist: Map<string, string> = new Map();
		const whitelist: Set<string> = new Set();

		for (let user of this._controller.userManager.users.values()) {
			if (user.isAdmin) {
				adminlist.add(user.id);
			}
			if (user.isBanned) {
				banlist.set(user.id, user.banReason);
			}
			if (user.isWhitelisted) {
				whitelist.add(user.id);
			}
		}

		this._controller.sendEvent(
			new lib.SyncUserListsEvent(adminlist, banlist, whitelist),
			lib.Address.fromShorthand("allHosts")
		);

		return backup ?? [];
	}

	async handleUserBulkExportRequest(request: lib.UserBulkExportRequest) {
		if (request.exportType === "users") {
			// Send a full user export
			const usersToSend = [] as lib.ClusterioUserExport["users"];
			for (const user of this._controller.userManager.users.values()) {
				let send = false;
				const userToSend = { username: user.name } as typeof usersToSend[0];
				if (user.isBanned) {
					send = true;
					userToSend.is_banned = true;
					if (user.banReason !== "") {
						userToSend.ban_reason = user.banReason;
					}
				}
				if (user.isAdmin) {
					send = true;
					userToSend.is_admin = true;
				}
				if (user.isWhitelisted) {
					send = true;
					userToSend.is_whitelisted = true;
				}
				if (send) {
					usersToSend.push(userToSend);
				}
			}
			return new lib.ClusterioUserExport(usersToSend);
		} else if (request.exportType === "bans") {
			// Bans have extra logic to handle ban reason
			const usersToSend = [] as Array<string | { username: string, reason: string }>;
			for (const user of this._controller.userManager.users.values()) {
				if (user.isBanned) {
					if (user.banReason && user.banReason !== "") {
						usersToSend.push({ username: user.name, reason: user.banReason });
					} else {
						usersToSend.push(user.name);
					}
				}
			}
			return usersToSend;
		}

		// This is a whitelist or admins export
		const usersToSend = [] as string[];
		const prop = request.exportType === "admins" ? "isAdmin" : "isWhitelisted";
		for (const user of this._controller.userManager.users.values()) {
			if (user[prop]) {
				usersToSend.push(user.name);
			}
		}
		return usersToSend;
	}

	async handleControllerUpdateRequest(request: lib.ControllerUpdateRequest) {
		if (!this._controller.config.get("controller.allow_remote_updates")) {
			throw new lib.RequestError("Remote updates are disabled on this machine");
		}
		return await lib.updatePackage("@clusterio/controller");
	}

	async handlePluginUpdateRequest(request: lib.PluginUpdateRequest) {
		if (!this._controller.config.get("controller.allow_plugin_updates")) {
			throw new lib.RequestError("Plugin updates are disabled on this machine");
		}
		return await lib.handlePluginUpdate(request.pluginPackage, this._controller.pluginInfos);
	}

	async handlePluginInstallRequest(request: lib.PluginInstallRequest) {
		if (!this._controller.config.get("controller.allow_plugin_install")) {
			throw new lib.RequestError("Plugin installs are disabled on this machine");
		}
		return await lib.handlePluginInstall(request.pluginPackage);
	}

	async handlePluginListRequest(request: lib.PluginListRequest) {
		return this._controller.pluginInfos.map(pluginInfo => lib.PluginDetails.fromNodeEnvInfo(
			pluginInfo,
			this._controller.plugins.has(pluginInfo.name),
			this._controller.config.get(`${pluginInfo.name}.load_plugin`),
		));
	}

	async handleDebugDumpWsRequest(request: lib.DebugDumpWsRequest) {
		this.ws_dumper = data => {
			if (this.connector.connected) {
				this.send(new lib.DebugWsMessageEvent(data.direction, data.content));
			}
		};
		this.connector._socket!.clusterio_ignore_dump = true;
		this._controller.debugEvents.on("message", this.ws_dumper);
	}

	async handleFactorioVersionsRequest(request: lib.FactorioVersionsRequest) {
		return await this._controller.factorioVersions.get(request.maxAgeMs);
	}
}

module.exports = ControlConnection;
