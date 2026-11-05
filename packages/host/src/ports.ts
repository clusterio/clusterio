import dgram from "node:dgram";
import net from "node:net";

import * as lib from "@clusterio/lib";
import type { FactorioServerPorts } from "./server.js";

/** TCP and UDP ports are separate, the same number may be used by both */
export type PortProtocol = "tcp" | "udp";
/** What a port is used for */
export type PortEndpoint = "game" | "rcon" | "lua_udp" | "host_lua_udp";

const endpointNames: Record<PortEndpoint, string> = {
	game: "game port",
	rcon: "RCON port",
	lua_udp: "Lua UDP port",
	host_lua_udp: "host Lua UDP socket",
};

/** Instance a port belongs to */
interface PortOwner {
	instanceId: number;
	instanceName: string;
}

/** Port used by an instance */
export interface PortClaim extends PortOwner {
	endpoint: PortEndpoint;
	protocol: PortProtocol;
	port: number;
}

/** Port set in the config of an assigned instance */
export interface ConfiguredPortClaim extends PortClaim {
	/** Config field the port is set in */
	field: string;
}

/** Where a free port is picked from */
interface FreePortOptions {
	/** Ports to pick from, any port the OS hands out if not set */
	range?: Set<number>;
	/** Port in the range to try first */
	preferred?: number | null;
}

/** Socket bound to a port, kept open until closed */
export interface BoundPort {
	port: number;
	close(): Promise<void>;
}

function instanceLabel(owner: PortOwner) {
	return `instance "${owner.instanceName}" (ID ${owner.instanceId})`;
}

function portOwner(config: lib.InstanceConfig): PortOwner {
	return { instanceId: config.get("instance.id"), instanceName: config.get("instance.name") };
}

/**
 * Ports set in the config of an instance
 *
 * Null and 0 are picked when the instance starts and are not claimed here.
 *
 * @param config - Config of the instance.
 * @returns ports the instance claims while assigned.
 */
export function configuredPortClaims(config: lib.InstanceConfig) {
	const owner = portOwner(config);
	const claims: ConfiguredPortClaim[] = [];
	const add = (endpoint: PortEndpoint, protocol: PortProtocol, field: keyof lib.InstanceConfigFields) => {
		const port = config.get(field) as number | null;
		if (port) {
			claims.push({ ...owner, endpoint, protocol, port, field });
		}
	};
	if (config.get("factorio.game_port") === null) {
		add("game", "udp", "factorio.host_assigned_game_port");
	} else {
		add("game", "udp", "factorio.game_port");
	}
	add("rcon", "tcp", "factorio.rcon_port");
	if (config.get("factorio.enable_lua_udp")) {
		add("lua_udp", "udp", "factorio.lua_udp_port");
	}
	return claims;
}

async function listenTcp(host: string, port: number): Promise<BoundPort> {
	const server = net.createServer();
	await new Promise<void>((resolve, reject) => {
		server.once("error", reject);
		server.listen({ host, port, ipv6Only: false }, () => {
			server.off("error", reject);
			resolve();
		});
	});
	return {
		port: (server.address() as net.AddressInfo).port,
		close: () => new Promise(resolve => { server.close(() => resolve()); }),
	};
}

async function bindUdp(type: "udp4" | "udp6", address: string, port: number) {
	const socket = dgram.createSocket({ type, ipv6Only: false });
	try {
		await new Promise<void>((resolve, reject) => {
			socket.once("error", reject);
			socket.bind(port, address, () => {
				socket.off("error", reject);
				resolve();
			});
		});
	} catch (err) {
		try {
			socket.close();
		} catch { /* Not bound */ }
		throw err;
	}
	return {
		port: socket.address().port,
		close: () => new Promise<void>(resolve => { socket.close(() => resolve()); }),
	};
}

/**
 * Bind a port on all addresses
 *
 * Binds dual stack on [::], or 0.0.0.0 if IPv6 is unavailable, so the port
 * is free on both IPv4 and IPv6.
 *
 * @param protocol - Protocol to bind.
 * @param port - Port to bind, 0 lets the OS pick a free one.
 * @returns the bound socket.
 */
export async function probePort(protocol: PortProtocol, port = 0): Promise<BoundPort> {
	const bind = protocol === "tcp"
		? (address: string) => listenTcp(address, port)
		: (address: string) => bindUdp(address === "::" ? "udp6" : "udp4", address, port);
	try {
		return await bind("::");
	} catch (err: any) {
		if (err.code !== "EAFNOSUPPORT" && err.code !== "EADDRNOTAVAIL") {
			throw err;
		}
		return await bind("0.0.0.0");
	}
}

/**
 * Ports reserved for one run of an instance
 *
 * Releasing only frees the ports of this reservation, so releasing a
 * reservation from an earlier run does not touch the ports of a later one.
 */
export class PortReservation {
	constructor(
		private _held: Set<readonly PortClaim[]>,
		readonly claims: readonly PortClaim[],
		readonly ports: FactorioServerPorts,
	) { }

	get released() {
		return !this._held.has(this.claims);
	}

	release() {
		this._held.delete(this.claims);
	}
}

/**
 * Ports in use by the instances of a host
 *
 * Picks the ports an instance runs with, avoiding the ports set in the
 * config of assigned instances, including stopped ones, and the ports
 * reserved for running ones.  Ports taken by other processes are found by
 * binding them.
 */
export class PortRegistry {
	/** Claims of reservations not yet released, including ones being made */
	_held = new Set<readonly PortClaim[]>();
	_probe = probePort;

	constructor(
		/** Instances assigned to the host */
		private _instances: ReadonlyMap<number, { config: lib.InstanceConfig }>,
	) { }

	/** Ports set in the config of assigned instances */
	configuredClaims() {
		return [...this._instances.values()].flatMap(instance => configuredPortClaims(instance.config));
	}

	/** Configured and reserved claims of the given port */
	claims(protocol: PortProtocol, port: number): PortClaim[] {
		return [...this.configuredClaims(), ...[...this._held].flat()].filter(
			claim => claim.protocol === protocol && claim.port === port
		);
	}

	/**
	 * Check if a port is configured or reserved
	 *
	 * @param protocol - Protocol of the port.
	 * @param port - Port to check.
	 * @param except - Ignore claims by this instance and endpoint.
	 * @returns true if the port is claimed.
	 */
	isClaimed(protocol: PortProtocol, port: number, except?: { instanceId: number, endpoint: PortEndpoint }) {
		return this.claims(protocol, port).some(
			claim => !except || claim.instanceId !== except.instanceId || claim.endpoint !== except.endpoint
		);
	}

	/**
	 * Fixed ports of an instance also set on another assigned instance
	 *
	 * @param instanceId - ID of the instance to check.
	 * @returns descriptions of the conflicts.
	 */
	configuredConflicts(instanceId: number) {
		const all = this.configuredClaims().filter(claim => claim.field !== "factorio.host_assigned_game_port");
		const conflicts: string[] = [];
		for (const claim of all.filter(c => c.instanceId === instanceId)) {
			for (const other of all) {
				if (other === claim || other.protocol !== claim.protocol || other.port !== claim.port) {
					continue;
				}
				const owner = other.instanceId === instanceId ? "the same instance" : instanceLabel(other);
				conflicts.push(
					`${claim.field} ${claim.port} (${claim.protocol.toUpperCase()}) is also the ` +
					`${endpointNames[other.endpoint]} of ${owner}, only one of them can be running`
				);
			}
		}
		return conflicts;
	}

	/**
	 * Reserve the ports for a run of an instance
	 *
	 * Fixed ports from the config are used as is, the rest are picked
	 * free.  A null game port is picked from the game port range, preferring
	 * the host assigned game port.
	 *
	 * @param config - Config of the instance.
	 * @param gamePortRange - Ports to pick a null game port from.
	 * @returns the reservation.
	 * @throws {lib.ConflictError} if a fixed port is reserved for another run.
	 */
	async reserve(config: lib.InstanceConfig, gamePortRange: Set<number>) {
		const owner = portOwner(config);
		const gamePort = config.get("factorio.game_port");
		const enableLuaUdp = config.get("factorio.enable_lua_udp");
		// Claims are added as they are picked so concurrent reservations see them.
		const claims: PortClaim[] = [];
		this._held.add(claims);
		const fixed = (endpoint: PortEndpoint, protocol: PortProtocol, port: number | null) => (
			port ? this._reserveFixed(claims, { ...owner, endpoint, protocol, port }) : null
		);
		const free = (endpoint: PortEndpoint, protocol: PortProtocol, options?: FreePortOptions) => (
			this._reserveFree(claims, owner, endpoint, protocol, options)
		);
		try {
			// Fixed ports first so free ones are not picked from them.
			const fixedGame = fixed("game", "udp", gamePort);
			const fixedRcon = fixed("rcon", "tcp", config.get("factorio.rcon_port"));
			const fixedLuaUdp = enableLuaUdp ? fixed("lua_udp", "udp", config.get("factorio.lua_udp_port")) : null;
			// Only a null game port picks from the range, 0 picks any free port.
			const gameRange = gamePort === null
				? { range: gamePortRange, preferred: config.get("factorio.host_assigned_game_port") }
				: undefined;
			const ports: FactorioServerPorts = {
				game: fixedGame ?? await free("game", "udp", gameRange),
				rcon: fixedRcon ?? await free("rcon", "tcp"),
				luaUdp: enableLuaUdp ? {
					factorio: fixedLuaUdp ?? await free("lua_udp", "udp"),
					host: await free("host_lua_udp", "udp"),
				} : null,
			};
			return new PortReservation(this._held, claims, ports);
		} catch (err) {
			this._held.delete(claims);
			throw err;
		}
	}

	_reserveFixed(claims: PortClaim[], claim: PortClaim) {
		// Ports configured on stopped instances do not prevent this, only reserved ones.
		const other = [...this._held].flat().find(c => c.protocol === claim.protocol && c.port === claim.port);
		if (other) {
			throw new lib.ConflictError(
				`Cannot use ${claim.protocol.toUpperCase()} port ${claim.port} for the ` +
				`${endpointNames[claim.endpoint]} of ${instanceLabel(claim)}, it is in use by the ` +
				`${endpointNames[other.endpoint]} of ${instanceLabel(other)}`
			);
		}
		claims.push(claim);
		return claim.port;
	}

	async _reserveFree(
		claims: PortClaim[],
		owner: PortOwner,
		endpoint: PortEndpoint,
		protocol: PortProtocol,
		options: FreePortOptions = {},
	) {
		const own = { instanceId: owner.instanceId, endpoint };
		// Probes stay bound until done so the OS does not hand out a skipped port again.
		const probes: BoundPort[] = [];
		const candidates = options.range ? rangeCandidates(options.range, options.preferred) : Array(100).fill(0);
		let inUse = 0;
		try {
			for (const candidate of candidates) {
				if (candidate && this.isClaimed(protocol, candidate, own)) {
					continue;
				}
				let probe;
				try {
					probe = await this._probe(protocol, candidate);
				} catch (err: any) {
					if (candidate && err.code === "EADDRINUSE") {
						inUse += 1;
						continue;
					}
					throw err;
				}
				probes.push(probe);
				// Checked again after probing as another reservation may have claimed it meanwhile.
				if (!this.isClaimed(protocol, probe.port, own)) {
					claims.push({ ...owner, endpoint, protocol, port: probe.port });
					return probe.port;
				}
			}
		} finally {
			await Promise.all(probes.map(probe => probe.close()));
		}
		const of = `the ${endpointNames[endpoint]} of ${instanceLabel(owner)}`;
		if (options.range) {
			const others = inUse ? ` (${inUse} in use by other processes)` : "";
			throw new lib.ConflictError(`No free ${protocol.toUpperCase()} port left in the range for ${of}${others}`);
		}
		throw new lib.EnvironmentError(`No free ${protocol.toUpperCase()} port found for ${of}`);
	}
}

function rangeCandidates(range: Set<number>, preferred?: number | null) {
	if (preferred && range.has(preferred)) {
		return [preferred, ...[...range].filter(port => port !== preferred)];
	}
	return [...range];
}
