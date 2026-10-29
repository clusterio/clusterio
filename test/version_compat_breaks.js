import assert from "node:assert/strict";

import {
	loadBreaks, matchBreaks, selectBreaks, validateBreaks,
} from "../scripts/version-compat-breaks.js";


describe("scripts/version-compat-breaks", function() {
	const breaks = {
		"2.0.3": {
			messages: {
				"request ListedRequest": { pr: 1, reason: "Listed.", impact: "None." },
				"event UnchangedEvent": { pr: 2, reason: "Unchanged.", impact: "None." },
			},
			connect: { pr: 3, reason: "Cannot connect.", impact: "None." },
		},
		"2.0.2": {
			messages: { "request OldRequest": { pr: 4, reason: "Old.", impact: "None." } },
		},
	};

	describe("validateBreaks()", function() {
		it("should accept the committed file", async function() {
			await loadBreaks();
		});
		it("should accept a valid file", function() {
			validateBreaks(breaks);
			validateBreaks({});
		});
		it("should require a pr number, reason and impact", function() {
			assert.throws(
				() => validateBreaks({ "1.0.0": { messages: { "request A": { reason: "A." } } } }),
				/must have a pr number/
			);
			assert.throws(
				() => validateBreaks({ "1.0.0": { messages: { "request A": { pr: 1, reason: " " } } } }),
				/is missing reason/
			);
			assert.throws(
				() => validateBreaks({ "1.0.0": { messages: { "request A": { pr: 1, reason: "A." } } } }),
				/is missing impact/
			);
			assert.throws(
				() => validateBreaks({ "1.0.0": { connect: { pr: 1 } } }),
				/connect is missing reason/
			);
		});
		it("should reject unknown properties and bad message names", function() {
			assert.throws(() => validateBreaks({ "1.0.0": { connected: false } }), /unknown properties connected/);
			assert.throws(
				() => validateBreaks({
					"1.0.0": { messages: { "request A": { pr: 1, reason: "A.", impact: "A.", x: 1 } } },
				}),
				/unknown properties x/
			);
			assert.throws(
				() => validateBreaks({ "1.0.0": { messages: { "A": { pr: 1, reason: "A." } } } }),
				/must be named/
			);
		});
	});

	describe("selectBreaks()", function() {
		it("should pick the entry for the published version", function() {
			const selected = selectBreaks(breaks, "2.0.3");
			assert.deepEqual([...selected.messages.keys()], ["request ListedRequest", "event UnchangedEvent"]);
			assert.deepEqual(selected.connect, { pr: 3, reason: "Cannot connect.", impact: "None." });
			assert.deepEqual(selected.ignored, ["2.0.2"]);
		});
		it("should ignore every entry when the version is not listed", function() {
			const selected = selectBreaks(breaks, "2.0.4");
			assert.equal(selected.messages.size, 0);
			assert.equal(selected.connect, undefined);
			assert.deepEqual(selected.ignored, ["2.0.3", "2.0.2"]);
		});
	});

	describe("matchBreaks()", function() {
		const { messages } = selectBreaks(breaks, "2.0.3");
		it("should split changed messages into known and unknown", function() {
			const result = matchBreaks(messages, ["request ListedRequest", "event UnchangedEvent", "event OtherEvent"]);
			assert.deepEqual(result, {
				known: ["request ListedRequest", "event UnchangedEvent"],
				unknown: ["event OtherEvent"],
				stale: [],
			});
		});
		it("should report listed messages that did not change as stale", function() {
			const result = matchBreaks(messages, ["request ListedRequest"]);
			assert.deepEqual(result.stale, ["event UnchangedEvent"]);
		});
		it("should not match messages listed for another version", function() {
			const result = matchBreaks(selectBreaks(breaks, "2.0.3").messages, ["request OldRequest"]);
			assert.deepEqual(result.unknown, ["request OldRequest"]);
		});
	});
});
