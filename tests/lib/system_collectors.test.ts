import fs from "node:fs/promises";
import os from "node:os";
import t, { type Test } from "tap";
import * as lib from "@clusterio/lib";

const collectorsPath = "@clusterio/lib/dist/node/src/system_collectors.js";

type Times = { user: number, nice: number, sys: number, idle: number, irq: number };

function cpu(model: string, times: Partial<Times> = {}) {
	return { model, speed: 0, times: { user: 0, nice: 0, sys: 0, idle: 0, irq: 0, ...times } };
}

// Load a fresh copy of the module with controllable os and filesystem stats.
// The module reads the CPU model once on load and keeps CPU times between calls.
async function load(t1: Test, cpus: ReturnType<typeof cpu>[]) {
	const state = {
		cpus,
		totalmem: 16_000,
		freemem: 4_000,
		uptime: 100,
		statfs: { blocks: 1000, bavail: 250, bsize: 4096 },
	};
	const collectors: typeof lib = await t1.mockImport(collectorsPath, {
		"os": {
			...os,
			cpus: () => state.cpus,
			type: () => "Linux",
			machine: () => "x86_64",
			hostname: () => "box",
			totalmem: () => state.totalmem,
			freemem: () => state.freemem,
			uptime: () => state.uptime,
		},
		"node:fs/promises": {
			...fs,
			statfs: async () => state.statfs,
		},
	});
	return { collectors, state };
}

async function samples(gauge: lib.Gauge) {
	for await (const result of gauge.collect()) {
		return Object.fromEntries(result.samples.get("")!);
	}
	throw new Error("collector yielded nothing");
}

t.test("systemInfo", async t1 => {
	t1.test("labels the system", async t2 => {
		const { collectors } = await load(t2, [cpu("Some CPU")]);
		const label = `kernel="Linux",machine="x86_64",cpu_model="Some CPU",hostname="box",node="${process.version}"`;
		t2.strictSame(await samples(collectors.systemInfo), { [label]: 1 });
	});
	t1.test("cleans up Intel CPU models", async t2 => {
		const { collectors } = await load(t2, [cpu("Intel(R) Core(TM) i7-8700K CPU @ 3.70GHz")]);
		const info = await collectors.gatherSystemInfo(1, false, false, 0);
		t2.equal(info.cpuModel, "Intel® Core™ i7-8700K");
	});
	t1.test("cleans up AMD CPU models", async t2 => {
		const { collectors } = await load(t2, [cpu("AMD Ryzen 7 3700X 8-Core Processor    ")]);
		const info = await collectors.gatherSystemInfo(1, false, false, 0);
		t2.equal(info.cpuModel, "AMD Ryzen 7 3700X");
	});
});

t.test("systemCpuSecondsTotal", async t1 => {
	t1.test("sums the time of each core in seconds", async t2 => {
		const { collectors } = await load(t2, [
			cpu("x", { user: 1000, nice: 2000, sys: 3000, idle: 4000, irq: 500 }),
			cpu("x", { user: 1500 }),
		]);
		t2.strictSame(
			await samples(collectors.systemCpuSecondsTotal),
			{ 'core="0"': 10.5, 'core="1"': 1.5 },
		);
	});
});

t.test("systemCpuIdleSecondsTotal", async t1 => {
	t1.test("gives the idle time of each core in seconds", async t2 => {
		const { collectors } = await load(t2, [cpu("x", { user: 1000, idle: 4000 }), cpu("x", { idle: 2500 })]);
		t2.strictSame(
			await samples(collectors.systemCpuIdleSecondsTotal),
			{ 'core="0"': 4, 'core="1"': 2.5 },
		);
	});
});

t.test("memory collectors", async t1 => {
	t1.test("report total and free memory", async t2 => {
		const { collectors, state } = await load(t2, [cpu("x")]);
		t2.strictSame(await samples(collectors.systemMemoryCapacityBytes), { "": 16_000 });
		t2.strictSame(await samples(collectors.systemMemoryAvailableBytes), { "": 4_000 });
		state.freemem = 3_000;
		t2.strictSame(await samples(collectors.systemMemoryAvailableBytes), { "": 3_000 }, "updates on collect");
	});
});

t.test("disk collectors", async t1 => {
	t1.test("report filesystem size and available space in bytes", async t2 => {
		const { collectors } = await load(t2, [cpu("x")]);
		t2.strictSame(await samples(collectors.systemDiskCapacityBytes), { "": 1000 * 4096 });
		t2.strictSame(await samples(collectors.systemDiskAvailableBytes), { "": 250 * 4096 });
	});
});

t.test("gatherSystemInfo()", async t1 => {
	t1.test("returns info about the system", async t2 => {
		t2.capture(Date, "now", () => 1_000_000);
		const { collectors } = await load(t2, [cpu("Some CPU")]);
		const plugins = [new lib.PluginDetails("p", "P", "1.0.0", "loaded")];
		const info = await collectors.gatherSystemInfo(7, true, false, 500, plugins);
		t2.equal(info.constructor.name, "SystemInfo", "fresh module copy, so compare by name");
		t2.strictSame({ ...info }, {
			id: 7,
			hostname: "box",
			node: process.version,
			kernel: "Linux",
			machine: "x86_64",
			cpuModel: "Some CPU",
			coreRatios: [],
			memoryCapacity: 16_000,
			memoryAvailable: 4_000,
			diskCapacity: 1000 * 4096,
			diskAvailable: 250 * 4096,
			canRestart: true,
			restartRequired: false,
			systemStartedAtMs: 1_000_000 - 100_000,
			processStartedAtMs: 500,
			updatedAtMs: 1_000_000,
			isDeleted: false,
			plugins,
		});
	});
	t1.test("gives core usage since the previous call", async t2 => {
		const { collectors, state } = await load(t2, [
			cpu("x", { user: 100, idle: 100 }),
			cpu("x", { user: 100, idle: 100 }),
		]);
		t2.strictSame((await collectors.gatherSystemInfo(1, false, false, 0)).coreRatios, [], "nothing to compare");
		state.cpus = [
			cpu("x", { user: 300, sys: 50, idle: 250 }),
			cpu("x", { user: 100, idle: 200 }),
		];
		t2.strictSame((await collectors.gatherSystemInfo(1, false, false, 0)).coreRatios, [0.625, 0]);
	});
	t1.test("gives 0 usage for cores with no elapsed time", async t2 => {
		const { collectors } = await load(t2, [cpu("x", { user: 100, idle: 100 })]);
		await collectors.gatherSystemInfo(1, false, false, 0);
		t2.strictSame((await collectors.gatherSystemInfo(1, false, false, 0)).coreRatios, [0]);
	});
	t1.test("only reports cores present in both calls", async t2 => {
		const { collectors, state } = await load(t2, [cpu("x"), cpu("x")]);
		await collectors.gatherSystemInfo(1, false, false, 0);
		state.cpus = [cpu("x", { user: 50, idle: 50 })];
		t2.strictSame((await collectors.gatherSystemInfo(1, false, false, 0)).coreRatios, [0.5]);
		state.cpus = [cpu("x", { user: 100, idle: 100 }), cpu("x", { user: 100, idle: 100 })];
		t2.strictSame((await collectors.gatherSystemInfo(1, false, false, 0)).coreRatios, [0.5]);
	});
});
