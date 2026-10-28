import { isIPv6 } from "node:net";

interface Entry {
	failures: number,
	resetAtMs: number,
}

/**
 * Counts failed attempts per client address and blocks addresses that fail
 * too often within a time window.
 *
 * IPv6 addresses are grouped by their /64 prefix as a single client usually
 * controls the whole prefix. The number of tracked addresses is capped, when
 * the cap is reached new addresses are blocked until old entries expire.
 */
export default class FailureLimiter {
	entries = new Map<string, Entry>();

	constructor(
		public maxFailures: number,
		public windowMs: number,
		public maxEntries = 10000,
	) { }

	static key(address: string) {
		if (address.startsWith("::ffff:") && address.includes(".")) {
			return address.slice("::ffff:".length);
		}
		if (isIPv6(address)) {
			return `${expandIPv6(address).slice(0, 4).join(":")}::/64`;
		}
		return address;
	}

	private prune(nowMs: number) {
		for (const [key, entry] of this.entries) {
			if (entry.resetAtMs <= nowMs) {
				this.entries.delete(key);
			}
		}
	}

	/** Milliseconds until the address may try again, 0 if it is not blocked. */
	blockedForMs(address: string, nowMs = Date.now()) {
		const entry = this.entries.get(FailureLimiter.key(address));
		if (entry) {
			if (entry.resetAtMs <= nowMs) {
				return 0;
			}
			return entry.failures >= this.maxFailures ? entry.resetAtMs - nowMs : 0;
		}
		if (this.entries.size >= this.maxEntries) {
			this.prune(nowMs);
			if (this.entries.size >= this.maxEntries) {
				return this.windowMs;
			}
		}
		return 0;
	}

	/** Record a failed attempt, returns true if the address became blocked by it. */
	fail(address: string, nowMs = Date.now()) {
		const key = FailureLimiter.key(address);
		let entry = this.entries.get(key);
		if (!entry || entry.resetAtMs <= nowMs) {
			if (!entry && this.entries.size >= this.maxEntries) {
				this.prune(nowMs);
				if (this.entries.size >= this.maxEntries) {
					return false;
				}
			}
			entry = { failures: 0, resetAtMs: nowMs + this.windowMs };
			this.entries.set(key, entry);
		}
		entry.failures += 1;
		return entry.failures === this.maxFailures;
	}
}

function expandIPv6(address: string) {
	const [head, tail = ""] = address.split("%")[0].split("::");
	const headParts = head ? head.split(":") : [];
	const tailParts = tail ? tail.split(":") : [];
	if (tailParts.length && tailParts[tailParts.length - 1].includes(".")) {
		tailParts.splice(-1, 1, "0", "0");
	}
	if (!address.includes("::")) {
		return headParts.map(p => p.padStart(4, "0").toLowerCase());
	}
	const missing = 8 - headParts.length - tailParts.length;
	return [...headParts, ...Array(missing).fill("0"), ...tailParts].map(p => p.padStart(4, "0").toLowerCase());
}
