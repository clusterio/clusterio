import t from "tap";
import * as lib from "@clusterio/lib";

function systemInfo(coreRatios: number[], memory: [number, number], disk: [number, number]) {
	return new lib.SystemInfo(
		1, "host", "v24", "linux", "x86_64", "cpu", coreRatios,
		memory[0], memory[1], disk[0], disk[1], false, false, 0, 0, 0, false,
	);
}

t.test("SystemInfo", async t1 => {
	t1.test("cpu getters", async t2 => {
		t2.test("sum the per core usage", async t3 => {
			const info = systemInfo([0.5, 0.25, 0, 1], [1, 1], [1, 1]);
			t3.equal(info.cpuCapacity, 4);
			t3.equal(info.cpuUsed, 1.75);
			t3.equal(info.cpuAvailable, 2.25);
			t3.equal(info.cpuRatio, 0.4375);
		});
	});
	t1.test("memory getters", async t2 => {
		t2.test("derive usage from capacity and available", async t3 => {
			const info = systemInfo([], [1000, 250], [1, 1]);
			t3.equal(info.memoryUsed, 750);
			t3.equal(info.memoryRatio, 0.75);
		});
	});
	t1.test("disk getters", async t2 => {
		t2.test("derive usage from capacity and available", async t3 => {
			const info = systemInfo([], [1, 1], [400, 300]);
			t3.equal(info.diskUsed, 100);
			t3.equal(info.diskRatio, 0.25);
		});
	});
});
