import dgram from "node:dgram";
import net from "node:net";
import util from "node:util";

import * as lib from "@clusterio/lib";

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

/** Port used by an instance */
export interface PortClaim {
	owner: number;
	endpoint: PortEndpoint;
	protocol: PortProtocol;
	port: number;
}

/** Port set in the config of an assigned instance */
export interface ConfiguredPortClaim extends PortClaim {
	/** Config field the port is set in */
	field: string;
}

/** Ports the host reserved for an instance to run Factorio with */
export interface InstancePorts {
	gamePort: number;
	rconPort: number;
	/** Only set with Lua UDP enabled */
	luaUdpPort?: number;
	/** Only set with Lua UDP enabled */
	hostUdpPort?: number;
}

/** Socket bound to a port, kept open until closed */
export interface BoundPort {
	port: number;
	close(): Promise<void>;
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
	const owner = config.get("instance.id");
	const claims: ConfiguredPortClaim[] = [];
	const add = (endpoint: PortEndpoint, protocol: PortProtocol, field: keyof lib.InstanceConfigFields) => {
		const port = config.get(field) as number | null;
		if (port) {
			claims.push({ owner, endpoint, protocol, port, field });
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

async function listenTcp(host: string): Promise<BoundPort> {
	const server = net.createServer();
	await new Promise<void>((resolve, reject) => {
		server.once("error", reject);
		server.listen({ host, port: 0, ipv6Only: false }, () => {
			server.off("error", reject);
			resolve();
		});
	});
	return {
		port: (server.address() as net.AddressInfo).port,
		close: () => new Promise(resolve => { server.close(() => resolve()); }),
	};
}

async function bindUdp(type: "udp4" | "udp6", address: string) {
	const socket = dgram.createSocket({ type, ipv6Only: false });
	try {
		await new Promise<void>((resolve, reject) => {
			socket.once("error", reject);
			socket.bind(0, address, () => {
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
 * Bind a port picked by the OS on all addresses
 *
 * Binds dual stack on [::], or 0.0.0.0 if IPv6 is unavailable, so the port
 * is free on both IPv4 and IPv6.
 *
 * @param protocol - Protocol to bind.
 * @returns the bound socket.
 */
export async function probeFreePort(protocol: PortProtocol): Promise<BoundPort> {
	const bind = protocol === "tcp"
		? listenTcp
		: (address: string) => bindUdp(address === "::" ? "udp6" : "udp4", address);
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
 * Ports in use by the instances of a host
 *
 * Holds the ports set in the config of assigned instances, including
 * stopped ones, and the ports reserved for running instances.  Free ports
 * are picked to avoid both.  This only covers the host's own instances,
 * ports taken by other processes are found by binding them.
 */
export class PortRegistry {
	_configured = new Map<number, ConfiguredPortClaim[]>();
	_reserved = new Map<number, PortClaim[]>();
	_probe = probeFreePort;

	constructor(
		/** Name of the owner used in messages */
		public describeOwner: (owner: number) => string = owner => `instance ${owner}`,
	) { }

	/**
	 * Replace the ports claimed by the config of an instance
	 *
	 * @param owner - ID of the instance.
	 * @param config - Current config of the instance.
	 * @returns descriptions of new conflicts with other configured ports.
	 */
	setConfigured(owner: number, config: lib.InstanceConfig) {
		const claims = configuredPortClaims(config);
		const previous = this._configured.get(owner) ?? [];
		this._configured.set(owner, claims);
		if (util.isDeepStrictEqual(claims, previous)) {
			return [];
		}
		return this._configuredConflicts(claims);
	}

	/** Remove the ports claimed by the config of an unassigned instance */
	clearConfigured(owner: number) {
		this._configured.delete(owner);
	}

	_configuredConflicts(claims: ConfiguredPortClaim[]) {
		const conflicts: string[] = [];
		for (const claim of claims) {
			if (claim.field === "factorio.host_assigned_game_port") {
				continue; // Reassigned on start if taken
			}
			for (const other of this._configuredClaims(claim.protocol, claim.port)) {
				if (other === claim || other.field === "factorio.host_assigned_game_port") {
					continue;
				}
				const owner = other.owner === claim.owner ? "the same instance" : this.describeOwner(other.owner);
				conflicts.push(
					`${claim.field} ${claim.port} (${claim.protocol.toUpperCase()}) is also the ` +
					`${endpointNames[other.endpoint]} of ${owner}, only one of them can be running`
				);
			}
		}
		return conflicts;
	}

	_configuredClaims(protocol: PortProtocol, port: number) {
		return [...this._configured.values()].flat().filter(
			claim => claim.protocol === protocol && claim.port === port
		);
	}

	_reservedClaims(protocol: PortProtocol, port: number) {
		return [...this._reserved.values()].flat().filter(
			claim => claim.protocol === protocol && claim.port === port
		);
	}

	/** Configured and reserved claims of the given port */
	claims(protocol: PortProtocol, port: number): PortClaim[] {
		return [...this._configuredClaims(protocol, port), ...this._reservedClaims(protocol, port)];
	}

	/**
	 * Check if a port is configured or reserved
	 *
	 * @param protocol - Protocol of the port.
	 * @param port - Port to check.
	 * @param except - Ignore claims by this owner and endpoint.
	 * @returns true if the port is claimed.
	 */
	isClaimed(protocol: PortProtocol, port: number, except?: { owner: number, endpoint: PortEndpoint }) {
		return this.claims(protocol, port).some(
			claim => !except || claim.owner !== except.owner || claim.endpoint !== except.endpoint
		);
	}

	/** Ports reserved for an instance */
	reserved(owner: number) {
		return this._reserved.get(owner) ?? [];
	}

	_add(claim: PortClaim) {
		const reserved = this._reserved.get(claim.owner);
		if (reserved) {
			reserved.push(claim);
		} else {
			this._reserved.set(claim.owner, [claim]);
		}
	}

	/**
	 * Reserve a fixed port
	 *
	 * Ports configured on stopped instances do not prevent this, only
	 * ports reserved for running instances.
	 *
	 * @param owner - ID of the instance reserving the port.
	 * @param endpoint - What the port is used for.
	 * @param protocol - Protocol of the port.
	 * @param port - Port to reserve.
	 * @returns the port.
	 * @throws {lib.ConflictError} if the port is already reserved.
	 */
	reserveFixed(owner: number, endpoint: PortEndpoint, protocol: PortProtocol, port: number) {
		const [other] = this._reservedClaims(protocol, port);
		if (other) {
			throw new lib.ConflictError(
				`Cannot use ${protocol.toUpperCase()} port ${port} for the ${endpointNames[endpoint]} of ` +
				`${this.describeOwner(owner)}, it is in use by the ${endpointNames[other.endpoint]} of ` +
				`${this.describeOwner(other.owner)}`
			);
		}
		this._add({ owner, endpoint, protocol, port });
		return port;
	}

	/**
	 * Reserve a free port picked by the OS
	 *
	 * Probes until the OS gives a port that is not claimed.  The port is
	 * free when picked, but another process may bind it before Factorio
	 * does.
	 *
	 * @param owner - ID of the instance reserving the port.
	 * @param endpoint - What the port is used for.
	 * @param protocol - Protocol of the port.
	 * @returns the port.
	 */
	async reserveFree(owner: number, endpoint: PortEndpoint, protocol: PortProtocol) {
		// Claimed ports stay bound until done so the OS does not hand them out again.
		const probes: BoundPort[] = [];
		try {
			for (let attempt = 0; attempt < 100; attempt++) {
				const probe = await this._probe(protocol);
				probes.push(probe);
				if (!this.isClaimed(protocol, probe.port)) {
					this._add({ owner, endpoint, protocol, port: probe.port });
					return probe.port;
				}
			}
		} finally {
			await Promise.all(probes.map(probe => probe.close()));
		}
		throw new lib.EnvironmentError(
			`No free ${protocol.toUpperCase()} port found for the ${endpointNames[endpoint]} of ` +
			`${this.describeOwner(owner)}`
		);
	}

	/** Release the ports reserved for an instance */
	release(owner: number) {
		this._reserved.delete(owner);
	}
}
