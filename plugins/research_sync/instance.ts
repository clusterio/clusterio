import * as lib from "@clusterio/lib";
import type { InstancePluginContext } from "@clusterio/host";
import {
	ContributionEvent,
	ProgressEvent,
	FinishedEvent,
	TechnologySync,
	SyncTechnologiesRequest,
} from "./messages.js";

// ./module/sync.lua
type IpcContribution = {
	name: string,
	level: number,
	contribution: number,
};
type IpcFinished = {
	name: string,
	level: number,
};

export default async function(context: InstancePluginContext) {
	const { instance, logger, plugin } = context;
	let syncStarted = false;

	// Commands are sent one at a time so they execute in order
	let rconQueue: Promise<unknown> = Promise.resolve();
	function sendOrderedRcon(message: string, expectEmpty = false) {
		const result = rconQueue.then(() => instance.sendRcon(message, expectEmpty, plugin.name));
		rconQueue = result.catch(() => {});
		return result;
	}

	function unexpectedError(err: Error) {
		logger.error(`Unexpected error:\n${err.stack}`);
	}

	async function researchContribution(tech: IpcContribution) {
		instance.sendTo("controller", new ContributionEvent(tech.name, tech.level, tech.contribution));
	}

	async function researchFinished(tech: IpcFinished) {
		instance.sendTo("controller", new FinishedEvent(tech.name, tech.level));
	}

	instance.server.on("ipc-research_sync:contribution", (tech: IpcContribution) => {
		researchContribution(tech).catch(err => unexpectedError(err));
	});
	instance.server.on("ipc-research_sync:finished", (tech: IpcFinished) => {
		researchFinished(tech).catch(err => unexpectedError(err));
	});

	instance.handle(ProgressEvent, async (event: ProgressEvent) => {
		if (!syncStarted || !["starting", "running"].includes(instance.status)) {
			return;
		}
		let techsJson = lib.escapeString(JSON.stringify(event.technologies));
		await sendOrderedRcon(`/sc research_sync.update_progress("${techsJson}")`, true);
	});

	instance.handle(FinishedEvent, async (event: FinishedEvent) => {
		if (!syncStarted || !["starting", "running"].includes(instance.status)) {
			return;
		}
		let { name, level } = event;
		await sendOrderedRcon(
			`/sc research_sync.research_technology("${lib.escapeString(name)}", ${level})`, true
		);
	});

	instance.hooks.start.attach(plugin.name, async () => {
		let dumpJson = await sendOrderedRcon("/sc research_sync.dump_technologies()");
		let techsToSend = [];
		let instanceTechs = new Map();
		for (let tech of JSON.parse(dumpJson)) {
			techsToSend.push(new TechnologySync(
				tech.name,
				tech.level,
				tech.progress || null,
				tech.researched,
			));
			instanceTechs.set(tech.name, tech);
		}

		let controllerTechs = await instance.sendTo("controller", new SyncTechnologiesRequest(techsToSend));
		syncStarted = true;
		let techsToSync = [];
		for (let controllerTech of controllerTechs) {
			let { name, level, progress, researched } = controllerTech;
			let instanceTech = instanceTechs.get(name);
			if (
				!instanceTech
				|| instanceTech.level !== level
				|| (instanceTech.progress || null) !== progress
				|| instanceTech.researched !== researched
			) {
				techsToSync.push(controllerTech);
			}
		}

		if (techsToSync.length) {
			let syncJson = lib.escapeString(JSON.stringify(techsToSync));
			await sendOrderedRcon(`/sc research_sync.sync_technologies("${syncJson}")`, true);
		}
	});
}
