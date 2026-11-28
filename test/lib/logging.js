import assert from "node:assert/strict";

import { WebConsoleFormat } from "@clusterio/lib";

// triple-beam's MESSAGE
const MESSAGE = Symbol.for("message");


describe("lib/logging", function() {
	describe("class WebConsoleFormat", function() {
		it("should separate the source from the message", function() {
			const format = new WebConsoleFormat();
			const info = format.transform({
				level: "info", message: "Hello", host_id: 1, host_name: "alpha",
				instance_id: 2, instance_name: "beta", plugin: "gamma",
			});
			assert.equal(info[MESSAGE], "[info] h:alpha - i:beta gamma: Hello");
		});
	});
});
