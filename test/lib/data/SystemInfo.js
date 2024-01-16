"use strict";
const assert = require("assert").strict;

const lib = require("@clusterio/lib");
const { SystemInfo } = lib;


describe("lib/data/ModPack", function() {
	describe("class SystemInfo", function() {
		it("correctly calculates derived metrics", function() {
			const system = new SystemInfo("controller", [0.5, 0.25, 0, 1], 1024, 768, 2048, 512, 0, false);
			assert.equal(system.cpuCapacity, 4);
			assert.equal(system.cpuUsed, 1.75);
			assert.equal(system.cpuAvailable, 2.25);
			assert.equal(system.cpuRatio, 0.4375);
			assert.equal(system.memoryUsed, 256);
			assert.equal(system.memoryRatio, 0.25);
			assert.equal(system.diskUsed, 1536);
			assert.equal(system.diskRatio, 0.75);
		});
	});
});
