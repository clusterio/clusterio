import dns from "node:dns/promises";
import { isIP } from "node:net";
import path from "node:path";

import * as lib from "@clusterio/lib";
import type {
	Controller, ControllerPluginContext, InstanceRecord, PlayerProxyRouteRequest, proxyProtocol,
} from "@clusterio/controller";

import { Listing, MatchingServerClient } from "./matching_server.js";
import {
	LobbyServer, ServerListRequest, TransferRequest, TransferState, TransferStatus, TransferStatusEvent,
} from "./messages.js";

/** How long a player has to connect to an instance once it's ready */
const TRANSFER_READY_TIMEOUT_MS = 120_000;
/** How long an instance has to start for a transfer to it */
const TRANSFER_START_TIMEOUT_MS = 600_000;
const LISTING_INTERVAL_MS = 30_000;

type ApplicationVersion = proxyProtocol.ApplicationVersion;

export interface Transfer {
	player: string;
	instanceId: number;
	state: TransferState;
	/** Lobby the player is waiting in */
	lobbyId?: number;
	expiresAtMs: number;
}

function formatVersion(version: ApplicationVersion) {
	return `${version.major}.${version.minor}.${version.sub}`;
}

/** Split host:port, supporting bracketed IPv6 addresses */
export function parseAddress(address: string): { host: string, port?: number } {
	const match = /^(?:\[([^\]]+)\]|([^:]+))(?::(\d+))?$/.exec(address.trim());
	if (!match) {
		return { host: address.trim() };
	}
	return { host: match[1] ?? match[2], port: match[3] !== undefined ? Number(match[3]) : undefined };
}

export class LobbyController {
	/** Transfers in progress by lowercase player name */
	transfers = new Map<string, Transfer>();
	private _listingTimer?: ReturnType<typeof setInterval>;
	private _listingWarning?: string;

	constructor(
		public controller: Controller,
		public logger: lib.Logger,
		public matchingServer: MatchingServerClient,
	) { }

	get proxy() {
		return this.controller.playerProxyServer;
	}

	static isLobby(instance: Readonly<InstanceRecord>) {
		return Boolean(instance.config.get("lobby.load_plugin") && instance.config.get("lobby.is_lobby"));
	}

	static isRoutable(instance: Readonly<InstanceRecord> | undefined): instance is Readonly<InstanceRecord> {
		return Boolean(instance && !instance.isDeleted && instance.config.get("instance.assigned_host") !== null);
	}

	/**
	 * Factorio version an instance runs, or ran last time it was seen
	 *
	 * @param instance - Instance to check.
	 * @returns version as major.minor.sub or null if unknown.
	 */
	instanceVersion(instance: Readonly<InstanceRecord>) {
		const seen = this.proxy?.serverVersions.get(instance.id);
		if (instance.status === "running" && instance.factorioVersion) {
			return instance.factorioVersion;
		}
		if (seen) {
			return formatVersion(seen);
		}
		const configured = instance.factorioVersion ?? instance.config.get("factorio.version");
		return /^\d+\.\d+\.\d+$/.test(configured) ? configured : null;
	}

	playersOnline(instanceId?: number) {
		const names: string[] = [];
		for (const user of this.controller.users.records.values()) {
			if (instanceId === undefined ? user.instances.size : user.instances.has(instanceId)) {
				names.push(user.name);
			}
		}
		return names.sort();
	}

	serverList(): LobbyServer[] {
		const servers: LobbyServer[] = [];
		for (const instance of this.controller.instances.values()) {
			if (
				!LobbyController.isRoutable(instance)
				|| LobbyController.isLobby(instance)
				|| !instance.config.get("lobby.listed")
			) {
				continue;
			}
			servers.push(new LobbyServer(
				instance.id,
				instance.config.get("instance.name"),
				instance.status,
				this.instanceVersion(instance),
				this.playersOnline(instance.id).length,
			));
		}
		return servers.sort((a, b) => a.name.localeCompare(b.name));
	}

	/**
	 * Built in mods besides base enabled in a mod list, as a comparable key
	 *
	 * @param version - Factorio version the mods are for.
	 * @param mods - Mods to check.
	 * @returns sorted comma separated names.
	 */
	static builtinModsKey(version: string, mods: Iterable<{ name: string, enabled?: boolean }>) {
		const builtin = new Set(lib.ModPack.getBuiltinModNames(version as lib.PartialVersion));
		builtin.delete("base");
		return [...mods]
			.filter(mod => mod.enabled !== false && builtin.has(mod.name))
			.map(mod => mod.name)
			.sort()
			.join(",");
	}

	/** Mod pack an instance runs with */
	instanceModPack(instance: Readonly<InstanceRecord>) {
		const id = instance.config.get("factorio.mod_pack_id")
			?? this.controller.config.get("controller.default_mod_pack_id");
		return id === null ? undefined : this.controller.modPacks.get(id);
	}

	/**
	 * Find a lobby running the given Factorio version
	 *
	 * @param version - Version of the client.
	 * @param mods -
	 *     Mods enabled in the client, if known the lobby must have the same
	 *     built in mods enabled for the client to be able to join it.
	 * @returns a running lobby if there is one, otherwise a stopped one configured for this version.
	 */
	pickLobby(version: ApplicationVersion, mods?: proxyProtocol.ModId[]) {
		const wanted = formatVersion(version);
		const wantedMods = mods ? LobbyController.builtinModsKey(wanted, mods) : undefined;
		let stopped: Readonly<InstanceRecord> | undefined;
		for (const instance of this.controller.instances.values()) {
			if (!LobbyController.isRoutable(instance) || !LobbyController.isLobby(instance)) {
				continue;
			}
			const seen = this.proxy?.serverVersions.get(instance.id);
			if (seen && formatVersion(seen) === wanted && seen.build !== version.build) {
				continue;
			}
			if (wantedMods !== undefined) {
				const modPack = this.instanceModPack(instance);
				if (modPack && LobbyController.builtinModsKey(wanted, modPack.mods.values()) !== wantedMods) {
					continue;
				}
			}
			if (instance.status === "running" && instance.factorioVersion === wanted) {
				return instance;
			}
			if (!stopped && instance.status !== "running" && this.instanceVersion(instance) === wanted) {
				stopped = instance;
			}
		}
		return stopped;
	}

	private _hostVersions = new Map<number, { versions: Set<string>, canDownload: boolean, fetchedAtMs: number }>();

	/** Factorio versions installed on a host, cached for a minute */
	async hostVersions(hostId: number) {
		const cached = this._hostVersions.get(hostId);
		if (cached && cached.fetchedAtMs > Date.now() - 60_000) {
			return cached;
		}
		const response: { versions: string[], canDownload: boolean } = await this.controller.sendTo(
			{ hostId }, new lib.HostFactorioVersionsRequest()
		);
		const result = {
			versions: new Set(response.versions),
			canDownload: response.canDownload,
			fetchedAtMs: Date.now(),
		};
		this._hostVersions.set(hostId, result);
		return result;
	}

	/**
	 * Pick a connected host that can run the given Factorio version
	 *
	 * @param version - Full Factorio version.
	 * @returns ID of a host with the version installed, or one that can download it.
	 */
	async pickHost(version: string) {
		let downloadHost: number | undefined;
		for (const host of this.controller.hosts.values()) {
			if (!host.connected || host.isDeleted) {
				continue;
			}
			let versions;
			try {
				versions = await this.hostVersions(host.id);
			} catch (err: any) {
				this.logger.verbose(`Unable to get Factorio versions of host ${host.id}: ${err.message}`);
				continue;
			}
			if (versions.versions.has(version)) {
				return host.id;
			}
			if (versions.canDownload && downloadHost === undefined) {
				downloadHost = host.id;
			}
		}
		if (downloadHost !== undefined) {
			const releases = await this.controller.factorioVersions.get().catch(() => []);
			if (releases.some(release => release.version === version)) {
				return downloadHost;
			}
		}
		return undefined;
	}

	/**
	 * Find a mod pack for the version with the given built in mods, creating one if needed
	 *
	 * @param version - Full Factorio version.
	 * @param modsKey - Built in mods as given by {@link LobbyController.builtinModsKey}.
	 * @returns the mod pack.
	 */
	lobbyModPack(version: string, modsKey: string) {
		const [major, minor] = version.split(".");
		const majorMinor = `${major}.${minor}`;
		const wanted = new Set(modsKey ? modsKey.split(",") : []);
		const matches = (pack: Readonly<lib.ModPack>) => (
			(pack.factorioVersion === version || pack.factorioVersion === majorMinor)
			&& LobbyController.builtinModsKey(version, pack.mods.values()) === modsKey
			// Lobbies get only built in mods, players with other mods are asked by Factorio to sync to them
			&& [...pack.mods.values()].every(mod => !mod.enabled || mod.name === "base" || wanted.has(mod.name))
		);
		for (const pack of this.controller.modPacks.values()) {
			if (!pack.isDeleted && matches(pack)) {
				return pack;
			}
		}
		const builtin = lib.ModPack.getBuiltinMods(majorMinor as lib.PartialVersion)
			.filter(mod => mod.name !== "base");
		const pack = lib.ModPack.fromJSON({
			name: `Lobby ${majorMinor}${wanted.size ? ` (${[...wanted].join(", ")})` : ""}`,
			description: "Created by the lobby plugin for lobbies of players with these built in mods.",
			factorio_version: majorMinor,
			mods: builtin.map(mod => ({ ...mod, enabled: wanted.has(mod.name) })),
		} as any);
		this.controller.modPacks.set(pack);
		this.logger.info(`Created mod pack ${pack.name} for lobbies`);
		return pack;
	}

	private _creatingLobbies = new Map<string, Promise<number | undefined>>();

	/**
	 * Create a lobby for a Factorio version and set of built in mods
	 *
	 * Concurrent calls for the same version and mods share one lobby.
	 *
	 * @param version - Version of the client.
	 * @param mods - Mods enabled in the client.
	 * @returns ID of the lobby created, or undefined if no host can run the version.
	 */
	async createLobby(version: ApplicationVersion, mods?: proxyProtocol.ModId[]) {
		const full = formatVersion(version);
		// Without the mod list assume all built in mods, as the expansion is the most common setup
		const modsKey = LobbyController.builtinModsKey(
			full, mods ?? lib.ModPack.getBuiltinMods(full as lib.PartialVersion).map(mod => ({ name: mod.name })),
		);
		const key = `${full}|${modsKey}`;
		let creating = this._creatingLobbies.get(key);
		if (!creating) {
			creating = this._createLobby(full, modsKey).finally(() => this._creatingLobbies.delete(key));
			this._creatingLobbies.set(key, creating);
		}
		return await creating;
	}

	private async _createLobby(version: string, modsKey: string) {
		const hostId = await this.pickHost(version);
		if (hostId === undefined) {
			this.logger.verbose(`No host can run Factorio ${version}, not creating a lobby for it`);
			return undefined;
		}
		const modPack = this.lobbyModPack(version, modsKey);
		const names = new Set([...this.controller.instances.values()].map(i => i.config.get("instance.name")));
		const base = modsKey.includes("space-age") ? `Lobby ${version}` : `Lobby ${version} (${modsKey || "base"})`;
		let name = base;
		for (let i = 2; names.has(name); i++) {
			name = `${base} ${i}`;
		}

		const config = new lib.InstanceConfig("controller", {
			"instance.name": name,
			"instance.auto_start": true,
			"factorio.version": version,
			"factorio.mod_pack_id": modPack.id,
			// The cluster is listed in the server browser by this plugin, not each lobby
			"factorio.settings": { visibility: { public: false, lan: false } },
			"lobby.is_lobby": true,
		});
		const instance = await this.controller.instances.createInstance(config);
		await this.controller.instances.assignInstance(instance.id, hostId);
		this.logger.info(`Created lobby ${name} on host ${hostId} for players with Factorio ${version}`);
		return instance.id;
	}

	/** Address players use to connect to an instance, through the proxy if it's enabled */
	connectAddress(instance: Readonly<InstanceRecord>) {
		if (this.proxy) {
			return this.controller.getPlayerProxyAddress();
		}

		const hostId = instance.config.get("instance.assigned_host");
		const host = hostId !== null ? this.controller.hosts.get(hostId) : undefined;
		const address = host?.publicAddress || host?.remoteAddress;
		if (!address || !instance.gamePort) {
			return undefined;
		}
		return `${address}:${instance.gamePort}`;
	}

	private _getTransfer(player: string) {
		const key = player.toLowerCase();
		const transfer = this.transfers.get(key);
		if (transfer && transfer.expiresAtMs < Date.now()) {
			this.transfers.delete(key);
			return undefined;
		}
		return transfer;
	}

	private _status(transfer: Transfer, message?: string) {
		const instance = this.controller.instances.get(transfer.instanceId);
		const name = instance?.config.get("instance.name") ?? String(transfer.instanceId);
		const address = transfer.state === "ready" && instance ? this.connectAddress(instance) : undefined;
		if (transfer.state === "ready" && !address) {
			return new TransferStatus("failed", name, undefined, "The address to connect to is not configured");
		}
		return new TransferStatus(transfer.state, name, address, message);
	}

	private _notify(transfer: Transfer, message?: string) {
		if (transfer.lobbyId === undefined) {
			return;
		}
		const lobby = this.controller.instances.get(transfer.lobbyId);
		if (lobby?.status !== "running") {
			return;
		}
		this.controller.sendTo(
			{ instanceId: transfer.lobbyId },
			new TransferStatusEvent(transfer.player, transfer.instanceId, this._status(transfer, message)),
		);
	}

	/**
	 * Start sending a player to an instance
	 *
	 * @param player - Name of the player.
	 * @param instanceId - Instance to send the player to.
	 * @param lobbyId - Lobby the player is waiting in.
	 * @returns the transfer created.
	 */
	startTransfer(player: string, instanceId: number, lobbyId?: number) {
		const instance = this.controller.instances.get(instanceId);
		if (!LobbyController.isRoutable(instance)) {
			throw new lib.UnavailableError(`Instance ${instanceId} is not available`);
		}
		const ready = instance.status === "running";
		const transfer: Transfer = {
			player,
			instanceId,
			state: ready ? "ready" : "starting",
			lobbyId,
			expiresAtMs: Date.now() + (ready ? TRANSFER_READY_TIMEOUT_MS : TRANSFER_START_TIMEOUT_MS),
		};
		this.transfers.set(player.toLowerCase(), transfer);

		if (instance.status === "stopped") {
			this.logger.info(`Starting instance ${instanceId} for ${player}`);
			(async () => {
				await this.controller.sendTo({ instanceId }, new lib.InstanceStartRequest());
			})().catch(err => {
				this._failTransfers(instanceId, `Failed to start: ${err.message}`);
			});
		}
		return transfer;
	}

	private _failTransfers(instanceId: number, message: string) {
		for (const [key, transfer] of this.transfers) {
			if (transfer.instanceId === instanceId && transfer.state === "starting") {
				transfer.state = "failed";
				this._notify(transfer, message);
				this.transfers.delete(key);
			}
		}
	}

	async handleServerListRequest(): Promise<LobbyServer[]> {
		return this.serverList();
	}

	async handleTransferRequest(request: TransferRequest, src: lib.Address): Promise<TransferStatus> {
		const lobbyId = src.type === lib.Address.instance ? src.id : undefined;
		return this._status(this.startTransfer(request.player, request.instanceId, lobbyId));
	}

	async onInstanceStatusChanged(instance: InstanceRecord) {
		if (instance.status === "running") {
			for (const transfer of this.transfers.values()) {
				if (transfer.instanceId === instance.id && transfer.state === "starting") {
					transfer.state = "ready";
					transfer.expiresAtMs = Date.now() + TRANSFER_READY_TIMEOUT_MS;
					this._notify(transfer);
				}
			}
		} else if (instance.status === "stopped" || instance.isDeleted) {
			this._failTransfers(instance.id, "The server stopped while starting");
		}
	}

	async onPlayerEvent(instance: InstanceRecord, event: lib.PlayerEvent) {
		if (event.type !== "join") {
			return;
		}
		const transfer = this._getTransfer(event.name);
		if (!transfer) {
			return;
		}
		if (transfer.instanceId === instance.id) {
			this.transfers.delete(event.name.toLowerCase());
		} else if (LobbyController.isLobby(instance)) {
			// Player is waiting in this lobby for the instance to start
			transfer.lobbyId = instance.id;
			this._notify(transfer);
		}
	}

	async onPlayerProxyRoute(request: PlayerProxyRouteRequest): Promise<number | undefined> {
		const transfer = this._getTransfer(request.username);
		if (transfer?.state === "ready") {
			return transfer.instanceId;
		}
		if (transfer?.state === "starting") {
			return transfer.lobbyId ?? await this.lobbyFor(request);
		}

		if (request.portInstanceId !== undefined) {
			const target = this.controller.instances.get(request.portInstanceId);
			if (!LobbyController.isRoutable(target) || target.status === "running") {
				return undefined;
			}
			// Starting can take longer than the client waits, so let the player wait in a lobby
			const lobbyId = await this.lobbyFor(request);
			if (lobbyId === undefined) {
				return undefined;
			}
			this.startTransfer(request.username, target.id, lobbyId);
			return lobbyId;
		}

		return await this.lobbyFor(request);
	}

	/** Lobby for the version and mods of a player, created if needed and lobby.auto_create is enabled */
	async lobbyFor(request: PlayerProxyRouteRequest) {
		const lobby = this.pickLobby(request.version, request.mods);
		if (lobby) {
			return lobby.id;
		}
		if (!this.controller.config.get("lobby.auto_create")) {
			return undefined;
		}
		return await this.createLobby(request.version, request.mods);
	}

	/** Build the server browser listings that should exist */
	async desiredListings() {
		const listings = new Map<string, Listing>();
		const proxy = this.proxy;
		if (!proxy) {
			return listings;
		}

		const clusterListing = this.controller.config.get("lobby.server_browser_listing");
		const instanceListings = [...this.controller.instances.values()].filter(
			instance => LobbyController.isRoutable(instance)
				&& instance.config.get("lobby.load_plugin")
				&& instance.config.get("lobby.server_browser_listing")
				&& instance.config.get("instance.player_proxy_port") !== null
		);
		if (!clusterListing && !instanceListings.length) {
			return listings;
		}

		const address = this.controller.getPlayerProxyAddress();
		if (!address) {
			this._warnListing(
				"controller.player_proxy_public_address or controller.public_url must be set to list servers"
			);
			return listings;
		}
		const { host, port } = parseAddress(address);
		let hostAddress = host;
		if (!isIP(host)) {
			try {
				hostAddress = (await dns.lookup(host, { family: 4 })).address;
			} catch (err: any) {
				this._warnListing(`Unable to resolve ${host} for the server browser: ${err.message}`);
				return listings;
			}
		}

		const tags = this.controller.config.get("lobby.server_browser_tags")
			.split(",").map(tag => tag.trim()).filter(Boolean);
		const common = {
			description: this.controller.config.get("lobby.server_browser_description"),
			tags,
			maxPlayers: this.controller.config.get("lobby.server_browser_max_players"),
			hostAddress,
		};

		if (clusterListing) {
			const name = this.controller.config.get("lobby.server_browser_name")
				?? this.controller.config.get("controller.name");
			const players = this.playersOnline();
			for (const instance of this.controller.instances.values()) {
				if (!LobbyController.isRoutable(instance) || !LobbyController.isLobby(instance)) {
					continue;
				}
				const version = await proxy.instanceVersion(instance.id);
				if (!version) {
					continue;
				}
				const key = `cluster:${formatVersion(version)}:${version.build}`;
				if (!listings.has(key)) {
					listings.set(key, {
						...common,
						name,
						hostPort: port ?? proxy.port,
						version: { version: formatVersion(version), build: version.build },
						players,
					});
				}
			}
		}

		for (const instance of instanceListings) {
			const version = await proxy.instanceVersion(instance.id);
			if (!version) {
				this.logger.verbose(`Version of instance ${instance.id} is not known yet, not listing it`);
				continue;
			}
			listings.set(`instance:${instance.id}`, {
				...common,
				name: instance.config.get("instance.name"),
				hostPort: instance.config.get("instance.player_proxy_port")!,
				version: { version: formatVersion(version), build: version.build },
				players: this.playersOnline(instance.id),
			});
		}
		return listings;
	}

	private _warnListing(message: string) {
		if (this._listingWarning !== message) {
			this._listingWarning = message;
			this.logger.warn(message);
		}
	}

	async updateListings() {
		const username = this.controller.config.get("controller.factorio_username");
		const token = this.controller.config.get("controller.factorio_token");
		const credentials = username && token ? { username, token } : undefined;
		await this.matchingServer.sync(await this.desiredListings(), credentials);
	}

	private _updateListingsSerial = new lib.AsyncSerialMergingCallback(async () => {
		try {
			await this.updateListings();
		} catch (err: any) {
			this.logger.error(`Unexpected error updating server browser listings:\n${err.stack}`);
		}
	});

	startListing() {
		this._listingTimer = setInterval(() => this._updateListingsSerial.invoke(), LISTING_INTERVAL_MS);
		this._listingTimer.unref();
		this._updateListingsSerial.invoke();
	}

	async shutdown() {
		clearInterval(this._listingTimer);
		await this.matchingServer.removeAll();
	}
}

export default async function loadControllerPlugin(context: ControllerPluginContext) {
	const { controller, logger, plugin } = context;
	const statePath = path.join(controller.config.get("controller.database_directory"), "lobby-listings.json");
	const lobby = new LobbyController(controller, logger, new MatchingServerClient(logger, statePath));

	controller.handle(ServerListRequest, lobby.handleServerListRequest.bind(lobby));
	controller.handle(TransferRequest, lobby.handleTransferRequest.bind(lobby));
	controller.hooks.instanceStatusChanged.attach(plugin.name, lobby.onInstanceStatusChanged.bind(lobby));
	controller.hooks.playerEvent.attach(plugin.name, lobby.onPlayerEvent.bind(lobby));
	controller.hooks.playerProxyRoute.attach(plugin.name, lobby.onPlayerProxyRoute.bind(lobby));
	controller.hooks.shutdown.attach(plugin.name, lobby.shutdown.bind(lobby));

	if (!controller.config.get("controller.player_proxy_port")) {
		logger.warn("controller.player_proxy_port is not set, players can only reach lobbies directly");
	}
	lobby.startListing();
}
