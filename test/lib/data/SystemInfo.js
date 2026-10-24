import assert from "node:assert/strict";

import { PluginDetails, SystemInfo } from "@clusterio/lib";
import { testRoundTripJsonSerialisable } from "../../common.js";


describe("lib/data/SystemInfo", function() {
	describe("class SystemInfo", function() {
		it("correctly calculates derived metrics", function() {
			const system = new SystemInfo(
				"controller",
				"server",
				"v18.0.0",
				"Linux",
				"x86_64",
				"x86 CPU",
				[0.5, 0.25, 0, 1],
				1024,
				768,
				2048,
				512,
				false,
				false,
				0,
				false
			);
			assert.equal(system.cpuCapacity, 4);
			assert.equal(system.cpuUsed, 1.75);
			assert.equal(system.cpuAvailable, 2.25);
			assert.equal(system.cpuRatio, 0.4375);
			assert.equal(system.memoryUsed, 256);
			assert.equal(system.memoryRatio, 0.25);
			assert.equal(system.diskUsed, 1536);
			assert.equal(system.diskRatio, 0.75);
		});
		it("has round trip json serialisation", function() {
			const base = [
				1, "host", "v22.0.0", "Linux", "x86_64", "CPU", [0.5],
				1024, 768, 2048, 512, true, false, 0, 0, 0, false,
			];
			testRoundTripJsonSerialisable(SystemInfo, [
				base,
				[...base, []],
				[...base, [new PluginDetails("name", "Title", "1.0.0", true, true, undefined, "name", "1.1.0")]],
			]);
		});
	});
});
