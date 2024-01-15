"use strict";
const assert = require("assert").strict;

const lib = require("@clusterio/lib");
const { SystemMetrics } = lib;


describe("lib/data/ModPack", function() {
	describe("class SystemMetrics", function() {
		it("correctly calculates derived metrics", function() {
			const metrics = new SystemMetrics("controller", [0.5, 0.25, 0, 1], 1024, 768, 2048, 512, 0, false);
			assert.equal(metrics.cpuCapacity, 4);
			assert.equal(metrics.cpuUsed, 1.75);
			assert.equal(metrics.cpuAvailable, 2.25);
			assert.equal(metrics.cpuRatio, 0.4375);
			assert.equal(metrics.memoryUsed, 256);
			assert.equal(metrics.memoryRatio, 0.25);
			assert.equal(metrics.diskUsed, 1536);
			assert.equal(metrics.diskRatio, 0.75);
		});
	});
});
