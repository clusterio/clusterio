import { Type, Static } from "@sinclair/typebox";

/**
 * Invite code that lets a new host claim a host token from the controller.
 *
 * Invites are limited by an optional expiry time and an optional number of
 * uses, both of which can be changed after the invite is created.
 */
export default class HostInvite {
	/** Characters used in invite codes, without 0/O, 1/I/L and other look-alikes. */
	static codeAlphabet = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
	static codeLength = 8;

	constructor(
		/** Unique id of the invite, separate from the code so it can be logged. */
		public id: number,
		/** Secret code used to claim the invite. */
		public code: string,
		/** Name of the user that created the invite. */
		public createdBy = "",
		/** Millisecond Unix timestamp the invite was created at. */
		public createdAtMs = 0,
		/** Millisecond Unix timestamp the invite expires at, null for never. */
		public expiresAtMs: number | null = null,
		/** Maximum number of times the invite can be claimed, null for unlimited. */
		public maxUses: number | null = null,
		/** Ids of the hosts that claimed this invite. */
		public hostIds: number[] = [],
		/** Millisecond Unix timestamp of the last claim, 0 if never claimed. */
		public lastUsedAtMs = 0,
		/** Millisecond Unix timestamp this entry was last updated at. */
		public updatedAtMs = 0,
		/** True if this invite has been revoked. */
		public isDeleted = false,
	) { }

	get uses() {
		return this.hostIds.length;
	}

	isExpired(nowMs = Date.now()) {
		return this.expiresAtMs !== null && this.expiresAtMs <= nowMs;
	}

	isUsedUp() {
		return this.maxUses !== null && this.uses >= this.maxUses;
	}

	/** True if the invite can be claimed. */
	isUsable(nowMs = Date.now()) {
		return !this.isDeleted && !this.isExpired(nowMs) && !this.isUsedUp();
	}

	/** Time the invite stopped being usable, or null if it is still usable. */
	inactiveSinceMs(nowMs = Date.now()) {
		if (this.isExpired(nowMs)) {
			return this.isUsedUp() ? Math.min(this.expiresAtMs!, this.lastUsedAtMs) : this.expiresAtMs;
		}
		return this.isUsedUp() ? this.lastUsedAtMs : null;
	}

	/** Uppercase a user supplied code and check it has the shape of an invite code. */
	static normalizeCode(code: string) {
		const normalized = code.trim().toUpperCase();
		const valid = normalized.length === this.codeLength
			&& [...normalized].every(c => this.codeAlphabet.includes(c));
		return valid ? normalized : null;
	}

	/**
	 * Split an invite URL of the form `<controller url>invite/<code>` into
	 * the controller URL and the normalised code.
	 */
	static parseUrl(url: string) {
		let parsed;
		try {
			parsed = new URL(url.trim());
		} catch {
			return null;
		}
		const match = /^(.*\/)invite\/([^/]+)\/?$/.exec(parsed.pathname);
		if (!["http:", "https:"].includes(parsed.protocol) || !match) {
			return null;
		}
		const code = this.normalizeCode(match[2]);
		if (!code) {
			return null;
		}
		return { controllerUrl: `${parsed.origin}${match[1]}`, code };
	}

	/** Code with all but the first two characters masked, for logging. */
	static redactCode(code: string) {
		return `${code.slice(0, 2)}${"*".repeat(this.codeLength - 2)}`;
	}

	static jsonSchema = Type.Object({
		"id": Type.Integer(),
		"code": Type.String(),
		"createdBy": Type.Optional(Type.String()),
		"createdAtMs": Type.Optional(Type.Number()),
		"expiresAtMs": Type.Optional(Type.Number()),
		"maxUses": Type.Optional(Type.Integer()),
		"hostIds": Type.Optional(Type.Array(Type.Integer())),
		"lastUsedAtMs": Type.Optional(Type.Number()),
		"updatedAtMs": Type.Optional(Type.Number()),
		"isDeleted": Type.Optional(Type.Boolean()),
	});

	static fromJSON(json: Static<typeof this.jsonSchema>) {
		return new this(
			json.id,
			json.code,
			json.createdBy,
			json.createdAtMs,
			json.expiresAtMs ?? null,
			json.maxUses ?? null,
			json.hostIds,
			json.lastUsedAtMs,
			json.updatedAtMs,
			json.isDeleted,
		);
	}

	toJSON() {
		const json = {
			id: this.id,
			code: this.code,
		} as Static<typeof HostInvite.jsonSchema>;

		if (this.createdBy !== "") {
			json.createdBy = this.createdBy;
		}
		if (this.createdAtMs !== 0) {
			json.createdAtMs = this.createdAtMs;
		}
		if (this.expiresAtMs !== null) {
			json.expiresAtMs = this.expiresAtMs;
		}
		if (this.maxUses !== null) {
			json.maxUses = this.maxUses;
		}
		if (this.hostIds.length) {
			json.hostIds = this.hostIds;
		}
		if (this.lastUsedAtMs !== 0) {
			json.lastUsedAtMs = this.lastUsedAtMs;
		}
		if (this.updatedAtMs !== 0) {
			json.updatedAtMs = this.updatedAtMs;
		}
		if (this.isDeleted !== false) {
			json.isDeleted = this.isDeleted;
		}

		return json;
	}
}
