import fs from "fs-extra";
import os from "os";
import util from "util";
import { Gauge } from "./prometheus";
import { SystemInfo } from "./data";

function filterCpuModel() {
	const model = os.cpus()[0].model;
	// Remove irelevant clutter
	return model
		.replace(/\(R\)/gi, "®") // Intel CPUs use (R) instead of ®
		.replace(/\(TM\)/gi, "™") // Intel and AMD CPUs use (TM) instead of ™
		.replace(/ CPU /, " ") // Intel CPUs add redundant "CPU" in the model.
		.replace(/ @ [0-9]+\.[0-9]+GHz/, "") // Intel CPUs add GHz after the model.
		.replace(/ (Dual|Quad|Six|[0-9]+)-Core Processor/, "") // AMD CPUs add cores after the model.
		.trim() // AMD CPUs may have trailing spaces in the model.
	;
}
const cpuModel = filterCpuModel();

export const systemInfo = new Gauge(
	"system_info",
	"Static info about the system.",
	{
		labels: ["kernel", "machine", "cpu_model", "hostname", "node"],
	}
);
systemInfo.labels({
	"kernel": os.type(),
	"machine": os.machine(),
	"cpu_model": cpuModel,
	"hostname": os.hostname(),
	"node": process.version,
}).set(1);

export const systemCpuSecondsTotal = new Gauge(
	"system_cpu_seconds_total",
	"Total system CPU time spent in seconds.",
	{
		labels: ["core"],
		callback: function(collector) {
			const cpus = os.cpus();
			for (let i = 0; i < cpus.length; i++) {
				const times = cpus[i].times;
				collector.labels(String(i)).set(
					(times.user + times.idle + times.irq + times.nice + times.sys) / 1000
				);
			}
		},
	},
);

export const systemCpuIdleSecondsTotal = new Gauge(
	"system_cpu_idle_seconds_total",
	"Total system CPU time spent being idle in seconds.",
	{
		labels: ["core"],
		callback: function(collector) {
			const cpus = os.cpus();
			for (let i = 0; i < cpus.length; i++) {
				const times = cpus[i].times;
				collector.labels(String(i)).set(
					times.idle / 1000
				);
			}
		},
	},
);

export const systemMemoryCapasityBytes = new Gauge(
	"system_memory_capasity_bytes",
	"Total system memory installed",
	{
		callback: function(collector) {
			collector.set(os.totalmem());
		},
	},
);

export const systemMemoryAvailableBytes = new Gauge(
	"system_memory_available_bytes",
	"Total system memory available for use",
	{
		callback: function(collector) {
			collector.set(os.freemem());
		},
	},
);

export const systemDiskCapasityBytes = new Gauge(
	"system_disk_capasity_bytes",
	"Size of the filesystem of the current working directory Node.js runs on",
	{
		callback: async function(collector) {
			// statfs was added in Node.js v18.15.0 and may not be present.
			// TODO: remove this check once minimum supported Node.js >= v18.15.0.
			if (!fs.statfs) {
				collector.set(0);
				return;
			}
			const statFsAsync = util.promisify(fs.statfs);
			const stats = await statFsAsync(".");
			collector.set(stats.blocks * stats.bsize);
		},
	},
);

export const systemDiskAvailableBytes = new Gauge(
	"system_disk_available_bytes",
	"Available space on the filesystem of the current working directory Node.js runs on",
	{
		callback: async function(collector) {
			// TODO: remove this check once minimum supported Node.js >= v18.15.0.
			if (!fs.statfs) {
				collector.set(0);
				return;
			}
			const statFsAsync = util.promisify(fs.statfs);
			const stats = await statFsAsync(".");
			collector.set(stats.bavail * stats.bsize);
		},
	},
);

function minZip<T>(a: T[], b: T[]): [T, T][] {
	const length = Math.min(a.length, b.length);
	const result = [];
	result.length = length;
	for (let i = 0; i < length; i++) {
		result[i] = [a[i], b[i]] as [T, T];
	}
	return result;
}

let previousTotalCpuMs: number[] = [];
let previousIdleCpuMs: number[] = [];
export async function gatherSystemInfo(id: SystemInfo["id"]) {
	const cpus = os.cpus();
	const currentTotalCpuMs = cpus.map(({ times }) => times.user + times.idle + times.irq + times.nice + times.sys);
	const currentIdleCpuMs = cpus.map(({ times }) => times.idle);
	const deltaTotalCpuMs = minZip(previousTotalCpuMs, currentTotalCpuMs).map(([prev, curr]) => curr - prev);
	const deltaIdleCpuMs = minZip(previousIdleCpuMs, currentIdleCpuMs).map(([prev, curr]) => curr - prev);
	const cpuUsage = minZip(deltaTotalCpuMs, deltaIdleCpuMs).map(([total, idle]) => (total - idle) / total);
	previousTotalCpuMs = currentTotalCpuMs;
	previousIdleCpuMs = currentIdleCpuMs;
	let diskCapacity = 0;
	let diskAvailable = 0;
	if (fs.statfs) { // TODO: remove this check once minimum supported Node.js >= v18.15.0.
		const statFsAsync = util.promisify(fs.statfs);
		const stats = await statFsAsync(".");
		diskCapacity = stats.blocks * stats.bsize;
		diskAvailable = stats.bavail * stats.bsize;
	}

	return new SystemInfo(
		id,
		os.hostname(),
		process.version,
		os.type(),
		os.machine(),
		cpuModel,
		cpuUsage,
		os.totalmem(),
		os.freemem(),
		diskCapacity,
		diskAvailable,
		Date.now(),
		false,
	);
}
