import crypto from "node:crypto";
import fs from "node:fs/promises";

import * as lib from "@clusterio/lib";

export const DEFAULT_MATCHING_SERVER_URL = "https://multiplayer.factorio.com";

/** Version of a game as listed in the server browser */
export interface ListingVersion {
	/** major.minor.sub */
	version: string;
	build: number;
}

/** Game to list in the Factorio server browser */
export interface Listing {
	name: string;
	description: string;
	tags: string[];
	maxPlayers: number;
	hostAddress: string;
	hostPort: number;
	version: ListingVersion;
	players: string[];
	/** Minutes the game has been running */
	gameTimeElapsed?: number;
}

/** State of a listing kept between restarts so it can be updated or removed */
interface StoredListing {
	gameId: number;
	gameSecret: string;
	serverSecret?: string;
}

interface ActiveListing extends StoredListing {
	/** Game details last sent to the matching server */
	payload: string;
}

export interface MatchingServerCredentials {
	username: string;
	token: string;
}

class MatchingServerError extends Error {
	constructor(public status: number, message: string) {
		super(message);
	}
}

/**
 * Keeps a set of games listed in the Factorio server browser
 *
 * Talks to the matching server the same way a Factorio server with
 * visibility.public set does: create-game with the account credentials,
 * update-game when the details change, post-game-heartbeat otherwise, and
 * remove-game when a listing is no longer wanted.
 */
export class MatchingServerClient {
	private _active = new Map<string, ActiveListing>();
	/** Server secrets by key, kept after a listing is removed so it gets the same server_id back */
	private _serverSecrets = new Map<string, string>();
	private _loaded = false;

	constructor(
		private _logger: lib.Logger,
		private _statePath?: string,
		private _baseUrl = DEFAULT_MATCHING_SERVER_URL,
		private _fetch: typeof fetch = fetch,
	) { }

	/** Keys of the listings currently registered */
	get keys() {
		return [...this._active.keys()];
	}

	gameId(key: string) {
		return this._active.get(key)?.gameId;
	}

	private async _request(method: "GET" | "POST", uri: string, body?: object) {
		const response = await this._fetch(`${this._baseUrl}/${uri}`, {
			method,
			headers: body ? { "Content-Type": "application/json" } : undefined,
			body: body ? JSON.stringify(body) : undefined,
			signal: AbortSignal.timeout(15_000),
		});
		const text = await response.text();
		if (!response.ok) {
			throw new MatchingServerError(response.status, `${uri} failed with ${response.status}: ${text}`);
		}
		return text ? JSON.parse(text) : {};
	}

	private static _game(listing: Listing, gameSecret: string, gameId?: number) {
		return {
			...(gameId !== undefined ? { game_id: gameId } : {}),
			game_secret: gameSecret,
			name: listing.name.slice(0, 50),
			description: listing.description.slice(0, 5000),
			application_version: {
				game_version: listing.version.version,
				build_version: listing.version.build,
				build_mode: "headless",
				platform: "linux64",
			},
			max_players: listing.maxPlayers,
			game_time_elapsed: listing.gameTimeElapsed ?? 0,
			has_password: false,
			host_address: listing.hostAddress,
			host_port: listing.hostPort,
			tags: listing.tags,
			players: listing.players,
			headless_server: true,
		};
	}

	private async _loadState() {
		if (this._loaded || !this._statePath) {
			this._loaded = true;
			return new Map<string, StoredListing>();
		}
		this._loaded = true;
		let stored: Record<string, StoredListing> = {};
		try {
			stored = JSON.parse(await fs.readFile(this._statePath, "utf8"));
		} catch (err: any) {
			if (err.code !== "ENOENT") {
				this._logger.warn(`Failed to read server browser listings: ${err.message}`);
			}
		}
		return new Map(Object.entries(stored));
	}

	private async _saveState() {
		if (!this._statePath) {
			return;
		}
		const stored: Record<string, StoredListing & { removed?: boolean }> = {};
		for (const [key, secret] of this._serverSecrets) {
			stored[key] = { gameId: -1, gameSecret: "", serverSecret: secret, removed: true };
		}
		for (const [key, { gameId, gameSecret, serverSecret }] of this._active) {
			stored[key] = { gameId, gameSecret, serverSecret };
		}
		await lib.safeOutputFile(this._statePath, JSON.stringify(stored, null, "\t"));
	}

	/**
	 * Make the registered listings match the given ones
	 *
	 * @param listings - Listings that should exist by a stable key.
	 * @param credentials - Factorio account to create listings with.
	 */
	async sync(listings: Map<string, Listing>, credentials?: MatchingServerCredentials) {
		if (!this._loaded) {
			// Listings from before a restart are taken over, and updated or removed below
			for (const [key, stored] of await this._loadState()) {
				if (stored.serverSecret) {
					this._serverSecrets.set(key, stored.serverSecret);
				}
				if (stored.gameId >= 0) {
					this._active.set(key, { ...stored, payload: "" });
				}
			}
		}

		let changed = false;
		for (const [key, active] of [...this._active]) {
			if (!listings.has(key)) {
				this._active.delete(key);
				await this._remove(key, active);
				changed = true;
			}
		}

		for (const [key, listing] of listings) {
			try {
				changed = await this._syncListing(key, listing, credentials) || changed;
			} catch (err: any) {
				this._logger.warn(`Failed to update server browser listing ${listing.name}: ${err.message}`);
			}
		}

		if (changed) {
			await this._saveState();
		}
	}

	private async _syncListing(key: string, listing: Listing, credentials?: MatchingServerCredentials) {
		const active = this._active.get(key);
		const payload = JSON.stringify(MatchingServerClient._game(listing, ""));
		if (!active) {
			await this._create(key, listing, payload, credentials);
			return true;
		}

		try {
			if (active.payload !== payload) {
				await this._request("POST", `update-game/${active.gameId}`, {
					game: MatchingServerClient._game(listing, active.gameSecret, active.gameId),
					game_secret: active.gameSecret,
				});
				active.payload = payload;
			} else {
				await this._request("POST", `post-game-heartbeat/${active.gameId}`, {
					game_secret: active.gameSecret,
					game_patch: { game_time_elapsed: listing.gameTimeElapsed ?? 0 },
				});
			}
		} catch (err: any) {
			if (err instanceof MatchingServerError && err.status === 404) {
				// The matching server forgot about the game, register it again
				this._active.delete(key);
				await this._create(key, listing, payload, credentials);
				return true;
			}
			throw err;
		}
		return false;
	}

	private async _create(
		key: string,
		listing: Listing,
		payload: string,
		credentials?: MatchingServerCredentials,
	) {
		if (!credentials) {
			throw new Error("controller.factorio_username and controller.factorio_token must be set");
		}
		const gameSecret = crypto.randomBytes(16).toString("hex");
		const serverSecret = this._serverSecrets.get(key);
		const result = await this._request("POST", "create-game", {
			game: MatchingServerClient._game(listing, gameSecret),
			username: credentials.username,
			token: credentials.token,
			...(serverSecret ? { server_secret: serverSecret } : {}),
		});
		if (typeof result.game_id !== "number") {
			throw new Error("create-game did not return a game_id");
		}
		if (typeof result.server_secret === "string") {
			this._serverSecrets.set(key, result.server_secret);
		}
		this._active.set(key, {
			gameId: result.game_id,
			gameSecret,
			serverSecret: this._serverSecrets.get(key),
			payload,
		});
		this._logger.info(`Listed ${listing.name} in the server browser as game ${result.game_id}`);
	}

	private async _remove(key: string, stored: StoredListing) {
		try {
			await this._request("POST", `remove-game/${stored.gameId}`, { game_secret: stored.gameSecret });
		} catch (err: any) {
			if (!(err instanceof MatchingServerError && err.status === 404)) {
				this._logger.warn(`Failed to remove server browser listing ${stored.gameId}: ${err.message}`);
			}
		}
	}

	/** Remove all listings */
	async removeAll() {
		await this.sync(new Map());
	}
}
