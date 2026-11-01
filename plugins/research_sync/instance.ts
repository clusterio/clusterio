import * as lib from "@clusterio/lib";
import type { InstancePluginContext } from "@clusterio/host";
import {
	ContributionEvent,
	ProgressEvent,
	FinishedEvent,
	TechnologySync,
	SyncTechnologiesRequest,
	QueueUpdateEvent,
	QueueEvent,
	QueueSyncRequest,
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
type IpcQueue = { queue: unknown, player?: string };

export default async function(context: InstancePluginContext) {
	const { instance, host, logger, plugin } = context;
	let syncStarted = false;
	let queueEventsApplied = 0;
	// Contributions made while the controller is unreachable, summed per technology.
	// Unlike finished research they can't be recovered from the game state.
	const pendingContributions = new Map<string, IpcContribution>();
	let finishedWhileDisconnected = false;

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

	// An empty Lua table serialises as {}, so anything that isn't an array is an empty queue
	function asArray(v: unknown): string[] {
		return Array.isArray(v) ? v : [];
	}

	async function applyQueue(data: { queue: string[], instance?: string, player?: string }) {
		await sendOrderedRcon(`/sc research_sync.apply_queue("${lib.escapeString(JSON.stringify(data))}")`, true);
	}

	// queue null asks for the cluster queue without seeding it
	async function followQueue(queue: string[] | null, player: string | null) {
		let applied = queueEventsApplied;
		let result = await instance.sendTo("controller", new QueueSyncRequest(queue, player));
		// A QueueEvent handled meanwhile is at least as new as this reply, since the controller broadcasts every
		// queue change in order with its replies. Arriving in the same read, it is applied before the reply.
		if (queueEventsApplied !== applied) {
			return;
		}
		await applyQueue({ queue: result });
	}

	async function syncQueue(seed: boolean) {
		let state = JSON.parse(await sendOrderedRcon("/sc research_sync.queue_state()"));
		if (state.follow) {
			await followQueue(seed && state.first ? asArray(state.queue) : null, null);
		}
	}

	async function researchContribution(tech: IpcContribution) {
		if (host.connector.connected) {
			instance.sendTo("controller", new ContributionEvent(tech.name, tech.level, tech.contribution));
			return;
		}
		let pending = pendingContributions.get(tech.name);
		if (pending && pending.level === tech.level) {
			pending.contribution += tech.contribution;
		} else if (!pending || pending.level < tech.level) {
			// A lower level finished here, the technology sync reports it
			pendingContributions.set(tech.name, { ...tech });
		}
	}

	async function researchFinished(tech: IpcFinished) {
		if (host.connector.connected) {
			instance.sendTo("controller", new FinishedEvent(tech.name, tech.level));
			return;
		}
		finishedWhileDisconnected = true;
	}

	function sendPendingContributions() {
		for (let tech of pendingContributions.values()) {
			instance.sendTo("controller", new ContributionEvent(tech.name, tech.level, tech.contribution));
		}
		pendingContributions.clear();
	}

	async function syncTechnologies() {
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
	}

	instance.server.on("ipc-research_sync:contribution", (tech: IpcContribution) => {
		researchContribution(tech).catch(err => unexpectedError(err));
	});
	instance.server.on("ipc-research_sync:finished", (tech: IpcFinished) => {
		researchFinished(tech).catch(err => unexpectedError(err));
	});

	instance.server.on("ipc-research_sync:queue", (data: IpcQueue) => {
		try {
			instance.sendTo("controller", new QueueUpdateEvent(asArray(data.queue), data.player ?? null));
		} catch (err: any) {
			unexpectedError(err);
		}
	});
	instance.server.on("ipc-research_sync:follow", (data: IpcQueue) => {
		followQueue(asArray(data.queue), data.player ?? null).catch(err => unexpectedError(err));
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

	instance.handle(QueueEvent, async (event: QueueEvent) => {
		if (!syncStarted || !["starting", "running"].includes(instance.status)) {
			return;
		}
		let data: { queue: string[], instance?: string, player?: string } = { queue: event.queue };
		if (event.instance !== null) {
			data.instance = event.instance;
		}
		if (event.player !== null) {
			data.player = event.player;
		}
		queueEventsApplied += 1;
		await applyQueue(data);
	});

	instance.hooks.start.attach(plugin.name, async () => {
		await syncTechnologies();

		// A first start counts as turning following on, which seeds an empty cluster queue
		await syncQueue(true);
	});

	// Events are lost both ways while the controller session is down. Contributions are kept above, finished
	// research comes from the technology sync, and the cluster queue replaces queue edits made meanwhile.
	instance.hooks.controllerConnectionEvent.attach(plugin.name, async (event) => {
		if (event !== "connect" && event !== "resume") {
			return;
		}
		try {
			sendPendingContributions();
			if (!syncStarted || !["starting", "running"].includes(instance.status)) {
				return;
			}
			if (event === "connect" || finishedWhileDisconnected) {
				finishedWhileDisconnected = false;
				try {
					await syncTechnologies();
				} catch (err) {
					finishedWhileDisconnected = true;
					throw err;
				}
			}
			if (event === "connect") {
				await syncQueue(false);
			}
		} catch (err: any) {
			unexpectedError(err);
		}
	});
}
