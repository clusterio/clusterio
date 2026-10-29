/**
 * Known compatibility breaks for the version compatibility test
 *
 * scripts/version-compat-breaks.json lists the intended breaks against a
 * published version, keyed by that version:
 *
 *   {
 *     "2.0.3": {
 *       "messages": {
 *         "request FactorioVersionsRequest": { "pr": 1129, "reason": "..." }
 *       },
 *       "connect": { "pr": 1234, "reason": "..." }
 *     }
 *   }
 *
 * Listed messages are warned about instead of failing the test, and an entry
 * with connect skips starting the cluster.  Entries for other versions are
 * ignored.  See docs/contributing.md for when to add an entry.
 */
"use strict";
import fs from "node:fs/promises";
import path from "node:path";

export const breaksFile = path.join(import.meta.dirname, "version-compat-breaks.json");

function validateBreak(value, where) {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error(`${where} must be an object`);
	}
	if (!Number.isInteger(value.pr) || value.pr <= 0) {
		throw new Error(`${where} must have a pr number`);
	}
	if (typeof value.reason !== "string" || !value.reason.trim()) {
		throw new Error(`${where} must have a reason`);
	}
	const unknown = Object.keys(value).filter(key => !["pr", "reason"].includes(key));
	if (unknown.length) {
		throw new Error(`${where} has unknown properties ${unknown.join(", ")}`);
	}
}

export function validateBreaks(breaks) {
	if (!breaks || typeof breaks !== "object" || Array.isArray(breaks)) {
		throw new Error("Known breaks must be an object keyed by version");
	}
	for (const [version, entry] of Object.entries(breaks)) {
		if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
			throw new Error(`Known breaks for ${version} must be an object`);
		}
		const unknown = Object.keys(entry).filter(key => !["messages", "connect"].includes(key));
		if (unknown.length) {
			throw new Error(`Known breaks for ${version} has unknown properties ${unknown.join(", ")}`);
		}
		if (entry.messages !== undefined) {
			if (!entry.messages || typeof entry.messages !== "object" || Array.isArray(entry.messages)) {
				throw new Error(`Known breaks for ${version} messages must be an object`);
			}
			for (const [name, value] of Object.entries(entry.messages)) {
				if (!/^(request|event) \S+$/.test(name)) {
					throw new Error(`Known break ${version} ${name} must be named "request <Name>" or "event <Name>"`);
				}
				validateBreak(value, `Known break ${version} ${name}`);
			}
		}
		if (entry.connect !== undefined) {
			validateBreak(entry.connect, `Known break ${version} connect`);
		}
	}
	return breaks;
}

export async function loadBreaks(file = breaksFile) {
	return validateBreaks(JSON.parse(await fs.readFile(file, "utf8")));
}

/**
 * Pick the entry for the published version and list the versions ignored.
 */
export function selectBreaks(breaks, version) {
	return {
		messages: new Map(Object.entries(breaks[version]?.messages ?? {})),
		connect: breaks[version]?.connect,
		ignored: Object.keys(breaks).filter(key => key !== version),
	};
}

/**
 * Split changed message names into known and unknown breaks, and list the
 * known breaks that did not change.
 */
export function matchBreaks(messages, changedNames) {
	const changed = new Set(changedNames);
	return {
		known: changedNames.filter(name => messages.has(name)),
		unknown: changedNames.filter(name => !messages.has(name)),
		stale: [...messages.keys()].filter(name => !changed.has(name)),
	};
}
